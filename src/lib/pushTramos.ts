import type { CargaPush, PrioridadPush, SeveridadAviso } from "./tipos";

/**
 * Prioridad de entrega según la distancia.
 *
 * La idea de fondo: quien está a dos cuadras del hecho tiene que enterarse
 * ahora y con ruido; quien está al otro lado de la ciudad se entera igual, pero
 * en silencio. Son la misma noticia con dos urgencias distintas, no dos
 * noticias.
 *
 * `Urgency` es una cabecera del protocolo Web Push (RFC 8030), no un adorno
 * nuestro: el servicio de push la usa para decidir si despierta un teléfono en
 * ahorro de batería o si espera a la siguiente ventana de radio. Es literalmente
 * prioridad de entrega, y por eso la distancia se traduce a eso y no sólo a
 * cómo se ve la notificación.
 *
 * Nota de escala, para que los números no engañen: Cali entra en un rectángulo
 * de unos 38 × 29 km (ver los `check` de `puntos` en 0001), así que un radio de
 * 8 km cubre buena parte de la ciudad. En la práctica estos tramos modulan la
 * urgencia mucho más de lo que excluyen gente — que es el resultado seguro para
 * una app de emergencia.
 */

export const CERCA_M = 2_000;
export const LEJOS_M = 8_000;

/** Valores de la cabecera `Urgency` del protocolo. */
export type Urgencia = "very-low" | "low" | "normal" | "high";

export type Tramo = {
  prioridad: PrioridadPush;
  urgencia: Urgencia;
  /**
   * Segundos que el servicio de push guarda el mensaje si el teléfono está
   * apagado o sin señal. Una hora para lo urgente; media para lo lejano, que
   * envejece antes de lo que tarda en importar.
   */
  ttl: number;
};

const ALTA: Tramo = { prioridad: "alta", urgencia: "high", ttl: 3600 };
const MEDIA: Tramo = { prioridad: "media", urgencia: "normal", ttl: 3600 };
const BAJA: Tramo = { prioridad: "baja", urgencia: "low", ttl: 1800 };

/**
 * Tramo que corresponde a una distancia.
 *
 * `null` —sin ubicación conocida, o un aviso de toda la ciudad que no tiene
 * coordenadas— cae en el tramo medio. No en el bajo: no saber dónde está
 * alguien no es razón para bajarle la prioridad a lo que le mandamos.
 */
export function tramoPorDistancia(distancia_m: number | null): Tramo {
  if (distancia_m === null) return MEDIA;
  if (distancia_m <= CERCA_M) return ALTA;
  if (distancia_m <= LEJOS_M) return MEDIA;
  return BAJA;
}

/**
 * Tramo de un aviso oficial, que no tiene coordenadas y va a toda la ciudad.
 * Aquí la prioridad la marca la severidad, que es el único eje disponible.
 */
export function tramoPorSeveridad(severidad: SeveridadAviso): Tramo {
  if (severidad === "critico") return ALTA;
  if (severidad === "importante") return MEDIA;
  return BAJA;
}

/**
 * Qué recibe el service worker. Se mantiene pequeño a propósito: algunos
 * servicios de push rechazan cargas grandes, y todo lo que no quepa aquí lo
 * puede volver a pedir la app cuando se abra.
 */
export function construirCarga(
  base: Omit<CargaPush, "prioridad">,
  tramo: Tramo,
): CargaPush {
  return { ...base, prioridad: tramo.prioridad };
}
