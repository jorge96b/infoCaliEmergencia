-- infoCaliEmergencia — 0011: notificaciones push con prioridad por cercanía.
--
-- Hasta aquí la app sólo se enteraba de las novedades preguntando: sondeo cada
-- 20 s del mapa, 30 s de la línea de tiempo. Eso funciona con la app abierta y
-- no sirve de nada con el teléfono en el bolsillo, que es justo cuando un toque
-- de queda o una zona nueva de derrumbe importan.
--
-- Dos cosas que este archivo cruza a propósito, y conviene decirlas:
--
--   1. Es el primer sitio del esquema que guarda algo parecido a DÓNDE está una
--      persona. Hasta ahora la ubicación no salía del navegador. Aquí se guarda
--      redondeada a dos decimales —poco más de un kilómetro— y el redondeo se
--      aplica también del lado del servidor: la promesa de "sólo aproximada"
--      tiene que ser cierta en el lado que la guarda, no sólo en el que la manda.
--
--   2. Es el primero que existe para que lo lea un servidor nuestro. Todo lo
--      demás lo consulta el navegador con la `anon key`; enviar un push exige una
--      clave privada VAPID, y una clave privada no puede vivir en el navegador.
--      Por eso hay dos familias de funciones aquí: las de `anon`, que sólo
--      permiten darse de alta y de baja, y las de `service_role`, que son las
--      únicas que pueden leer un endpoint.
--
-- Sobre los endpoints: un `endpoint` con sus dos claves es una credencial de
-- envío. Quien lo tenga puede mandarle una notificación a ese teléfono. Se trata
-- igual que `dispositivos` — `anon` no lo lee jamás.
--
-- Nota sobre la numeración: existen dos archivos 0008 (ver la nota en
-- `0009_avisos.sql`), luego 0009 y 0010. Éste es el 0011.

-- ---------------------------------------------------------------------------
-- Suscripciones
--
-- Colgadas de `dispositivos` y no de una identidad nueva: el UUID del navegador
-- ya existe, ya viaja en cada petición y ya tiene `bloqueado`, así que quien
-- fue bloqueado por reportes falsos deja de recibir push sin escribir una línea
-- más.
--
-- La clave única es el `endpoint` y no el dispositivo: un mismo teléfono puede
-- tener la app instalada y abierta en el navegador a la vez, y son dos
-- suscripciones distintas para el servicio de push.
-- ---------------------------------------------------------------------------

create table if not exists suscripciones_push (
  id             uuid primary key default gen_random_uuid(),
  dispositivo_id uuid not null references dispositivos (id) on delete cascade,

  endpoint       text not null unique,
  p256dh         text not null,
  auth           text not null,

  -- Redondeadas a 2 decimales (~1.1 km). Los mismos límites que `puntos`: fuera
  -- de Cali esto no tiene nada que decir.
  lat_aprox      double precision check (lat_aprox between 3.28 and 3.62),
  lng_aprox      double precision check (lng_aprox between -76.68 and -76.42),
  ubicada_en     timestamptz,

  activa         boolean  not null default true,
  -- Fallos transitorios seguidos. Los definitivos (404/410) no cuentan aquí:
  -- ésos apagan la suscripción de una vez, ver `rpc_push_resultado`.
  fallos         smallint not null default 0,

  creada_en      timestamptz not null default now(),
  vista_en       timestamptz not null default now()
);

create index if not exists suscripciones_push_geo_idx
  on suscripciones_push (lat_aprox, lng_aprox) where activa;

create index if not exists suscripciones_push_dispositivo_idx
  on suscripciones_push (dispositivo_id);

-- ---------------------------------------------------------------------------
-- Envíos
--
-- Idempotencia, y es la pieza que evita el fallo caro de todo esto: un Database
-- Webhook reintenta cuando duda, y sin esto un reintento son dos notificaciones
-- para la misma persona sobre el mismo hecho. Es el mismo truco que `client_id`
-- en las tablas de reportes — un índice único hace estructuralmente imposible lo
-- que si no habría que recordar comprobar.
--
-- El barrido de comunidad se apoya en lo mismo: mira una ventana de 15 minutos
-- cada 3, así que ve cinco veces cada señal a propósito. Perder una señal por
-- una ventana corta sería un fallo real; repetirla sale gratis gracias a esta
-- tabla.
-- ---------------------------------------------------------------------------

create table if not exists envios_push (
  id             bigint generated always as identity primary key,
  suscripcion_id uuid not null references suscripciones_push (id) on delete cascade,
  origen         text not null check (origen in ('aviso', 'reporte_oficial', 'punto', 'necesidad')),
  fila_id        text not null,
  enviado_en     timestamptz not null default now(),
  unique (suscripcion_id, origen, fila_id)
);

create index if not exists envios_push_antiguedad_idx on envios_push (enviado_en);

-- ---------------------------------------------------------------------------
-- Memoria de niveles
--
-- `muy_requerido` no es una columna de ninguna tabla: es un nivel de consenso
-- que calcula `v_necesidades` a partir de votos con decaimiento, y cambia con el
-- paso del tiempo aunque no entre ningún reporte nuevo. No hay INSERT sobre el
-- que enganchar un webhook, así que la única forma de avisar "esto acaba de
-- volverse crítico" es recordar en qué nivel estaba la última vez que se miró.
--
-- Y hace falta recordarlo, no sólo mirar el nivel actual: una necesidad crítica
-- sigue siendo crítica durante horas, y avisar cada tres minutos de lo mismo es
-- exactamente cómo se consigue que la gente apague las notificaciones.
-- ---------------------------------------------------------------------------

create table if not exists nivel_notificado (
  punto_id    uuid not null references puntos (id) on delete cascade,
  recurso     text not null references recursos (slug),
  nivel       demanda not null,
  cambiado_en timestamptz not null default now(),
  primary key (punto_id, recurso)
);

-- ---------------------------------------------------------------------------
-- Alta, baja y ubicación — para `anon`
--
-- Mismas reglas que el resto de escrituras del proyecto: SECURITY DEFINER,
-- idempotentes, y pasando por `fn_asegurar_dispositivo`, que registra el
-- dispositivo y rechaza a los bloqueados.
-- ---------------------------------------------------------------------------

-- Redondeo a la rejilla de ~1.1 km. Existe como función y no escrito a mano en
-- cada sitio porque es la promesa de privacidad de esta migración: si algún día
-- cambia la resolución, cambia aquí y en ningún otro lado.
create or replace function fn_rejilla(v double precision)
returns double precision language sql immutable parallel safe as $$
  select round(v::numeric, 2)::double precision;
$$;

create or replace function rpc_push_suscribir(
  p_dispositivo uuid,
  p_endpoint    text,
  p_p256dh      text,
  p_auth        text,
  p_lat         double precision default null,
  p_lng         double precision default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform fn_asegurar_dispositivo(p_dispositivo);

  if length(btrim(coalesce(p_endpoint, ''))) < 20 then
    raise exception 'La suscripción no trae un endpoint utilizable.' using errcode = '22P02';
  end if;

  -- El navegador puede devolver el mismo endpoint tras reinstalar la app o
  -- cambiar de dispositivo lógico, así que la reconciliación va sobre el
  -- endpoint y reactiva lo que estuviera apagado. Volver a suscribirse es la
  -- forma que tiene la gente de arreglar unas notificaciones que dejaron de
  -- llegar; si eso no reactivara, no arreglaría nada.
  insert into suscripciones_push (dispositivo_id, endpoint, p256dh, auth,
                                  lat_aprox, lng_aprox, ubicada_en)
  values (p_dispositivo, btrim(p_endpoint), p_p256dh, p_auth,
          fn_rejilla(p_lat), fn_rejilla(p_lng),
          case when p_lat is not null then now() end)
  on conflict (endpoint) do update
    set dispositivo_id = excluded.dispositivo_id,
        p256dh         = excluded.p256dh,
        auth           = excluded.auth,
        -- Una re-suscripción sin coordenadas no borra las que ya había: el
        -- permiso de ubicación y el de notificaciones se conceden por separado
        -- y en cualquier orden.
        lat_aprox      = coalesce(excluded.lat_aprox, suscripciones_push.lat_aprox),
        lng_aprox      = coalesce(excluded.lng_aprox, suscripciones_push.lng_aprox),
        ubicada_en     = coalesce(excluded.ubicada_en, suscripciones_push.ubicada_en),
        activa         = true,
        fallos         = 0,
        vista_en       = now()
  returning id into v_id;

  return v_id;
end $$;

create or replace function rpc_push_ubicacion(
  p_dispositivo uuid,
  p_lat         double precision,
  p_lng         double precision
) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform fn_asegurar_dispositivo(p_dispositivo);

  update suscripciones_push
     set lat_aprox  = fn_rejilla(p_lat),
         lng_aprox  = fn_rejilla(p_lng),
         ubicada_en = now(),
         vista_en   = now()
   where dispositivo_id = p_dispositivo and activa;
end $$;

-- Baja. No borra la fila: si borrara, el navegador que vuelva con el mismo
-- endpoint no encontraría rastro y `envios_push` habría perdido la memoria de
-- lo ya enviado, así que la primera notificación tras reactivar sería un
-- duplicado de algo que la persona ya vio.
create or replace function rpc_push_baja(p_dispositivo uuid, p_endpoint text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update suscripciones_push
     set activa = false, vista_en = now()
   where endpoint = btrim(p_endpoint) and dispositivo_id = p_dispositivo;
end $$;

-- ---------------------------------------------------------------------------
-- Selección de destinatarios — sólo para el servidor
--
-- `p_lat` nulo significa "toda la ciudad", que es el caso de los avisos
-- oficiales: un toque de queda no tiene coordenadas.
--
-- Con coordenadas se filtra por bounding box antes de calcular la distancia
-- real, el mismo patrón que `rpc_crear_punto`, para que el índice sirva de algo.
-- El margen del cuadrado lleva un grado de más sobre lo estrictamente necesario
-- porque las coordenadas guardadas están redondeadas a 0.01°: sin ese margen,
-- alguien a 1.9 km del hecho podría caer fuera del cuadrado por el redondeo y
-- perderse una alerta que le tocaba.
-- ---------------------------------------------------------------------------

create or replace function rpc_push_destinatarios(
  p_lat     double precision default null,
  p_lng     double precision default null,
  p_radio_m double precision default null
) returns table (
  id          uuid,
  endpoint    text,
  p256dh      text,
  auth        text,
  distancia_m double precision
)
language sql stable security definer set search_path = public as $$
  with objetivo as (
    select coalesce(p_radio_m, 8000) as radio,
           -- Un grado de latitud son ~111.32 km en cualquier parte; el de
           -- longitud se encoge con el coseno de la latitud. El `greatest` sólo
           -- evita la división por cero en los polos, donde esta app no tiene
           -- nada que hacer. El `+ 0.01` es el margen del redondeo (ver arriba).
           coalesce(p_radio_m, 8000) / 111320.0 + 0.01 as d_lat,
           coalesce(p_radio_m, 8000)
             / (111320.0 * greatest(cos(radians(coalesce(p_lat, 0))), 0.01)) + 0.01 as d_lng
  )
  select s.id,
         s.endpoint,
         s.p256dh,
         s.auth,
         case when p_lat is null or s.lat_aprox is null then null
              else metros(s.lat_aprox, s.lng_aprox, p_lat, p_lng) end
  from suscripciones_push s
  join dispositivos d on d.id = s.dispositivo_id
  cross join objetivo o
  where s.activa
    and not d.bloqueado
    and (
      -- Sin objetivo geográfico: va a todo el mundo, tenga ubicación o no.
      p_lat is null
      or (
        s.lat_aprox is not null
        and s.lat_aprox between p_lat - o.d_lat and p_lat + o.d_lat
        and s.lng_aprox between p_lng - o.d_lng and p_lng + o.d_lng
        and metros(s.lat_aprox, s.lng_aprox, p_lat, p_lng) <= o.radio
      )
    );
$$;

-- Reserva el envío y devuelve sólo las suscripciones a las que de verdad toca
-- mandar. Las que ya estaban en `envios_push` para ese mismo hecho no vuelven:
-- se apuntan ANTES de enviar, no después, porque un push perdido molesta mucho
-- menos que un push repetido.
create or replace function rpc_push_reservar(
  p_origen        text,
  p_fila_id       text,
  p_suscripciones uuid[]
) returns setof uuid
language sql security definer set search_path = public as $$
  insert into envios_push (suscripcion_id, origen, fila_id)
  select unnest(p_suscripciones), p_origen, p_fila_id
  on conflict (suscripcion_id, origen, fila_id) do nothing
  returning suscripcion_id;
$$;

-- El reloj de la base, para marcar el inicio de una tanda. El servidor de envío
-- no puede usar el suyo: comparar dos relojes distintos con un `>=` es cómo se
-- acaban soltando reservas que no eran de esa tanda.
create or replace function rpc_push_ahora() returns timestamptz
language sql stable security definer set search_path = public as $$ select now(); $$;

-- Suelta las reservas de una tanda que no llegó a enviarse.
--
-- La reserva se hace ANTES de enviar, para que un reintento no duplique. El
-- efecto secundario es que un fallo pasajero del servicio de push —un 503 de
-- FCM de treinta segundos— dejaría a esa gente sin su aviso PARA SIEMPRE, porque
-- la fila de `envios_push` ya estaría puesta y el siguiente barrido la vería
-- como enviada. Soltando lo que falló, el barrido de dentro de tres minutos lo
-- vuelve a intentar solo.
--
-- Sólo se sueltan los fallos pasajeros. Un 410 no se suelta: esa suscripción no
-- existe y reintentarla no la va a resucitar.
create or replace function rpc_push_liberar(
  p_suscripciones uuid[],
  p_desde         timestamptz
) returns void
language sql security definer set search_path = public as $$
  delete from envios_push
   where suscripcion_id = any(p_suscripciones)
     and enviado_en >= p_desde;
$$;

-- Resultado de la tanda. Tres listas en una sola llamada para no hacer un viaje
-- por suscripción.
--
-- Un 404 o un 410 del servicio de push no es un fallo transitorio: significa que
-- esa suscripción ya no existe y no va a volver. Apagarla en el acto es lo
-- correcto y además obligado por la buena vecindad con FCM y compañía, que
-- penalizan a quien insiste contra endpoints muertos. Lo demás —5xx, tiempos de
-- espera— sí se reintenta, y sólo tras cinco tandas seguidas fallando se apaga.
create or replace function rpc_push_resultado(
  p_ok       uuid[] default '{}',
  p_muertas  uuid[] default '{}',
  p_fallidas uuid[] default '{}'
) returns void
language plpgsql security definer set search_path = public as $$
begin
  update suscripciones_push
     set fallos = 0, vista_en = now()
   where id = any(p_ok);

  update suscripciones_push
     set activa = false, vista_en = now()
   where id = any(p_muertas);

  update suscripciones_push
     set fallos   = least(fallos + 1, 32767),
         activa   = activa and fallos + 1 < 5,
         vista_en = now()
   where id = any(p_fallidas);
end $$;

-- ---------------------------------------------------------------------------
-- Barrido de señales de comunidad — sólo para el servidor
--
-- Devuelve lo que merece un aviso desde la última pasada. Dos orígenes:
--
--   · `punto`     — una zona afectada nueva. Es la única clase de punto cuyo
--                   solo nacimiento ya es noticia; un centro de acopio nuevo es
--                   una buena noticia, no una alerta.
--   · `necesidad` — una necesidad que ACABA de cruzar a `muy_requerido`. La
--                   transición, no el estado: ver la nota de `nivel_notificado`.
--
-- Las coordenadas salen siempre de `puntos`. Las tablas de reportes no tienen
-- lat/lng propias —heredan el sitio por `punto_id`— así que toda la geografía
-- de esta app pasa por ahí.
-- ---------------------------------------------------------------------------

create or replace function rpc_push_barrido(p_ventana interval default '15 minutes')
returns table (
  origen   text,
  fila_id  text,
  punto_id uuid,
  punto    text,
  barrio   text,
  lat      double precision,
  lng      double precision,
  emoji    text,
  etiqueta text
)
language plpgsql security definer set search_path = public as $$
-- Los parámetros de salida se llaman igual que varias columnas (`lat`, `nivel`,
-- `punto_id`…). Todo va cualificado más abajo, pero la directiva deja escrito
-- cuál gana si algún día se cuela una referencia a secas.
#variable_conflict use_column
begin
  -- Olvidar lo que salió de la ventana de 24 h de `v_necesidades`. Sin esto, una
  -- necesidad que se apagó sola y reaparece mañana se quedaría marcada como ya
  -- notificada y no volvería a avisar nunca.
  delete from nivel_notificado nn
   where not exists (
     select 1 from v_necesidades n
      where n.punto_id = nn.punto_id and n.recurso = nn.recurso);

  return query
  -- Poner al día la memoria. El `where` del `on conflict` es la pieza clave: si
  -- el nivel no cambió, no se actualiza la fila y RETURNING no la devuelve, así
  -- que una necesidad que lleva seis horas crítica no genera ciento veinte
  -- notificaciones.
  with cambios as (
    insert into nivel_notificado as nn (punto_id, recurso, nivel)
    select n.punto_id, n.recurso, n.nivel from v_necesidades n
    on conflict (punto_id, recurso) do update
      set nivel = excluded.nivel, cambiado_en = now()
      where nn.nivel is distinct from excluded.nivel
    returning nn.punto_id, nn.recurso, nn.nivel, nn.cambiado_en
  )
  -- Zonas afectadas nuevas.
  select 'punto'::text,
         p.id::text,
         p.id,
         p.nombre,
         p.barrio,
         p.lat,
         p.lng,
         tp.emoji,
         tp.etiqueta
    from puntos p
    join tipos_punto tp on tp.slug = p.tipo
   where p.tipo = 'zona_afectada'
     and p.estado = 'activo'
     and not p.oculto
     and p.creado_en > now() - p_ventana

  union all

  -- Necesidades que acaban de volverse críticas.
  --
  -- `cambiado_en` va dentro de `fila_id` a propósito: sin él, una necesidad que
  -- se apaga y vuelve a encenderse mañana tendría la misma clave que hoy y
  -- `envios_push` se la comería como si fuera un reintento.
  select 'necesidad'::text,
         t.punto_id::text || ':' || t.recurso || ':' ||
           extract(epoch from t.cambiado_en)::bigint::text,
         p.id,
         p.nombre,
         p.barrio,
         p.lat,
         p.lng,
         r.emoji,
         r.etiqueta
    from cambios t
    join puntos p   on p.id = t.punto_id
    join recursos r on r.slug = t.recurso
   where t.nivel = 'muy_requerido'
     and p.estado = 'activo'
     and not p.oculto;

  -- La cola de envíos no tiene por qué crecer para siempre. Una semana es de
  -- sobra: lo que evita es el duplicado inmediato de un reintento, no el de
  -- dentro de un mes.
  delete from envios_push where enviado_en < now() - interval '7 days';
end $$;

-- ---------------------------------------------------------------------------
-- Permisos
--
-- Supabase concede permisos por omisión a `anon` y `authenticated` sobre cada
-- tabla nueva del esquema `public`, y a `public` el EXECUTE de cada función
-- nueva. Aquí eso sería un agujero de los serios —los endpoints son
-- credenciales de envío— así que se revoca todo y se concede una cosa a la vez.
-- ---------------------------------------------------------------------------

alter table suscripciones_push enable row level security;
alter table envios_push        enable row level security;
alter table nivel_notificado   enable row level security;

revoke all on suscripciones_push, envios_push, nivel_notificado
  from anon, authenticated;

-- Las de `anon`: darse de alta, moverse y darse de baja. Nada más.
revoke all on function rpc_push_suscribir(uuid, text, text, text,
                                          double precision, double precision) from public;
revoke all on function rpc_push_ubicacion(uuid, double precision, double precision) from public;
revoke all on function rpc_push_baja(uuid, text) from public;

grant execute on function
  rpc_push_suscribir(uuid, text, text, text, double precision, double precision),
  rpc_push_ubicacion(uuid, double precision, double precision),
  rpc_push_baja(uuid, text)
to anon;

-- Las del servidor. Ni `anon` ni `authenticated`: `rpc_push_destinatarios`
-- devuelve endpoints, y un moderador con sesión tampoco tiene nada que hacer
-- con ellos.
revoke all on function rpc_push_destinatarios(double precision, double precision,
                                              double precision) from public, anon, authenticated;
revoke all on function rpc_push_reservar(text, text, uuid[]) from public, anon, authenticated;
revoke all on function rpc_push_ahora() from public, anon, authenticated;
revoke all on function rpc_push_liberar(uuid[], timestamptz) from public, anon, authenticated;
revoke all on function rpc_push_resultado(uuid[], uuid[], uuid[]) from public, anon, authenticated;
revoke all on function rpc_push_barrido(interval) from public, anon, authenticated;

grant execute on function
  rpc_push_destinatarios(double precision, double precision, double precision),
  rpc_push_reservar(text, text, uuid[]),
  rpc_push_ahora(),
  rpc_push_liberar(uuid[], timestamptz),
  rpc_push_resultado(uuid[], uuid[], uuid[]),
  rpc_push_barrido(interval)
to service_role;
