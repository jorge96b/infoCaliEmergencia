-- infoCaliEmergencia — 0009: avisos oficiales y reporte de situación.
--
-- Hasta aquí la app sólo sabía de información reportada por la comunidad y
-- validada por consenso. Falta la otra mitad: lo que publica la autoridad y no
-- se vota — un toque de queda, un pico y placa, el cierre de una clínica, el
-- conteo oficial de víctimas.
--
-- Son datos de otra naturaleza y se guardan aparte a propósito. Mezclar las
-- cifras de la Alcaldía con los conteos de la comunidad haría imposible saber
-- qué está verificado y qué no, que es justo lo que esta app existe para evitar.
--
-- La diferencia de fondo con todo lo demás del esquema es la VIGENCIA. Aquí
-- toda caducidad era implícita y calculada al leer: decaimiento exponencial,
-- ventanas de 24 h, latido de 90 min. Un toque de queda necesita lo contrario,
-- una ventana explícita con principio y fin, porque seguir mostrándolo después
-- de las 6 a.m. sería exactamente la desinformación que queremos combatir.
--
-- Nota sobre la numeración: existen dos archivos 0008 (`0008_actividad.sql` y
-- `0008_recurso_otro.sql`). Se salvan porque tocan objetos disjuntos y el orden
-- alfabético los ordena bien, pero la colisión es real y por eso esto es 0009.

-- ---------------------------------------------------------------------------
-- Enums
--
-- El orden de `severidad_aviso` no es decorativo: los enums de Postgres ordenan
-- por posición de declaración, así que `order by severidad` deja lo crítico
-- arriba sin necesidad de un CASE.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'severidad_aviso') then
    create type severidad_aviso as enum ('critico', 'importante', 'informativo');
  end if;
  if not exists (select 1 from pg_type where typname = 'tipo_aviso') then
    create type tipo_aviso as enum ('toque_queda', 'movilidad', 'servicios', 'salud', 'otro');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Avisos
-- ---------------------------------------------------------------------------

create table if not exists avisos (
  id             uuid primary key default gen_random_uuid(),
  tipo           tipo_aviso not null default 'otro',
  severidad      severidad_aviso not null default 'importante',
  titulo         text not null check (length(btrim(titulo)) between 3 and 120),
  cuerpo         text check (length(cuerpo) <= 2000),
  fuente         text not null default 'Alcaldía de Santiago de Cali'
                   check (length(fuente) between 2 and 120),
  enlace         text check (enlace is null or enlace ~ '^https?://'),

  -- La ventana. `vigente_hasta` nulo significa "sin caducidad conocida", que es
  -- lo correcto para un cierre de clínica pero nunca para un toque de queda.
  vigente_desde  timestamptz not null default now(),
  vigente_hasta  timestamptz,
  check (vigente_hasta is null or vigente_hasta > vigente_desde),

  -- Fijado = sale en la franja sobre el mapa, no sólo en la lista. Se reserva
  -- para lo que cambia lo que la gente puede hacer ahora mismo.
  fijado         boolean not null default false,

  -- Retirado a mano, para cuando un aviso deja de aplicar antes de vencer. No
  -- se borra: el histórico de lo que se anunció importa.
  retirado       boolean not null default false,

  publicado_por  uuid references moderadores (id),
  creado_en      timestamptz not null default now()
);

create index if not exists avisos_vigencia_idx
  on avisos (vigente_desde desc, vigente_hasta) where not retirado;

-- ---------------------------------------------------------------------------
-- Reporte de situación
--
-- Tabla aparte y no un aviso más porque las cifras son estructuradas y siempre
-- se consultan igual: la más reciente. Cada boletín se guarda como una fila
-- nueva; nunca se actualiza la anterior, para poder mirar la evolución.
--
-- `reportado_en` es la hora que trae el boletín, no la de carga: si alguien
-- sube a medianoche el reporte de las 7:30 p.m., lo que la gente tiene que ver
-- es 7:30 p.m.
-- ---------------------------------------------------------------------------

create table if not exists reportes_oficiales (
  id            uuid primary key default gen_random_uuid(),
  numero        integer check (numero > 0),
  fuente        text not null default 'Alcaldía de Santiago de Cali',
  reportado_en  timestamptz not null,
  fallecidos    integer check (fallecidos >= 0),
  rescatados    integer check (rescatados >= 0),
  colapsadas    integer check (colapsadas >= 0),
  con_danos     integer check (con_danos >= 0),
  salud         text check (length(salud) <= 1000),
  servicios     text check (length(servicios) <= 1000),
  publicado_por uuid references moderadores (id),
  creado_en     timestamptz not null default now()
);

create index if not exists reportes_oficiales_recientes_idx
  on reportes_oficiales (reportado_en desc);

-- ---------------------------------------------------------------------------
-- Vistas
--
-- El filtro va escrito en el cuerpo, no delegado a RLS: en este esquema las
-- vistas corren con los permisos de su dueño (`security_invoker` apagado), así
-- que no heredan las políticas de las tablas.
-- ---------------------------------------------------------------------------

-- Incluye lo que rige ahora y lo que empieza en las próximas 48 h, marcando
-- cuál es cuál. Un pico y placa que arranca mañana a las 6 a. m. hay que poder
-- anunciarlo esta noche, pero jamás mostrarlo como si ya estuviera rigiendo:
-- por eso viaja con su `estado` y la franja del mapa sólo deja pasar
-- `vigente`.
create or replace view v_avisos as
select id,
       tipo,
       severidad,
       titulo,
       cuerpo,
       fuente,
       enlace,
       vigente_desde,
       vigente_hasta,
       fijado,
       creado_en,
       case when now() >= vigente_desde then 'vigente' else 'proximo' end as estado
from avisos
where not retirado
  and (vigente_hasta is null or now() < vigente_hasta)
  and vigente_desde < now() + interval '48 hours'
-- Lo que rige ahora antes que lo que viene; luego lo crítico; dentro de cada
-- nivel, lo que vence antes, que es lo que más urge saber. Los que no caducan
-- van al final de su grupo.
order by (now() >= vigente_desde) desc,
         severidad,
         vigente_hasta nulls last,
         vigente_desde;

create or replace view v_reporte_oficial as
select numero, fuente, reportado_en,
       fallecidos, rescatados, colapsadas, con_danos,
       salud, servicios, creado_en
from reportes_oficiales
order by reportado_en desc
limit 1;

-- ---------------------------------------------------------------------------
-- Publicación
--
-- Primera vía de escritura de contenido público para un moderador: hasta ahora
-- sólo podían ocultar y bloquear. El CHECK de `acciones_moderacion` hay que
-- ampliarlo para que quepan las acciones nuevas.
-- ---------------------------------------------------------------------------

alter table acciones_moderacion drop constraint if exists acciones_moderacion_accion_check;
alter table acciones_moderacion add constraint acciones_moderacion_accion_check
  check (accion in ('aprobar', 'ocultar', 'bloquear', 'desbloquear', 'ocultar_todo',
                    'publicar_aviso', 'retirar_aviso', 'publicar_reporte'));

create or replace function rpc_mod_publicar_aviso(
  p_titulo        text,
  p_tipo          tipo_aviso,
  p_severidad     severidad_aviso,
  p_vigente_desde timestamptz,
  p_vigente_hasta timestamptz default null,
  p_cuerpo        text default null,
  p_fijado        boolean default false,
  p_enlace        text default null,
  p_fuente        text default 'Alcaldía de Santiago de Cali'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_mod uuid := auth.uid();
  v_id  uuid;
begin
  if not es_moderador() then
    raise exception 'Solo los moderadores pueden publicar avisos.' using errcode = '42501';
  end if;

  -- Un toque de queda sin hora de fin se quedaría en pantalla para siempre, que
  -- es el fallo más caro que puede tener esta pieza.
  if p_tipo = 'toque_queda' and p_vigente_hasta is null then
    raise exception 'Un toque de queda necesita hora de fin.' using errcode = '22P02';
  end if;

  insert into avisos (titulo, tipo, severidad, vigente_desde, vigente_hasta,
                      cuerpo, fijado, enlace, fuente, publicado_por)
  values (btrim(p_titulo), p_tipo, p_severidad, p_vigente_desde, p_vigente_hasta,
          nullif(btrim(coalesce(p_cuerpo, '')), ''), p_fijado,
          nullif(btrim(coalesce(p_enlace, '')), ''), p_fuente, v_mod)
  returning id into v_id;

  insert into acciones_moderacion (moderador, accion, tabla, fila_id, motivo)
  values (v_mod, 'publicar_aviso', 'avisos', v_id::text, left(btrim(p_titulo), 280));

  return v_id;
end $$;

create or replace function rpc_mod_retirar_aviso(p_id uuid, p_motivo text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare v_mod uuid := auth.uid();
begin
  if not es_moderador() then
    raise exception 'Solo los moderadores pueden hacer esto.' using errcode = '42501';
  end if;

  update avisos set retirado = true where id = p_id;
  if not found then
    raise exception 'Ese aviso no existe.' using errcode = '22P02';
  end if;

  insert into acciones_moderacion (moderador, accion, tabla, fila_id, motivo)
  values (v_mod, 'retirar_aviso', 'avisos', p_id::text, p_motivo);
end $$;

create or replace function rpc_mod_publicar_reporte(
  p_reportado_en timestamptz,
  p_numero       integer default null,
  p_fallecidos   integer default null,
  p_rescatados   integer default null,
  p_colapsadas   integer default null,
  p_con_danos    integer default null,
  p_salud        text    default null,
  p_servicios    text    default null,
  p_fuente       text    default 'Alcaldía de Santiago de Cali'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_mod uuid := auth.uid();
  v_id  uuid;
begin
  if not es_moderador() then
    raise exception 'Solo los moderadores pueden publicar reportes.' using errcode = '42501';
  end if;

  if p_reportado_en > now() + interval '5 minutes' then
    raise exception 'El reporte no puede venir del futuro.' using errcode = '22P02';
  end if;

  insert into reportes_oficiales (numero, fuente, reportado_en, fallecidos,
                                  rescatados, colapsadas, con_danos, salud,
                                  servicios, publicado_por)
  values (p_numero, p_fuente, p_reportado_en, p_fallecidos, p_rescatados,
          p_colapsadas, p_con_danos,
          nullif(btrim(coalesce(p_salud, '')), ''),
          nullif(btrim(coalesce(p_servicios, '')), ''), v_mod)
  returning id into v_id;

  insert into acciones_moderacion (moderador, accion, tabla, fila_id, motivo)
  values (v_mod, 'publicar_reporte', 'reportes_oficiales', v_id::text,
          'Reporte ' || coalesce('#' || p_numero, 'sin número'));

  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Permisos
--
-- Supabase concede permisos por omisión a `anon` y `authenticated` sobre cada
-- tabla nueva del esquema `public`, así que hay que revocar explícitamente.
-- `anon` sólo ve las vistas, que ya filtran por vigencia: nunca las tablas, o
-- podría leer avisos retirados, futuros o vencidos.
-- ---------------------------------------------------------------------------

alter table avisos             enable row level security;
alter table reportes_oficiales enable row level security;

revoke all on avisos, reportes_oficiales from anon, authenticated;
grant select on avisos, reportes_oficiales to authenticated;

revoke all on v_avisos, v_reporte_oficial from anon, authenticated;
grant select on v_avisos, v_reporte_oficial to anon, authenticated;

revoke all on function rpc_mod_publicar_aviso(text, tipo_aviso, severidad_aviso,
  timestamptz, timestamptz, text, boolean, text, text) from public, anon;
revoke all on function rpc_mod_retirar_aviso(uuid, text) from public, anon;
revoke all on function rpc_mod_publicar_reporte(timestamptz, integer, integer,
  integer, integer, integer, text, text, text) from public, anon;

grant execute on function
  rpc_mod_publicar_aviso(text, tipo_aviso, severidad_aviso, timestamptz,
                         timestamptz, text, boolean, text, text),
  rpc_mod_retirar_aviso(uuid, text),
  rpc_mod_publicar_reporte(timestamptz, integer, integer, integer, integer,
                           integer, text, text, text)
to authenticated;

-- Las políticas son para los moderadores; `anon` no tiene GRANT y no llega aquí.
drop policy if exists p_avisos_mod on avisos;
create policy p_avisos_mod on avisos for select to authenticated using (es_moderador());

drop policy if exists p_reportes_mod on reportes_oficiales;
create policy p_reportes_mod on reportes_oficiales
  for select to authenticated using (es_moderador());
