/**
 * Bajar la geometría de unas cuantas calles de Cali desde OpenStreetMap.
 *
 * Es la única pieza del geocodificador que toca la red, y corre en el navegador
 * de quien modera —no en el servidor— porque es ahí donde hay salida a
 * internet abierta, la misma por la que ya bajan las teselas del mapa.
 *
 * Se pide todo de una vez. Un reporte de la Secretaría trae unas dieciocho
 * esquinas que mencionan unas veinticinco calles distintas; pedir cada cruce
 * por separado serían dieciocho consultas contra un servidor público y gratuito
 * que además cobra en paciencia. Una sola consulta con todos los nombres baja la
 * geometría una vez y los cruces se calculan aquí, en memoria.
 */

import { RECUADRO_CALI, normalizar, type Polilinea } from "./geocali";

/**
 * Espejos de Overpass, en orden. El primero es el oficial; si está saturado
 * —responde 429 o 504, cosa que pasa— se intenta el siguiente. No es
 * redundancia de lujo: si esto falla, la persona se queda sin la ayuda entera.
 */
export const SERVIDORES = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

const ESPERA_MS = 45_000;

/**
 * OpenStreetMap escribe los nombres con tildes y eñes; el reporte de la
 * Alcaldía llega sin ellas. Como la comparación va contra el servidor, el
 * patrón tiene que admitir las dos formas: "Cañasgordas" y "CANASGORDAS".
 */
const EQUIVALENTES: Record<string, string> = {
  A: "[aá]",
  E: "[eé]",
  I: "[ií]",
  O: "[oó]",
  U: "[uúü]",
  N: "[nñ]",
};

function patron(nombre: string): string {
  return nombre
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/[AEIOUN]/g, (letra) => EQUIVALENTES[letra] ?? letra);
}

type ElementoOverpass = {
  type: string;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
};

/**
 * Pide las vías cuyo nombre coincida con alguno de los candidatos y las
 * devuelve agrupadas por nombre normalizado, listas para `resolver`.
 */
export async function bajarVias(
  candidatos: string[],
  opciones: { señal?: AbortSignal; servidores?: string[] } = {},
): Promise<Map<string, Polilinea[]>> {
  const buscados = [...new Set(candidatos.map(normalizar).filter(Boolean))];
  const indice = new Map<string, Polilinea[]>();
  if (buscados.length === 0) return indice;

  const alternativa = buscados.map(patron).join("|");
  const caja = `${RECUADRO_CALI.sur},${RECUADRO_CALI.oeste},${RECUADRO_CALI.norte},${RECUADRO_CALI.este}`;

  // `out geom` trae las coordenadas dentro de cada vía, sin tener que resolver
  // los nodos por aparte. Se consulta `alt_name` además de `name` porque las
  // avenidas caleñas suelen tener el nombre oficial en uno y el de la calle en
  // el otro: "Avenida 3 Norte" / "Avenida Estación".
  const consulta = `[out:json][timeout:60];
(
  way["highway"]["name"~"^(${alternativa})$",i](${caja});
  way["highway"]["alt_name"~"^(${alternativa})$",i](${caja});
);
out geom;`;

  const datos = await pedir(consulta, opciones);

  for (const elemento of datos.elements ?? []) {
    if (!elemento.geometry || elemento.geometry.length < 2) continue;
    const linea: Polilinea = elemento.geometry.map((g) => ({ lat: g.lat, lng: g.lon }));

    // Una misma vía puede entrar por `name` y por `alt_name`; se indexa bajo
    // los dos, que para eso se preguntó por ambos.
    for (const etiqueta of ["name", "alt_name"] as const) {
      const valor = elemento.tags?.[etiqueta];
      if (!valor) continue;
      const clave = normalizar(valor);
      if (!buscados.includes(clave)) continue;
      const previas = indice.get(clave);
      if (previas) previas.push(linea);
      else indice.set(clave, [linea]);
    }
  }

  return indice;
}

async function pedir(
  consulta: string,
  opciones: { señal?: AbortSignal; servidores?: string[] },
): Promise<{ elements?: ElementoOverpass[]; remark?: string }> {
  const servidores = opciones.servidores ?? SERVIDORES;
  let ultimoError: Error | null = null;

  for (const servidor of servidores) {
    // Un reloj propio por servidor: sin esto, un espejo que no responde deja a
    // la persona mirando un botón girando sin final.
    const reloj = new AbortController();
    const corte = setTimeout(() => reloj.abort(), ESPERA_MS);
    const cancelar = () => reloj.abort();
    opciones.señal?.addEventListener("abort", cancelar);

    try {
      const respuesta = await fetch(servidor, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(consulta)}`,
        signal: reloj.signal,
      });

      if (!respuesta.ok) {
        // 429 y 504 son el servidor saturado, no un error nuestro: vale la pena
        // el siguiente espejo. Los demás también, que no cuesta nada.
        ultimoError = new Error(
          respuesta.status === 429 || respuesta.status === 504
            ? "OpenStreetMap está saturado en este momento"
            : `OpenStreetMap respondió ${respuesta.status}`,
        );
        continue;
      }

      const datos = (await respuesta.json()) as {
        elements?: ElementoOverpass[];
        remark?: string;
      };

      // Overpass avisa de consultas truncadas con un `remark` y un 200 alegre.
      if (datos.remark && !datos.elements?.length) {
        ultimoError = new Error(`OpenStreetMap no completó la consulta: ${datos.remark}`);
        continue;
      }

      return datos;
    } catch (e) {
      if (opciones.señal?.aborted) throw new Error("Búsqueda cancelada.");
      ultimoError =
        e instanceof Error && e.name === "AbortError"
          ? new Error("OpenStreetMap tardó demasiado en responder")
          : e instanceof Error
            ? e
            : new Error("No se pudo consultar OpenStreetMap");
    } finally {
      clearTimeout(corte);
      opciones.señal?.removeEventListener("abort", cancelar);
    }
  }

  throw new Error(
    `${ultimoError?.message ?? "No se pudo consultar OpenStreetMap"}. Puedes seguir señalando las esquinas a mano.`,
  );
}
