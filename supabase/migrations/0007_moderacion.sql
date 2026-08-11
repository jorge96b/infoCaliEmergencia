-- infoCaliEmergencia — 0007: moderación humana.
--
-- Hasta aquí la moderación era automática y sin marcha atrás: tres denuncias de
-- dispositivos distintos ocultaban una fila y nadie podía volver a mostrarla sin
-- entrar a la consola de Supabase a escribir SQL. Esta migración pone a una
-- persona en el bucle, y hace que su decisión pese más que el automatismo.
--
-- Van incluidos dos arreglos, porque sin ellos el botón "Aprobar" del panel
-- sería puro adorno:
--
--   1. `fn_auto_ocultar` se volvía a disparar en la cuarta denuncia y en todas
--      las siguientes. Tres cuentas coordinadas deshacían cada decisión tantas
--      veces como quisieran, y el moderador quedaba en una rueda de hámster.
--   2. `rpc_reportar_*` ponía `oculto = false` al rectificar dentro de la misma
--      hora, así que un reporte escondido a mano se destapaba solo en cuanto su
--      autor lo repetía.
--
-- La pieza que arregla las dos es `decisiones_moderacion`: si hay decisión
-- humana sobre una fila, gana, tanto contra el trigger como contra el upsert.
--
-- Requiere Supabase: usa `auth.uid()` para saber quién está actuando.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
end $$;

grant usage on schema public to authenticated;

-- ---------------------------------------------------------------------------
-- Quién puede moderar
--
-- Los moderadores se crean a mano en Supabase → Authentication → Users y luego
-- se insertan aquí. No hay registro público ni invitaciones: son tres o cinco
-- personas de confianza, y esa lista se mantiene a mano a propósito.
--
-- `id` es un `auth.users.id`, pero NO lleva clave foránea a esa tabla. Dos
-- razones: `prueba_logica.sql` tiene que poder crear un moderador de mentira y
-- borrarlo sin tocar el esquema de autenticación de Supabase, y un id huérfano
-- es inofensivo — nadie puede obtener un JWT para un usuario que ya no existe.
-- Para revocar a alguien se pone `activo = false`, que además deja rastro.
-- ---------------------------------------------------------------------------

create table if not exists moderadores (
  id        uuid primary key,
  nombre    text not null check (length(btrim(nombre)) between 2 and 60),
  activo    boolean not null default true,
  creado_en timestamptz not null default now()
);

-- SECURITY DEFINER a propósito: si leyera `moderadores` con los permisos de
-- quien la invoca, la política de esa misma tabla volvería a llamarla y la
-- recursión revienta. `auth.uid()` va cualificado para no depender del
-- search_path.
create or replace function es_moderador() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from moderadores m where m.id = auth.uid() and m.activo
  );
$$;

-- ---------------------------------------------------------------------------
-- Decisiones
--
-- Una fila por objetivo, no por denuncia: el moderador juzga la fila, y esa
-- sentencia resuelve todas las denuncias que la señalaban.
--
--   `aprobado` = revisada y legítima. Inmune al auto-ocultamiento.
--   `oculto`   = escondida por decisión humana. Inmune al destape automático.
-- ---------------------------------------------------------------------------

create table if not exists decisiones_moderacion (
  tabla       text not null check (tabla in ('puntos', 'necesidad_reportes',
                                             'insumo_reportes', 'persona_reportes')),
  fila_id     text not null,
  decision    text not null check (decision in ('aprobado', 'oculto')),
  moderador   uuid not null references moderadores (id),
  motivo      text check (length(motivo) <= 280),
  decidido_en timestamptz not null default now(),
  primary key (tabla, fila_id)
);

-- ---------------------------------------------------------------------------
-- Bitácora
--
-- Sólo se inserta (desde los RPC) y se lee. Nadie recibe UPDATE ni DELETE, ni
-- siquiera los moderadores: una bitácora que se puede editar no es una
-- bitácora. Con cinco personas actuando sobre la misma base, esto es lo único
-- que permite reconstruir quién decidió qué cuando algo salga mal.
-- ---------------------------------------------------------------------------

create table if not exists acciones_moderacion (
  id             bigint generated always as identity primary key,
  moderador      uuid not null references moderadores (id),
  accion         text not null check (accion in ('aprobar', 'ocultar', 'bloquear',
                                                 'desbloquear', 'ocultar_todo')),
  tabla          text,
  fila_id        text,
  dispositivo_id uuid,
  motivo         text check (length(motivo) <= 280),
  creado_en      timestamptz not null default now()
);

create index if not exists acciones_recientes_idx on acciones_moderacion (creado_en desc);

-- ---------------------------------------------------------------------------
-- Arreglo 1: el auto-ocultamiento respeta lo ya aprobado
--
-- Reemplaza la versión de 0003. Único cambio: la guarda inicial.
-- ---------------------------------------------------------------------------

create or replace function fn_auto_ocultar() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  -- Una fila que un moderador ya revisó y aprobó no vuelve a caer por
  -- denuncias. Sin esto, tres cuentas coordinadas deshacen cada decisión y
  -- moderar se convierte en achicar agua con un balde agujereado.
  if exists (
    select 1 from decisiones_moderacion d
     where d.tabla = new.tabla and d.fila_id = new.fila_id and d.decision = 'aprobado'
  ) then
    return null;
  end if;

  -- Un punto oficial tampoco cae por votación. La intención de `origen =
  -- 'oficial'` siempre fue ésa, pero hasta aquí sólo se aplicaba a
  -- `punto_confirmaciones`: por esta vía tres cuentas coordinadas podían borrar
  -- del mapa un albergue verificado, que es justo lo que no puede pasar. Un
  -- moderador sí puede ocultarlo a mano si de verdad cerró.
  if new.tabla = 'puntos' and exists (
    select 1 from puntos p where p.id::text = new.fila_id and p.origen = 'oficial'
  ) then
    return null;
  end if;

  select count(*) into v_n from reportes_abuso
   where tabla = new.tabla and fila_id = new.fila_id;

  if v_n >= 3 then
    execute format('update public.%I set oculto = true where id::text = $1', new.tabla)
      using new.fila_id;
  end if;
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- Arreglo 2: rectificar un reporte no destapa lo escondido a mano
--
-- Reemplazan a las de 0004. Único cambio: el `oculto = false` del
-- `on conflict do update` pasa a consultar si hay decisión humana en contra.
-- ---------------------------------------------------------------------------

create or replace function rpc_reportar_necesidad(
  p_punto        uuid,
  p_recurso      text,
  p_dispositivo  uuid,
  p_voto         smallint,
  p_client_id    uuid,
  p_cantidad     numeric     default null,
  p_nota         text        default null,
  p_reportado_en timestamptz default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  select id into v_id from necesidad_reportes where client_id = p_client_id;
  if v_id is not null then
    return v_id;
  end if;

  perform fn_asegurar_dispositivo(p_dispositivo);

  insert into necesidad_reportes
    (punto_id, recurso, dispositivo_id, voto, cantidad, nota, client_id, reportado_en)
  values
    (p_punto, p_recurso, p_dispositivo, p_voto, p_cantidad, p_nota, p_client_id, p_reportado_en)
  on conflict (punto_id, recurso, dispositivo_id, slot)
  do update set voto        = excluded.voto,
                cantidad    = coalesce(excluded.cantidad, necesidad_reportes.cantidad),
                nota        = coalesce(excluded.nota, necesidad_reportes.nota),
                efectivo_en = greatest(necesidad_reportes.efectivo_en, excluded.efectivo_en),
                oculto      = exists (
                  select 1 from decisiones_moderacion d
                   where d.tabla = 'necesidad_reportes'
                     and d.fila_id = necesidad_reportes.id::text
                     and d.decision = 'oculto')
  returning id into v_id;

  return v_id;
end $$;

create or replace function rpc_reportar_insumo(
  p_punto        uuid,
  p_recurso      text,
  p_dispositivo  uuid,
  p_nivel        nivel_stock,
  p_client_id    uuid,
  p_cantidad     numeric     default null,
  p_nota         text        default null,
  p_reportado_en timestamptz default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  select id into v_id from insumo_reportes where client_id = p_client_id;
  if v_id is not null then
    return v_id;
  end if;

  perform fn_asegurar_dispositivo(p_dispositivo);

  insert into insumo_reportes
    (punto_id, recurso, dispositivo_id, nivel, cantidad, nota, client_id, reportado_en)
  values
    (p_punto, p_recurso, p_dispositivo, p_nivel, p_cantidad, p_nota, p_client_id, p_reportado_en)
  on conflict (punto_id, recurso, dispositivo_id, slot)
  do update set nivel       = excluded.nivel,
                cantidad    = coalesce(excluded.cantidad, insumo_reportes.cantidad),
                nota        = coalesce(excluded.nota, insumo_reportes.nota),
                efectivo_en = greatest(insumo_reportes.efectivo_en, excluded.efectivo_en),
                oculto      = exists (
                  select 1 from decisiones_moderacion d
                   where d.tabla = 'insumo_reportes'
                     and d.fila_id = insumo_reportes.id::text
                     and d.decision = 'oculto')
  returning id into v_id;

  return v_id;
end $$;

create or replace function rpc_reportar_personas(
  p_punto        uuid,
  p_dispositivo  uuid,
  p_estado       estado_persona,
  p_cantidad     smallint,
  p_client_id    uuid,
  p_nota         text        default null,
  p_reportado_en timestamptz default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  select id into v_id from persona_reportes where client_id = p_client_id;
  if v_id is not null then
    return v_id;
  end if;

  perform fn_asegurar_dispositivo(p_dispositivo);

  insert into persona_reportes
    (punto_id, dispositivo_id, estado, cantidad, nota, client_id, reportado_en)
  values
    (p_punto, p_dispositivo, p_estado, p_cantidad, p_nota, p_client_id, p_reportado_en)
  on conflict (punto_id, estado, dispositivo_id, slot)
  do update set cantidad    = excluded.cantidad,
                nota        = coalesce(excluded.nota, persona_reportes.nota),
                efectivo_en = greatest(persona_reportes.efectivo_en, excluded.efectivo_en),
                oculto      = exists (
                  select 1 from decisiones_moderacion d
                   where d.tabla = 'persona_reportes'
                     and d.fila_id = persona_reportes.id::text
                     and d.decision = 'oculto')
  returning id into v_id;

  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Vistas de moderación
--
-- Al revés que las vistas del mapa, éstas se otorgan sólo a `authenticated` y
-- llevan `where es_moderador()` dentro del propio cuerpo. Siguen corriendo como
-- dueño (security_invoker apagado, igual que las demás), así que ven lo oculto
-- sin que haya que abrir ni un permiso nuevo sobre las tablas base: `anon` no
-- gana absolutamente nada en esta migración.
--
-- Un `authenticated` que no sea moderador recibe cero filas, no un error. Es
-- deliberado: distinguir "no tienes permiso" de "no hay nada" le diría a quien
-- husmea que el panel existe.
-- ---------------------------------------------------------------------------

-- Las cuatro tablas denunciables, normalizadas a una forma común. Es lo que
-- permite que el moderador vea QUÉ está juzgando sin abrir otra pantalla:
-- juzgar un `fila_id` a ciegas no es moderar, es tirar una moneda.
create or replace view v_filas_denunciables as
  select 'puntos'::text            as tabla,
         p.id::text                as fila_id,
         p.id                      as punto_id,
         p.nombre                  as punto,
         p.creado_por              as dispositivo_id,
         p.nombre || ' · ' || tp.etiqueta as texto,
         coalesce(p.descripcion, '')      as detalle,
         p.creado_en,
         p.oculto
    from puntos p
    join tipos_punto tp on tp.slug = p.tipo
   where es_moderador()

  union all

  select 'necesidad_reportes', n.id::text, n.punto_id, pu.nombre, n.dispositivo_id,
         case when n.voto > 0 then 'Falta ' else 'Ya llegó ' end || r.etiqueta,
         coalesce(n.nota, ''), n.creado_en, n.oculto
    from necesidad_reportes n
    join puntos pu   on pu.id = n.punto_id
    join recursos r  on r.slug = n.recurso
   where es_moderador()

  union all

  select 'insumo_reportes', i.id::text, i.punto_id, pu.nombre, i.dispositivo_id,
         r.etiqueta || ' — ' || i.nivel::text,
         coalesce(i.nota, ''), i.creado_en, i.oculto
    from insumo_reportes i
    join puntos pu   on pu.id = i.punto_id
    join recursos r  on r.slug = i.recurso
   where es_moderador()

  union all

  select 'persona_reportes', pe.id::text, pe.punto_id, pu.nombre, pe.dispositivo_id,
         pe.cantidad::text || ' ' || pe.estado::text,
         coalesce(pe.nota, ''), pe.creado_en, pe.oculto
    from persona_reportes pe
    join puntos pu on pu.id = pe.punto_id
   where es_moderador();

-- La cola: una tarjeta por fila denunciada, no una por denuncia.
create or replace view v_cola_moderacion as
  select a.tabla,
         a.fila_id,
         count(*)                                             as denuncias,
         count(*) filter (where a.motivo = 'ofensivo')        as ofensivo,
         count(*) filter (where a.motivo = 'falso')           as falso,
         count(*) filter (where a.motivo = 'duplicado')       as duplicado,
         count(*) filter (where a.motivo = 'resuelto')        as resuelto,
         count(*) filter (where a.motivo = 'otro')            as otro,
         min(a.creado_en)                                     as primera,
         max(a.creado_en)                                     as ultima,
         coalesce(
           array_agg(a.detalle order by a.creado_en desc)
             filter (where a.detalle is not null and btrim(a.detalle) <> ''),
           array[]::text[])                                   as detalles,
         f.punto_id,
         f.punto,
         f.dispositivo_id,
         f.texto,
         f.detalle       as contenido,
         f.creado_en     as fila_creada_en,
         f.oculto,
         -- `reportes_abuso.fila_id` es `text` sin clave foránea ni cascada, así
         -- que una fila borrada deja denuncias apuntando al vacío. Se marcan en
         -- vez de desaparecer: una denuncia que se evapora sin explicación es
         -- peor que una que dice "esto ya no existe".
         (f.fila_id is null) as huerfano,
         d.decision,
         d.decidido_en,
         d.motivo        as motivo_decision
    from reportes_abuso a
    left join v_filas_denunciables f
           on f.tabla = a.tabla and f.fila_id = a.fila_id
    left join decisiones_moderacion d
           on d.tabla = a.tabla and d.fila_id = a.fila_id
   where es_moderador()
   group by a.tabla, a.fila_id, f.fila_id, f.punto_id, f.punto, f.dispositivo_id,
            f.texto, f.detalle, f.creado_en, f.oculto,
            d.decision, d.decidido_en, d.motivo;

-- Ficha del dispositivo: lo que hay que mirar ANTES de bloquear. Incluye las
-- denuncias que EMITIÓ, no sólo las que recibió — alguien que dispara diez
-- denuncias en media hora está intentando tumbar información legítima, y ese
-- abuso hoy no se ve por ninguna parte.
create or replace view v_ficha_dispositivo as
  select d.id,
         d.bloqueado,
         d.motivo,
         d.creado_en,
         d.visto_en,
         (select count(*) from puntos p             where p.creado_por    = d.id) as puntos,
         (select count(*) from necesidad_reportes n where n.dispositivo_id = d.id) as necesidades,
         (select count(*) from insumo_reportes i    where i.dispositivo_id = d.id) as insumos,
         (select count(*) from persona_reportes pe  where pe.dispositivo_id = d.id) as personas,
         (select count(*) from reportes_abuso a     where a.dispositivo_id = d.id) as denuncias_emitidas,
         (select count(*) from reportes_abuso a
            join v_filas_denunciables f on f.tabla = a.tabla and f.fila_id = a.fila_id
           where f.dispositivo_id = d.id)                                          as denuncias_recibidas,
         (select count(*) from v_filas_denunciables f
           where f.dispositivo_id = d.id and f.oculto)                             as filas_ocultas
    from dispositivos d
   where es_moderador();

-- Salud: si las denuncias por hora se disparan, es señal de ataque coordinado y
-- conviene mirar dos veces antes de aprobar u ocultar nada.
create or replace view v_salud_moderacion as
  select (select count(*) from reportes_abuso where creado_en > now() - interval '1 hour')  as denuncias_1h,
         (select count(*) from reportes_abuso where creado_en > now() - interval '24 hours') as denuncias_24h,
         (select count(*) from v_cola_moderacion where decision is null)                     as pendientes,
         (select count(*) from v_filas_denunciables where oculto)                            as ocultas,
         (select count(*) from dispositivos where bloqueado)                                 as bloqueados,
         (select count(*) from acciones_moderacion where creado_en > now() - interval '24 hours') as acciones_24h,
         now() as generado_en
   where es_moderador();

-- La bitácora con el nombre de quien actuó; sin el nombre no sirve de nada.
create or replace view v_bitacora as
  select b.id, b.accion, b.tabla, b.fila_id, b.dispositivo_id, b.motivo, b.creado_en,
         m.nombre as moderador
    from acciones_moderacion b
    join moderadores m on m.id = b.moderador
   where es_moderador()
   order by b.creado_en desc;

-- ---------------------------------------------------------------------------
-- Acciones de moderación
--
-- Nada se borra nunca: todo es un `oculto` o un `bloqueado` reversible, más una
-- fila de bitácora. En una emergencia, un moderador cansado se equivoca; el
-- diseño tiene que dar por hecho que va a pasar y dejar volver atrás.
-- ---------------------------------------------------------------------------

create or replace function rpc_mod_decidir(
  p_tabla text, p_fila_id text, p_decision text, p_motivo text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_mod uuid := auth.uid();
begin
  if not es_moderador() then
    raise exception 'Solo los moderadores pueden hacer esto.' using errcode = '42501';
  end if;

  -- `format(%I)` ya entrecomilla el identificador, así que no hay inyección
  -- posible; la lista blanca está para dar un error legible en vez de un
  -- "relation does not exist" críptico.
  if p_tabla not in ('puntos', 'necesidad_reportes', 'insumo_reportes', 'persona_reportes') then
    raise exception 'Tabla desconocida: %', p_tabla using errcode = '22P02';
  end if;
  if p_decision not in ('aprobado', 'oculto') then
    raise exception 'Decisión desconocida: %', p_decision using errcode = '22P02';
  end if;

  insert into decisiones_moderacion (tabla, fila_id, decision, moderador, motivo)
  values (p_tabla, p_fila_id, p_decision, v_mod, p_motivo)
  on conflict (tabla, fila_id)
  do update set decision    = excluded.decision,
                moderador   = excluded.moderador,
                motivo      = excluded.motivo,
                decidido_en = now();

  execute format('update public.%I set oculto = $1 where id::text = $2', p_tabla)
    using (p_decision = 'oculto'), p_fila_id;

  insert into acciones_moderacion (moderador, accion, tabla, fila_id, motivo)
  values (v_mod,
          case when p_decision = 'oculto' then 'ocultar' else 'aprobar' end,
          p_tabla, p_fila_id, p_motivo);
end $$;

create or replace function rpc_mod_bloquear(
  p_dispositivo uuid,
  p_bloqueado   boolean,
  p_motivo      text,
  p_ocultar_todo boolean default false
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_mod   uuid := auth.uid();
  v_tabla text;
begin
  if not es_moderador() then
    raise exception 'Solo los moderadores pueden hacer esto.' using errcode = '42501';
  end if;

  -- El motivo es obligatorio para bloquear. `dispositivos.motivo` existe desde
  -- 0001 y hasta hoy nadie lo escribía: un bloqueo sin razón anotada es
  -- imposible de revisar después, y de revertir con criterio.
  if p_bloqueado and coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Hay que decir por qué se bloquea.' using errcode = '22P02';
  end if;

  -- Al desbloquear se limpia el motivo: dejarlo puesto en un dispositivo que ya
  -- no está bloqueado confunde a quien lo mire después. La historia completa
  -- queda en la bitácora, que es donde tiene que estar.
  insert into dispositivos (id, bloqueado, motivo)
  values (p_dispositivo, p_bloqueado, case when p_bloqueado then p_motivo end)
  on conflict (id) do update set bloqueado = excluded.bloqueado,
                                 motivo    = excluded.motivo;

  -- Bloquear no borra lo ya publicado. Dejarlo en el mapa vacía de sentido el
  -- bloqueo, así que se puede ocultar todo de una vez — dejando decisión
  -- humana en cada fila, para que no se destape sola después.
  if p_ocultar_todo then
    insert into decisiones_moderacion (tabla, fila_id, decision, moderador, motivo)
    select 'puntos', p.id::text, 'oculto', v_mod, p_motivo
      from puntos p where p.creado_por = p_dispositivo
    on conflict (tabla, fila_id)
    do update set decision = 'oculto', moderador = excluded.moderador,
                  motivo = excluded.motivo, decidido_en = now();

    update puntos set oculto = true, actualizado_en = now()
     where creado_por = p_dispositivo;

    foreach v_tabla in array array['necesidad_reportes', 'insumo_reportes', 'persona_reportes'] loop
      execute format($f$
        insert into decisiones_moderacion (tabla, fila_id, decision, moderador, motivo)
        select %L, t.id::text, 'oculto', $1, $2 from public.%I t where t.dispositivo_id = $3
        on conflict (tabla, fila_id)
        do update set decision = 'oculto', moderador = excluded.moderador,
                      motivo = excluded.motivo, decidido_en = now()
      $f$, v_tabla, v_tabla) using v_mod, p_motivo, p_dispositivo;

      execute format('update public.%I set oculto = true where dispositivo_id = $1', v_tabla)
        using p_dispositivo;
    end loop;
  end if;

  insert into acciones_moderacion (moderador, accion, dispositivo_id, motivo)
  values (v_mod,
          case when not p_bloqueado then 'desbloquear'
               when p_ocultar_todo  then 'ocultar_todo'
               else 'bloquear' end,
          p_dispositivo, p_motivo);
end $$;

-- ---------------------------------------------------------------------------
-- Permisos
--
-- Regla de esta migración: `anon` no gana ni un permiso. Todo lo nuevo es para
-- `authenticated`, y dentro de `authenticated` todo pasa por `es_moderador()`.
--
-- Los `revoke` de abajo NO son decorativos. Supabase tiene privilegios por
-- omisión que conceden todo sobre cada tabla, vista y función nueva del esquema
-- `public` a `anon` y a `authenticated` — por eso 0003 abría con un
-- `revoke all on all tables`. Sin estos revoke, `anon` podría leer la cola de
-- denuncias entera y cualquier persona con sesión podría escribir la bitácora.
-- ---------------------------------------------------------------------------

alter table moderadores           enable row level security;
alter table decisiones_moderacion enable row level security;
alter table acciones_moderacion   enable row level security;

revoke all on moderadores, decisiones_moderacion, acciones_moderacion
  from anon, authenticated;
revoke all on v_filas_denunciables, v_cola_moderacion, v_ficha_dispositivo,
              v_salud_moderacion, v_bitacora
  from anon, authenticated;

grant select on moderadores, decisiones_moderacion, acciones_moderacion to authenticated;

create policy p_moderadores_select on moderadores
  for select to authenticated using (es_moderador());
create policy p_decisiones_select on decisiones_moderacion
  for select to authenticated using (es_moderador());
create policy p_acciones_select on acciones_moderacion
  for select to authenticated using (es_moderador());

-- Ni siquiera los moderadores escriben estas tablas directamente: todo pasa por
-- los RPC, que son los que dejan rastro en la bitácora.

grant select on v_filas_denunciables, v_cola_moderacion, v_ficha_dispositivo,
                v_salud_moderacion, v_bitacora to authenticated;

revoke all on function es_moderador() from public, anon;
revoke all on function rpc_mod_decidir(text, text, text, text) from public, anon;
revoke all on function rpc_mod_bloquear(uuid, boolean, text, boolean) from public, anon;

grant execute on function
  es_moderador(),
  rpc_mod_decidir(text, text, text, text),
  rpc_mod_bloquear(uuid, boolean, text, boolean)
to authenticated;
