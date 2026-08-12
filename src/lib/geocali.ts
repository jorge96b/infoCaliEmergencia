/**
 * Interpretar direcciones de Cali y encontrar la esquina donde se cruzan dos
 * vías. Todo lo de aquí es cálculo puro: no toca la red ni el navegador.
 *
 * La razón de que exista es que ningún geocodificador de propósito general
 * resuelve "Calle 5 con Carrera 42". Nominatim, que es el que acompaña a
 * OpenStreetMap, no geocodifica intersecciones: devuelve el centroide de la
 * Calle 5, que en Cali queda a kilómetros de la esquina. Un cierre vial mal
 * ubicado manda a alguien por una vía equivocada en el peor momento posible.
 *
 * Así que la esquina no se pregunta, se calcula: se baja la geometría de las
 * dos vías (eso lo hace `overpass.ts`) y aquí se busca dónde se tocan. La parte
 * difícil —qué nombre tiene una vía en OpenStreetMap, dónde se cruzan dos
 * polilíneas, cuándo el resultado no es de fiar— queda en funciones puras que
 * se pueden probar sin red.
 */

export type Punto = { lat: number; lng: number };

/** Una vía de OpenStreetMap es una polilínea; una calle suele ser varias. */
export type Polilinea = Punto[];

/** El mismo recuadro que imponen los `check` de `puntos` en la migración 0001. */
export const RECUADRO_CALI = { sur: 3.28, oeste: -76.68, norte: 3.62, este: -76.42 };

/** Se consideran la misma esquina dos vías que se acercan a esto o menos. */
export const UMBRAL_CRUCE_M = 25;

/**
 * Hasta aquí se propone la esquina, pero marcada. Entre 25 y 120 metros suele
 * ser una avenida de doble calzada con separador ancho o una glorieta.
 */
export const UMBRAL_CERCA_M = 120;

/** Dos cruces más separados que esto son esquinas distintas, no ruido. */
export const UMBRAL_GRUPO_M = 300;

// ---------------------------------------------------------------------------
// Nomenclatura
// ---------------------------------------------------------------------------

const ABREVIATURAS: Record<string, string> = {
  AV: "AVENIDA",
  AVE: "AVENIDA",
  AVD: "AVENIDA",
  AVDA: "AVENIDA",
  CL: "CALLE",
  CLL: "CALLE",
  CLLE: "CALLE",
  CR: "CARRERA",
  CRA: "CARRERA",
  CRRA: "CARRERA",
  CARR: "CARRERA",
  KR: "CARRERA",
  KRA: "CARRERA",
  DG: "DIAGONAL",
  DIAG: "DIAGONAL",
  TV: "TRANSVERSAL",
  TRV: "TRANSVERSAL",
  TRANSV: "TRANSVERSAL",
  AUT: "AUTOPISTA",
};

const TIPOS_VIA = ["CALLE", "CARRERA", "AVENIDA", "DIAGONAL", "TRANSVERSAL", "AUTOPISTA"];

/**
 * Las letras que en la nomenclatura caleña son orientación y no nomenclador.
 *
 * La distinción importa: la 5N es la Avenida 5 *Norte*, pero la 28D es la
 * Carrera 28D y no existe ninguna "Carrera 28 Deste". Por eso sólo estas letras
 * generan la variante larga.
 */
const ORIENTACIONES: Record<string, string> = {
  N: "NORTE",
  S: "SUR",
  E: "ESTE",
  O: "OESTE",
  W: "OESTE",
  OE: "OESTE",
};

/**
 * Deja el texto en la forma con la que se compara todo: mayúsculas, sin tildes,
 * sin puntuación y con las abreviaturas expandidas.
 *
 * Los paréntesis se van enteros porque casi siempre traen la aclaración del
 * cierre —"(cierre total)", "(sentido norte-sur)"— y no parte del nombre.
 */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[.,#;:"']/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((p) => p.length > 0 && !/^(NO|NRO)$/.test(p))
    .map((p) => ABREVIATURAS[p] ?? p)
    .map(quitarOrdinal)
    .join(" ");
}

/**
 * "5TA" → "5", "9NA" → "9".
 *
 * Los reportes escriben la Calle 5 como "Calle 5ta" y la 9 como "9na". Sin
 * esto la terminación se confunde con un nomenclador —como la D de la 28D— y
 * se termina buscando una "Calle 5TA" que no existe en ningún mapa.
 *
 * La lista es cerrada a propósito: los nomencladores reales de Cali son de una
 * sola letra (28D, 8B) o de orientación (5N, 72W), así que ninguno colisiona
 * con estas parejas.
 */
function quitarOrdinal(palabra: string): string {
  const m = palabra.match(/^(\d+)(RA|RO|ER|DA|DO|TA|TO|MA|MO|VA|VO|NA|NO)$/);
  return m ? m[1] : palabra;
}

/**
 * Los nombres con los que esa vía puede estar cargada en OpenStreetMap.
 *
 * Es donde se gana o se pierde la mayoría de los casos. La Alcaldía escribe
 * "AVENIDA 5N"; el mapa puede tener "Avenida 5 Norte", "Avenida 5N" o
 * "Avenida 5 N", según quién la dibujó. Se buscan todas.
 */
export function nombresDeVia(via: string): string[] {
  const completo = normalizar(via);
  if (!completo) return [];

  const candidatos = new Set<string>([completo]);
  const conTipo = completo.match(
    new RegExp(`^(${TIPOS_VIA.join("|")})\\s+(.+)$`),
  );

  if (!conTipo) {
    // Una vía con nombre propio y sin tipo: "ROOSEVELT", "SIMON BOLIVAR". En el
    // mapa casi siempre están como avenida.
    candidatos.add(`AVENIDA ${completo}`);
    return [...candidatos];
  }

  const [, tipo, resto] = conTipo;
  const numerada = resto.match(/^(\d+)\s*([A-Z]{1,2})?(\s+BIS)?$/);

  if (!numerada) {
    // El camino contrario al de abajo: la placa produce "Calle 14 Norte" y el
    // mapa puede tenerla como "Calle 14N". Sin esto, todo lo que salga de una
    // dirección del norte o del oeste se queda sin encontrar.
    const orientada = resto.match(/^(\d+)\s+(NORTE|SUR|OESTE|ESTE)$/);
    if (orientada) {
      const [, numero, orientacion] = orientada;
      const inicial = orientacion.charAt(0);
      candidatos.add(`${tipo} ${numero}${inicial}`);
      candidatos.add(`${tipo} ${numero} ${inicial}`);
      return [...candidatos];
    }

    // "AVENIDA ROOSEVELT" también aparece como "ROOSEVELT" a secas.
    candidatos.add(resto);
    return [...candidatos];
  }

  const [, numero, sufijo, bis] = numerada;
  const cola = bis ? " BIS" : "";

  if (!sufijo) {
    candidatos.add(`${tipo} ${numero}${cola}`);
  } else {
    // El sufijo nunca se descarta: la Calle 72W no es la Calle 72, y proponer
    // una por la otra deja el cierre a veinte cuadras.
    candidatos.add(`${tipo} ${numero}${sufijo}${cola}`);
    candidatos.add(`${tipo} ${numero} ${sufijo}${cola}`);
    const orientacion = ORIENTACIONES[sufijo];
    if (orientacion) candidatos.add(`${tipo} ${numero} ${orientacion}${cola}`);
  }

  return [...candidatos];
}

// ---------------------------------------------------------------------------
// Interpretar la línea del reporte
// ---------------------------------------------------------------------------

export type Consulta =
  | {
      tipo: "cruce";
      a: string;
      b: string;
      /**
       * Metros que la placa declara desde la esquina, cuando la dirección venía
       * en nomenclatura ("Carrera 56 #3-88" son 88 m). Es la única medida
       * honesta del error del punto propuesto.
       */
      placa?: number;
    }
  | { tipo: "tramo"; eje: string; desde: string; hasta: string };

/**
 * La vía que cruza a otra en la nomenclatura colombiana. Las carreras van
 * contra las calles, y las diagonales contra las transversales.
 */
const COMPLEMENTO: Record<string, string> = {
  CALLE: "CARRERA",
  CARRERA: "CALLE",
  AVENIDA: "CALLE",
  AUTOPISTA: "CALLE",
  DIAGONAL: "TRANSVERSAL",
  TRANSVERSAL: "DIAGONAL",
};

const ORIENTACIONES_LARGAS = ["NORTE", "SUR", "OESTE", "ESTE"];

/**
 * Recorta la dirección de una línea que trae también el nombre del sitio y el
 * barrio: "Edificio Ana Pilar - Carrera 56 #3-88, Cuarto de Legua".
 *
 * Los listados de la Alcaldía no vienen como direcciones sueltas sino como
 * fichas, y sin este recorte se termina buscando en OpenStreetMap una vía
 * llamada "Edificio Ana Pilar - Carrera 56", que evidentemente no existe.
 *
 * A diferencia de `normalizar`, conserva el `#`, que es lo que distingue una
 * placa de un cruce.
 */
export function extraerDireccion(linea: string): string {
  const limpia = linea
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .replace(/\([^)]*\)/g, " ");

  // El barrio va al final y separado por coma. Se quedan sólo los trozos que
  // hablan de vías, y así "…, Cuarto de Legua" se cae sin llevarse por delante
  // un "Calle 5, entre Carrera 56 y 62".
  const trozos = limpia
    .split(",")
    .map((t) =>
      t
        .replace(/[.;:"']/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .split(" ")
        .map((p) => ABREVIATURAS[p] ?? p)
        .map(quitarOrdinal)
        .join(" "),
    )
    .filter((t) => t.length > 0);

  const conVia = trozos.filter(
    (t) =>
      t.includes("#") ||
      /\b(CON|ENTRE)\b/.test(t) ||
      TIPOS_VIA.some((v) => new RegExp(`\\b${v}\\b`).test(t)),
  );
  if (conVia.length === 0) return "";

  const texto = conVia.join(" ");

  // Del nombre del sitio a la dirección: la dirección empieza donde aparece el
  // primer tipo de vía.
  const inicio = texto.search(new RegExp(`\\b(${TIPOS_VIA.join("|")})\\b`));
  return (inicio >= 0 ? texto.slice(inicio) : texto).replace(/\s+/g, " ").trim();
}

/**
 * "CARRERA 56 #3-88" → el cruce de la Carrera 56 con la Calle 3.
 *
 * La nomenclatura colombiana ya dice dónde está la esquina: el primer número
 * después del `#` es la vía que cruza, y el segundo son los metros desde esa
 * esquina. Por eso una placa no necesita geocodificador: se lee.
 */
function interpretarPlaca(direccion: string): Consulta | null {
  const m = direccion.match(/^(.+?)\s*#\s*(\d+[A-Z]*)(?:\s*-\s*(\d+))?/);
  if (!m) return null;

  const eje = m[1].trim();
  const tipoEje = TIPOS_VIA.find((v) => eje.startsWith(`${v} `));
  if (!tipoEje) return null;

  const cruza = COMPLEMENTO[tipoEje];
  if (!cruza) return null;

  // En el norte y el oeste la orientación la llevan las dos vías: la placa
  // "Avenida 4 Norte #14-20" cruza con la Calle 14 Norte, no con la Calle 14.
  const orientacion = ORIENTACIONES_LARGAS.find((o) => eje.endsWith(` ${o}`));
  const sufijoPropio = /[A-Z]$/.test(m[2]);
  const destino =
    orientacion && !sufijoPropio ? `${cruza} ${m[2]} ${orientacion}` : `${cruza} ${m[2]}`;

  return { tipo: "cruce", a: eje, b: destino, placa: m[3] ? Number(m[3]) : undefined };
}

const SEPARADOR_CRUCE = /\s+(?:CRUCE\s+CON|ESQUINA\s+CON|CON|X)\s+(?:LA\s+|EL\s+)?/;
const SEPARADOR_TRAMO = /^(.+?)\s+ENTRE\s+(.+?)\s+Y\s+(.+)$/;

/**
 * En "ENTRE CARRERA 56 Y 62" el segundo extremo viene desnudo y hereda el tipo
 * del primero. Sin esto se buscaría una vía llamada "62", que no existe.
 */
function heredarTipo(desde: string, hasta: string): string {
  if (!/^\d/.test(hasta)) return hasta;
  const tipo = TIPOS_VIA.find((t) => desde.startsWith(`${t} `));
  return tipo ? `${tipo} ${hasta}` : hasta;
}

/**
 * "CALLE 5 CON CARRERA 42" → un cruce. "CALLE 3 ENTRE 56 Y 62" → un tramo.
 * "CARRERA 56 #3-88" → el cruce que dice la placa.
 */
export function interpretarDireccion(linea: string): Consulta | null {
  const texto = extraerDireccion(linea);
  if (!texto) return null;

  const tramo = texto.match(SEPARADOR_TRAMO);
  if (tramo) {
    const eje = tramo[1].trim();
    const desde = tramo[2].trim();
    const hasta = heredarTipo(desde, tramo[3].trim());
    if (eje && desde && hasta) return { tipo: "tramo", eje, desde, hasta };
  }

  const partes = texto.split(SEPARADOR_CRUCE);
  if (partes.length >= 2) {
    const a = partes[0].trim();
    const b = partes[1].trim();
    if (a && b) return { tipo: "cruce", a, b };
  }

  // La placa va de última: si la línea trae "con", eso manda, porque una
  // esquina dicha es más precisa que una deducida del nomenclador.
  return interpretarPlaca(texto);
}

/** Todos los nombres que hay que pedirle a Overpass para resolver la consulta. */
export function viasDeConsulta(c: Consulta): string[] {
  return c.tipo === "cruce" ? [c.a, c.b] : [c.eje, c.desde, c.hasta];
}

// ---------------------------------------------------------------------------
// Geometría
// ---------------------------------------------------------------------------

const RADIO_TIERRA_M = 6_371_000;
const LAT_REF = 3.45;
const LNG_REF = -76.53;
const M_POR_GRADO_LAT = (Math.PI / 180) * RADIO_TIERRA_M;
const M_POR_GRADO_LNG = M_POR_GRADO_LAT * Math.cos((LAT_REF * Math.PI) / 180);

type Plano = { x: number; y: number };

/**
 * Proyección equirectangular centrada en Cali. Sobre un recuadro de 38 × 29 km
 * el error es de centímetros, y a cambio el cruce de dos polilíneas se vuelve
 * geometría de bachillerato en vez de trigonometría esférica.
 */
function aPlano(p: Punto): Plano {
  return { x: (p.lng - LNG_REF) * M_POR_GRADO_LNG, y: (p.lat - LAT_REF) * M_POR_GRADO_LAT };
}

function aGeo(q: Plano): Punto {
  return { lat: q.y / M_POR_GRADO_LAT + LAT_REF, lng: q.x / M_POR_GRADO_LNG + LNG_REF };
}

function distanciaPlana(a: Plano, b: Plano): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Distancia de un punto a un segmento, y el punto del segmento más cercano. */
function puntoASegmento(p: Plano, a: Plano, b: Plano): { d: number; q: Plano } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const largo2 = dx * dx + dy * dy;
  if (largo2 === 0) return { d: distanciaPlana(p, a), q: a };

  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / largo2));
  const q = { x: a.x + t * dx, y: a.y + t * dy };
  return { d: distanciaPlana(p, q), q };
}

/** El punto donde se cortan dos segmentos, si es que se cortan. */
function corte(a1: Plano, a2: Plano, b1: Plano, b2: Plano): Plano | null {
  const rx = a2.x - a1.x;
  const ry = a2.y - a1.y;
  const sx = b2.x - b1.x;
  const sy = b2.y - b1.y;

  const denominador = rx * sy - ry * sx;
  if (denominador === 0) return null; // paralelos o colineales

  const t = ((b1.x - a1.x) * sy - (b1.y - a1.y) * sx) / denominador;
  const u = ((b1.x - a1.x) * ry - (b1.y - a1.y) * rx) / denominador;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;

  return { x: a1.x + t * rx, y: a1.y + t * ry };
}

/** Lo más cerca que llegan dos segmentos, y dónde. */
function acercamiento(
  a1: Plano,
  a2: Plano,
  b1: Plano,
  b2: Plano,
): { d: number; q: Plano } {
  const cruzan = corte(a1, a2, b1, b2);
  if (cruzan) return { d: 0, q: cruzan };

  // Sin corte, el mínimo está entre un extremo de un segmento y el otro
  // segmento. Se guarda también el extremo de origen, no sólo la proyección.
  const opciones = [
    { origen: a1, ...puntoASegmento(a1, b1, b2) },
    { origen: a2, ...puntoASegmento(a2, b1, b2) },
    { origen: b1, ...puntoASegmento(b1, a1, a2) },
    { origen: b2, ...puntoASegmento(b2, a1, a2) },
  ];
  const mejor = opciones.reduce((m, o) => (o.d < m.d ? o : m));

  // El punto propuesto va a media distancia: si las dos calzadas de una avenida
  // pasan a 30 m de la transversal, la esquina está en el separador, no sobre
  // una de las calzadas.
  return {
    d: mejor.d,
    q: { x: (mejor.origen.x + mejor.q.x) / 2, y: (mejor.origen.y + mejor.q.y) / 2 },
  };
}

type Caja = { minX: number; minY: number; maxX: number; maxY: number };

function caja(linea: Plano[]): Caja {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of linea) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

function cajasLejos(a: Caja, b: Caja, margen: number): boolean {
  return (
    a.minX - b.maxX > margen ||
    b.minX - a.maxX > margen ||
    a.minY - b.maxY > margen ||
    b.minY - a.maxY > margen
  );
}

export type Cruce = { punto: Punto; distancia: number };

/**
 * Los puntos donde dos calles se encuentran.
 *
 * No basta con buscar un nodo compartido, que sería mucho más barato: una
 * avenida de doble calzada son dos polilíneas que no comparten ningún nodo con
 * la transversal que las atraviesa, y ese es justamente el caso de la Avenida
 * Roosevelt o la Avenida 5 Norte. Por eso se mide segmento contra segmento.
 *
 * Devuelve los cruces ya agrupados —un cruce real aparece en varios pares de
 * segmentos— y, aparte, el acercamiento mínimo, que sirve para distinguir "no
 * se cruzan" de "no se tocan por poco".
 */
export function cruces(
  a: Polilinea[],
  b: Polilinea[],
): { grupos: Cruce[]; minimo: Cruce | null } {
  const lineasA = a.map((l) => l.map(aPlano)).filter((l) => l.length >= 2);
  const lineasB = b.map((l) => l.map(aPlano)).filter((l) => l.length >= 2);

  const encontrados: { q: Plano; d: number }[] = [];
  let minimo: { q: Plano; d: number } | null = null;

  for (const la of lineasA) {
    const cajaA = caja(la);
    for (const lb of lineasB) {
      // Descarte barato: la mayoría de los pares de polilíneas de dos calles
      // largas ni se acercan, y sin esto se comparan segmento a segmento.
      if (cajasLejos(cajaA, caja(lb), UMBRAL_CERCA_M)) continue;

      for (let i = 0; i + 1 < la.length; i++) {
        for (let j = 0; j + 1 < lb.length; j++) {
          const { d, q } = acercamiento(la[i], la[i + 1], lb[j], lb[j + 1]);
          if (!minimo || d < minimo.d) minimo = { q, d };
          if (d <= UMBRAL_CRUCE_M) encontrados.push({ q, d });
        }
      }
    }
  }

  // Un cruce sale repetido en varios pares de segmentos; y una misma pareja de
  // nombres puede cruzarse de verdad en dos sitios de la ciudad. Agrupar por
  // cercanía separa las dos cosas.
  const grupos: { q: Plano; d: number }[] = [];
  for (const e of encontrados.sort((x, y) => x.d - y.d)) {
    const cerca = grupos.some((g) => distanciaPlana(g.q, e.q) <= UMBRAL_GRUPO_M);
    if (!cerca) grupos.push(e);
  }

  return {
    grupos: grupos.map((g) => ({ punto: aGeo(g.q), distancia: g.d })),
    minimo: minimo ? { punto: aGeo(minimo.q), distancia: minimo.d } : null,
  };
}

// ---------------------------------------------------------------------------
// Resolver una dirección contra la geometría bajada
// ---------------------------------------------------------------------------

/**
 * - `encontrada`: las vías se cruzan y el punto es de fiar.
 * - `dudosa`: hay punto, pero algo no cuadra y hay que mirarlo.
 * - `ambigua`: ese par de nombres se cruza en más de un sitio de Cali.
 * - `sin_via`: OpenStreetMap no tiene alguna de las dos calles con ese nombre.
 * - `sin_cruce`: están las dos, pero nunca se acercan.
 */
export type Diagnostico = "encontrada" | "dudosa" | "ambigua" | "sin_via" | "sin_cruce";

export type Hallazgo = {
  diagnostico: Diagnostico;
  punto: Punto | null;
  detalle: string;
  alternativas: Punto[];
};

/** Nombre normalizado → geometría. Lo llena `overpass.ts`. */
export type IndiceVias = Map<string, Polilinea[]>;

/** Junta la geometría de todos los alias con los que pudo quedar cargada la vía. */
function geometriaDe(via: string, indice: IndiceVias): Polilinea[] {
  const lineas: Polilinea[] = [];
  for (const nombre of nombresDeVia(via)) {
    const encontradas = indice.get(nombre);
    if (encontradas) lineas.push(...encontradas);
  }
  return lineas;
}

export function dentroDeCali(p: Punto): boolean {
  return (
    p.lat >= RECUADRO_CALI.sur &&
    p.lat <= RECUADRO_CALI.norte &&
    p.lng >= RECUADRO_CALI.oeste &&
    p.lng <= RECUADRO_CALI.este
  );
}

function noHallado(detalle: string, diagnostico: Diagnostico = "sin_via"): Hallazgo {
  return { diagnostico, punto: null, detalle, alternativas: [] };
}

/** La esquina de dos vías, con su diagnóstico. */
export function resolverCruce(a: string, b: string, indice: IndiceVias): Hallazgo {
  const geoA = geometriaDe(a, indice);
  const geoB = geometriaDe(b, indice);

  const faltan = [geoA.length === 0 ? a : null, geoB.length === 0 ? b : null].filter(
    (v): v is string => v !== null,
  );
  if (faltan.length > 0) {
    return noHallado(`sin datos de ${faltan.join(" ni ")} en OpenStreetMap`);
  }

  const { grupos, minimo } = cruces(geoA, geoB);

  if (grupos.length > 1) {
    const dentro = grupos.filter((g) => dentroDeCali(g.punto));
    return {
      diagnostico: "ambigua",
      punto: dentro[0]?.punto ?? null,
      detalle: `${grupos.length} cruces posibles`,
      alternativas: dentro.map((g) => g.punto),
    };
  }

  if (grupos.length === 1) {
    const unico = grupos[0];
    if (!dentroDeCali(unico.punto)) {
      return noHallado("el cruce cae fuera de Cali", "sin_cruce");
    }
    return {
      diagnostico: "encontrada",
      punto: unico.punto,
      detalle: "",
      alternativas: [],
    };
  }

  if (minimo && minimo.distancia <= UMBRAL_CERCA_M && dentroDeCali(minimo.punto)) {
    return {
      diagnostico: "dudosa",
      punto: minimo.punto,
      detalle: `las vías no se tocan, quedan a ${Math.round(minimo.distancia)} m`,
      alternativas: [],
    };
  }

  return noHallado("las vías no se cruzan en ningún punto", "sin_cruce");
}

/** El punto medio de un tramo entre dos esquinas. */
function medio(a: Punto, b: Punto): Punto {
  return { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
}

function metrosEntre(a: Punto, b: Punto): number {
  return distanciaPlana(aPlano(a), aPlano(b));
}

/** Resuelve una línea del reporte, sea cruce o tramo. */
export function resolver(consulta: Consulta, indice: IndiceVias): Hallazgo {
  if (consulta.tipo === "cruce") {
    const hallazgo = resolverCruce(consulta.a, consulta.b, indice);

    // Una placa ubica la esquina, no la puerta. Los metros que ella misma
    // declara son la distancia que falta, y de qué lado de la esquina cae no
    // lo dice la nomenclatura: pasada media cuadra, eso lo mira una persona.
    if (consulta.placa !== undefined && hallazgo.punto && consulta.placa > 100) {
      return {
        ...hallazgo,
        diagnostico: "dudosa",
        detalle: `la placa está a ${consulta.placa} m de esta esquina`,
      };
    }
    return hallazgo;
  }

  const uno = resolverCruce(consulta.eje, consulta.desde, indice);
  const otro = resolverCruce(consulta.eje, consulta.hasta, indice);

  // Un tramo se marca en su mitad: es lo más útil para quien mira el mapa y
  // quiere saber por dónde no pasar.
  if (uno.punto && otro.punto) {
    const largo = metrosEntre(uno.punto, otro.punto);
    const punto = medio(uno.punto, otro.punto);
    const dudoso =
      uno.diagnostico !== "encontrada" || otro.diagnostico !== "encontrada" || largo > 1_500;
    return {
      diagnostico: dudoso ? "dudosa" : "encontrada",
      punto,
      detalle: dudoso
        ? largo > 1_500
          ? `tramo de ${(largo / 1000).toFixed(1)} km, más largo de lo normal`
          : "uno de los extremos no es seguro"
        : "",
      alternativas: [],
    };
  }

  // Con un solo extremo el tramo no se puede centrar, pero la esquina que sí
  // salió ya ubica el cierre en la cuadra correcta.
  const unico = uno.punto ? uno : otro.punto ? otro : null;
  if (unico) {
    return {
      diagnostico: "dudosa",
      punto: unico.punto,
      detalle: "sólo se encontró un extremo del tramo",
      alternativas: [],
    };
  }

  return uno.diagnostico === "sin_via" ? uno : otro;
}

/**
 * Resuelve un reporte entero.
 *
 * Recibe quién baja la geometría en vez de bajarla: así este módulo se puede
 * probar sin red, y de paso todas las calles del reporte se piden en una sola
 * consulta en lugar de una por esquina.
 */
export async function buscarEsquinas(
  lineas: string[],
  bajar: (candidatos: string[]) => Promise<IndiceVias>,
): Promise<Map<string, Hallazgo>> {
  const consultas = new Map<string, Consulta>();
  const resultados = new Map<string, Hallazgo>();

  for (const linea of lineas) {
    const consulta = interpretarDireccion(linea);
    if (consulta) consultas.set(linea, consulta);
    else resultados.set(linea, noHallado("no se entendió la dirección", "sin_via"));
  }

  if (consultas.size === 0) return resultados;

  const candidatos = new Set<string>();
  for (const consulta of consultas.values()) {
    for (const via of viasDeConsulta(consulta)) {
      for (const nombre of nombresDeVia(via)) candidatos.add(nombre);
    }
  }

  const indice = await bajar([...candidatos]);

  for (const [linea, consulta] of consultas) {
    resultados.set(linea, resolver(consulta, indice));
  }

  return resultados;
}
