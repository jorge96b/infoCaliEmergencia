-- infoCaliEmergencia — verificación del despliegue.
--
-- Pégalo entero en el SQL Editor de Supabase después de correr las migraciones.
-- Es una sola consulta de lectura: no escribe nada y se puede correr cuantas
-- veces se quiera.
--
-- Devuelve una fila por comprobación. Cualquier cosa que salga con ✗ hay que
-- resolverla antes de compartir el enlace.
--
-- Para probar además que la lógica de consenso funciona sobre TU base, corre
-- después `prueba_logica.sql`.

with
-- ---------------------------------------------------------------------------
tablas(nombre) as (values
  ('tipos_punto'), ('recursos'), ('dispositivos'), ('puntos'),
  ('punto_confirmaciones'), ('necesidad_reportes'), ('insumo_reportes'),
  ('persona_reportes'), ('presencia'), ('reportes_abuso')),

vistas(nombre) as (values
  ('v_necesidades'), ('v_insumos'), ('v_presencia'), ('v_personas'),
  ('v_verificacion'), ('v_puntos_mapa'), ('v_mapa_calor'), ('v_global')),

funciones(nombre) as (values
  ('peso'), ('metros'), ('dispositivo_actual'), ('fn_asegurar_dispositivo'),
  ('fn_limite_tasa'), ('fn_auto_ocultar'), ('fn_normalizar_reporte'),
  ('rpc_crear_punto'), ('rpc_confirmar_punto'), ('rpc_reportar_necesidad'),
  ('rpc_reportar_insumo'), ('rpc_reportar_personas'), ('rpc_presencia_entrar'),
  ('rpc_presencia_latido'), ('rpc_presencia_salir'), ('rpc_mi_presencia'),
  ('rpc_denunciar')),

-- Índices únicos que sostienen el control de abuso. Si alguno falta, un solo
-- dispositivo podría mover el puntaje de una necesidad sin límite.
indices(nombre) as (values
  ('necesidad_reportes_punto_id_recurso_dispositivo_id_slot_key'),
  ('insumo_reportes_punto_id_recurso_dispositivo_id_slot_key'),
  ('persona_reportes_punto_id_estado_dispositivo_id_slot_key'),
  ('presencia_activa_idx')),

-- ---------------------------------------------------------------------------
comprobaciones as (

  select 1 as orden, 'Tablas' as bloque, t.nombre as elemento,
         case when pt.tablename is null then '✗ FALTA'
              when not pt.rowsecurity  then '✗ RLS APAGADO'
              else '✓' end as estado
  from tablas t
  left join pg_tables pt on pt.tablename = t.nombre and pt.schemaname = 'public'

  union all
  select 2, 'Vistas', v.nombre,
         case when pv.viewname is null then '✗ FALTA' else '✓' end
  from vistas v
  left join pg_views pv on pv.viewname = v.nombre and pv.schemaname = 'public'

  union all
  select 3, 'Funciones', f.nombre,
         case when p.proname is null then '✗ FALTA' else '✓' end
  from funciones f
  left join pg_proc p
    on p.proname = f.nombre and p.pronamespace = 'public'::regnamespace

  union all
  select 4, 'Índices anti-abuso', i.nombre,
         case when pi.indexname is null then '✗ FALTA' else '✓' end
  from indices i
  left join pg_indexes pi on pi.indexname = i.nombre and pi.schemaname = 'public'

  -- Permisos que anon NUNCA debe tener. Cualquier fila aquí es un agujero.
  union all
  select 5, 'Permisos indebidos de anon',
         g.table_name || ' → ' || g.privilege_type, '✗ AGUJERO'
  from information_schema.role_table_grants g
  where g.grantee = 'anon' and g.table_schema = 'public'
    and (g.privilege_type in ('DELETE', 'TRUNCATE')
         or (g.privilege_type = 'SELECT'
             and g.table_name in ('presencia', 'dispositivos', 'reportes_abuso')))

  union all
  select 5, 'Permisos indebidos de anon', 'ninguno', '✓'
  where not exists (
    select 1 from information_schema.role_table_grants g
    where g.grantee = 'anon' and g.table_schema = 'public'
      and (g.privilege_type in ('DELETE', 'TRUNCATE')
           or (g.privilege_type = 'SELECT'
               and g.table_name in ('presencia', 'dispositivos', 'reportes_abuso'))))

  -- anon no debe poder escribir las columnas de tiempo: si pudiera, podría
  -- antedatar un reporte y manipular el decaimiento a su favor.
  union all
  select 6, 'anon no escribe columnas de tiempo',
         c.table_name || ' → ' || c.column_name, '✗ AGUJERO'
  from information_schema.column_privileges c
  where c.grantee = 'anon' and c.table_schema = 'public'
    and c.column_name in ('creado_en', 'efectivo_en', 'slot')
    and c.privilege_type = 'INSERT'

  union all
  select 6, 'anon no escribe columnas de tiempo', 'ninguna', '✓'
  where not exists (
    select 1 from information_schema.column_privileges c
    where c.grantee = 'anon' and c.table_schema = 'public'
      and c.column_name in ('creado_en', 'efectivo_en', 'slot')
      and c.privilege_type = 'INSERT')

  union all
  select 7, 'Catálogos', 'tipos_punto (' || count(*) || ' filas)',
         case when count(*) >= 10 then '✓' else '✗ INCOMPLETO' end
  from tipos_punto

  union all
  select 7, 'Catálogos', 'recursos (' || count(*) || ' filas)',
         case when count(*) >= 26 then '✓' else '✗ INCOMPLETO' end
  from recursos

  union all
  select 7, 'Catálogos',
         '  insumos ' || count(*) filter (where categoria = 'insumo') ||
         ', equipos ' || count(*) filter (where categoria = 'equipo') ||
         ', personal ' || count(*) filter (where categoria = 'personal'),
         '·'
  from recursos

  -- Un mapa vacío es un mapa muerto: la primera persona que llegue tiene que
  -- encontrar algo útil.
  union all
  select 8, 'Puntos cargados',
         count(*) || ' activos (' ||
         count(*) filter (where origen = 'oficial') || ' oficiales)',
         case when count(*) = 0
              then '✗ SIN PUNTOS: cárgalos antes de difundir el enlace'
              when count(*) < 5 then '⚠ muy pocos para arrancar'
              else '✓' end
  from puntos
  where estado = 'activo' and not oculto
)

select bloque, elemento, estado
from comprobaciones
order by orden, (estado like '✗%') desc, elemento;
