-- infoCaliEmergencia — 0003: permisos, RLS y límites de tasa.
--
-- Marco honesto: la `anon key` de Supabase es pública por diseño, así que nada
-- de lo que hay aquí es autenticación. El trabajo de estas políticas es acotar
-- la FORMA de lo que un cliente anónimo puede hacer —sólo insertar, bien
-- formado, acotado, sin destruir nada— y encarecer el abuso, no impedirlo.
--
-- Son tres capas, cada una haciendo lo que mejor sabe:
--
--   1. GRANTs por columna. La más barata y la que más se olvida. `anon` no
--      recibe DELETE ni UPDATE amplio, y no recibe INSERT sobre `creado_en`, así
--      que un cliente no puede antedatar un reporte para manipular el decaimiento
--      aunque lo intente.
--   2. Índices únicos por `slot` (ver 0001). Hacen imposible que un dispositivo
--      mueva el puntaje de una necesidad más de ±1 por hora. No es una
--      heurística: aunque reenvíe diez mil inserciones, el puntaje no cambia.
--   3. Un trigger BEFORE INSERT para el volumen y la lista de bloqueo.

-- Roles de Supabase. En un proyecto real ya existen; el `if not exists` permite
-- correr estas migraciones también contra un Postgres local de pruebas.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
end $$;

grant usage on schema public to anon;

-- ---------------------------------------------------------------------------
-- Identidad del dispositivo
--
-- El UUID viaja en la cabecera `x-device-id`, que el cliente fija globalmente al
-- construir el cliente de Supabase.
-- ---------------------------------------------------------------------------

create or replace function dispositivo_actual() returns uuid
language sql stable as $$
  select nullif(current_setting('request.headers', true)::json ->> 'x-device-id', '')::uuid;
$$;

grant execute on function dispositivo_actual() to anon;
grant execute on function peso(timestamptz, numeric) to anon;

-- ---------------------------------------------------------------------------
-- Límite de tasa y registro automático del dispositivo
-- ---------------------------------------------------------------------------

create or replace function fn_limite_tasa() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_max  int := coalesce(nullif(tg_argv[0], '')::int, 30);
  v_mins int := coalesce(nullif(tg_argv[1], '')::int, 10);
  v_n    int;
begin
  -- Alta implícita: el primer reporte de un dispositivo lo registra, así que la
  -- clave foránea nunca se rompe y el cliente no necesita un paso de "registro".
  insert into dispositivos (id) values (new.dispositivo_id)
    on conflict (id) do update set visto_en = now();

  if exists (select 1 from dispositivos d where d.id = new.dispositivo_id and d.bloqueado) then
    raise exception 'Este dispositivo fue bloqueado por reportes falsos.'
      using errcode = '42501';
  end if;

  execute format(
    'select count(*) from public.%I where dispositivo_id = $1 and creado_en > now() - $2',
    tg_table_name)
    into v_n
    using new.dispositivo_id, make_interval(mins => v_mins);

  if v_n >= v_max then
    raise exception 'Demasiados reportes seguidos. Espera unos minutos.'
      using errcode = 'P0001';
  end if;

  return new;
end $$;

create trigger t_lim_necesidad before insert on necesidad_reportes
  for each row execute function fn_limite_tasa('30', '10');
create trigger t_lim_insumo before insert on insumo_reportes
  for each row execute function fn_limite_tasa('30', '10');
create trigger t_lim_persona before insert on persona_reportes
  for each row execute function fn_limite_tasa('15', '10');
create trigger t_lim_confirmacion before insert on punto_confirmaciones
  for each row execute function fn_limite_tasa('40', '10');
create trigger t_lim_abuso before insert on reportes_abuso
  for each row execute function fn_limite_tasa('10', '30');

-- ---------------------------------------------------------------------------
-- Auto-ocultamiento por denuncias
--
-- Tres denuncias de dispositivos distintos ocultan la fila. Todas las vistas
-- filtran por `not oculto`, así que desaparece del mapa hasta que un moderador
-- la revise. Es reversible: la fila nunca se borra.
-- ---------------------------------------------------------------------------

create or replace function fn_auto_ocultar() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  select count(*) into v_n from reportes_abuso
   where tabla = new.tabla and fila_id = new.fila_id;

  if v_n >= 3 then
    execute format('update public.%I set oculto = true where id::text = $1', new.tabla)
      using new.fila_id;
  end if;
  return null;
end $$;

create trigger t_auto_ocultar after insert on reportes_abuso
  for each row execute function fn_auto_ocultar();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table puntos               enable row level security;
alter table punto_confirmaciones enable row level security;
alter table necesidad_reportes   enable row level security;
alter table insumo_reportes      enable row level security;
alter table persona_reportes     enable row level security;
alter table presencia            enable row level security;
alter table reportes_abuso       enable row level security;
alter table dispositivos         enable row level security;

revoke all on all tables in schema public from anon;

-- Catálogos: lectura pública.
grant select on tipos_punto, recursos to anon;

-- Puntos: lectura libre. La creación pasa por rpc_crear_punto (0004), que
-- deduplica por cercanía; por eso no hay política de INSERT aquí.
grant select on puntos to anon;
create policy p_puntos_select on puntos
  for select to anon
  using (not oculto and estado <> 'duplicado');

-- Confirmaciones de punto.
grant select on punto_confirmaciones to anon;
grant insert (punto_id, dispositivo_id, voto, client_id) on punto_confirmaciones to anon;
create policy p_conf_select on punto_confirmaciones for select to anon using (true);
create policy p_conf_insert on punto_confirmaciones
  for insert to anon
  with check (dispositivo_id = dispositivo_actual() and voto in (-1, 1));

-- Necesidades. Nótese que `creado_en`, `efectivo_en` y `slot` quedan fuera del
-- GRANT de INSERT: los fija el trigger de normalización, no el cliente.
grant select on necesidad_reportes to anon;
grant insert (punto_id, recurso, dispositivo_id, voto, cantidad, nota, client_id, reportado_en)
  on necesidad_reportes to anon;
create policy p_nec_select on necesidad_reportes for select to anon using (not oculto);
create policy p_nec_insert on necesidad_reportes
  for insert to anon
  with check (
    dispositivo_id = dispositivo_actual()
    and voto in (-1, 1)
    and exists (
      select 1 from puntos pu
      where pu.id = punto_id and pu.estado = 'activo' and not pu.oculto
    )
  );

-- Insumos disponibles.
grant select on insumo_reportes to anon;
grant insert (punto_id, recurso, dispositivo_id, nivel, cantidad, nota, client_id, reportado_en)
  on insumo_reportes to anon;
create policy p_ins_select on insumo_reportes for select to anon using (not oculto);
create policy p_ins_insert on insumo_reportes
  for insert to anon
  with check (
    dispositivo_id = dispositivo_actual()
    and exists (
      select 1 from puntos pu
      where pu.id = punto_id and pu.estado = 'activo' and not pu.oculto
    )
  );

-- Conteos de personas.
grant select on persona_reportes to anon;
grant insert (punto_id, dispositivo_id, estado, cantidad, nota, client_id, reportado_en)
  on persona_reportes to anon;
create policy p_per_select on persona_reportes for select to anon using (not oculto);
create policy p_per_insert on persona_reportes
  for insert to anon
  with check (dispositivo_id = dispositivo_actual() and cantidad between 0 and 500);

-- Denuncias: sólo escritura. No se pueden leer a propósito, para que nadie
-- pueda medir cuántas faltan para tumbar un reporte legítimo.
grant insert (tabla, fila_id, dispositivo_id, motivo, detalle, client_id) on reportes_abuso to anon;
create policy p_abuso_insert on reportes_abuso
  for insert to anon
  with check (dispositivo_id = dispositivo_actual());

-- `presencia` y `dispositivos` no reciben ningún GRANT: se escriben sólo por RPC
-- y se leen sólo agregadas. Cuánta gente hay en un punto es información útil;
-- qué dispositivo está en cuál, no.

-- ---------------------------------------------------------------------------
-- Vistas
--
-- Las vistas pertenecen al dueño de la migración y se ejecutan con sus permisos
-- (security_invoker desactivado, que es el comportamiento por omisión). Esto es
-- deliberado y necesario: así `v_presencia` puede publicar conteos sin que
-- `anon` tenga acceso de lectura a la tabla `presencia`. El linter de seguridad
-- de Supabase marcará estas vistas — es una excepción consciente, no un olvido.
-- ---------------------------------------------------------------------------

grant select on v_necesidades, v_insumos, v_presencia, v_personas,
                v_verificacion, v_puntos_mapa, v_mapa_calor, v_global to anon;
