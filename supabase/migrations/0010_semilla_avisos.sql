-- infoCaliEmergencia — 0010: avisos y reporte oficial del 11 de agosto de 2026.
--
-- Va aparte del esquema a propósito: esto es CONTENIDO, no estructura, y
-- caduca. Se puede revisar y corregir sin tocar 0009, y el día que sobre se
-- borra sin arrastrar nada.
--
-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ REVISA LAS FECHAS ANTES DE CORRER ESTO.                                  │
-- │                                                                          │
-- │ Las horas van en -05:00 (hora de Colombia, sin horario de verano). Si el │
-- │ toque de queda de esta noche tiene otro horario, corrígelo aquí abajo.   │
-- │ Publicar una restricción con la hora equivocada es peor que no           │
-- │ publicarla: la gente sale creyendo que puede, o se queda creyendo que no.│
-- └──────────────────────────────────────────────────────────────────────────┘
--
-- Fuente: @alcaldiadecali y @movilidadcali, 11 y 12 de agosto de 2026.
-- `publicado_por` va nulo: son datos de arranque, no los publicó un moderador.

-- ---------------------------------------------------------------------------
-- Toque de queda — rige esta noche (11 → 12 de agosto)
-- ---------------------------------------------------------------------------

insert into avisos (tipo, severidad, titulo, cuerpo, vigente_desde, vigente_hasta, fijado)
values (
  'toque_queda',
  'critico',
  'Toque de queda esta noche, 9:00 p. m. a 6:00 a. m.',
  E'Rige desde las 9:00 p. m. de hoy hasta las 6:00 a. m. de mañana.\n\n'
  'Excepciones: fuerza pública y organismos de seguridad del Estado; '
  'personal de salud, ambulancias y atención prehospitalaria; operadores de '
  'servicios públicos esenciales (agua, energía, gas, aseo y '
  'telecomunicaciones); transporte de carga y distribución de alimentos, '
  'medicamentos e insumos esenciales; estaciones de servicio y el personal '
  'que garantice su funcionamiento; medios de comunicación y personal de '
  'prensa debidamente acreditado; y atención y cuidado de animales en '
  'situación de urgencia.',
  '2026-08-11 21:00:00-05',
  '2026-08-12 06:00:00-05',
  true
);

-- ---------------------------------------------------------------------------
-- Pico y placa ampliado — del 12 al 15 de agosto
--
-- Empieza mañana a las 6 a. m., así que hoy la vista lo marca como `proximo`:
-- se anuncia, pero no se muestra como si ya rigiera.
--
-- La restricción sólo rige de 6 a. m. a 7 p. m. cada día, pero la ventana de
-- vigencia cubre el periodo completo: el detalle horario va en el cuerpo. Un
-- modelo con horarios por día sería más fiel, y hoy no vale la complejidad.
-- ---------------------------------------------------------------------------

insert into avisos (tipo, severidad, titulo, cuerpo, vigente_desde, vigente_hasta, fijado)
values (
  'movilidad',
  'importante',
  'Pico y placa ampliado del 12 al 15 de agosto',
  E'Esquema solidario (pares/impares), de 6:00 a. m. a 7:00 p. m.\n\n'
  'Aplica también a los vehículos que entran o salen del perímetro urbano.',
  '2026-08-12 06:00:00-05',
  '2026-08-15 19:00:00-05',
  true
);

-- ---------------------------------------------------------------------------
-- Salud — sin hora de fin conocida, así que sin caducidad
-- ---------------------------------------------------------------------------

insert into avisos (tipo, severidad, titulo, cuerpo, vigente_desde, fijado)
values (
  'salud',
  'importante',
  'Alerta roja hospitalaria: hay clínicas cerradas',
  E'Continúa la alerta roja hospitalaria.\n\n'
  'Cierre total de la Clínica Nuestra y de Sanitas de la Roosevelt por daños '
  'estructurales importantes.\n\n'
  'Cierre parcial de servicios en el Hospital Universitario del Valle y en la '
  'Clínica Colombia por afectaciones en la infraestructura.\n\n'
  'Antes de trasladar a alguien, confirma que el servicio que necesitas está '
  'abierto.',
  '2026-08-11 19:30:00-05',
  false
);

-- ---------------------------------------------------------------------------
-- Servicios públicos
-- ---------------------------------------------------------------------------

insert into avisos (tipo, severidad, titulo, cuerpo, vigente_desde, fijado)
values (
  'servicios',
  'informativo',
  'Energía restablecida en más del 90 % de la ciudad',
  E'Emcali informa que más del 90 % de Cali ya tiene el suministro de energía '
  'normalizado.\n\n'
  'Los trabajos se concentran en reactivar tres circuitos —Vergel, Cencar y '
  'Mojica— que atienden a unas 12 mil personas.',
  '2026-08-11 19:30:00-05',
  false
);

-- ---------------------------------------------------------------------------
-- Reporte de situación #4
--
-- Cifras preliminares: la propia Alcaldía advierte que pueden variar a medida
-- que avance la consolidación de la información oficial. La interfaz lo dice.
-- ---------------------------------------------------------------------------

insert into reportes_oficiales (numero, reportado_en, fallecidos, rescatados,
                                colapsadas, con_danos, salud, servicios)
values (
  4,
  '2026-08-11 19:30:00-05',
  74, 84, 107, 643,
  'Continúa la alerta roja hospitalaria. Cierre total de la Clínica Nuestra y '
  'de Sanitas de la Roosevelt por daños estructurales importantes, y cierre '
  'parcial de servicios en el Hospital Universitario del Valle y la Clínica '
  'Colombia por afectaciones en la infraestructura.',
  'Emcali informa que en más del 90 % de la ciudad ya se normalizó el '
  'suministro de energía. Los trabajos se concentran en la reactivación de '
  'tres circuitos (Vergel, Cencar y Mojica) que atienden a 12 mil personas.'
);
