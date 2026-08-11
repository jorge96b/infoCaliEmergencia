import type { Demanda, MotivoDenuncia, NivelStock, TablaDenunciable } from "./tipos";

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
