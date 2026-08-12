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

/**
 * Texto libre de un reporte de necesidad, con el id de su fila para poder
 * denunciar esa nota en concreto y no el punto entero. El id viaja como texto
 * porque es lo que recibe `rpc_denunciar`, que atiende por igual a los uuid de
 * los puntos y a los bigint de los reportes.
 */
export type NotaNecesidad = {
  id: string;
  texto: string;
};

export type NecesidadResumen = {
  recurso: string;
  etiqueta: string;
  emoji: string;
  categoria: CategoriaRecurso;
  nivel: Demanda;
  confirmaciones: number;
  ultimo_reporte: string;
  // Opcional a propósito: mientras no se aplique la migración 0008 la vista no
  // devuelve esta columna, y la interfaz tiene que seguir funcionando igual.
  notas?: NotaNecesidad[];
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
// Línea de tiempo
// ---------------------------------------------------------------------------

export type TipoEvento = "falta" | "llego" | "hay" | "personas" | "lugar_nuevo";

/**
 * Una fila de `v_actividad`: un reporte individual, no un agregado. Es el único
 * tipo del proyecto que representa una fila suelta de las tablas de reportes;
 * todo lo demás llega ya resumido por punto.
 *
 * `tabla` es exactamente `TablaDenunciable` —el tipo se declara más abajo, que
 * en TypeScript da igual— para que cada evento se pueda pasar tal cual a
 * `<Denunciar>` sin conversiones: sin eso, la línea de tiempo mostraría
 * contenido de usuario sin ninguna forma de reportarlo.
 */
export type Evento = {
  tabla: TablaDenunciable;
  fila_id: string;
  punto_id: string;
  punto: string;
  barrio: string | null;
  punto_emoji: string;
  lat: number;
  lng: number;
  /** `efectivo_en`: cuándo se observó. Es el criterio de orden. */
  ocurrido_en: string;
  /** `creado_en`: cuándo llegó al servidor. Difiere si estuvo en la cola. */
  recibido_en: string;
  /** Del recurso o del tipo de lugar. Nulo en los conteos de personas. */
  emoji: string | null;
  etiqueta: string | null;
  accion: TipoEvento;
  /** `nivel_stock` o `estado_persona`, según `accion`. */
  nivel: string | null;
  cantidad: number | null;
  nota: string | null;
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

// ---------------------------------------------------------------------------
// Información oficial
//
// De otra naturaleza que todo lo anterior: no se vota ni se valida por
// consenso, la publica la autoridad y caduca por reloj. Por eso viaja aparte
// hasta la interfaz, donde se muestra atribuida y nunca mezclada con los
// conteos de la comunidad.
// ---------------------------------------------------------------------------

export type SeveridadAviso = "critico" | "importante" | "informativo";
export type TipoAviso = "toque_queda" | "movilidad" | "servicios" | "salud" | "otro";

export type Aviso = {
  id: string;
  tipo: TipoAviso;
  severidad: SeveridadAviso;
  titulo: string;
  cuerpo: string | null;
  fuente: string;
  enlace: string | null;
  vigente_desde: string;
  vigente_hasta: string | null;
  fijado: boolean;
  creado_en: string;
  /** `proximo` = anunciado pero todavía no rige. Nunca se muestra como vigente. */
  estado: "vigente" | "proximo";
};

export type ReporteOficial = {
  numero: number | null;
  fuente: string;
  /** La hora del boletín, no la de carga. */
  reportado_en: string;
  fallecidos: number | null;
  rescatados: number | null;
  colapsadas: number | null;
  con_danos: number | null;
  salud: string | null;
  servicios: string | null;
  creado_en: string;
};

export type Oficial = { avisos: Aviso[]; reporte: ReporteOficial | null };

// ---------------------------------------------------------------------------
// Notificaciones push
//
// El único contenido de la app que llega sin que nadie haya abierto nada, y por
// eso el único que puede molestar de verdad. Los tipos de aquí los comparten
// tres sitios que no comparten runtime: el navegador que se suscribe, las rutas
// de servidor que envían, y `public/sw.js`, que no pasa por el compilador y por
// tanto no puede importarlos — allá `CargaPush` está replicada a mano y hay un
// comentario que apunta aquí.
// ---------------------------------------------------------------------------

export type PrioridadPush = "alta" | "media" | "baja";

/** De dónde salió la notificación. Decide el texto y el enlace profundo. */
export type OrigenPush = "aviso" | "reporte_oficial" | "punto" | "necesidad";

/** Lo que viaja dentro del push y recibe el service worker. */
export type CargaPush = {
  origen: OrigenPush;
  titulo: string;
  cuerpo: string;
  /** Calculada por el servidor con la ubicación aproximada (~1 km). */
  prioridad: PrioridadPush;
  /**
   * Coordenadas del hecho, para que el service worker recalcule la distancia
   * real contra la última posición guardada en el teléfono. Nulas cuando es de
   * toda la ciudad: un toque de queda no tiene coordenadas.
   */
  lat: number | null;
  lng: number | null;
  /** Para abrir la ficha del lugar al tocar la notificación. */
  punto_id: string | null;
  /**
   * Agrupa en la bandeja del sistema. Dos notificaciones con la misma etiqueta
   * se sustituyen en vez de apilarse, que es lo que hace falta cuando la misma
   * necesidad se reactiva.
   */
  etiqueta: string;
};

/** Estado del interruptor de notificaciones, tal como lo ve la interfaz. */
export type EstadoPush =
  | "no_soportado"
  | "requiere_instalar"
  | "denegado"
  | "inactivo"
  | "activo";
