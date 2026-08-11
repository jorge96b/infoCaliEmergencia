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
