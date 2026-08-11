-- infoCaliEmergencia — 0005: catálogos.
--
-- Sólo se siembran catálogos. Deliberadamente NO se incluyen albergues, centros
-- de acopio ni puntos médicos de ejemplo: enviar gente a una dirección inventada
-- durante una emergencia real puede hacer daño. Quien despliegue debe cargar
-- puntos verificados con fuentes reales y marcarlos con origen = 'oficial'.
--
-- Dicho eso, un mapa vacío es un mapa muerto: la primera persona que llegue
-- tiene que encontrar algo útil. Cargar diez o veinte ubicaciones confirmadas
-- antes de difundir el enlace es parte del lanzamiento, no un extra.

insert into tipos_punto (slug, etiqueta, color, emoji, orden) values
  ('zona_afectada',      'Zona afectada',        '#dc2626', '⚠️', 10),
  ('albergue',           'Albergue',             '#2563eb', '🏠', 20),
  ('centro_acopio',      'Centro de acopio',     '#7c3aed', '📦', 30),
  ('punto_medico',       'Punto médico',         '#e11d48', '🚑', 40),
  ('cocina_comunitaria', 'Cocina comunitaria',   '#ea580c', '🍲', 50),
  ('punto_agua',         'Punto de agua',        '#0891b2', '💧', 60),
  ('punto_carga',        'Carga e internet',     '#65a30d', '🔌', 70),
  ('punto_encuentro',    'Punto de encuentro',   '#0d9488', '👥', 80),
  ('via_bloqueada',      'Vía bloqueada',        '#a16207', '🚧', 90),
  ('escombros',          'Remoción de escombros','#57534e', '🧱', 95)
on conflict (slug) do update
  set etiqueta = excluded.etiqueta,
      color    = excluded.color,
      emoji    = excluded.emoji,
      orden    = excluded.orden;

-- `destacado` marca lo que aparece en la grilla rápida de reporte. Es la
-- diferencia entre reportar en dos toques o tener que buscar en una lista larga
-- con una sola mano y con prisa.
insert into recursos (slug, etiqueta, categoria, unidad, emoji, orden, destacado) values
  -- Insumos
  ('agua',         'Agua potable',           'insumo',   'litro',    '💧', 10,  true),
  ('comida',       'Comida no perecedera',   'insumo',   'kg',       '🥫', 20,  true),
  ('fruta',        'Fruta',                  'insumo',   'kg',       '🍎', 25,  true),
  ('guantes',      'Guantes',                'insumo',   'par',      '🧤', 30,  true),
  ('tapabocas',    'Tapabocas',              'insumo',   'unidad',   '😷', 40,  true),
  ('cascos',       'Cascos',                 'insumo',   'unidad',   '⛑️', 50,  true),
  ('linternas',    'Linternas y pilas',      'insumo',   'unidad',   '🔦', 60,  true),
  ('medicamentos', 'Medicamentos',           'insumo',   'caja',     '💊', 70,  true),
  ('cobijas',      'Cobijas y colchonetas',  'insumo',   'unidad',   '🛏️', 80,  false),
  ('panales',      'Pañales',                'insumo',   'paquete',  '🍼', 90,  false),
  ('aseo',         'Elementos de aseo',      'insumo',   'kit',      '🧼', 100, false),
  ('carpas',       'Carpas y plásticos',     'insumo',   'unidad',   '⛺', 110, false),
  ('ropa',         'Ropa',                   'insumo',   'bolsa',    '👕', 120, false),
  -- Equipos
  ('volquetas',    'Volquetas',              'equipo',   'vehículo', '🚛', 200, true),
  ('retro',        'Retroexcavadoras',       'equipo',   'máquina',  '🚜', 210, true),
  ('herramienta',  'Herramienta manual',     'equipo',   'kit',      '🔧', 220, true),
  ('generadores',  'Plantas eléctricas',     'equipo',   'unidad',   '⚡', 230, false),
  ('motosierras',  'Motosierras',            'equipo',   'unidad',   '🪚', 240, false),
  ('ambulancias',  'Ambulancias',            'equipo',   'vehículo', '🚑', 250, false),
  ('camillas',     'Camillas',               'equipo',   'unidad',   '🩹', 260, false),
  -- Personal
  ('medicos',      'Médicos y enfermeros',   'personal', 'persona',  '🩺', 300, true),
  ('voluntarios',  'Voluntarios',            'personal', 'persona',  '🙋', 310, true),
  ('rescatistas',  'Rescatistas',            'personal', 'persona',  '🦺', 320, true),
  ('ingenieros',   'Ingenieros estructurales','personal','persona',  '📐', 330, false),
  ('psicologos',   'Apoyo psicosocial',      'personal', 'persona',  '🧠', 340, false),
  ('conductores',  'Conductores',            'personal', 'persona',  '🚐', 350, false)
on conflict (slug) do update
  set etiqueta  = excluded.etiqueta,
      categoria = excluded.categoria,
      unidad    = excluded.unidad,
      emoji     = excluded.emoji,
      orden     = excluded.orden,
      destacado = excluded.destacado;
