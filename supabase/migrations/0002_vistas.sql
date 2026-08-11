-- infoCaliEmergencia — 0002: vistas de agregación.
--
-- Aquí vive la defensa contra la desinformación. Dos reglas la resumen:
--
--   1. Sólo cuenta el último reporte de cada dispositivo. Reportar veinte veces
--      pesa exactamente lo mismo que reportar una vez, así que el puntaje mide
--      cuánta gente coincide y no cuánto insiste una sola persona.
--
--   2. Todo reporte pierde la mitad de su valor cada pocas horas. Un "falta
--      agua" de la madrugada deja de mandar sobre un "ya llegó agua" de hace
--      diez minutos, y una necesidad que nadie vuelve a confirmar se apaga sola
--      sin que nadie tenga que hacer nada.
--
-- Son vistas normales, no materializadas: el puntaje cambia con el paso del
-- tiempo aunque no entren filas nuevas, así que una vista materializada estaría
-- desactualizada entre refrescos, que es justo el problema que queremos evitar.
-- El volumen es pequeño y los índices las cubren; escalar se resuelve cacheando
-- la respuesta HTTP, no precalculando en la base.

-- Peso de un reporte según su antigüedad: 1.0 recién hecho, 0.5 tras una vida
-- media, 0.25 tras dos, y así.
create or replace function peso(ts timestamptz, vida_media_horas numeric)
returns numeric language sql stable parallel safe as $$
  select power(0.5, (extract(epoch from (now() - ts)) / (vida_media_horas * 3600.0)))::numeric;
$$;

-- ---------------------------------------------------------------------------
-- Necesidades — vida media 10 h, ventana 24 h
--
-- Umbrales: >= 2.0 muy requerido, >= 0.6 poco requerido, resto no requerido.
--
-- Traducido a comportamiento: una persona sola marca "poco requerido"; dos
-- coincidiendo lo suben a "muy requerido"; tres confirmaciones lo sostienen unas
-- seis horas antes de ablandarse, y un reporte que nadie vuelve a confirmar se
-- apaga solo en unas siete. Dos "ya llegó" frescos cancelan tres confirmaciones
-- de hace rato.
--
-- La calibración es deliberadamente generosa con las necesidades: en una
-- emergencia, no mostrar una necesidad real cuesta mucho más que mostrar una que
-- ya se resolvió, porque lo segundo lo corrige cualquiera con un toque y lo
-- primero no lo corrige nadie.
-- ---------------------------------------------------------------------------

create or replace view v_necesidades as
with ultimo_por_dispositivo as (
  select distinct on (punto_id, recurso, dispositivo_id)
         punto_id, recurso, dispositivo_id, voto, cantidad, efectivo_en
  from necesidad_reportes
  where efectivo_en > now() - interval '24 hours'
    and not oculto
  order by punto_id, recurso, dispositivo_id, efectivo_en desc
),
agregado as (
  select punto_id,
         recurso,
         sum(voto * peso(efectivo_en, 10))                     as puntaje,
         count(*) filter (where voto > 0)                      as confirmaciones,
         count(*) filter (where voto < 0)                      as negaciones,
         max(efectivo_en)                                      as ultimo_reporte,
         percentile_cont(0.5) within group (
           order by cantidad::double precision
         ) filter (where voto > 0 and cantidad is not null)     as cantidad_mediana
  from ultimo_por_dispositivo
  group by punto_id, recurso
)
select a.punto_id,
       a.recurso,
       r.etiqueta,
       r.categoria,
       r.unidad,
       r.emoji,
       round(a.puntaje, 2)                as puntaje,
       a.confirmaciones::int              as confirmaciones,
       a.negaciones::int                  as negaciones,
       a.ultimo_reporte,
       round(a.cantidad_mediana::numeric, 1) as cantidad_mediana,
       (case
          when a.puntaje >= 2.0 then 'muy_requerido'
          when a.puntaje >= 0.6 then 'poco_requerido'
          else 'no_requerido'
        end)::demanda                     as nivel
from agregado a
join recursos r on r.slug = a.recurso;

-- ---------------------------------------------------------------------------
-- Insumos disponibles — vida media 4 h, ventana 8 h
--
-- El stock es lo que más rápido cambia, así que decae más rápido que todo lo
-- demás. El nivel resultante es el promedio ponderado por frescura de los
-- niveles reportados, traducido de vuelta al enum.
-- ---------------------------------------------------------------------------

create or replace view v_insumos as
with ultimo_por_dispositivo as (
  select distinct on (punto_id, recurso, dispositivo_id)
         punto_id, recurso, dispositivo_id, nivel, cantidad, efectivo_en
  from insumo_reportes
  where efectivo_en > now() - interval '8 hours'
    and not oculto
  order by punto_id, recurso, dispositivo_id, efectivo_en desc
),
numerico as (
  select *,
         (array_position(enum_range(null::nivel_stock), nivel) - 1)::numeric as n,
         peso(efectivo_en, 4)                                                as w
  from ultimo_por_dispositivo
)
select n.punto_id,
       n.recurso,
       r.etiqueta,
       r.categoria,
       r.unidad,
       r.emoji,
       count(*)::int      as reportes,
       max(n.efectivo_en) as ultimo_reporte,
       (enum_range(null::nivel_stock))[
         round(sum(n.n * n.w) / nullif(sum(n.w), 0))::int + 1
       ]                  as nivel,
       round(percentile_cont(0.5) within group (
         order by n.cantidad::double precision
       )::numeric, 1)     as cantidad_mediana
from numerico n
join recursos r on r.slug = n.recurso
group by n.punto_id, n.recurso, r.etiqueta, r.categoria, r.unidad, r.emoji;

-- ---------------------------------------------------------------------------
-- Presencia — expiración dura a los 90 minutos sin latido
--
-- Casi nadie toca "ya me fui", así que la presencia tiene que caducar sola. Sin
-- esto el mapa de calor sólo crecería y en un día mostraría a media ciudad
-- concentrada en cada albergue.
--
-- Expone conteos únicamente. La tabla `presencia` no es legible por el público:
-- saber cuánta gente hay en un punto es información útil; saber qué dispositivo
-- está en cuál, no.
-- ---------------------------------------------------------------------------

create or replace view v_presencia as
select punto_id,
       sum(personas)::int as personas,
       count(*)::int      as dispositivos,
       max(visto_en)      as ultimo_latido
from presencia
where fin_en is null
  and visto_en > now() - interval '90 minutes'
group by punto_id;

-- ---------------------------------------------------------------------------
-- Personas — vida media 24 h, ventana 72 h
--
-- Usa la MEDIANA de lo que reporta cada dispositivo, nunca la suma: sumar
-- multiplicaría a la misma persona desaparecida por cada quien que la reporta,
-- y un solo troll escribiendo 500 no mueve una mediana.
-- ---------------------------------------------------------------------------

create or replace view v_personas as
with ultimo_por_dispositivo as (
  select distinct on (punto_id, estado, dispositivo_id)
         punto_id, estado, dispositivo_id, cantidad, efectivo_en
  from persona_reportes
  where efectivo_en > now() - interval '72 hours'
    and not oculto
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
-- Verificación de puntos — la existencia de un lugar no decae
-- ---------------------------------------------------------------------------

create or replace view v_verificacion as
select punto_id,
       sum(voto)::int                          as saldo,
       count(*) filter (where voto > 0)::int    as confirmaciones
from punto_confirmaciones
group by punto_id;

-- ---------------------------------------------------------------------------
-- Vista principal del mapa
--
-- Una sola consulta trae todo lo que el mapa necesita dibujar. Evita el N+1 de
-- pedir necesidades e insumos punto por punto, que con mala señal sería fatal.
-- ---------------------------------------------------------------------------

create or replace view v_puntos_mapa as
select p.id,
       p.nombre,
       p.tipo,
       tp.etiqueta as tipo_etiqueta,
       tp.color,
       tp.emoji,
       round(p.lat::numeric, 5) as lat,
       round(p.lng::numeric, 5) as lng,
       p.barrio,
       p.direccion,
       p.descripcion,
       p.contacto,
       p.origen,
       p.creado_en,
       coalesce(v.confirmaciones, 0) as confirmaciones,
       (p.origen = 'oficial' or coalesce(v.confirmaciones, 0) >= 3) as verificado,
       coalesce(pr.personas, 0) as personas,
       coalesce((
         select json_agg(json_build_object(
                  'recurso', n.recurso, 'etiqueta', n.etiqueta, 'emoji', n.emoji,
                  'categoria', n.categoria, 'nivel', n.nivel,
                  'confirmaciones', n.confirmaciones, 'ultimo_reporte', n.ultimo_reporte)
                order by n.puntaje desc)
         from v_necesidades n
         where n.punto_id = p.id and n.nivel <> 'no_requerido'
       ), '[]'::json) as necesidades,
       coalesce((
         select json_agg(json_build_object(
                  'recurso', i.recurso, 'etiqueta', i.etiqueta, 'emoji', i.emoji,
                  'nivel', i.nivel, 'ultimo_reporte', i.ultimo_reporte)
                order by i.recurso)
         from v_insumos i
         where i.punto_id = p.id
       ), '[]'::json) as insumos,
       coalesce((
         select json_object_agg(pe.estado, pe.cantidad)
         from v_personas pe
         where pe.punto_id = p.id and pe.cantidad > 0
       ), '{}'::json) as personas_estado,
       (select max(x) from (
          select max(n2.ultimo_reporte) from v_necesidades n2 where n2.punto_id = p.id
          union all
          select max(i2.ultimo_reporte) from v_insumos i2 where i2.punto_id = p.id
        ) t(x)) as ultimo_movimiento
from puntos p
join tipos_punto tp on tp.slug = p.tipo
left join v_verificacion v on v.punto_id = p.id
left join v_presencia   pr on pr.punto_id = p.id
where p.estado = 'activo' and not p.oculto;

-- ---------------------------------------------------------------------------
-- Mapa de calor
--
-- Las zonas afectadas aportan una intensidad mínima aunque nadie haya marcado
-- presencia: son justamente los lugares donde puede no quedar nadie con señal
-- para reportar, y no pueden desaparecer del mapa por eso.
-- ---------------------------------------------------------------------------

create or replace view v_mapa_calor as
select round(p.lat::numeric, 5) as lat,
       round(p.lng::numeric, 5) as lng,
       greatest(
         coalesce(pr.personas, 0),
         case when p.tipo = 'zona_afectada' then 3 else 0 end
       )::int as intensidad
from puntos p
left join v_presencia pr on pr.punto_id = p.id
where p.estado = 'activo'
  and not p.oculto
  and (coalesce(pr.personas, 0) > 0 or p.tipo = 'zona_afectada');

-- ---------------------------------------------------------------------------
-- Tablero global
-- ---------------------------------------------------------------------------

create or replace view v_global as
select
  (select count(*)::int from puntos where estado = 'activo' and not oculto)              as puntos_activos,
  (select coalesce(sum(personas), 0)::int from v_presencia)                              as personas_en_terreno,
  (select coalesce(sum(cantidad), 0)::int from v_personas where estado = 'desaparecido') as desaparecidos,
  (select coalesce(sum(cantidad), 0)::int from v_personas where estado = 'herido')       as heridos,
  (select coalesce(sum(cantidad), 0)::int from v_personas where estado = 'rescatado')    as rescatados,
  (select count(*)::int from v_necesidades where nivel = 'muy_requerido')                as necesidades_criticas,
  (select json_agg(x) from (
     select n.recurso, n.etiqueta, n.emoji, n.categoria,
            count(*) filter (where n.nivel = 'muy_requerido')::int as puntos_criticos,
            round(sum(n.puntaje), 1)                               as puntaje_total
     from v_necesidades n
     where n.nivel <> 'no_requerido'
     group by n.recurso, n.etiqueta, n.emoji, n.categoria
     order by puntos_criticos desc, puntaje_total desc
     limit 12
   ) x)                                                                                  as top_necesidades,
  now() as generado_en;
