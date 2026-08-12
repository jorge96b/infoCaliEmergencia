"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { PropuestaMapa, PuntoMapa } from "@/lib/tipos";
import { buscarEsquinas, type Diagnostico } from "@/lib/geocali";
import { bajarVias } from "@/lib/overpass";

/**
 * Carga guiada de puntos oficiales, pensada para el reporte de cierres viales
 * de la Secretaría de Movilidad.
 *
 * El problema que resuelve es de ritmo: la Alcaldía publica quince o veinte
 * esquinas varias veces al día, y cargarlas una por una —abrir el formulario,
 * escribir el nombre, elegir el tipo, buscar la esquina, guardar, repetir— es
 * tan lento que en la práctica no se hace.
 *
 * Aquí se pega el reporte entero, se convierte en una fila de pendientes, y se
 * buscan las esquinas en OpenStreetMap de una sola vez.
 *
 * Lo que la búsqueda NO hace es guardar sola. Deja las esquinas como propuestas
 * sobre el mapa y espera confirmación, por dos razones que no cambian: un nombre
 * mal interpretado pone un cierre en la esquina equivocada, y un cierre mal
 * ubicado manda a alguien por una vía equivocada en el peor momento posible. Lo
 * que la búsqueda ahorra es el trabajo de encontrar dieciocho esquinas; lo que
 * no ahorra es el par de ojos que las revisa.
 */

const Mapa = dynamic(() => import("@/components/Mapa"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full place-items-center text-sm text-slate-500">Cargando mapa…</div>
  ),
});

const CLAVE = "ice-cierres-pendientes";

type Estado = "pendiente" | "listo" | "saltado";

/** Lo que el buscador encontró para una línea del reporte. */
type Busqueda = {
  punto: { lat: number; lng: number } | null;
  diagnostico: Diagnostico;
  detalle: string;
};

type Cierre = { texto: string; nombre: string; estado: Estado; busqueda?: Busqueda };

/** Cómo se lee cada diagnóstico en la fila. */
const SENAS: Record<Diagnostico, { icono: string; clase: string; texto: string }> = {
  encontrada: { icono: "📍", clase: "text-emerald-300", texto: "encontrada" },
  dudosa: { icono: "⚠️", clase: "text-amber-300", texto: "revisar" },
  ambigua: { icono: "⚠️", clase: "text-amber-300", texto: "revisar" },
  sin_via: { icono: "✗", clase: "text-rose-300", texto: "sin datos" },
  sin_cruce: { icono: "✗", clase: "text-rose-300", texto: "sin datos" },
};

/**
 * "CALLE 5 CON CARRERA 42" → "Calle 5 con Carrera 42".
 *
 * Los reportes vienen en mayúsculas y así no se pueden leer de un vistazo en un
 * marcador. Los nomencladores con letra —5N, 28D, 72W— conservan la mayúscula
 * porque forman parte del nombre de la vía: la 72W no es la 72.
 */
function titular(linea: string): string {
  return linea
    .split(/\s+/)
    .map((palabra) => {
      if (/^\d+[a-z]*$/i.test(palabra)) return palabra.toUpperCase();
      if (/^(con|entre|y|de|del|la|el)$/i.test(palabra)) return palabra.toLowerCase();
      return palabra.charAt(0).toUpperCase() + palabra.slice(1).toLowerCase();
    })
    .join(" ");
}

/** Cada línea con contenido es un cierre. Se ignoran viñetas y numeración. */
function interpretar(texto: string): Cierre[] {
  const vistos = new Set<string>();
  const cierres: Cierre[] = [];

  for (const cruda of texto.split("\n")) {
    const linea = cruda.replace(/^[\s•·\-–—*\d.)]+/, "").trim();
    if (linea.length < 4) continue;

    const clave = linea.toUpperCase().replace(/\s+/g, " ");
    if (vistos.has(clave)) continue;
    vistos.add(clave);

    cierres.push({ texto: clave, nombre: titular(clave), estado: "pendiente" });
  }

  return cierres;
}

export default function CierresViales({
  puntos,
  ocupado,
  onColocar,
  onRecargar,
}: {
  /** Los cierres que ya están en el mapa, para no repetirlos. */
  puntos: PuntoMapa[];
  ocupado: boolean;
  onColocar: (nombre: string, texto: string, lat: number, lng: number) => Promise<void>;
  onRecargar: () => void;
}) {
  const [pegado, setPegado] = useState("");
  const [cierres, setCierres] = useState<Cierre[]>([]);
  const [aviso, setAviso] = useState<string | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [guardando, setGuardando] = useState<number | null>(null);

  // La lista sobrevive a un refresco. Quedarse sin ella en el cierre quince de
  // dieciocho, con el reporte ya cerrado en el teléfono, es la clase de detalle
  // que hace que una herramienta se abandone a la mitad.
  //
  // Va en un efecto y no en el estado inicial por lo mismo que en `page.tsx`:
  // la página se prerrenderiza y el servidor no puede leer el almacenamiento
  // del navegador, así que hacerlo durante el render rompería la hidratación.
  useEffect(() => {
    try {
      const guardado = window.localStorage.getItem(CLAVE);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (guardado) setCierres(JSON.parse(guardado) as Cierre[]);
    } catch {
      // Un almacenamiento lleno o bloqueado no puede impedir cargar cierres.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(CLAVE, JSON.stringify(cierres));
    } catch {
      // Igual que arriba: se pierde la persistencia, no la sesión de trabajo.
    }
  }, [cierres]);

  const siguiente = useMemo(() => cierres.findIndex((c) => c.estado === "pendiente"), [cierres]);
  const actual = siguiente >= 0 ? cierres[siguiente] : null;
  const hechos = cierres.filter((c) => c.estado === "listo").length;

  const pendientes = useMemo(
    () => cierres.filter((c) => c.estado === "pendiente"),
    [cierres],
  );

  /** Las que se pueden guardar en bloque: sólo las que no dejaron ninguna duda. */
  const seguras = useMemo(
    () => pendientes.filter((c) => c.busqueda?.diagnostico === "encontrada" && c.busqueda.punto),
    [pendientes],
  );

  const propuestas: PropuestaMapa[] = useMemo(
    () =>
      pendientes
        .filter((c) => c.busqueda?.punto)
        .map((c) => ({
          clave: c.texto,
          lat: c.busqueda!.punto!.lat,
          lng: c.busqueda!.punto!.lng,
          etiqueta: c.nombre,
          dudosa: c.busqueda!.diagnostico !== "encontrada",
        })),
    [pendientes],
  );

  function cargar() {
    const nuevos = interpretar(pegado);
    if (nuevos.length === 0) {
      setAviso("No se reconoció ninguna línea. Pega una dirección por renglón.");
      return;
    }
    // Lo que ya se cargó antes no vuelve a la fila: el reporte de las 3 p. m.
    // repite casi entero el de las 11 a. m.
    const yaEnMapa = new Set(
      puntos.map((p) => (p.direccion ?? p.nombre).toUpperCase().replace(/\s+/g, " ")),
    );
    setCierres(
      nuevos.map((c) => (yaEnMapa.has(c.texto) ? { ...c, estado: "listo" as Estado } : c)),
    );
    setPegado("");
    setAviso(
      yaEnMapa.size > 0
        ? `${nuevos.length} cierres en la lista. Los que ya estaban en el mapa quedan marcados.`
        : `${nuevos.length} cierres en la lista.`,
    );
  }

  /**
   * Busca todas las esquinas pendientes de una sola vez.
   *
   * La consulta sale del navegador de quien modera y no del servidor, que es
   * donde hay salida a internet abierta: la misma por la que ya bajan las
   * teselas del mapa.
   */
  async function buscar() {
    if (buscando || pendientes.length === 0) return;
    setBuscando(true);
    setAviso("Buscando las esquinas en OpenStreetMap…");

    try {
      const hallazgos = await buscarEsquinas(
        pendientes.map((c) => c.texto),
        (candidatos) => bajarVias(candidatos),
      );

      let encontradas = 0;
      let dudosas = 0;
      let fallidas = 0;

      setCierres((cs) =>
        cs.map((c) => {
          if (c.estado !== "pendiente") return c;
          const h = hallazgos.get(c.texto);
          if (!h) return c;

          if (h.punto && h.diagnostico === "encontrada") encontradas += 1;
          else if (h.punto) dudosas += 1;
          else fallidas += 1;

          return {
            ...c,
            busqueda: {
              punto: h.punto ? { lat: h.punto.lat, lng: h.punto.lng } : null,
              diagnostico: h.diagnostico,
              detalle: h.detalle,
            },
          };
        }),
      );

      const partes = [`${encontradas} encontradas`];
      if (dudosas > 0) partes.push(`${dudosas} por revisar`);
      if (fallidas > 0) partes.push(`${fallidas} sin datos, señálalas a mano`);
      setAviso(`${partes.join(", ")}. Míralas en el mapa antes de guardar.`);
    } catch (e) {
      setAviso(e instanceof Error ? e.message : "No se pudo consultar OpenStreetMap.");
    } finally {
      setBuscando(false);
    }
  }

  /**
   * Guarda un cierre que ya tiene una esquina propuesta. Devuelve si quedó
   * guardado, en vez de lanzar: el guardado en bloque necesita saber cuántas
   * alcanzaron a pasar, y una excepción suelta desde un manejador de clic no
   * la recoge nadie.
   */
  async function confirmar(indice: number): Promise<boolean> {
    const c = cierres[indice];
    if (!c?.busqueda?.punto || ocupado) return false;
    try {
      await onColocar(c.nombre, c.texto, c.busqueda.punto.lat, c.busqueda.punto.lng);
      setCierres((cs) =>
        cs.map((x, i) => (i === indice ? { ...x, estado: "listo", busqueda: undefined } : x)),
      );
      return true;
    } catch (e) {
      setAviso(e instanceof Error ? e.message : "No se pudo guardar el punto.");
      return false;
    }
  }

  /**
   * Guarda de un golpe las que no dejaron dudas. Van una por una y en orden
   * porque si una falla —la sesión de moderación caducó, se cayó la red— hay
   * que poder decir cuántas alcanzaron a quedar.
   */
  async function guardarSeguras() {
    if (guardando !== null || ocupado) return;
    const objetivo = seguras.map((c) => c.texto);
    let listas = 0;

    for (const texto of objetivo) {
      setGuardando(listas);
      const indice = cierres.findIndex((c) => c.texto === texto);
      if (indice < 0) continue;

      if (await confirmar(indice)) {
        listas += 1;
        continue;
      }

      // La primera que falla detiene el resto: si la sesión de moderación
      // caducó o se cayó la red, las siguientes van a fallar igual y lo único
      // que se logra es no saber en qué quedó todo.
      setAviso(`Se guardaron ${listas} de ${objetivo.length}. Las demás siguen en la lista.`);
      setGuardando(null);
      return;
    }

    setGuardando(null);
    setAviso(`${listas} cierres guardados.`);
  }

  async function alTocarMapa(lat: number, lng: number) {
    if (!actual || ocupado) return;
    try {
      await onColocar(actual.nombre, actual.texto, lat, lng);
      setCierres((cs) =>
        cs.map((c, i) => (i === siguiente ? { ...c, estado: "listo", busqueda: undefined } : c)),
      );
      setAviso(null);
    } catch (e) {
      setAviso(e instanceof Error ? e.message : "No se pudo guardar el punto.");
    }
  }

  function marcar(i: number, estado: Estado) {
    setCierres((cs) => cs.map((c, j) => (j === i ? { ...c, estado } : c)));
  }

  const enProceso = buscando || guardando !== null || ocupado;

  return (
    <div className="space-y-4">
      {cierres.length === 0 ? (
        <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
          <h2 className="mb-1 text-base font-semibold text-slate-100">
            Cargar el reporte de cierres viales
          </h2>
          <p className="mb-3 text-sm text-slate-400">
            Pega el listado tal como lo publica la Secretaría de Movilidad, una
            dirección por renglón. Después se buscan las esquinas y tú las
            confirmas.
          </p>
          <textarea
            value={pegado}
            onChange={(e) => setPegado(e.target.value)}
            rows={8}
            placeholder={"CALLE 5 CON CARRERA 42\nCALLE 6 CON CARRERA 44\nAVENIDA 5N CON CALLE 67"}
            className="campo mb-3 font-mono text-sm"
          />
          <button onClick={cargar} className="btn-grande btn-entrar">
            Preparar la lista
          </button>
        </section>
      ) : (
        <>
          <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 className="text-base font-semibold text-slate-100">
                {actual ? "Señala esta esquina en el mapa" : "Listado terminado"}
              </h2>
              <span className="shrink-0 text-sm text-slate-400">
                {hechos} de {cierres.length}
              </span>
            </div>

            {actual ? (
              <>
                <p className="rounded-lg border border-amber-600/50 bg-amber-950/60 p-3 text-lg font-semibold text-amber-100">
                  🚧 {actual.nombre}
                </p>
                <p className="mt-2 text-sm text-slate-400">
                  {actual.busqueda?.punto
                    ? "Ya hay una esquina propuesta en el mapa. Confírmala si está bien, o toca el punto correcto para corregirla."
                    : "Toca el punto exacto del mapa. Se guarda como fuente oficial, así que no lo tumba una votación."}
                </p>

                <div className="mt-3 flex flex-wrap gap-2">
                  {actual.busqueda?.punto && (
                    <button
                      onClick={() => void confirmar(siguiente)}
                      disabled={enProceso}
                      className="btn-mini btn-entrar"
                    >
                      Confirmar esta
                    </button>
                  )}
                  <button
                    onClick={() => marcar(siguiente, "saltado")}
                    disabled={enProceso}
                    className="btn-mini btn-llego"
                  >
                    Saltar esta
                  </button>
                </div>
              </>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button onClick={() => setCierres([])} className="btn-mini btn-falta">
                  Empezar otro reporte
                </button>
                <button onClick={onRecargar} className="btn-mini btn-llego">
                  Actualizar el mapa
                </button>
              </div>
            )}
          </section>

          {pendientes.length > 0 && (
            <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => void buscar()}
                  disabled={enProceso}
                  className="btn-mini btn-entrar"
                >
                  {buscando ? "Buscando…" : "Buscar las esquinas"}
                </button>
                {seguras.length > 0 && (
                  <button
                    onClick={() => void guardarSeguras()}
                    disabled={enProceso}
                    className="btn-mini btn-llego"
                  >
                    {guardando !== null
                      ? `Guardando ${guardando + 1} de ${seguras.length}…`
                      : `Guardar las ${seguras.length} encontradas`}
                  </button>
                )}
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Las esquinas se buscan en OpenStreetMap desde este navegador. Las
                que salen con ⚠️ o ✗ hay que mirarlas: se señalan a mano tocando
                el mapa.
              </p>
            </section>
          )}

          {/* El mapa no se reinicia entre esquina y esquina: cargar dieciocho
              cierres del centro sería insoportable si volviera a Cali entera
              después de cada toque. */}
          <div className="h-[420px] overflow-hidden rounded-xl border border-slate-800">
            <Mapa
              puntos={puntos}
              calor={[]}
              mostrarCalor={false}
              onSeleccionar={() => {}}
              onClicMapa={(lat, lng) => void alTocarMapa(lat, lng)}
              destino={null}
              propuestas={propuestas}
            />
          </div>

          <ul className="space-y-1.5">
            {cierres.map((c, i) => {
              const sena = c.estado === "pendiente" && c.busqueda ? SENAS[c.busqueda.diagnostico] : null;
              return (
                <li
                  key={c.texto}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                    c.estado === "listo"
                      ? "border-emerald-600/40 bg-emerald-500/10 text-emerald-200"
                      : c.estado === "saltado"
                        ? "border-slate-700 bg-slate-900/60 text-slate-500"
                        : i === siguiente
                          ? "border-amber-600/50 bg-amber-950/40 text-amber-100"
                          : "border-slate-800 text-slate-300"
                  }`}
                >
                  <span aria-hidden>
                    {c.estado === "listo"
                      ? "✓"
                      : c.estado === "saltado"
                        ? "—"
                        : (sena?.icono ?? "🚧")}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{c.nombre}</span>

                  {sena && (
                    <span className={`shrink-0 text-xs ${sena.clase}`} title={c.busqueda?.detalle}>
                      {c.busqueda?.detalle || sena.texto}
                    </span>
                  )}
                  {c.estado === "pendiente" && c.busqueda?.punto && i !== siguiente && (
                    <button
                      onClick={() => void confirmar(i)}
                      disabled={enProceso}
                      className="shrink-0 text-xs text-emerald-300 underline"
                    >
                      usar
                    </button>
                  )}
                  {c.estado !== "pendiente" && (
                    <button
                      onClick={() => marcar(i, "pendiente")}
                      className="shrink-0 text-xs text-slate-400 underline"
                    >
                      {c.estado === "listo" ? "cargar otra vez" : "recuperar"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {aviso && (
        <p className="rounded-xl border border-slate-700 bg-slate-800/80 p-3 text-sm text-slate-200">
          {aviso}
        </p>
      )}
    </div>
  );
}
