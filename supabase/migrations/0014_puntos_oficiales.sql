-- infoCaliEmergencia — 0014: que un moderador pueda cargar puntos oficiales.
--
-- Hasta ahora los puntos oficiales sólo se cargaban por SQL, a mano, uno por
-- uno. Funciona el día del despliegue y no funciona ningún otro día: la
-- Alcaldía publica el reporte de cierres viales varias veces al día, con
-- quince o veinte esquinas cada vez, y nadie va a abrir el SQL Editor para eso
-- mientras el reporte sigue cambiando.
--
-- `rpc_crear_punto` no sirve para esto por dos razones: corta a cinco puntos
-- por hora —lo que es correcto contra un troll y absurdo contra un reporte de
-- dieciocho cierres— y siempre marca `origen = 'comunidad'`, así que un cierre
-- confirmado por la Secretaría de Movilidad podría tumbarlo la votación de tres
-- personas que pasaron por ahí y vieron la vía despejada.
--
-- Lo que esta migración NO hace es adivinar coordenadas. La esquina la sigue
-- poniendo una persona sobre el mapa; esto sólo recibe el punto que esa persona
-- señaló. Un cierre mal ubicado manda a alguien por una vía equivocada, y a
-- doscientos metros en una ciudad en cuadrícula ya es otra esquina.

alter table acciones_moderacion drop constraint if exists acciones_moderacion_accion_check;
alter table acciones_moderacion add constraint acciones_moderacion_accion_check
  check (accion in ('aprobar', 'ocultar', 'bloquear', 'desbloquear', 'ocultar_todo',
                    'publicar_aviso', 'retirar_aviso', 'publicar_reporte',
                    'crear_punto'));

create or replace function rpc_mod_crear_punto(
  p_nombre      text,
  p_tipo        text,
  p_lat         double precision,
  p_lng         double precision,
  p_dispositivo uuid,
  p_client_id   uuid,
  p_direccion   text default null,
  p_descripcion text default null,
  p_barrio      text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_mod uuid := auth.uid();
  v_id  uuid;
begin
  if not es_moderador() then
    raise exception 'Solo los moderadores pueden cargar puntos oficiales.'
      using errcode = '42501';
  end if;

  -- Idempotencia por `client_id`, igual que en el resto de escrituras: si la
  -- respuesta se pierde y el navegador reintenta, sale el mismo punto y no dos
  -- marcadores encima del otro.
  select id into v_id from puntos where client_id = p_client_id;
  if v_id is not null then
    return v_id;
  end if;

  perform fn_asegurar_dispositivo(p_dispositivo);

  -- A diferencia de `rpc_crear_punto`, aquí no hay fusión con lo que ya esté a
  -- menos de 40 m. Dos cierres seguidos sobre la misma calle —"Calle 5 con
  -- Carrera 56" y "Calle 5 entre Carrera 56 y 62"— caen a esa distancia, y
  -- fusionarlos en silencio le haría creer al moderador que ya cargó los dos.
  -- Si sobra un punto, se retira desde la cola de moderación, que deja rastro.
  insert into puntos (nombre, tipo, lat, lng, direccion, descripcion, barrio,
                      origen, creado_por, client_id)
  values (btrim(p_nombre), p_tipo, p_lat, p_lng,
          nullif(btrim(coalesce(p_direccion, '')), ''),
          nullif(btrim(coalesce(p_descripcion, '')), ''),
          nullif(btrim(coalesce(p_barrio, '')), ''),
          'oficial', p_dispositivo, p_client_id)
  returning id into v_id;

  insert into acciones_moderacion (moderador, accion, tabla, fila_id, motivo)
  values (v_mod, 'crear_punto', 'puntos', v_id::text, left(btrim(p_nombre), 280));

  return v_id;
end $$;

revoke all on function rpc_mod_crear_punto(text, text, double precision,
  double precision, uuid, uuid, text, text, text) from public, anon;

grant execute on function rpc_mod_crear_punto(text, text, double precision,
  double precision, uuid, uuid, text, text, text) to authenticated;
