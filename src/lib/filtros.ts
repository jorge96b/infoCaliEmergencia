import type { PuntoMapa } from "./tipos";

/**
 * Estado de los filtros del mapa/lista. Vive en `page.tsx` y se comparte entre
 * ambas vistas para que muestren exactamente el mismo subconjunto de puntos.
 */
export type FiltrosPuntos = {
  /** Slugs de tipo seleccionados. Vacío = todos los tipos. */
  tipos: Set<string>;
  /** Sólo puntos con alguna necesidad `muy_requerido`. */
  soloCriticos: boolean;
};

export const FILTROS_VACIOS: FiltrosPuntos = {
  tipos: new Set(),
  soloCriticos: false,
};

/** Un punto es crítico si le falta algo marcado como muy requerido. */
export function esCritico(p: PuntoMapa): boolean {
  return p.necesidades.some((n) => n.nivel === "muy_requerido");
}

/** Minúsculas y sin acentos, para que "boyacá" case con "boyaca". */
function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

/** ¿Hay algún filtro o búsqueda activos? Útil para mostrar "Limpiar". */
export function hayFiltrosActivos(filtros: FiltrosPuntos, busqueda: string): boolean {
  return filtros.tipos.size > 0 || filtros.soloCriticos || busqueda.trim() !== "";
}

/**
 * Aplica tipo + criticidad + búsqueda de texto (nombre/barrio/dirección).
 * Función pura: no muta la lista de entrada.
 */
export function aplicarFiltros(
  puntos: PuntoMapa[],
  filtros: FiltrosPuntos,
  busqueda: string,
): PuntoMapa[] {
  const texto = normalizar(busqueda.trim());

  return puntos.filter((p) => {
    if (filtros.tipos.size > 0 && !filtros.tipos.has(p.tipo)) return false;
    if (filtros.soloCriticos && !esCritico(p)) return false;

    if (texto !== "") {
      const heno = normalizar(
        [p.nombre, p.barrio ?? "", p.direccion ?? ""].join(" "),
      );
      if (!heno.includes(texto)) return false;
    }

    return true;
  });
}
