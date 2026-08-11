export type Demanda = "no_requerido" | "poco_requerido" | "muy_requerido";
export type NivelStock = "nada" | "poco" | "suficiente" | "excedente";
export type CategoriaRecurso = "insumo" | "equipo" | "personal";
export type EstadoPersona = "desaparecido" | "herido" | "rescatado";

export type TipoPunto = {
  slug: string;
  etiqueta: string;
  color: string;
  emoji: string;
  orden: number;
};

export type Recurso = {
  slug: string;
  etiqueta: string;
  categoria: CategoriaRecurso;
  unidad: string;
  emoji: string;
  orden: number;
  destacado: boolean;
};

export type NecesidadResumen = {
  recurso: string;
  etiqueta: string;
  emoji: string;
  categoria: CategoriaRecurso;
  nivel: Demanda;
  confirmaciones: number;
  ultimo_reporte: string;
};

export type InsumoResumen = {
  recurso: string;
  etiqueta: string;
  emoji: string;
  nivel: NivelStock;
  ultimo_reporte: string;
};

export type PuntoMapa = {
  id: string;
  nombre: string;
  tipo: string;
  tipo_etiqueta: string;
  color: string;
  emoji: string;
  lat: number;
  lng: number;
  barrio: string | null;
  direccion: string | null;
  descripcion: string | null;
  contacto: string | null;
  origen: "comunidad" | "oficial";
  creado_en: string;
  confirmaciones: number;
  verificado: boolean;
  personas: number;
  necesidades: NecesidadResumen[];
  insumos: InsumoResumen[];
  personas_estado: Partial<Record<EstadoPersona, number>>;
  ultimo_movimiento: string | null;
};

export type PuntoCalor = { lat: number; lng: number; intensidad: number };

export type Global = {
  puntos_activos: number;
  personas_en_terreno: number;
  desaparecidos: number;
  heridos: number;
  rescatados: number;
  necesidades_criticas: number;
  top_necesidades:
    | {
        recurso: string;
        etiqueta: string;
        emoji: string;
        categoria: CategoriaRecurso;
        puntos_criticos: number;
        puntaje_total: number;
      }[]
    | null;
  generado_en: string;
};

export type Instantanea = {
  puntos: PuntoMapa[];
  calor: PuntoCalor[];
  global: Global | null;
};

// ---------------------------------------------------------------------------
// Moderación
//
// Los dos primeros reflejan los `check` de `reportes_abuso` (0001). Si cambian
// allá, tienen que cambiar aquí: el servidor rechaza cualquier otro valor con
// un 23514 que la interfaz no sabría explicar.
// ---------------------------------------------------------------------------

export type MotivoDenuncia = "falso" | "duplicado" | "ofensivo" | "resuelto" | "otro";

export type TablaDenunciable =
  | "puntos"
  | "necesidad_reportes"
  | "insumo_reportes"
  | "persona_reportes";

export type Decision = "aprobado" | "oculto";

/** Una fila de `v_cola_moderacion`: un objetivo denunciado, no una denuncia. */
export type FilaCola = {
  tabla: TablaDenunciable;
  fila_id: string;
  denuncias: number;
  ofensivo: number;
  falso: number;
  duplicado: number;
  resuelto: number;
  otro: number;
  primera: string;
  ultima: string;
  detalles: string[];
  // Nulos cuando la denuncia quedó huérfana: la fila señalada ya no existe.
  punto_id: string | null;
  punto: string | null;
  dispositivo_id: string | null;
  texto: string | null;
  contenido: string | null;
  fila_creada_en: string | null;
  oculto: boolean | null;
  huerfano: boolean;
  decision: Decision | null;
  decidido_en: string | null;
  motivo_decision: string | null;
};

export type Ficha = {
  id: string;
  bloqueado: boolean;
  motivo: string | null;
  creado_en: string;
  visto_en: string;
  puntos: number;
  necesidades: number;
  insumos: number;
  personas: number;
  denuncias_emitidas: number;
  denuncias_recibidas: number;
  filas_ocultas: number;
};

export type FilaDispositivo = {
  tabla: TablaDenunciable;
  fila_id: string;
  punto_id: string;
  punto: string;
  dispositivo_id: string;
  texto: string;
  detalle: string;
  creado_en: string;
  oculto: boolean;
};

export type Salud = {
  denuncias_1h: number;
  denuncias_24h: number;
  pendientes: number;
  ocultas: number;
  bloqueados: number;
  acciones_24h: number;
  generado_en: string;
};

export type EntradaBitacora = {
  id: number;
  accion: "aprobar" | "ocultar" | "bloquear" | "desbloquear" | "ocultar_todo";
  tabla: string | null;
  fila_id: string | null;
  dispositivo_id: string | null;
  motivo: string | null;
  creado_en: string;
  moderador: string;
};
