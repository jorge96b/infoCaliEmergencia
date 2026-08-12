"use client";

import { SEVERIDAD, TIPO_AVISO, vigencia } from "@/lib/formato";
import type { Aviso } from "@/lib/tipos";

/**
 * La franja de alerta sobre el mapa.
 *
 * Muestra un solo aviso: el más urgente de los que están fijados y rigiendo
 * ahora mismo. Uno solo y no una pila, porque compite con el mapa por la única
 * pantalla que hay y porque tres alertas a la vez no se leen, se ignoran.
 *
 * Deja fuera a propósito los avisos `proximo`. Un pico y placa que empieza
 * mañana a las 6 a. m. merece anunciarse —y sale en la campana— pero enseñarlo
 * arriba en rojo haría creer que ya rige, que es exactamente el error que esta
 * pieza existe para no cometer.
 */
export default function FranjaAviso({
  avisos,
  onAbrir,
}: {
  avisos: Aviso[];
  onAbrir: () => void;
}) {
  // `v_avisos` ya llega ordenada: vigentes primero, luego por severidad.
  const aviso = avisos.find((a) => a.fijado && a.estado === "vigente");
  if (!aviso) return null;

  const s = SEVERIDAD[aviso.severidad];
  const t = TIPO_AVISO[aviso.tipo];

  return (
    <button
      onClick={onAbrir}
      className={`flex w-full items-center gap-2 px-3 py-2 text-left ${s.franja}`}
      aria-label={`${t.etiqueta}: ${aviso.titulo}. Toca para ver el detalle.`}
    >
      <span aria-hidden className="text-base leading-none">
        {t.emoji}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold leading-tight">
          {aviso.titulo}
        </span>
        <span className="block text-[11px] leading-tight opacity-90">
          {vigencia(aviso)} · {aviso.fuente}
        </span>
      </span>
      <span aria-hidden className="text-xs opacity-80">
        Ver
      </span>
    </button>
  );
}
