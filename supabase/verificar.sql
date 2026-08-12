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
  ('persona_reportes'), ('presencia'), ('reportes_abuso'),
  ('moderadores'), ('decisiones_moderacion'), ('acciones_moderacion'),
  ('avisos'), ('reportes_oficiales'),
  ('suscripciones_push'), ('envios_push'), ('nivel_notificado'),
  ('recursos_por_tipo')),

vistas(nombre) as (values
  ('v_necesidades'), ('v_insumos'), ('v_presencia'), ('v_personas'),
  ('v_verificacion'), ('v_puntos_mapa'), ('v_mapa_calor'), ('v_global'),
  ('v_actividad'),
  ('v_filas_denunciables'), ('v_cola_moderacion'), ('v_ficha_dispositivo'),
  ('v_salud_moderacion'), ('v_bitacora'),
  ('v_avisos'), ('v_reporte_oficial'), ('v_recursos_tipo')),

funciones(nombre) as (values
  ('peso'), ('metros'), ('dispositivo_actual'), ('fn_asegurar_dispositivo'),
  ('fn_limite_tasa'), ('fn_auto_ocultar'), ('fn_normalizar_reporte'),
  ('rpc_crear_punto'), ('rpc_confirmar_punto'), ('rpc_reportar_necesidad'),
  ('rpc_reportar_insumo'), ('rpc_reportar_personas'), ('rpc_presencia_entrar'),
  ('rpc_presencia_latido'), ('rpc_presencia_salir'), ('rpc_mi_presencia'),
  ('rpc_denunciar'), ('es_moderador'), ('rpc_mod_decidir'), ('rpc_mod_bloquear'),
  ('fn_rejilla'), ('rpc_push_suscribir'), ('rpc_push_ubicacion'), ('rpc_push_baja'),
  ('rpc_push_destinatarios'), ('rpc_push_reservar'), ('rpc_push_resultado'),
  ('rpc_push_barrido'), ('rpc_push_ahora'), ('rpc_push_liberar')),

-- Funciones que sólo puede ejecutar el servidor con la clave de servicio.
-- `rpc_push_destinatarios` devuelve endpoints de notificación, que son
-- credenciales de envío: quien los tenga puede mandarle un push a ese teléfono.
solo_servidor(nombre) as (values
  ('rpc_push_destinatarios'), ('rpc_push_reservar'), ('rpc_push_ahora'),
  ('rpc_push_liberar'), ('rpc_push_resultado'), ('rpc_push_barrido')),

-- Y las que `anon` sí tiene que poder ejecutar, o el interruptor de
-- notificaciones falla en silencio desde el teléfono.
abiertas_a_anon(nombre) as (values
  ('rpc_push_suscribir'), ('rpc_push_ubicacion'), ('rpc_push_baja')),

-- Objetos que `anon` no debe poder leer bajo ningún concepto. Ojo: Supabase
-- concede permisos por omisión sobre cada tabla y vista nueva del esquema
-- `public` tanto a `anon` como a `authenticated`, así que quien añada un objeto
-- sin su `revoke` aparecerá aquí.
vedadas_a_anon(nombre) as (values
  ('presencia'), ('dispositivos'), ('reportes_abuso'),
  ('moderadores'), ('decisiones_moderacion'), ('acciones_moderacion'),
  ('v_filas_denunciables'), ('v_cola_moderacion'), ('v_ficha_dispositivo'),
  ('v_salud_moderacion'), ('v_bitacora'),
  -- Las tablas de lo oficial: `anon` sólo ve `v_avisos` y `v_reporte_oficial`,
  -- que ya filtran por vigencia. Leer la tabla sería leer avisos retirados,
  -- futuros o vencidos.
  ('avisos'), ('reportes_oficiales'),
  -- Un `endpoint` de push con sus claves es una credencial de envío.
  ('suscripciones_push'), ('envios_push'), ('nivel_notificado'),
  -- `anon` lee `v_recursos_tipo`, que ya viene unida y ordenada; la tabla no.
  ('recursos_por_tipo')),

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
             and g.table_name in (select nombre from vedadas_a_anon)))

  union all
  select 5, 'Permisos indebidos de anon', 'ninguno', '✓'
  where not exists (
    select 1 from information_schema.role_table_grants g
    where g.grantee = 'anon' and g.table_schema = 'public'
      and (g.privilege_type in ('DELETE', 'TRUNCATE')
           or (g.privilege_type = 'SELECT'
               and g.table_name in (select nombre from vedadas_a_anon))))

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

  -- Un tipo sin lista no rompe nada —la ficha cae de vuelta en los recursos
  -- destacados—, y por eso mismo hay que mirarlo aquí: si no, nadie se entera
  -- de que en los albergues volvieron a salir volquetas.
  union all
  select 7, 'Catálogos',
         'recursos por tipo (' ||
         (select count(*) from recursos_por_tipo) || ' filas, ' ||
         count(*) filter (where not tp.tiene) || ' tipos sin lista)',
         case when count(*) filter (where not tp.tiene) = 0 then '✓'
              else '⚠ esos tipos muestran la lista genérica' end
  from (select exists (select 1 from recursos_por_tipo rt where rt.tipo = t.slug)
        from tipos_punto t where t.activo) as tp (tiene)

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

  -- ---------------------------------------------------------------------------
  -- Moderación
  -- ---------------------------------------------------------------------------

  -- Sin moderadores dados de alta, el panel abre pero no muestra ni una fila:
  -- todas las vistas filtran por `es_moderador()`.
  union all
  select 9, 'Moderación', count(*) || ' moderadores activos',
         case when count(*) = 0
              then '✗ NINGUNO: créalos en Authentication → Users e insértalos en moderadores'
              else '✓' end
  from moderadores where activo

  -- Si `es_moderador()` no fuera SECURITY DEFINER, la política de `moderadores`
  -- la llamaría a ella misma y la recursión tumbaría todo el panel.
  union all
  select 9, 'Moderación', 'es_moderador() es SECURITY DEFINER',
         case when bool_or(p.prosecdef) then '✓' else '✗ NO LO ES' end
  from pg_proc p
  where p.proname = 'es_moderador' and p.pronamespace = 'public'::regnamespace

  -- Los dos arreglos que hacen que moderar sirva de algo. Si `fn_auto_ocultar`
  -- no consulta las decisiones, lo aprobado vuelve a caer en la cuarta denuncia;
  -- si `rpc_reportar_necesidad` no las consulta, lo ocultado se destapa solo.
  union all
  select 9, 'Moderación', 'la decisión humana gana al automatismo (' || p.proname || ')',
         case when p.prosrc like '%decisiones_moderacion%' then '✓'
              else '✗ MIGRACIÓN 0007 SIN APLICAR' end
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname in ('fn_auto_ocultar', 'rpc_reportar_necesidad',
                      'rpc_reportar_insumo', 'rpc_reportar_personas')

  -- Un punto oficial no puede caer por votación de denuncias.
  union all
  select 9, 'Moderación', 'los puntos oficiales no se auto-ocultan',
         case when bool_or(p.prosrc like '%oficial%') then '✓'
              else '✗ MIGRACIÓN 0007 SIN APLICAR' end
  from pg_proc p
  where p.proname = 'fn_auto_ocultar' and p.pronamespace = 'public'::regnamespace

  -- Nadie escribe la bitácora a mano: todo pasa por los RPC, que son los que
  -- dejan rastro. Una bitácora editable no es una bitácora.
  union all
  select 9, 'Moderación',
         'acciones_moderacion → ' || g.privilege_type || ' de ' || g.grantee, '✗ AGUJERO'
  from information_schema.role_table_grants g
  where g.table_schema = 'public' and g.table_name = 'acciones_moderacion'
    and g.grantee in ('anon', 'authenticated')
    and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')

  union all
  select 9, 'Moderación', 'la bitácora no se puede editar', '✓'
  where not exists (
    select 1 from information_schema.role_table_grants g
    where g.table_schema = 'public' and g.table_name = 'acciones_moderacion'
      and g.grantee in ('anon', 'authenticated')
      and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'))

  -- ---------------------------------------------------------------------------
  -- Notificaciones push
  -- ---------------------------------------------------------------------------

  -- `has_function_privilege` mira también lo concedido a PUBLIC, que es como se
  -- cuela este agujero: Postgres da EXECUTE a PUBLIC en cada función nueva, así
  -- que basta con olvidar un `revoke` para publicar los endpoints de medio Cali.
  union all
  select 10, 'Push', 'anon puede ejecutar ' || p.proname, '✗ AGUJERO'
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname in (select nombre from solo_servidor)
    and has_function_privilege('anon', p.oid, 'EXECUTE')

  union all
  select 10, 'Push', 'los endpoints sólo los lee el servidor', '✓'
  where not exists (
    select 1 from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in (select nombre from solo_servidor)
      and has_function_privilege('anon', p.oid, 'EXECUTE'))

  -- El fallo simétrico, y mucho más fácil de no notar: sin estos permisos el
  -- interruptor de notificaciones no da error visible, simplemente no suscribe.
  union all
  select 10, 'Push', 'anon puede ' || p.proname,
         case when has_function_privilege('anon', p.oid, 'EXECUTE') then '✓'
              else '✗ SIN PERMISO' end
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname in (select nombre from abiertas_a_anon)

  union all
  select 10, 'Push', count(*) || ' suscripciones activas (' ||
         count(*) filter (where lat_aprox is not null) || ' con ubicación)',
         case when count(*) = 0 then '· todavía nadie activó las notificaciones'
              else '✓' end
  from suscripciones_push where activa

  -- La promesa de privacidad de la migración 0011 se verifica mirando las filas,
  -- no leyendo el código: si algo guardó una coordenada exacta, aquí se ve.
  union all
  select 10, 'Push', 'las ubicaciones están redondeadas a ~1 km',
         case when count(*) = 0 then '✓'
              else '✗ ' || count(*) || ' CON PRECISIÓN DE MÁS' end
  from suscripciones_push
  where lat_aprox is not null
    and (lat_aprox::numeric <> round(lat_aprox::numeric, 2)
         or lng_aprox::numeric <> round(lng_aprox::numeric, 2))
)

select bloque, elemento, estado
from comprobaciones
order by orden, (estado like '✗%') desc, elemento;
