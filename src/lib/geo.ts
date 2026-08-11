/**
 * Utilidades de distancia en el cliente.
 *
 * La lista de puntos puede ordenarse por cercanía cuando la persona comparte su
 * ubicación. El cálculo es el mismo haversine que usa la función SQL `metros()`
 * de `rpc_crear_punto`, replicado aquí para no tener que ir al servidor sólo
 * para ordenar una lista que ya está en memoria.
 */

const RADIO_TIERRA_M = 6_371_000;

function aRadianes(grados: number): number {
  return (grados * Math.PI) / 180;
}

/** Distancia en metros entre dos coordenadas `[lat, lng]` (haversine). */
export function metros(a: [number, number], b: [number, number]): number {
  const dLat = aRadianes(b[0] - a[0]);
  const dLng = aRadianes(b[1] - a[1]);
  const lat1 = aRadianes(a[0]);
  const lat2 = aRadianes(b[0]);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * RADIO_TIERRA_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Distancia legible: metros por debajo de 1 km, kilómetros con un decimal arriba. */
export function formatearDistancia(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}
