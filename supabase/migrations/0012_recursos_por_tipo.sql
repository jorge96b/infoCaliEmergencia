-- infoCaliEmergencia — 0012: qué recursos vienen al caso en cada tipo de punto.
--
-- Hasta ahora la grilla de "qué falta" mostraba los mismos 15 recursos
-- destacados en todos los puntos. En un albergue salían volquetas y
-- retroexcavadoras; en un colapso estructural no salía comida caliente ni
-- combustible, porque ni siquiera existían en el catálogo. Buscar entre cosas
-- que no vienen al caso cuesta segundos que en una emergencia no sobran.
--
-- La relevancia se modela como tabla y no como una columna `text[]` en
-- `recursos` por dos razones prácticas: cada tipo puede ordenar su lista a su
-- manera, y corregir una lista pasa a ser un `insert` o un `delete` suelto, sin
-- tocar código ni volver a desplegar.
--
-- Es una migración de sólo altas: no modifica ninguna fila ni ninguna vista de
-- las que ya están en producción.

-- ---------------------------------------------------------------------------
-- Recursos que faltaban
--
-- Ninguno va como `destacado`. Ese distintivo pasa a ser sólo el respaldo para
-- un tipo que se quedara sin lista; la relevancia de verdad la decide la tabla
-- de más abajo, y marcarlos destacados cambiaría ese respaldo sin querer.
--
-- Las tres comidas van separadas y no como un único "comida preparada" porque
-- una cocina necesita poder decir "faltan 200 almuerzos": la hora es justo el
-- dato que hace accionable el reporte.
-- ---------------------------------------------------------------------------

insert into recursos (slug, etiqueta, categoria, unidad, emoji, orden, destacado) values
  ('desayunos',   'Desayunos',                   'insumo', 'ración', '🍳', 21,  false),
  ('almuerzos',   'Almuerzos',                   'insumo', 'ración', '🍽️', 22,  false),
  ('cenas',       'Cenas',                       'insumo', 'ración', '🥘', 23,  false),
  ('panitos',     'Pañitos húmedos',             'insumo', 'paquete','🧻', 95,  false),
  -- Aparte de `linternas`: aquello es luz personal, esto es iluminar un frente
  -- de trabajo para poder remover escombros de noche.
  ('iluminacion', 'Luces y reflectores',         'equipo', 'unidad', '💡', 235, false),
  ('combustible', 'Combustible (gasolina, ACPM)','equipo', 'galón',  '⛽', 245, false)
on conflict (slug) do update
  set etiqueta  = excluded.etiqueta,
      categoria = excluded.categoria,
      unidad    = excluded.unidad,
      emoji     = excluded.emoji,
      orden     = excluded.orden;

-- ---------------------------------------------------------------------------
-- Qué se pide en cada tipo de lugar
-- ---------------------------------------------------------------------------

create table if not exists recursos_por_tipo (
  tipo    text not null references tipos_punto (slug) on delete cascade,
  recurso text not null references recursos (slug) on delete cascade,
  -- Orden propio de cada tipo: en un albergue la ropa va antes que el agua;
  -- en una zona afectada, al revés.
  orden   smallint not null default 100,
  primary key (tipo, recurso)
);

create index if not exists recursos_por_tipo_orden_idx
  on recursos_por_tipo (tipo, orden);

create or replace view v_recursos_tipo as
select rt.tipo,
       r.slug,
       r.etiqueta,
       r.categoria,
       r.unidad,
       r.emoji,
       rt.orden,
       r.destacado
from recursos_por_tipo rt
join recursos r on r.slug = rt.recurso
where r.activo
order by rt.tipo, rt.orden;

-- ---------------------------------------------------------------------------
-- Las diez listas
--
-- `voluntarios` aparece en casi todas, pero la grilla no lo pinta: tiene su
-- propia sección en la ficha del punto desde la migración anterior. Se deja en
-- la lista porque la pestaña "qué hay" sí lo usa, y porque si algún día se
-- quita esa sección, la lista ya está bien.
--
-- `otro` no está en ninguna: lo añade siempre el componente, porque es la única
-- salida para lo que nadie previó.
-- ---------------------------------------------------------------------------

insert into recursos_por_tipo (tipo, recurso, orden) values
  -- Zona afectada — un colapso estructural, un rescate en curso.
  ('zona_afectada', 'agua',         10),
  ('zona_afectada', 'desayunos',    20),
  ('zona_afectada', 'almuerzos',    21),
  ('zona_afectada', 'cenas',        22),
  ('zona_afectada', 'herramienta',  30),
  ('zona_afectada', 'iluminacion',  40),
  ('zona_afectada', 'combustible',  50),
  ('zona_afectada', 'voluntarios',  60),
  -- AÑADIDO por mí, revísalo: un rescate necesita esto tanto como lo de arriba.
  ('zona_afectada', 'rescatistas',  70),
  ('zona_afectada', 'volquetas',    80),
  ('zona_afectada', 'retro',        90),
  ('zona_afectada', 'guantes',     100),
  ('zona_afectada', 'cascos',      110),
  ('zona_afectada', 'medicos',     120),
  ('zona_afectada', 'camillas',    130),

  -- Albergue — gente alojada, necesidades domésticas.
  ('albergue', 'ropa',          10),
  ('albergue', 'comida',        20),
  ('albergue', 'panitos',       30),
  ('albergue', 'panales',       40),
  -- AÑADIDO por mí, revísalo.
  ('albergue', 'agua',          50),
  ('albergue', 'cobijas',       60),
  ('albergue', 'aseo',          70),
  ('albergue', 'desayunos',     80),
  ('albergue', 'almuerzos',     81),
  ('albergue', 'cenas',         82),
  ('albergue', 'medicamentos',  90),
  ('albergue', 'psicologos',   100),
  ('albergue', 'voluntarios',  110),

  -- Centro de acopio — recibe y clasifica donaciones.
  ('centro_acopio', 'voluntarios', 10),
  ('centro_acopio', 'comida',      20),
  -- AÑADIDO por mí, revísalo.
  ('centro_acopio', 'agua',        30),
  ('centro_acopio', 'ropa',        40),
  ('centro_acopio', 'aseo',        50),
  ('centro_acopio', 'panales',     60),
  ('centro_acopio', 'panitos',     70),
  ('centro_acopio', 'cobijas',     80),
  ('centro_acopio', 'conductores', 90),

  -- Punto médico — propuesta mía completa.
  ('punto_medico', 'medicos',      10),
  ('punto_medico', 'medicamentos', 20),
  ('punto_medico', 'camillas',     30),
  ('punto_medico', 'ambulancias',  40),
  ('punto_medico', 'guantes',      50),
  ('punto_medico', 'tapabocas',    60),
  ('punto_medico', 'agua',         70),
  ('punto_medico', 'generadores',  80),
  ('punto_medico', 'voluntarios',  90),

  -- Cocina comunitaria — propuesta mía completa.
  ('cocina_comunitaria', 'comida',      10),
  ('cocina_comunitaria', 'agua',        20),
  ('cocina_comunitaria', 'fruta',       30),
  ('cocina_comunitaria', 'combustible', 40),
  ('cocina_comunitaria', 'desayunos',   50),
  ('cocina_comunitaria', 'almuerzos',   51),
  ('cocina_comunitaria', 'cenas',       52),
  ('cocina_comunitaria', 'aseo',        60),
  ('cocina_comunitaria', 'voluntarios', 70),

  -- Punto de agua — propuesta mía completa.
  ('punto_agua', 'agua',        10),
  ('punto_agua', 'generadores', 20),
  ('punto_agua', 'combustible', 30),
  ('punto_agua', 'conductores', 40),
  ('punto_agua', 'voluntarios', 50),

  -- Carga e internet — propuesta mía completa.
  ('punto_carga', 'generadores', 10),
  ('punto_carga', 'combustible', 20),
  ('punto_carga', 'iluminacion', 30),
  ('punto_carga', 'voluntarios', 40),

  -- Punto de encuentro — propuesta mía completa.
  ('punto_encuentro', 'agua',        10),
  ('punto_encuentro', 'comida',      20),
  ('punto_encuentro', 'carpas',      30),
  ('punto_encuentro', 'cobijas',     40),
  ('punto_encuentro', 'psicologos',  50),
  ('punto_encuentro', 'voluntarios', 60),

  -- Vía bloqueada — propuesta mía completa.
  ('via_bloqueada', 'volquetas',   10),
  ('via_bloqueada', 'retro',       20),
  ('via_bloqueada', 'motosierras', 30),
  ('via_bloqueada', 'herramienta', 40),
  ('via_bloqueada', 'iluminacion', 50),
  ('via_bloqueada', 'combustible', 60),
  ('via_bloqueada', 'conductores', 70),
  ('via_bloqueada', 'voluntarios', 80),

  -- Remoción de escombros — propuesta mía completa.
  ('escombros', 'volquetas',   10),
  ('escombros', 'retro',       20),
  ('escombros', 'herramienta', 30),
  ('escombros', 'guantes',     40),
  ('escombros', 'cascos',      50),
  ('escombros', 'iluminacion', 60),
  ('escombros', 'combustible', 70),
  ('escombros', 'rescatistas', 80),
  ('escombros', 'agua',        90),
  ('escombros', 'voluntarios', 100)
on conflict (tipo, recurso) do update set orden = excluded.orden;

-- ---------------------------------------------------------------------------
-- Permisos
--
-- Supabase concede permisos por omisión sobre cada tabla y vista nueva del
-- esquema `public`, así que hay que revocar a mano. `anon` lee la vista, que ya
-- viene unida y ordenada; la tabla no la necesita.
-- ---------------------------------------------------------------------------

alter table recursos_por_tipo enable row level security;

revoke all on recursos_por_tipo from anon, authenticated;
grant select on recursos_por_tipo to authenticated;

revoke all on v_recursos_tipo from anon, authenticated;
grant select on v_recursos_tipo to anon, authenticated;

drop policy if exists p_recursos_tipo_mod on recursos_por_tipo;
create policy p_recursos_tipo_mod on recursos_por_tipo
  for select to authenticated using (es_moderador());
