-- infoCaliEmergencia — 0008: línea de tiempo de lo reportado.
--
-- Todo lo público que existía hasta aquí es agregado: `v_puntos_mapa` responde
-- "¿cómo está este punto?" colapsando cada reporte a un puntaje. Falta la otra
-- pregunta, la que hace quien acaba de abrir la aplicación: "¿qué está pasando
-- ahora mismo?". Eso necesita lo contrario de un agregado —filas individuales en
-- orden cronológico— y por eso hace falta una vista propia y no un filtro más
-- sobre las que ya hay.
--
-- No abre ni un permiso nuevo sobre las tablas base. `anon` ya podía leer las
-- tres tablas de reportes desde 0003; lo que aporta esta vista es una forma
-- acotada de leerlas: sin `dispositivo_id`, con los catálogos ya resueltos y con
-- la ventana de tiempo puesta.

-- ---------------------------------------------------------------------------
-- Índices para el barrido cronológico global
--
-- Los de 0001 están ordenados por (punto, recurso, dispositivo) y sirven para
-- responder "qué pasa en este punto". Aquí se pregunta al revés —"qué pasó en la
-- ciudad, lo más reciente primero"— y ese prefijo no los cubre.
-- ---------------------------------------------------------------------------

create index if not exists necesidad_actividad_idx
  on necesidad_reportes (efectivo_en desc) where not oculto;
create index if not exists insumo_actividad_idx
  on insumo_reportes (efectivo_en desc) where not oculto;
create index if not exists persona_actividad_idx
  on persona_reportes (efectivo_en desc) where not oculto;
create index if not exists puntos_actividad_idx
  on puntos (creado_en desc) where not oculto;

-- ---------------------------------------------------------------------------
-- v_actividad — ventana de 24 h
--
-- Cuatro decisiones que no se leen solas en el SQL:
--
--   1. Ordena por `efectivo_en`, no por `creado_en`. Podría parecer al revés,
--      porque `creado_en` es la que ningún cliente puede escribir. Pero el
--      trigger de normalización (0001) acota `efectivo_en` a
--      [creado_en - 6 h, creado_en], así que lo único que un cliente puede hacer
--      es ANTEDATAR su reporte, que lo hunde en la lista en vez de subirlo:
--      colarse arriba es imposible por construcción. Y a cambio se gana lo que
--      de verdad importa: los RPC de 0007 rectifican dentro de la misma hora con
--      `on conflict do update`, que sube `efectivo_en` con `greatest(...)` pero
--      NO toca `creado_en`. Ordenando por `creado_en`, una tarjeta que ya dice
--      "ya llegó agua" se quedaría clavada en la posición de hace cincuenta
--      minutos, que es justo la información equivocada.
--
--   2. No expone `dispositivo_id`. Un muro público de actividad que lo llevara
--      convertiría el mapa en un rastreador: con un puñado de eventos se
--      reconstruye por dónde anduvo un teléfono. Los conteos por punto son
--      información útil; el rastro de un dispositivo, no. Es la misma regla que
--      mantiene `presencia` fuera del alcance de `anon` (0003).
--
--   3. El índice único por `slot` hace de filtro anti-ruido gratis. Como
--      reportar dos veces en la misma hora actualiza la fila en lugar de añadir
--      otra, la lista no se llena de repeticiones del mismo dispositivo sin que
--      haya que deduplicar nada aquí.
--
--   4. No lleva `limit`. El recorte lo pone quien consulta, para que un filtro
--      posterior por punto siga devolviendo lo que corresponde y no los restos
--      de un recorte hecho antes de filtrar.
--
-- Como todas las vistas del proyecto, corre con los permisos de su dueño
-- (security_invoker apagado), así que NO hereda las políticas de RLS: los
-- filtros de visibilidad —`not oculto` en cada rama y `estado = 'activo'` en el
-- punto— van escritos a mano aquí. Si alguna vez se añade una cuarta tabla de
-- reportes, este es el sitio donde hay que acordarse de repetirlos.
-- ---------------------------------------------------------------------------

create or replace view v_actividad as
with eventos as (
  select 'necesidad_reportes'::text                                       as tabla,
         n.id::text                                                       as fila_id,
         n.punto_id                                                       as punto_id,
         n.efectivo_en                                                    as ocurrido_en,
         n.creado_en                                                      as recibido_en,
         r.emoji                                                          as emoji,
         r.etiqueta                                                       as etiqueta,
         (case when n.voto > 0 then 'falta' else 'llego' end)::text        as accion,
         null::text                                                       as nivel,
         null::int                                                        as cantidad,
         n.nota                                                           as nota
    from necesidad_reportes n
    join recursos r on r.slug = n.recurso
   where not n.oculto
     and n.efectivo_en > now() - interval '24 hours'

  union all

  select 'insumo_reportes', i.id::text, i.punto_id, i.efectivo_en, i.creado_en,
         r.emoji, r.etiqueta, 'hay', i.nivel::text, null::int, i.nota
    from insumo_reportes i
    join recursos r on r.slug = i.recurso
   where not i.oculto
     and i.efectivo_en > now() - interval '24 hours'

  union all

  -- Sin emoji ni etiqueta de catálogo: un conteo de personas no es un recurso.
  -- La interfaz pone los suyos a partir de `accion` y `nivel`.
  select 'persona_reportes', pe.id::text, pe.punto_id, pe.efectivo_en, pe.creado_en,
         null::text, null::text, 'personas', pe.estado::text, pe.cantidad::int, pe.nota
    from persona_reportes pe
   where not pe.oculto
     and pe.efectivo_en > now() - interval '24 hours'

  union all

  -- Un lugar nuevo también es algo que alguien acaba de reportar. `ocurrido_en`
  -- y `recibido_en` coinciden porque los puntos no pasan por la cola offline.
  -- La descripción se recorta a 280 como las notas: la tarjeta es un resumen, y
  -- quinientos caracteres por evento pesan de más en una lista que se refresca.
  select 'puntos', pu.id::text, pu.id, pu.creado_en, pu.creado_en,
         tp.emoji, tp.etiqueta, 'lugar_nuevo', null::text, null::int,
         left(pu.descripcion, 280)
    from puntos pu
    join tipos_punto tp on tp.slug = pu.tipo
   where not pu.oculto
     and pu.estado = 'activo'
     and pu.creado_en > now() - interval '24 hours'
)
select e.tabla,
       e.fila_id,
       e.punto_id,
       p.nombre                 as punto,
       p.barrio,
       tp.emoji                 as punto_emoji,
       round(p.lat::numeric, 5) as lat,
       round(p.lng::numeric, 5) as lng,
       e.ocurrido_en,
       e.recibido_en,
       e.emoji,
       e.etiqueta,
       e.accion,
       e.nivel,
       e.cantidad,
       e.nota
  from eventos e
  -- El join descarta los eventos de puntos ocultos o cerrados: ocultar un lugar
  -- tiene que silenciar también su rastro, no sólo su alfiler en el mapa.
  join puntos p       on p.id = e.punto_id and p.estado = 'activo' and not p.oculto
  join tipos_punto tp on tp.slug = p.tipo
 order by e.ocurrido_en desc;

grant select on v_actividad to anon;
