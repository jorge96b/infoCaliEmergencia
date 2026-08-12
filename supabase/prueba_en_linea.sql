-- infoCaliEmergencia — prueba de la cifra de personas en línea.
--
-- Pégalo entero en el SQL Editor de Supabase. Comprueba que el latido cuenta,
-- que la ventana caduca, que un dispositivo bloqueado no suma y que `anon`
-- puede hacer su parte. BORRA todo lo que crea antes de terminar.
--
-- Es seguro correrlo sobre la base de producción: sólo toca los identificadores
-- que empiezan por fffffffe-, y los limpia pase lo que pase.

create temp table if not exists _pruebas_linea (
  orden int, prueba text, esperado text, obtenido text, estado text
);
truncate _pruebas_linea;

do $$
declare
  d1 uuid := 'fffffffe-0000-0000-0000-000000000001';
  d2 uuid := 'fffffffe-0000-0000-0000-000000000002';
  d3 uuid := 'fffffffe-0000-0000-0000-000000000003';
  v_base int;
  v_n    int;
  v_antes timestamptz;
  v_despues timestamptz;
begin
  -- Punto de partida: lo que ya haya en línea no es asunto de esta prueba, así
  -- que todo se mide como diferencia contra esta base.
  select personas_en_linea into v_base from v_global;

  -- -------------------------------------------------------------------------
  -- 1. Un latido pone al dispositivo en línea.
  -- -------------------------------------------------------------------------
  perform rpc_latido_dispositivo(d1);
  select personas_en_linea into v_n from v_global;
  insert into _pruebas_linea values (
    1, 'un latido suma a la cuenta', '1', (v_n - v_base)::text,
    case when v_n - v_base = 1 then '✓' else '✗' end);

  -- -------------------------------------------------------------------------
  -- 2. Fuera de la ventana de 10 minutos deja de contar.
  -- -------------------------------------------------------------------------
  update dispositivos set visto_en = now() - interval '11 minutes' where id = d1;
  select personas_en_linea into v_n from v_global;
  insert into _pruebas_linea values (
    2, 'a los 11 minutos ya no cuenta', '0', (v_n - v_base)::text,
    case when v_n - v_base = 0 then '✓' else '✗' end);

  -- -------------------------------------------------------------------------
  -- 3. Un latido perdido no borra a nadie: a los 6 minutos sigue contando.
  --
  -- Es el caso que justifica que la ventana sea el doble del latido — un túnel,
  -- un semáforo de red, y la persona sigue ahí.
  -- -------------------------------------------------------------------------
  update dispositivos set visto_en = now() - interval '6 minutes' where id = d1;
  select personas_en_linea into v_n from v_global;
  insert into _pruebas_linea values (
    3, 'un latido perdido no la saca de la cuenta', '1', (v_n - v_base)::text,
    case when v_n - v_base = 1 then '✓' else '✗' end);

  -- -------------------------------------------------------------------------
  -- 4. El latido resucita a un dispositivo viejo.
  -- -------------------------------------------------------------------------
  update dispositivos set visto_en = now() - interval '3 hours' where id = d1;
  select visto_en into v_antes from dispositivos where id = d1;
  perform rpc_latido_dispositivo(d1);
  select visto_en into v_despues from dispositivos where id = d1;
  insert into _pruebas_linea values (
    4, 'el latido actualiza visto_en', 'sí',
    case when v_despues > v_antes then 'sí' else 'no' end,
    case when v_despues > v_antes then '✓' else '✗' end);

  -- -------------------------------------------------------------------------
  -- 5. Un dispositivo bloqueado no engorda la cifra.
  --
  -- Importa porque el bloqueo es la herramienta contra el abuso: si un bot
  -- bloqueado siguiera contando, bastaría con dejarlo latiendo para inflar la
  -- sensación de que media ciudad está mirando.
  -- -------------------------------------------------------------------------
  insert into dispositivos (id) values (d2) on conflict (id) do nothing;
  begin
    perform rpc_latido_dispositivo(d2);
  exception when others then null;
  end;
  update dispositivos set bloqueado = true, visto_en = now() where id = d2;
  select personas_en_linea into v_n from v_global;
  insert into _pruebas_linea values (
    5, 'un dispositivo bloqueado no cuenta', '1', (v_n - v_base)::text,
    case when v_n - v_base = 1 then '✓' else '✗' end);

  -- -------------------------------------------------------------------------
  -- 6. Dos dispositivos distintos son dos personas.
  -- -------------------------------------------------------------------------
  perform rpc_latido_dispositivo(d3);
  select personas_en_linea into v_n from v_global;
  insert into _pruebas_linea values (
    6, 'dos dispositivos son dos', '2', (v_n - v_base)::text,
    case when v_n - v_base = 2 then '✓' else '✗' end);

exception when others then
  insert into _pruebas_linea values (0, 'ERROR INESPERADO', '', sqlerrm, '✗');
end $$;

-- `anon` tiene que poder llamar al latido y leer la cifra: es todo lo que hace
-- el cliente, y si un permiso falta, falla en silencio en el navegador.
do $$
declare v_n int;
begin
  set local role anon;
  perform rpc_latido_dispositivo('fffffffe-0000-0000-0000-000000000009');
  select personas_en_linea into v_n from v_global;
  reset role;
  insert into _pruebas_linea values (
    7, 'anon puede latir y leer la cifra', 'sí', 'sí', '✓');
exception when others then
  reset role;
  insert into _pruebas_linea values (7, 'anon puede latir y leer la cifra', 'sí', sqlerrm, '✗');
end $$;

delete from dispositivos where id::text like 'fffffffe-%';

select orden, prueba, esperado, obtenido, estado
from _pruebas_linea order by orden;
