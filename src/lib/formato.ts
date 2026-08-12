import type {
  Demanda,
  Evento,
  MotivoDenuncia,
  NivelStock,
  SeveridadAviso,
  TablaDenunciable,
  TipoAviso,
  TipoEvento,
} from "./tipos";

/**
 * Antigüedad en palabras. En una emergencia el dato más importante junto al
 * número es cuándo se supo, así que nunca se muestra una cifra sin esto al lado.
 */
export function haceCuanto(iso: string | null | undefined): string {
  if (!iso) return "sin reportes";

  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "ahora mismo";
  if (min < 60) return `hace ${min} min`;

  const horas = Math.floor(min / 60);
  if (horas < 24) return `hace ${horas} h`;

  const dias = Math.floor(horas / 24);
  return `hace ${dias} d`;
}

/** Un punto sin movimiento en 6 h se marca como posiblemente desactualizado. */
export function estaObsoleto(iso: string | null | undefined): boolean {
  if (!iso) return true;
  return Date.now() - new Date(iso).getTime() > 6 * 3600 * 1000;
}

export const DEMANDA: Record<
  Demanda,
  { texto: string; fondo: string; borde: string; texto_color: string }
> = {
  muy_requerido: {
    texto: "Muy requerido",
    fondo: "bg-red-500/15",
    borde: "border-red-500/50",
    texto_color: "text-red-300",
  },
  poco_requerido: {
    texto: "Poco requerido",
    fondo: "bg-amber-500/15",
    borde: "border-amber-500/50",
    texto_color: "text-amber-300",
  },
  no_requerido: {
    texto: "No requerido",
    fondo: "bg-slate-500/10",
    borde: "border-slate-600",
    texto_color: "text-slate-400",
  },
};

export const STOCK: Record<NivelStock, { texto: string; color: string }> = {
  nada: { texto: "No hay", color: "text-red-300" },
  poco: { texto: "Poco", color: "text-amber-300" },
  suficiente: { texto: "Suficiente", color: "text-emerald-300" },
  excedente: { texto: "De sobra", color: "text-sky-300" },
};

export const NIVELES_STOCK: NivelStock[] = ["nada", "poco", "suficiente", "excedente"];

export const ESTADO_PERSONA: Record<string, string> = {
  desaparecido: "Desaparecidas",
  herido: "Heridas",
  rescatado: "Rescatadas",
};

// ---------------------------------------------------------------------------
// Línea de tiempo
// ---------------------------------------------------------------------------

/**
 * Aspecto de cada tipo de evento. El emoji es sólo el respaldo: cuando el evento
 * trae el de su recurso o su tipo de lugar, manda ese, que dice mucho más.
 */
export const EVENTO: Record<
  TipoEvento,
  { emoji: string; borde: string; fondo: string; color: string }
> = {
  falta: { emoji: "❗", borde: "border-red-500/50", fondo: "bg-red-500/10", color: "text-red-300" },
  llego: {
    emoji: "✅",
    borde: "border-emerald-500/50",
    fondo: "bg-emerald-500/10",
    color: "text-emerald-300",
  },
  hay: { emoji: "📦", borde: "border-slate-600", fondo: "bg-slate-800", color: "text-slate-200" },
  personas: {
    emoji: "🧍",
    borde: "border-sky-500/50",
    fondo: "bg-sky-500/10",
    color: "text-sky-300",
  },
  lugar_nuevo: {
    emoji: "📍",
    borde: "border-slate-600",
    fondo: "bg-slate-800",
    color: "text-slate-200",
  },
};

/**
 * Femenino y con singular propio: `ESTADO_PERSONA` sólo tiene la forma plural
 * porque es un encabezado de sección, y aquí la cifra va pegada a la palabra.
 * "1 heridas" es de las cosas que hacen dudar de todo lo demás que dice la app.
 */
const CONTEO_PERSONA: Record<string, { una: string; varias: string }> = {
  desaparecido: { una: "desaparecida", varias: "desaparecidas" },
  herido: { una: "herida", varias: "heridas" },
  rescatado: { una: "rescatada", varias: "rescatadas" },
};

/** El titular de la tarjeta: lo que pasó, en las palabras de quien lo reportó. */
export function tituloEvento(e: Evento): string {
  const cosa = e.etiqueta?.toLowerCase() ?? "algo";

  switch (e.accion) {
    case "falta":
      return `Falta ${cosa}`;
    case "llego":
      return `Ya llegó ${cosa}`;
    case "hay":
      return `${e.etiqueta}: ${STOCK[e.nivel as NivelStock].texto.toLowerCase()}`;
    case "personas": {
      const p = CONTEO_PERSONA[e.nivel ?? ""];
      if (!p) return "Conteo de personas";
      if (e.cantidad === 0) return `Sin ${p.varias}`;
      return `${e.cantidad} ${e.cantidad === 1 ? p.una : p.varias}`;
    }
    case "lugar_nuevo":
      // Sin el tipo de lugar en el titular a propósito: "Zona afectada nueva" y
      // "Albergue nuevo" no concuerdan igual, y el emoji ya lo dice.
      return "Lugar nuevo en el mapa";
  }
}

/**
 * Encabezado de grupo. Con la ventana de 24 h de `v_actividad` sólo pueden salir
 * dos, así que no hace falta traer un formateador de fechas para esto.
 */
export function franjaDia(iso: string): string {
  const dia = new Date(iso).toDateString();
  const hoy = new Date();
  if (dia === hoy.toDateString()) return "Hoy";

  const ayer = new Date(hoy);
  ayer.setDate(hoy.getDate() - 1);
  return dia === ayer.toDateString() ? "Ayer" : "Antes";
}

/**
 * Un reporte que estuvo en la cola sin señal llega con retraso. Sin decirlo, la
 * lista pondría arriba un "hace 3 h" recién recibido junto a uno de verdad
 * reciente y parecería que el orden está mal.
 */
export function llegoTarde(e: Evento): boolean {
  return new Date(e.recibido_en).getTime() - new Date(e.ocurrido_en).getTime() > 15 * 60_000;
}

/**
 * Motivos de denuncia, redactados como los diría quien denuncia.
 *
 * `resuelto` no es abuso —significa "esto ya se solucionó"— pero comparte
 * formulario porque para quien mira el mapa es el mismo gesto: "esto ya no es
 * cierto". El panel lo separa visualmente de los demás.
 */
export const MOTIVO_DENUNCIA: Record<MotivoDenuncia, { texto: string; ayuda: string }> = {
  falso: { texto: "Es falso", ayuda: "No existe o la información es inventada" },
  duplicado: { texto: "Está repetido", ayuda: "Ya hay otro igual en el mapa" },
  ofensivo: { texto: "Es ofensivo", ayuda: "Contenido agresivo o que pone a alguien en riesgo" },
  resuelto: { texto: "Ya se resolvió", ayuda: "Era cierto, pero ya no" },
  otro: { texto: "Otra cosa", ayuda: "Cuéntanos qué pasa" },
};

export const MOTIVOS_DENUNCIA: MotivoDenuncia[] = [
  "falso",
  "duplicado",
  "ofensivo",
  "resuelto",
  "otro",
];

export const TABLA_DENUNCIABLE: Record<TablaDenunciable, string> = {
  puntos: "Lugar",
  necesidad_reportes: "Necesidad",
  insumo_reportes: "Disponibilidad",
  persona_reportes: "Conteo de personas",
};

// ---------------------------------------------------------------------------
// Avisos oficiales
// ---------------------------------------------------------------------------

export const SEVERIDAD: Record<
  SeveridadAviso,
  { texto: string; fondo: string; borde: string; texto_color: string; franja: string }
> = {
  critico: {
    texto: "Crítico",
    fondo: "bg-red-500/15",
    borde: "border-red-500/50",
    texto_color: "text-red-300",
    franja: "bg-red-700 text-red-50",
  },
  importante: {
    texto: "Importante",
    fondo: "bg-amber-500/15",
    borde: "border-amber-500/50",
    texto_color: "text-amber-300",
    franja: "bg-amber-600 text-amber-50",
  },
  informativo: {
    texto: "Informativo",
    fondo: "bg-slate-500/10",
    borde: "border-slate-600",
    texto_color: "text-slate-300",
    franja: "bg-slate-700 text-slate-100",
  },
};

export const TIPO_AVISO: Record<TipoAviso, { emoji: string; etiqueta: string }> = {
  toque_queda: { emoji: "🚫", etiqueta: "Toque de queda" },
  movilidad: { emoji: "🚗", etiqueta: "Movilidad" },
  servicios: { emoji: "⚡", etiqueta: "Servicios públicos" },
  salud: { emoji: "🏥", etiqueta: "Salud" },
  otro: { emoji: "📢", etiqueta: "Aviso" },
};

/** "hasta las 6:00 a. m." — la hora local de Cali, que es la que importa. */
export function hora(iso: string): string {
  return new Date(iso)
    .toLocaleTimeString("es-CO", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "America/Bogota",
    })
    // Intl mete un espacio fino (U+202F) antes del meridiano y a veces junta
    // las letras; se normaliza a un espacio normal para que no se vea raro.
    .replace(/\s*([ap])\.\s*m\./i, " $1. m.")
    .replace(/\s+/g, " ")
    .trim();
}

export function fechaHora(iso: string): string {
  return new Date(iso).toLocaleString("es-CO", {
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/Bogota",
  });
}

/**
 * La vigencia en una línea. Es lo que decide si alguien sale a la calle, así
 * que dice siempre la hora exacta y no un "en 3 horas" que hay que traducir.
 */
export function vigencia(aviso: {
  estado: "vigente" | "proximo";
  vigente_desde: string;
  vigente_hasta: string | null;
}): string {
  if (aviso.estado === "proximo") {
    return `Desde ${fechaHora(aviso.vigente_desde)}`;
  }
  return aviso.vigente_hasta ? `Hasta las ${hora(aviso.vigente_hasta)}` : "Sin hora de fin definida";
}
