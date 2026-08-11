-- infoCaliEmergencia — prueba de la lógica de consenso sobre tu propia base.
--
-- Pégalo entero en el SQL Editor de Supabase. Crea datos de mentira, comprueba
-- que el consenso, el decaimiento y la idempotencia se comportan como deben, y
-- BORRA todo lo que creó antes de terminar. Al final muestra una tabla con el
-- resultado de cada prueba.
--
-- Es seguro correrlo sobre la base de producción: sólo toca los identificadores
-- que empiezan por ffffffff-, y los limpia pase lo que pase.

create temp table if not exists _pruebas (
  orden int, prueba text, esperado text, obtenido text, estado text
);
truncate _pruebas;

do $$
declare
  d1 uuid := 'ffffffff-0000-0000-0000-000000000001';
  d2 uuid := 'ffffffff-0000-0000-0000-000000000002';
  d3 uuid := 'ffffffff-0000-0000-0000-000000000003';
  d4 uuid := 'ffffffff-0000-0000-0000-000000000004';
  v_mod uuid := 'ffffffff-2222-2222-2222-222222222222';
  cid uuid := 'ffffffff-1111-1111-1111-111111111111';
  p uuid;
  p2 uuid;
  p3 uuid;
  p4 uuid;
  v_nivel text;
  v_conf int;
  v_n int;
  v_cant int;
  v_oculto boolean;
  v_nec bigint;
begin
  insert into dispositivos (id) values (d1), (d2), (d3), (d4)
    on conflict (id) do nothing;

  -- ---- 1. Crear punto y deduplicación por cercanía ----
  p := rpc_crear_punto('PRUEBA temporal — se borra sola', 'albergue',
                       3.4516, -76.5320, d1, gen_random_uuid());

  p2 := rpc_crear_punto('PRUEBA duplicado a 20 m', 'albergue',
                        3.45178, -76.5320, d2, gen_random_uuid());

  insert into _pruebas values (1, 'Deduplicación: mismo tipo a 20 m',
    'devuelve el punto existente',
    case when p = p2 then 'devolvió el mismo' else 'creó uno nuevo' end,
    case when p = p2 then '✓' else '✗ FALLA' end);

  -- ---- 2. Umbrales de consenso ----
  perform rpc_reportar_necesidad(p, 'agua', d1, 1::smallint, gen_random_uuid());
  select nivel::text into v_nivel from v_necesidades
   where punto_id = p and recurso = 'agua';

  insert into _pruebas values (2, 'Una persona confirma',
    'poco_requerido', v_nivel,
    case when v_nivel = 'poco_requerido' then '✓' else '✗ FALLA' end);

  perform rpc_reportar_necesidad(p, 'agua', d2, 1::smallint, gen_random_uuid());
  perform rpc_reportar_necesidad(p, 'agua', d3, 1::smallint, gen_random_uuid());
  select nivel::text into v_nivel from v_necesidades
   where punto_id = p and recurso = 'agua';

  insert into _pruebas values (3, 'Tres personas confirman',
    'muy_requerido', v_nivel,
    case when v_nivel = 'muy_requerido' then '✓' else '✗ FALLA' end);

  -- ---- 3. Insistir no debe inflar el consenso ----
  perform rpc_reportar_necesidad(p, 'agua', d1, 1::smallint, gen_random_uuid());
  perform rpc_reportar_necesidad(p, 'agua', d1, 1::smallint, gen_random_uuid());
  select confirmaciones into v_conf from v_necesidades
   where punto_id = p and recurso = 'agua';

  insert into _pruebas values (4, 'Un dispositivo insiste 3 veces',
    'sigue contando 3 personas', v_conf || ' personas',
    case when v_conf = 3 then '✓' else '✗ FALLA: insistir infló el consenso' end);

  -- ---- 4. Corrección: "ya llegó" baja el nivel ----
  perform rpc_reportar_necesidad(p, 'agua', d1, (-1)::smallint, gen_random_uuid());
  perform rpc_reportar_necesidad(p, 'agua', d2, (-1)::smallint, gen_random_uuid());
  select nivel::text into v_nivel from v_necesidades
   where punto_id = p and recurso = 'agua';

  insert into _pruebas values (5, 'Dos personas dicen "ya llegó"',
    'no_requerido', coalesce(v_nivel, '(sin datos)'),
    case when v_nivel = 'no_requerido' then '✓' else '✗ FALLA' end);

  -- ---- 5. Decaimiento: fuera de la ventana de 24 h deja de contar ----
  update necesidad_reportes set efectivo_en = now() - interval '30 hours'
   where punto_id = p;
  select count(*) into v_n from v_necesidades where punto_id = p;

  insert into _pruebas values (6, 'Reportes de hace 30 h',
    'ya no aparecen', v_n || ' visibles',
    case when v_n = 0 then '✓' else '✗ FALLA: no caducan' end);

  -- ---- 6. Mediana frente a un valor extremo ----
  perform rpc_reportar_personas(p, d1, 'desaparecido', 3::smallint, gen_random_uuid());
  perform rpc_reportar_personas(p, d2, 'desaparecido', 4::smallint, gen_random_uuid());
  perform rpc_reportar_personas(p, d3, 'desaparecido', 500::smallint, gen_random_uuid());
  select cantidad into v_cant from v_personas where punto_id = p;

  insert into _pruebas values (7, 'Alguien reporta 500 desaparecidos',
    'la mediana se queda en 3-5', v_cant::text,
    case when v_cant between 3 and 5 then '✓'
         else '✗ FALLA: un valor extremo movió la cifra' end);

  -- ---- 7. Presencia y su caducidad ----
  perform rpc_presencia_entrar(p, d1, gen_random_uuid(), 5::smallint);
  select personas into v_n from v_presencia where punto_id = p;

  insert into _pruebas values (8, 'Marcar presencia con 5 personas',
    '5', coalesce(v_n::text, '0'),
    case when v_n = 5 then '✓' else '✗ FALLA' end);

  update presencia set visto_en = now() - interval '2 hours' where punto_id = p;
  select count(*) into v_n from v_presencia where punto_id = p;

  insert into _pruebas values (9, 'Presencia sin latido en 2 h',
    'deja de contar', v_n || ' activas',
    case when v_n = 0 then '✓' else '✗ FALLA: la presencia no caduca' end);

  -- ---- 8. Idempotencia (lo que hace segura la cola sin señal) ----
  perform rpc_reportar_necesidad(p, 'volquetas', d1, 1::smallint, cid);
  perform rpc_reportar_necesidad(p, 'volquetas', d1, 1::smallint, cid);
  perform rpc_reportar_necesidad(p, 'volquetas', d1, 1::smallint, cid);
  select count(*) into v_n from necesidad_reportes
   where punto_id = p and recurso = 'volquetas';

  insert into _pruebas values (10, 'El mismo client_id enviado 3 veces',
    '1 fila', v_n || ' filas',
    case when v_n = 1 then '✓'
         else '✗ FALLA: la cola sin señal duplicaría reportes' end);

  -- ---- 9. Coordenadas fuera de Cali ----
  begin
    insert into puntos (nombre, tipo, lat, lng, creado_por, client_id)
    values ('PRUEBA fuera de Cali', 'albergue', 40.7, -74.0, d1, gen_random_uuid());
    insert into _pruebas values (11, 'Punto con coordenadas de Nueva York',
      'rechazado', 'aceptado', '✗ FALLA');
  exception when check_violation then
    insert into _pruebas values (11, 'Punto con coordenadas de Nueva York',
      'rechazado', 'rechazado', '✓');
  end;

  -- ---- 10. Moderación ----
  --
  -- Se simula la sesión de un moderador fijando la misma variable que lee
  -- `auth.uid()`. El tercer argumento de `set_config` es `is_local`: se deshace
  -- solo al terminar la transacción, así que no puede quedarse pegada.
  insert into moderadores (id, nombre) values (v_mod, 'PRUEBA moderador')
    on conflict (id) do nothing;
  perform set_config('request.jwt.claim.sub', v_mod::text, true);

  p3 := rpc_crear_punto('PRUEBA a moderar', 'albergue',
                        3.4600, -76.5400, d1, gen_random_uuid());

  perform rpc_denunciar('puntos', p3::text, d1, 'falso', gen_random_uuid());
  perform rpc_denunciar('puntos', p3::text, d2, 'falso', gen_random_uuid());
  perform rpc_denunciar('puntos', p3::text, d3, 'falso', gen_random_uuid());
  select oculto into v_oculto from puntos where id = p3;

  insert into _pruebas values (12, 'Tres dispositivos denuncian un punto',
    'queda oculto', case when v_oculto then 'oculto' else 'visible' end,
    case when v_oculto then '✓' else '✗ FALLA: el auto-ocultamiento no actuó' end);

  perform rpc_mod_decidir('puntos', p3::text, 'aprobado', 'PRUEBA');
  select oculto into v_oculto from puntos where id = p3;

  insert into _pruebas values (13, 'Un moderador lo aprueba',
    'vuelve a estar visible', case when v_oculto then 'oculto' else 'visible' end,
    case when not v_oculto then '✓' else '✗ FALLA' end);

  -- La prueba que justifica media migración: sin la guarda de
  -- `decisiones_moderacion`, esta cuarta denuncia volvía a tumbarlo y el
  -- moderador quedaba atrapado deshaciendo lo mismo para siempre.
  perform rpc_denunciar('puntos', p3::text, d4, 'falso', gen_random_uuid());
  select oculto into v_oculto from puntos where id = p3;

  insert into _pruebas values (14, 'Cuarta denuncia sobre lo ya aprobado',
    'sigue visible', case when v_oculto then 'oculto otra vez' else 'visible' end,
    case when not v_oculto then '✓'
         else '✗ FALLA: las denuncias deshacen las decisiones' end);

  -- Y la otra mitad: rectificar dentro de la misma hora no puede destapar lo
  -- que un moderador escondió a mano.
  v_nec := rpc_reportar_necesidad(p3, 'agua', d2, 1::smallint, gen_random_uuid());
  perform rpc_mod_decidir('necesidad_reportes', v_nec::text, 'oculto', 'PRUEBA');
  perform rpc_reportar_necesidad(p3, 'agua', d2, 1::smallint, gen_random_uuid());
  select oculto into v_oculto from necesidad_reportes where id = v_nec;

  insert into _pruebas values (15, 'Reportar de nuevo lo que se ocultó a mano',
    'sigue oculto', case when v_oculto then 'oculto' else 'destapado' end,
    case when v_oculto then '✓'
         else '✗ FALLA: repetir el reporte deshace la decisión' end);

  -- Un albergue oficial no puede desaparecer del mapa por votación.
  p4 := rpc_crear_punto('PRUEBA oficial', 'albergue',
                        3.4700, -76.5500, d1, gen_random_uuid());
  update puntos set origen = 'oficial' where id = p4;

  perform rpc_denunciar('puntos', p4::text, d1, 'falso', gen_random_uuid());
  perform rpc_denunciar('puntos', p4::text, d2, 'falso', gen_random_uuid());
  perform rpc_denunciar('puntos', p4::text, d3, 'falso', gen_random_uuid());
  select oculto into v_oculto from puntos where id = p4;

  insert into _pruebas values (16, 'Tres denuncias sobre un punto oficial',
    'sigue visible', case when v_oculto then 'oculto' else 'visible' end,
    case when not v_oculto then '✓'
         else '✗ FALLA: se puede tumbar un albergue verificado' end);

  -- Sin sesión de moderador, moderar tiene que ser imposible.
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform rpc_mod_decidir('puntos', p3::text, 'oculto', 'PRUEBA');
    insert into _pruebas values (17, 'Moderar sin ser moderador',
      'rechazado', 'aceptado', '✗ FALLA: cualquiera puede moderar');
  exception when insufficient_privilege then
    insert into _pruebas values (17, 'Moderar sin ser moderador',
      'rechazado', 'rechazado', '✓');
  end;
  perform set_config('request.jwt.claim.sub', v_mod::text, true);

  -- Bloquear sin ocultar deja el rastro en el mapa, que es justo lo que no
  -- sirve. Va al final porque después de esto d3 ya no puede reportar.
  perform rpc_mod_bloquear(d3, true, 'PRUEBA de bloqueo', true);
  select count(*) into v_n from persona_reportes
   where dispositivo_id = d3 and not oculto;

  insert into _pruebas values (18, 'Bloquear ocultando todo lo publicado',
    'no queda nada visible', v_n || ' filas visibles',
    case when v_n = 0 then '✓' else '✗ FALLA: lo suyo sigue en el mapa' end);

exception when others then
  insert into _pruebas values (99, 'ERROR INESPERADO', '', sqlerrm, '✗');
end $$;

-- Limpieza: todo lo que creó la prueba, pase lo que pase. El borrado en cascada
-- se lleva reportes, confirmaciones y presencia asociados; las denuncias y las
-- decisiones NO van en cascada (`reportes_abuso.fila_id` es texto sin clave
-- foránea), así que se borran a mano y antes que aquello a lo que apuntan.
delete from reportes_abuso      where dispositivo_id::text like 'ffffffff-%';
delete from acciones_moderacion where moderador::text like 'ffffffff-%';
delete from decisiones_moderacion where moderador::text like 'ffffffff-%';
delete from puntos where nombre like 'PRUEBA %';
delete from moderadores   where id::text like 'ffffffff-%';
delete from dispositivos  where id::text like 'ffffffff-%';

select prueba, esperado, obtenido, estado
from _pruebas
order by orden;
