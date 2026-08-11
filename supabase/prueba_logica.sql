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
  cid uuid := 'ffffffff-1111-1111-1111-111111111111';
  p uuid;
  p2 uuid;
  v_nivel text;
  v_conf int;
  v_n int;
  v_cant int;
begin
  insert into dispositivos (id) values (d1), (d2), (d3)
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

exception when others then
  insert into _pruebas values (99, 'ERROR INESPERADO', '', sqlerrm, '✗');
end $$;

-- Limpieza: todo lo que creó la prueba, pase lo que pase. El borrado en cascada
-- se lleva reportes, confirmaciones y presencia asociados.
delete from puntos where nombre like 'PRUEBA %';
delete from dispositivos where id::text like 'ffffffff-%';

select prueba, esperado, obtenido, estado
from _pruebas
order by orden;
