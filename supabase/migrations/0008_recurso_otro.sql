-- ---------------------------------------------------------------------------
-- 0008 · "Otra cosa": pedir algo que no está en el catálogo
--
-- El catálogo de recursos cubre lo previsible, y en una emergencia lo que hace
-- falta a veces no estaba previsto. Sin una salida, quien necesita una grúa o
-- pañales de adulto no tiene forma de decirlo y el dato se pierde.
--
-- La salida es un recurso más, `otro`, con la diferencia de que aquí sí importa
-- el texto libre: el campo `nota` de `necesidad_reportes` ya existía (0001) y
-- `rpc_reportar_necesidad` ya lo guardaba (0004), pero ninguna vista lo sacaba,
-- así que hasta ahora era un dato que entraba y no volvía a verse.
--
-- Esta migración sólo añade el recurso y expone esas notas. No toca los RPC.
--
-- Sobre el abuso: la nota es el primer texto libre y público de la aplicación.
-- Se apoya en lo que ya existe en vez de inventar nada — el `check` de 0001 la
-- limita a 280 caracteres, `v_necesidades` descarta lo que esté `oculto`, y
-- cada nota viaja con el id de su fila para que se pueda denunciar una nota
-- concreta (`rpc_denunciar` recibe `fila_id` como texto, así que le sirve
-- igual el uuid de un punto que el bigint de un reporte). Desde 0007 esconder
-- una fila es una decisión humana que aguanta aunque su autor vuelva a
-- reportar.
-- ---------------------------------------------------------------------------

-- `destacado` lo pone en la grilla rápida; `orden` alto lo deja de último, que
-- es donde debe estar: primero lo que se puede reportar de un toque.
insert into recursos (slug, etiqueta, categoria, unidad, emoji, orden, destacado) values
  ('otro', 'Otra cosa', 'insumo', 'unidad', '📝', 999, true)
on conflict (slug) do update
  set etiqueta  = excluded.etiqueta,
      categoria = excluded.categoria,
      unidad    = excluded.unidad,
      emoji     = excluded.emoji,
      orden     = excluded.orden,
      destacado = excluded.destacado;

-- ---------------------------------------------------------------------------
-- v_necesidades · igual que en 0002, más la columna `notas`
--
-- Se conservan el orden y el tipo de las columnas anteriores y la nueva va al
-- final, que es lo que `create or replace view` admite sin tener que borrar la
-- vista y con ella las que dependen de esta.
-- ---------------------------------------------------------------------------

create or replace view v_necesidades as
with ultimo_por_dispositivo as (
  select distinct on (punto_id, recurso, dispositivo_id)
         id, punto_id, recurso, dispositivo_id, voto, cantidad, nota, efectivo_en
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
        end)::demanda                     as nivel,
       coalesce(nt.notas, '[]'::json)     as notas
from agregado a
join recursos r on r.slug = a.recurso
-- Sólo las notas de quien dice que algo falta: la de quien reporta "ya llegó"
-- no describe una necesidad. Se cortan en tres para que la hoja del punto no se
-- convierta en un muro de texto, y el id va como texto porque es lo que espera
-- `rpc_denunciar`.
left join lateral (
  select json_agg(
           json_build_object('id', u.id::text, 'texto', btrim(u.nota))
           order by u.efectivo_en desc
         ) as notas
  from (
    select id, nota, efectivo_en
    from ultimo_por_dispositivo x
    where x.punto_id = a.punto_id
      and x.recurso  = a.recurso
      and x.voto > 0
      and x.nota is not null
      and btrim(x.nota) <> ''
    order by x.efectivo_en desc
    limit 3
  ) u
) nt on true;

-- ---------------------------------------------------------------------------
-- v_puntos_mapa · igual que en 0002, con `notas` dentro de cada necesidad
--
-- Se repite entera porque `create or replace view` no permite parchear una
-- expresión suelta. El único cambio está en el `json_build_object` de
-- `necesidades`.
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
                  'confirmaciones', n.confirmaciones, 'ultimo_reporte', n.ultimo_reporte,
                  'notas', n.notas)
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
