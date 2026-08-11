-- infoCaliEmergencia — 0004: funciones de escritura.
--
-- Casi todo lo que escribe la aplicación pasa por aquí en vez de por un INSERT
-- directo, porque necesita lógica que el cliente no puede garantizar:
--
--   · Crear un punto deduplica por cercanía, para que el mapa no se llene de
--     alfileres repetidos del mismo albergue.
--   · Reportar una necesidad debe poder CORREGIRSE dentro de la misma hora, y el
--     índice único por `slot` convierte eso en un upsert que el cliente no puede
--     expresar por sí solo (no conoce ni puede fijar `slot`).
--   · Marcar presencia es abrir una sesión, no insertar un evento.
--
-- Todas son SECURITY DEFINER y todas son idempotentes por `client_id`: reenviar
-- la cola offline cien veces produce exactamente una fila.

-- Distancia en metros entre dos coordenadas (haversine). Doce líneas que nos
-- ahorran depender de PostGIS.
create or replace function metros(lat1 double precision, lng1 double precision,
                                  lat2 double precision, lng2 double precision)
returns double precision language sql immutable parallel safe as $$
  select 6371000 * acos(least(1, greatest(-1,
    sin(radians(lat1)) * sin(radians(lat2)) +
    cos(radians(lat1)) * cos(radians(lat2)) * cos(radians(lng2 - lng1)))));
$$;

-- Comprobación compartida: dispositivo registrado, no bloqueado, y coherente
-- con la cabecera si viene.
--
-- Sobre la cabecera: `x-device-id` la fija el propio cliente, así que cualquiera
-- puede falsificarla. No es un control de seguridad y no se pretende que lo sea
-- — atrapa errores de programación, no atacantes. Lo que de verdad contiene el
-- abuso son los índices únicos por `slot`, los límites de tasa y el hecho de que
-- las vistas usen medianas y consenso en vez de sumas.
create or replace function fn_asegurar_dispositivo(p_dispositivo uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_cabecera uuid;
begin
  v_cabecera := dispositivo_actual();
  if v_cabecera is not null and v_cabecera <> p_dispositivo then
    raise exception 'El dispositivo no coincide con la sesión.' using errcode = '42501';
  end if;

  insert into dispositivos (id) values (p_dispositivo)
    on conflict (id) do update set visto_en = now();

  if exists (select 1 from dispositivos where id = p_dispositivo and bloqueado) then
    raise exception 'Este dispositivo fue bloqueado por reportes falsos.' using errcode = '42501';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Crear punto
--
-- Si ya existe un punto del mismo tipo a menos de 40 metros, no se crea uno
-- nuevo: se confirma el que ya estaba. Sin esto, diez personas marcando el mismo
-- albergue producen diez alfileres y el mapa deja de servir justo cuando más
-- gente lo está usando.
-- ---------------------------------------------------------------------------

create or replace function rpc_crear_punto(
  p_nombre      text,
  p_tipo        text,
  p_lat         double precision,
  p_lng         double precision,
  p_dispositivo uuid,
  p_client_id   uuid,
  p_direccion   text default null,
  p_descripcion text default null,
  p_barrio      text default null,
  p_contacto    text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id        uuid;
  v_existente uuid;
  v_n         int;
begin
  select id into v_id from puntos where client_id = p_client_id;
  if v_id is not null then
    return v_id;
  end if;

  perform fn_asegurar_dispositivo(p_dispositivo);

  select count(*) into v_n from puntos
   where creado_por = p_dispositivo and creado_en > now() - interval '1 hour';
  if v_n >= 5 then
    raise exception 'Máximo 5 puntos nuevos por hora.' using errcode = 'P0001';
  end if;

  -- El prefiltro por bounding box (~66 m) permite usar el índice; luego la
  -- distancia real descarta las esquinas del cuadrado.
  select id into v_existente from puntos
   where tipo = p_tipo
     and estado = 'activo'
     and not oculto
     and lat between p_lat - 0.0006 and p_lat + 0.0006
     and lng between p_lng - 0.0006 and p_lng + 0.0006
     and metros(lat, lng, p_lat, p_lng) < 40
   order by metros(lat, lng, p_lat, p_lng)
   limit 1;

  if v_existente is not null then
    insert into punto_confirmaciones (punto_id, dispositivo_id, voto, client_id)
    values (v_existente, p_dispositivo, 1, p_client_id)
    on conflict do nothing;
    return v_existente;
  end if;

  insert into puntos (nombre, tipo, lat, lng, direccion, descripcion, barrio,
                      contacto, creado_por, client_id)
  values (btrim(p_nombre), p_tipo, p_lat, p_lng, p_direccion, p_descripcion,
          p_barrio, p_contacto, p_dispositivo, p_client_id)
  returning id into v_id;

  -- Quien crea el punto cuenta como su primera confirmación.
  insert into punto_confirmaciones (punto_id, dispositivo_id, voto, client_id)
  values (v_id, p_dispositivo, 1, gen_random_uuid());

  return v_id;
end $$;

create or replace function rpc_confirmar_punto(
  p_punto uuid, p_dispositivo uuid, p_voto smallint, p_client_id uuid
) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform fn_asegurar_dispositivo(p_dispositivo);

  insert into punto_confirmaciones (punto_id, dispositivo_id, voto, client_id)
  values (p_punto, p_dispositivo, p_voto, p_client_id)
  on conflict (punto_id, dispositivo_id)
  do update set voto = excluded.voto, creado_en = now();
end $$;

-- ---------------------------------------------------------------------------
-- Reportes
--
-- El `on conflict … do update` sobre el índice de `slot` es lo que permite
-- rectificar: si alguien marca "falta agua" y dos minutos después ve llegar el
-- camión, su segundo toque reemplaza al primero en lugar de rebotar contra el
-- límite de tasa. Corregir tiene que ser tan barato como reportar, o la gente
-- simplemente no corrige.
-- ---------------------------------------------------------------------------

create or replace function rpc_reportar_necesidad(
  p_punto        uuid,
  p_recurso      text,
  p_dispositivo  uuid,
  p_voto         smallint,
  p_client_id    uuid,
  p_cantidad     numeric     default null,
  p_nota         text        default null,
  p_reportado_en timestamptz default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  select id into v_id from necesidad_reportes where client_id = p_client_id;
  if v_id is not null then
    return v_id;
  end if;

  perform fn_asegurar_dispositivo(p_dispositivo);

  insert into necesidad_reportes
    (punto_id, recurso, dispositivo_id, voto, cantidad, nota, client_id, reportado_en)
  values
    (p_punto, p_recurso, p_dispositivo, p_voto, p_cantidad, p_nota, p_client_id, p_reportado_en)
  on conflict (punto_id, recurso, dispositivo_id, slot)
  do update set voto        = excluded.voto,
                cantidad    = coalesce(excluded.cantidad, necesidad_reportes.cantidad),
                nota        = coalesce(excluded.nota, necesidad_reportes.nota),
                efectivo_en = greatest(necesidad_reportes.efectivo_en, excluded.efectivo_en),
                oculto      = false
  returning id into v_id;

  return v_id;
end $$;

create or replace function rpc_reportar_insumo(
  p_punto        uuid,
  p_recurso      text,
  p_dispositivo  uuid,
  p_nivel        nivel_stock,
  p_client_id    uuid,
  p_cantidad     numeric     default null,
  p_nota         text        default null,
  p_reportado_en timestamptz default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  select id into v_id from insumo_reportes where client_id = p_client_id;
  if v_id is not null then
    return v_id;
  end if;

  perform fn_asegurar_dispositivo(p_dispositivo);

  insert into insumo_reportes
    (punto_id, recurso, dispositivo_id, nivel, cantidad, nota, client_id, reportado_en)
  values
    (p_punto, p_recurso, p_dispositivo, p_nivel, p_cantidad, p_nota, p_client_id, p_reportado_en)
  on conflict (punto_id, recurso, dispositivo_id, slot)
  do update set nivel       = excluded.nivel,
                cantidad    = coalesce(excluded.cantidad, insumo_reportes.cantidad),
                nota        = coalesce(excluded.nota, insumo_reportes.nota),
                efectivo_en = greatest(insumo_reportes.efectivo_en, excluded.efectivo_en),
                oculto      = false
  returning id into v_id;

  return v_id;
end $$;

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
declare v_id bigint;
begin
  select id into v_id from persona_reportes where client_id = p_client_id;
  if v_id is not null then
    return v_id;
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
                oculto      = false
  returning id into v_id;

  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Presencia
-- ---------------------------------------------------------------------------

create or replace function rpc_presencia_entrar(
  p_punto uuid, p_dispositivo uuid, p_client_id uuid,
  p_personas smallint default 1, p_rol text default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  perform fn_asegurar_dispositivo(p_dispositivo);

  -- Sólo se puede estar en un punto a la vez: llegar a uno cierra el anterior.
  update presencia set fin_en = now()
   where dispositivo_id = p_dispositivo and fin_en is null and punto_id <> p_punto;

  update presencia set visto_en = now(), personas = p_personas, rol = coalesce(p_rol, rol)
   where dispositivo_id = p_dispositivo and punto_id = p_punto and fin_en is null
  returning id into v_id;

  if v_id is null then
    insert into presencia (punto_id, dispositivo_id, personas, rol, client_id)
    values (p_punto, p_dispositivo, p_personas, p_rol, p_client_id)
    on conflict (client_id) do update set visto_en = now(), fin_en = null
    returning id into v_id;
  end if;

  return v_id;
end $$;

-- Latido: mantiene viva la sesión. Sin él, la presencia caduca a los 90 minutos.
create or replace function rpc_presencia_latido(p_dispositivo uuid) returns void
language sql security definer set search_path = public as $$
  update presencia set visto_en = now()
   where dispositivo_id = p_dispositivo and fin_en is null;
$$;

create or replace function rpc_presencia_salir(p_dispositivo uuid) returns void
language sql security definer set search_path = public as $$
  update presencia set fin_en = now()
   where dispositivo_id = p_dispositivo and fin_en is null;
$$;

-- ¿En qué punto estoy? El cliente lo pregunta al abrir para restaurar el estado
-- del botón de presencia.
create or replace function rpc_mi_presencia(p_dispositivo uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select punto_id from presencia
   where dispositivo_id = p_dispositivo
     and fin_en is null
     and visto_en > now() - interval '90 minutes'
   limit 1;
$$;

create or replace function rpc_denunciar(
  p_tabla text, p_fila_id text, p_dispositivo uuid,
  p_motivo text, p_client_id uuid, p_detalle text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform fn_asegurar_dispositivo(p_dispositivo);

  insert into reportes_abuso (tabla, fila_id, dispositivo_id, motivo, detalle, client_id)
  values (p_tabla, p_fila_id, p_dispositivo, p_motivo, p_detalle, p_client_id)
  on conflict do nothing;
end $$;

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------

revoke all on function rpc_crear_punto(text, text, double precision, double precision,
                                       uuid, uuid, text, text, text, text) from public;

grant execute on function
  rpc_crear_punto(text, text, double precision, double precision, uuid, uuid, text, text, text, text),
  rpc_confirmar_punto(uuid, uuid, smallint, uuid),
  rpc_reportar_necesidad(uuid, text, uuid, smallint, uuid, numeric, text, timestamptz),
  rpc_reportar_insumo(uuid, text, uuid, nivel_stock, uuid, numeric, text, timestamptz),
  rpc_reportar_personas(uuid, uuid, estado_persona, smallint, uuid, text, timestamptz),
  rpc_presencia_entrar(uuid, uuid, uuid, smallint, text),
  rpc_presencia_latido(uuid),
  rpc_presencia_salir(uuid),
  rpc_mi_presencia(uuid),
  rpc_denunciar(text, text, uuid, text, uuid, text)
to anon;
