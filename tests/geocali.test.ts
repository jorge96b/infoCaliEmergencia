import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buscarEsquinas,
  extraerDireccion,
  cruces,
  interpretarDireccion,
  nombresDeVia,
  normalizar,
  resolver,
  type IndiceVias,
  type Polilinea,
  type Punto,
} from "../src/lib/geocali.ts";
import { metros } from "../src/lib/geo.ts";

/**
 * Geometría sintética alrededor del centro de Cali. Las calles de verdad están
 * en OpenStreetMap y aquí no hay red, así que se dibujan a mano las situaciones
 * que importan: un cruce limpio, una avenida de doble calzada, y un par de
 * nombres que se cruzan en dos sitios distintos.
 */
const LAT = 3.45;
const LNG = -76.53;

/** Un metro, en grados de latitud. */
const M_LAT = 1 / 111_194.93;

function horizontal(lat: number, desdeLng: number, hastaLng: number): Polilinea {
  return [
    { lat, lng: desdeLng },
    { lat, lng: hastaLng },
  ];
}

function vertical(lng: number, desdeLat: number, hastaLat: number): Polilinea {
  return [
    { lat: desdeLat, lng },
    { lat: hastaLat, lng },
  ];
}

function cerca(a: Punto | null, b: Punto, tolerancia = 5) {
  assert.ok(a, "se esperaba un punto y no hubo ninguno");
  const d = metros([a.lat, a.lng], [b.lat, b.lng]);
  assert.ok(d <= tolerancia, `el punto quedó a ${Math.round(d)} m del esperado`);
}

// ---------------------------------------------------------------------------
// Nomenclatura
// ---------------------------------------------------------------------------

test("normalizar expande abreviaturas y quita tildes y aclaraciones", () => {
  assert.equal(normalizar("Av. 5N"), "AVENIDA 5N");
  assert.equal(normalizar("Cra 42"), "CARRERA 42");
  assert.equal(normalizar("Cll. 9"), "CALLE 9");
  assert.equal(normalizar("Avenida Cañasgordas"), "AVENIDA CANASGORDAS");
  assert.equal(normalizar("CALLE 5 CON CARRERA 42 (cierre total)"), "CALLE 5 CON CARRERA 42");
});

test("una vía con orientación se busca en sus tres formas", () => {
  const nombres = nombresDeVia("AVENIDA 5N");
  assert.ok(nombres.includes("AVENIDA 5N"));
  assert.ok(nombres.includes("AVENIDA 5 N"));
  assert.ok(nombres.includes("AVENIDA 5 NORTE"));
});

test("la letra de nomenclador no se confunde con una orientación", () => {
  const nombres = nombresDeVia("CARRERA 28D");
  assert.ok(nombres.includes("CARRERA 28D"));
  assert.ok(nombres.includes("CARRERA 28 D"));
  // "Carrera 28 Deste" no existe, y "Carrera 28" es otra calle distinta.
  assert.ok(!nombres.some((n) => n.includes("OESTE")));
  assert.ok(!nombres.includes("CARRERA 28"));
});

test("la 72W se busca como Oeste pero nunca como la 72 a secas", () => {
  const nombres = nombresDeVia("CALLE 72W");
  assert.ok(nombres.includes("CALLE 72 OESTE"));
  assert.ok(!nombres.includes("CALLE 72"));
});

test("una vía con nombre propio se busca con y sin 'Avenida'", () => {
  assert.deepEqual(nombresDeVia("ROOSEVELT").sort(), ["AVENIDA ROOSEVELT", "ROOSEVELT"]);
  assert.deepEqual(nombresDeVia("Avenida Roosevelt").sort(), [
    "AVENIDA ROOSEVELT",
    "ROOSEVELT",
  ]);
});

// ---------------------------------------------------------------------------
// Interpretar la línea
// ---------------------------------------------------------------------------

test("un cruce se parte en sus dos vías", () => {
  assert.deepEqual(interpretarDireccion("CALLE 5 CON CARRERA 42"), {
    tipo: "cruce",
    a: "CALLE 5",
    b: "CARRERA 42",
  });
  assert.deepEqual(interpretarDireccion("Av. 5N esquina con Calle 67"), {
    tipo: "cruce",
    a: "AVENIDA 5N",
    b: "CALLE 67",
  });
});

test("en un tramo el segundo extremo hereda el tipo de vía del primero", () => {
  assert.deepEqual(interpretarDireccion("CALLE 3 ENTRE CARRERA 56 Y 62"), {
    tipo: "tramo",
    eje: "CALLE 3",
    desde: "CARRERA 56",
    hasta: "CARRERA 62",
  });
});

// ---------------------------------------------------------------------------
// Fichas con nombre, placa y barrio
// ---------------------------------------------------------------------------

test("se descarta el nombre del sitio y el barrio, y queda la dirección", () => {
  assert.equal(
    extraerDireccion("Panadería Quintapan – Calle 5ta con Carrera 42, Tequendama."),
    "CALLE 5 CON CARRERA 42",
  );
  assert.equal(
    extraerDireccion("Edificio Ana Pilar - Carrera 56 #3-88, Cuarto de Legua."),
    "CARRERA 56 #3-88",
  );
  // El sitio se llama "Edificio Calle 9na…": la dirección empieza en el primer
  // tipo de vía, aunque el nombre se pegue a ella.
  assert.equal(
    extraerDireccion("Edificio Calle 9na con Cra. 38 (Frente a las canchas), Eucarístico."),
    "CALLE 9 CON CARRERA 38",
  );
});

test("un barrio con coma no se lleva por delante un tramo", () => {
  assert.equal(
    extraerDireccion("Calle 5, entre Carrera 56 y 62, San Fernando."),
    "CALLE 5 ENTRE CARRERA 56 Y 62",
  );
});

test("los ordinales del reporte no se confunden con nomencladores", () => {
  assert.equal(normalizar("Calle 5ta"), "CALLE 5");
  assert.equal(normalizar("Calle 9na"), "CALLE 9");
  // La D de la 28D sí es nomenclador y se queda.
  assert.equal(normalizar("Carrera 28D"), "CARRERA 28D");
  assert.equal(normalizar("Calle 8B"), "CALLE 8B");
});

test("una placa dice por sí sola en qué esquina está", () => {
  // "Carrera 56 #3-88" es la Carrera 56, a 88 m de la Calle 3.
  assert.deepEqual(interpretarDireccion("Edificio Ana Pilar - Carrera 56 #3-88, Cuarto de Legua."), {
    tipo: "cruce",
    a: "CARRERA 56",
    b: "CALLE 3",
    placa: 88,
  });
  // El Hospital Universitario del Valle: Calle 5 con Carrera 36.
  assert.deepEqual(interpretarDireccion("Hospital Universitario del Valle – Calle 5ta #36-08."), {
    tipo: "cruce",
    a: "CALLE 5",
    b: "CARRERA 36",
    placa: 8,
  });
});

test("en el norte la orientación la llevan las dos vías", () => {
  assert.deepEqual(interpretarDireccion("Clínica ValleSalud Norte – Avenida 4 Norte #14-20."), {
    tipo: "cruce",
    a: "AVENIDA 4 NORTE",
    b: "CALLE 14 NORTE",
    placa: 20,
  });
  // Y esa Calle 14 Norte se busca también como "Calle 14N".
  assert.ok(nombresDeVia("CALLE 14 NORTE").includes("CALLE 14N"));
});

test("el nomenclador de la placa manda sobre la orientación del eje", () => {
  // "Cra 28D #72W-14": la 72 es Oeste porque lo dice la placa, no la carrera.
  assert.deepEqual(interpretarDireccion("Notaria 20 - Cra 28D #72W-14, El Poblado II."), {
    tipo: "cruce",
    a: "CARRERA 28D",
    b: "CALLE 72W",
    placa: 14,
  });
});

test("una esquina dicha manda sobre la deducida de la placa", () => {
  const c = interpretarDireccion("Edificio – Calle 9 #38-21 con Carrera 44");
  assert.equal(c?.tipo, "cruce");
  assert.equal(c?.tipo === "cruce" ? c.b : "", "CARRERA 44");
});

test("una placa lejos de la esquina queda marcada para revisar", () => {
  const indice = new Map([
    ["CARRERA 58", [vertical(LNG, LAT - 0.01, LAT + 0.01)]],
    ["CALLE 3", [horizontal(LAT, LNG - 0.01, LNG + 0.01)]],
  ]) as IndiceVias;

  // 138 m desde la esquina: más de media cuadra, lo mira una persona.
  const lejos = resolver({ tipo: "cruce", a: "CARRERA 58", b: "CALLE 3", placa: 138 }, indice);
  assert.equal(lejos.diagnostico, "dudosa");
  assert.match(lejos.detalle, /138 m/);

  // 88 m es la misma esquina para lo que sirve un mapa de emergencia.
  const acomodada = resolver({ tipo: "cruce", a: "CARRERA 58", b: "CALLE 3", placa: 88 }, indice);
  assert.equal(acomodada.diagnostico, "encontrada");
});

test("una línea que no es una dirección no se inventa", () => {
  assert.equal(interpretarDireccion("REPORTE DE CIERRES"), null);
  assert.equal(interpretarDireccion(""), null);
});

// ---------------------------------------------------------------------------
// Cruzar vías
// ---------------------------------------------------------------------------

test("dos vías que se cortan dan la esquina exacta", () => {
  const { grupos } = cruces(
    [horizontal(LAT, LNG - 0.01, LNG + 0.01)],
    [vertical(LNG, LAT - 0.01, LAT + 0.01)],
  );
  assert.equal(grupos.length, 1);
  cerca(grupos[0].punto, { lat: LAT, lng: LNG }, 1);
});

test("una avenida de doble calzada se resuelve aunque no comparta ningún nodo", () => {
  // Dos calzadas separadas 40 m y una transversal que muere 55 m antes: no hay
  // corte en ninguna parte, que es exactamente el caso de la Roosevelt.
  const avenida = [
    horizontal(LAT + 20 * M_LAT, LNG - 0.01, LNG + 0.01),
    horizontal(LAT - 20 * M_LAT, LNG - 0.01, LNG + 0.01),
  ];
  const transversal = [vertical(LNG, LAT - 0.01, LAT - 55 * M_LAT)];

  const hallazgo = resolver(
    { tipo: "cruce", a: "AVENIDA ROOSEVELT", b: "CARRERA 39" },
    new Map([
      ["AVENIDA ROOSEVELT", avenida],
      ["CARRERA 39", transversal],
    ]) as IndiceVias,
  );

  assert.equal(hallazgo.diagnostico, "dudosa");
  assert.match(hallazgo.detalle, /no se tocan/);
  // El punto va a media distancia entre el final de la carrera y la calzada sur.
  cerca(hallazgo.punto, { lat: LAT - 37.5 * M_LAT, lng: LNG }, 5);
});

test("el mismo par de nombres cruzándose en dos sitios queda marcado como ambiguo", () => {
  const hallazgo = resolver(
    { tipo: "cruce", a: "CALLE 5", b: "CARRERA 1" },
    new Map([
      ["CALLE 5", [horizontal(LAT, LNG - 0.03, LNG + 0.03)]],
      [
        "CARRERA 1",
        [vertical(LNG - 0.02, LAT - 0.01, LAT + 0.01), vertical(LNG + 0.02, LAT - 0.01, LAT + 0.01)],
      ],
    ]) as IndiceVias,
  );

  assert.equal(hallazgo.diagnostico, "ambigua");
  assert.equal(hallazgo.alternativas.length, 2);
});

test("una calle que no está en el mapa se reporta por su nombre", () => {
  const hallazgo = resolver(
    { tipo: "cruce", a: "CALLE 5", b: "CARRERA 999" },
    new Map([["CALLE 5", [horizontal(LAT, LNG - 0.01, LNG + 0.01)]]]) as IndiceVias,
  );

  assert.equal(hallazgo.diagnostico, "sin_via");
  assert.match(hallazgo.detalle, /CARRERA 999/);
  assert.equal(hallazgo.punto, null);
});

test("dos calles paralelas que nunca se acercan no producen ningún punto", () => {
  const hallazgo = resolver(
    { tipo: "cruce", a: "CALLE 5", b: "CALLE 9" },
    new Map([
      ["CALLE 5", [horizontal(LAT, LNG - 0.01, LNG + 0.01)]],
      ["CALLE 9", [horizontal(LAT + 0.01, LNG - 0.01, LNG + 0.01)]],
    ]) as IndiceVias,
  );

  assert.equal(hallazgo.diagnostico, "sin_cruce");
  assert.equal(hallazgo.punto, null);
});

test("un tramo se marca en la mitad de sus dos esquinas", () => {
  const hallazgo = resolver(
    { tipo: "tramo", eje: "CALLE 3", desde: "CARRERA 56", hasta: "CARRERA 62" },
    new Map([
      ["CALLE 3", [horizontal(LAT, LNG - 0.02, LNG + 0.02)]],
      ["CARRERA 56", [vertical(LNG - 0.005, LAT - 0.01, LAT + 0.01)]],
      ["CARRERA 62", [vertical(LNG + 0.005, LAT - 0.01, LAT + 0.01)]],
    ]) as IndiceVias,
  );

  assert.equal(hallazgo.diagnostico, "encontrada");
  cerca(hallazgo.punto, { lat: LAT, lng: LNG }, 2);
});

test("un cruce fuera del recuadro de Cali no se propone", () => {
  // La base de datos rechaza cualquier punto fuera de ese recuadro, así que
  // proponerlo sólo produciría un error al guardar.
  const lejos = 4.6; // Bogotá
  const hallazgo = resolver(
    { tipo: "cruce", a: "CALLE 5", b: "CARRERA 42" },
    new Map([
      ["CALLE 5", [horizontal(lejos, LNG - 0.01, LNG + 0.01)]],
      ["CARRERA 42", [vertical(LNG, lejos - 0.01, lejos + 0.01)]],
    ]) as IndiceVias,
  );

  assert.equal(hallazgo.punto, null);
});

// ---------------------------------------------------------------------------
// El reporte entero
// ---------------------------------------------------------------------------

test("un reporte entero se resuelve con una sola bajada de geometría", async () => {
  const lineas = [
    "CALLE 5 CON CARRERA 42",
    "AVENIDA 5N CON CALLE 67",
    "ALGO QUE NO ES UNA DIRECCION",
  ];

  let bajadas = 0;
  let pedidos: string[] = [];

  const resultados = await buscarEsquinas(lineas, async (candidatos) => {
    bajadas += 1;
    pedidos = candidatos;
    return new Map([
      ["CALLE 5", [horizontal(LAT, LNG - 0.01, LNG + 0.01)]],
      ["CARRERA 42", [vertical(LNG, LAT - 0.01, LAT + 0.01)]],
      // La 5N sólo está cargada en su forma larga: por eso se buscan los alias.
      ["AVENIDA 5 NORTE", [horizontal(LAT + 0.005, LNG - 0.01, LNG + 0.01)]],
      ["CALLE 67", [vertical(LNG + 0.005, LAT - 0.01, LAT + 0.01)]],
    ]) as IndiceVias;
  });

  assert.equal(bajadas, 1, "las calles del reporte se piden todas juntas");
  assert.ok(pedidos.includes("AVENIDA 5 NORTE"));

  cerca(resultados.get("CALLE 5 CON CARRERA 42")?.punto ?? null, { lat: LAT, lng: LNG }, 2);
  cerca(resultados.get("AVENIDA 5N CON CALLE 67")?.punto ?? null, {
    lat: LAT + 0.005,
    lng: LNG + 0.005,
  }, 2);

  const basura = resultados.get("ALGO QUE NO ES UNA DIRECCION");
  assert.equal(basura?.punto, null);
  assert.match(basura?.detalle ?? "", /no se entendió/);
});
