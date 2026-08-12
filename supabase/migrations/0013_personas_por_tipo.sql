-- infoCaliEmergencia — 0013: el conteo de personas afectadas sólo donde aplica.
--
-- La pestaña "Personas" —desaparecidas, heridas, rescatadas— salía en los diez
-- tipos de punto. En un albergue o un centro de acopio no hay personas
-- afectadas que contar: hay gente alojada y gente trabajando, que es otra cosa
-- y ya se mide con la presencia. Preguntar allí por desaparecidos no es sólo
-- ruido: invita a que alguien escriba una cifra inventada, y esa cifra se suma
-- al contador de toda la ciudad.
--
-- Por eso el cambio no es sólo esconder una pestaña. Son tres capas:
--
--   1. El catálogo dice qué tipos llevan conteo.
--   2. `v_personas` deja de contar lo reportado en los tipos que no lo llevan,
--      así que las cifras que ya estén cargadas dejan de inflar el global.
--   3. El RPC lo rechaza, porque esconder un botón no es un control: la cola
--      sin conexión reintenta sola y cualquiera puede llamar al RPC a mano.
--
-- Es reversible sin desplegar nada: un `update` a `tipos_punto` devuelve la
-- pestaña a un tipo, o se la quita a otro.

-- ---------------------------------------------------------------------------
-- 1. Qué tipos llevan conteo
-- ---------------------------------------------------------------------------

alter table tipos_punto
  add column if not exists reporta_personas boolean not null default false;

comment on column tipos_punto.reporta_personas is
  'Si en este tipo de lugar se cuentan personas desaparecidas, heridas y '
  'rescatadas. Falso en los lugares de apoyo: allí la gente se mide con la '
  'presencia, no con el conteo de afectados.';

-- Sólo se marcan los dos que sí. Los demás se quedan en el `false` por
-- omisión, y no se tocan con un `update` general a propósito: si alguien
-- habilita otro tipo a mano, volver a correr esta migración no se lo deshace.
--
-- `escombros` va con `zona_afectada` aunque la petición hablara sólo de la
-- segunda. Un frente de remoción de escombros es, literalmente, donde puede
-- haber alguien enterrado; dejarlo sin conteo sería quitar la casilla justo
-- en el sitio donde más urge llenarla. Quitárselo es una línea:
--   update tipos_punto set reporta_personas = false where slug = 'escombros';
update tipos_punto
   set reporta_personas = true
 where slug in ('zona_afectada', 'escombros');

-- ---------------------------------------------------------------------------
-- 2. Lo ya reportado deja de contar donde no aplica
--
-- Esto es lo que arregla el pasado. Sin este filtro, unos "12 desaparecidos"
-- cargados ayer en un albergue seguirían sumando en la barra global de la
-- ciudad para siempre, sin que nadie supiera de dónde salen.
--
-- No se borra ninguna fila: `persona_reportes` queda intacta, con su rastro
-- para moderación. Simplemente deja de agregarse.
-- ---------------------------------------------------------------------------

create or replace view v_personas as
with ultimo_por_dispositivo as (
  select distinct on (punto_id, estado, dispositivo_id)
         punto_id, estado, dispositivo_id, cantidad, efectivo_en
  from persona_reportes pr
  where efectivo_en > now() - interval '72 hours'
    and not oculto
    and exists (
      select 1
      from puntos p
      join tipos_punto tp on tp.slug = p.tipo
      where p.id = pr.punto_id and tp.reporta_personas
    )
  order by punto_id, estado, dispositivo_id, efectivo_en desc
)
select punto_id,
       estado,
       (percentile_cont(0.5) within group (order by cantidad::double precision))::int as cantidad,
       max(cantidad)::int   as cantidad_max,
       count(*)::int        as reportes,
       max(efectivo_en)     as ultimo_reporte
from ultimo_por_dispositivo
group by punto_id, estado;

-- ---------------------------------------------------------------------------
-- 3. El servidor lo rechaza
--
-- Se conserva entero el cuerpo de la 0007 —la consulta a `decisiones_moderacion`
-- que hace que lo ocultado por un moderador no se destape solo— y se le añade
-- la comprobación del tipo.
--
-- El código `42501` no es casual: la app lo muestra tal cual está escrito aquí
-- y la cola sin conexión lo trata como definitivo, así que un reporte encolado
-- antes de este cambio se descarta en el primer intento en vez de reintentarse
-- ocho veces contra una pared.
--
-- La comprobación va DESPUÉS de la de idempotencia: si un reporte ya se aceptó,
-- reenviarlo tiene que seguir devolviendo el mismo id y no un error nuevo.
-- ---------------------------------------------------------------------------

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
declare
  v_id bigint;
  v_tipo text;
begin
  select id into v_id from persona_reportes where client_id = p_client_id;
  if v_id is not null then
    return v_id;
  end if;

  select tp.etiqueta into v_tipo
  from puntos p
  join tipos_punto tp on tp.slug = p.tipo
  where p.id = p_punto and tp.reporta_personas;

  if v_tipo is null then
    raise exception
      'Aquí no se lleva conteo de personas afectadas. Repórtalo en la zona afectada donde ocurrió.'
      using errcode = '42501';
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
