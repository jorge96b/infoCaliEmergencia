-- Mushu — mapa colaborativo de emergencia para Cali
-- 0001: enums, catálogos, puntos y tablas de reportes.
--
-- Ejecutar en orden: 0001_esquema, 0002_vistas, 0003_rls, 0004_rpc, 0005_semilla.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type demanda           as enum ('no_requerido', 'poco_requerido', 'muy_requerido');
create type categoria_recurso as enum ('insumo', 'equipo', 'personal');
create type nivel_stock       as enum ('nada', 'poco', 'suficiente', 'excedente');
create type estado_persona    as enum ('desaparecido', 'herido', 'rescatado');
create type estado_punto      as enum ('activo', 'cerrado', 'duplicado');
create type origen_punto      as enum ('comunidad', 'oficial');

-- ---------------------------------------------------------------------------
-- Catálogos
-- ---------------------------------------------------------------------------

create table tipos_punto (
  slug     text primary key,
  etiqueta text not null,
  color    text not null,
  emoji    text not null,
  orden    smallint not null default 100,
  activo   boolean not null default true
);

-- Insumos, equipos y personal viven en una sola tabla. Agregar un recurso
-- nuevo es insertar una fila: no requiere tocar el código de la aplicación.
create table recursos (
  slug      text primary key,
  etiqueta  text not null,
  categoria categoria_recurso not null,
  unidad    text not null default 'unidad',
  emoji     text not null,
  orden     smallint not null default 100,
  destacado boolean not null default false,   -- aparece en la grilla rápida
  activo    boolean not null default true
);

create index recursos_orden_idx on recursos (categoria, orden) where activo;

-- ---------------------------------------------------------------------------
-- Dispositivos
--
-- Identidad anónima: un UUID generado en el navegador. No es autenticación —
-- sirve para deduplicar votos, limitar la tasa de reportes y poder bloquear a
-- quien abuse. Nunca se expone públicamente.
-- ---------------------------------------------------------------------------

create table dispositivos (
  id        uuid primary key,
  creado_en timestamptz not null default now(),
  visto_en  timestamptz not null default now(),
  bloqueado boolean not null default false,
  motivo    text
);

-- ---------------------------------------------------------------------------
-- Puntos del mapa
--
-- Coordenadas como double precision en vez de PostGIS: Cali cabe en un
-- bounding box pequeño y todas las consultas son filtros por rango o "dame
-- todo", así que la extensión agregaría fricción sin comprar nada. La distancia
-- se calcula con una función haversine (ver 0004_rpc).
-- ---------------------------------------------------------------------------

create table puntos (
  id             uuid primary key default gen_random_uuid(),
  nombre         text not null check (length(btrim(nombre)) between 3 and 80),
  tipo           text not null references tipos_punto (slug),
  lat            double precision not null check (lat between 3.28 and 3.62),
  lng            double precision not null check (lng between -76.68 and -76.42),
  direccion      text check (length(direccion) <= 160),
  descripcion    text check (length(descripcion) <= 500),
  barrio         text check (length(barrio) <= 60),
  contacto       text check (length(contacto) <= 60),
  estado         estado_punto not null default 'activo',
  origen         origen_punto not null default 'comunidad',
  creado_por     uuid not null references dispositivos (id),
  client_id      uuid not null unique,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  oculto         boolean not null default false
);

create index puntos_activos_idx on puntos (tipo) where estado = 'activo' and not oculto;
create index puntos_coords_idx  on puntos (lat, lng) where estado = 'activo' and not oculto;

-- Confirmaciones de que el punto existe de verdad. Un punto pasa a
-- "verificado" cuando 3 dispositivos distintos lo confirman.
create table punto_confirmaciones (
  id             bigint generated always as identity primary key,
  punto_id       uuid not null references puntos (id) on delete cascade,
  dispositivo_id uuid not null references dispositivos (id),
  voto           smallint not null check (voto in (-1, 1)),
  client_id      uuid not null unique,
  creado_en      timestamptz not null default now(),
  unique (punto_id, dispositivo_id)
);

create index punto_conf_idx on punto_confirmaciones (punto_id);

-- ---------------------------------------------------------------------------
-- Reportes
--
-- Tres columnas aparecen en todas las tablas de reportes y merecen explicación:
--
--   client_id    UUID generado en el navegador ANTES del primer intento de red.
--                Único, así que reenviar la cola offline nunca duplica filas,
--                ni siquiera cuando la petición llegó pero la respuesta se perdió.
--
--   efectivo_en  Momento real de la observación. Cuando un reporte estuvo
--                encolado sin señal, decae desde que se observó y no desde que
--                se logró enviar. Un trigger lo acota a [creado_en - 6 h,
--                creado_en] para que un reloj desajustado —o alguien haciendo
--                trampa— no pueda inflar ni posfechar su reporte.
--
--   slot         La hora UTC truncada. Junto con el índice único de más abajo
--                garantiza un solo reporte por dispositivo, punto y recurso por
--                hora: el límite de tasa deja de ser una heurística y pasa a ser
--                una imposibilidad estructural.
-- ---------------------------------------------------------------------------

-- "Aquí falta X" (voto = 1) / "Ya llegó X" (voto = -1)
create table necesidad_reportes (
  id             bigint generated always as identity primary key,
  punto_id       uuid not null references puntos (id) on delete cascade,
  recurso        text not null references recursos (slug),
  dispositivo_id uuid not null references dispositivos (id),
  voto           smallint not null check (voto in (-1, 1)),
  cantidad       numeric(10,2) check (cantidad is null or (cantidad > 0 and cantidad <= 100000)),
  nota           text check (length(nota) <= 280),
  client_id      uuid not null unique,
  reportado_en   timestamptz,
  creado_en      timestamptz not null default now(),
  efectivo_en    timestamptz not null default now(),
  slot           timestamp   not null default date_trunc('hour', timezone('UTC', now())),
  oculto         boolean not null default false,
  unique (punto_id, recurso, dispositivo_id, slot)
);

create index necesidad_lookup_idx
  on necesidad_reportes (punto_id, recurso, dispositivo_id, efectivo_en desc)
  where not oculto;

-- "Cuánto hay de X aquí"
create table insumo_reportes (
  id             bigint generated always as identity primary key,
  punto_id       uuid not null references puntos (id) on delete cascade,
  recurso        text not null references recursos (slug),
  dispositivo_id uuid not null references dispositivos (id),
  nivel          nivel_stock not null,
  cantidad       numeric(10,2) check (cantidad is null or (cantidad >= 0 and cantidad <= 1000000)),
  nota           text check (length(nota) <= 280),
  client_id      uuid not null unique,
  reportado_en   timestamptz,
  creado_en      timestamptz not null default now(),
  efectivo_en    timestamptz not null default now(),
  slot           timestamp   not null default date_trunc('hour', timezone('UTC', now())),
  oculto         boolean not null default false,
  unique (punto_id, recurso, dispositivo_id, slot)
);

create index insumo_lookup_idx
  on insumo_reportes (punto_id, recurso, dispositivo_id, efectivo_en desc)
  where not oculto;

-- Conteos de personas. Deliberadamente sin nombres, teléfonos ni fotos:
-- un registro público y anónimo de personas desaparecidas por nombre sería una
-- violación de la Ley 1581 de 2012 y un vector conocido de estafa y extorsión
-- tras desastres en Colombia. Ver /ayuda en la aplicación.
create table persona_reportes (
  id             bigint generated always as identity primary key,
  punto_id       uuid not null references puntos (id) on delete cascade,
  dispositivo_id uuid not null references dispositivos (id),
  estado         estado_persona not null,
  cantidad       smallint not null check (cantidad between 0 and 500),
  nota           text check (length(nota) <= 280),
  client_id      uuid not null unique,
  reportado_en   timestamptz,
  creado_en      timestamptz not null default now(),
  efectivo_en    timestamptz not null default now(),
  slot           timestamp   not null default date_trunc('hour', timezone('UTC', now())),
  oculto         boolean not null default false,
  unique (punto_id, estado, dispositivo_id, slot)
);

create index persona_lookup_idx
  on persona_reportes (punto_id, estado, dispositivo_id, efectivo_en desc)
  where not oculto;

-- ---------------------------------------------------------------------------
-- Presencia (alimenta el mapa de calor)
--
-- Modelada como sesión con latido, no como bitácora de eventos: la gente casi
-- nunca toca "ya me fui", así que la presencia debe expirar sola. Una sesión
-- sin latido en 90 minutos deja de contar.
-- ---------------------------------------------------------------------------

create table presencia (
  id             bigint generated always as identity primary key,
  punto_id       uuid not null references puntos (id) on delete cascade,
  dispositivo_id uuid not null references dispositivos (id),
  personas       smallint not null default 1 check (personas between 1 and 50),
  rol            text check (rol in ('voluntario', 'afectado', 'rescatista', 'medico', 'otro')),
  inicio_en      timestamptz not null default now(),
  visto_en       timestamptz not null default now(),
  fin_en         timestamptz,
  client_id      uuid not null unique
);

-- Un dispositivo sólo puede estar en un punto a la vez.
create unique index presencia_activa_idx on presencia (dispositivo_id) where fin_en is null;
create index presencia_punto_idx on presencia (punto_id, visto_en desc) where fin_en is null;

-- ---------------------------------------------------------------------------
-- Moderación
-- ---------------------------------------------------------------------------

create table reportes_abuso (
  id             bigint generated always as identity primary key,
  tabla          text not null check (tabla in ('puntos', 'necesidad_reportes', 'insumo_reportes', 'persona_reportes')),
  fila_id        text not null,
  dispositivo_id uuid not null references dispositivos (id),
  motivo         text not null check (motivo in ('falso', 'duplicado', 'ofensivo', 'resuelto', 'otro')),
  detalle        text check (length(detalle) <= 280),
  client_id      uuid not null unique,
  creado_en      timestamptz not null default now(),
  unique (tabla, fila_id, dispositivo_id)
);

create index abuso_objetivo_idx on reportes_abuso (tabla, fila_id);

-- ---------------------------------------------------------------------------
-- Normalización de reportes
--
-- Se hace en un trigger y no en columnas generadas porque `timestamptz -
-- interval` es STABLE, no IMMUTABLE, y Postgres rechaza expresiones no
-- inmutables en columnas generadas. El trigger además pisa `creado_en` con la
-- hora del servidor, de modo que ningún cliente pueda antedatar un reporte para
-- manipular el decaimiento.
-- ---------------------------------------------------------------------------

create or replace function fn_normalizar_reporte() returns trigger
language plpgsql as $$
begin
  new.creado_en   := now();
  new.efectivo_en := greatest(
                       least(coalesce(new.reportado_en, new.creado_en), new.creado_en),
                       new.creado_en - interval '6 hours');
  new.slot        := date_trunc('hour', timezone('UTC', new.creado_en));
  return new;
end $$;

create trigger t_norm_necesidad before insert on necesidad_reportes
  for each row execute function fn_normalizar_reporte();
create trigger t_norm_insumo before insert on insumo_reportes
  for each row execute function fn_normalizar_reporte();
create trigger t_norm_persona before insert on persona_reportes
  for each row execute function fn_normalizar_reporte();
