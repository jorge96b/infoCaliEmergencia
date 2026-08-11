"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import BarraGlobal from "@/components/BarraGlobal";
import CrearPunto from "@/components/CrearPunto";
import EstadoConexion from "@/components/EstadoConexion";
import Filtros from "@/components/Filtros";
import HojaPunto from "@/components/HojaPunto";
import ListaPuntos from "@/components/ListaPuntos";
import { arrancarCola } from "@/lib/cola";
import { cargarCatalogos, cargarInstantanea, miPresencia } from "@/lib/datos";
import { idDispositivo } from "@/lib/dispositivo";
import { aplicarFiltros, FILTROS_VACIOS, type FiltrosPuntos } from "@/lib/filtros";
import { latido } from "@/lib/reportes";
import { configurado } from "@/lib/supabase";
import type { Instantanea, PuntoMapa, Recurso, TipoPunto } from "@/lib/tipos";

// Leaflet toca `window` al cargar, así que el mapa no puede renderizarse en el
// servidor.
const Mapa = dynamic(() => import("@/components/Mapa"), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-slate-500">Cargando mapa…</div>,
});

const REFRESCO_MS = 20_000;
const LATIDO_MS = 5 * 60_000;

export default function Pagina() {
  const [datos, setDatos] = useState<Instantanea>({ puntos: [], calor: [], global: null });
  const [tipos, setTipos] = useState<TipoPunto[]>([]);
  const [recursos, setRecursos] = useState<Recurso[]>([]);
  // El punto abierto se siembra desde `?p=<id>` en el primer render (enlace
  // profundo), sin un efecto que lo corrija después. La hoja se abrirá sola en
  // cuanto ese punto llegue en la instantánea.
  const [seleccionado, setSeleccionado] = useState<string | null>(() =>
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("p"),
  );
  const [colocando, setColocando] = useState(false);
  const [nuevoLugar, setNuevoLugar] = useState<{ lat: number; lng: number } | null>(null);
  const [presenciaEn, setPresenciaEn] = useState<string | null>(null);
  const [mostrarCalor, setMostrarCalor] = useState(true);
  const [destino, setDestino] = useState<[number, number] | null>(null);
  // Última ubicación conocida de la persona. Se usa para volar el mapa y para
  // ordenar la lista por cercanía; sólo se llena cuando toca "Ubicarme".
  const [ubicacion, setUbicacion] = useState<[number, number] | null>(null);
  const [vista, setVista] = useState<"mapa" | "lista">("mapa");
  const [filtros, setFiltros] = useState<FiltrosPuntos>(FILTROS_VACIOS);
  const [busqueda, setBusqueda] = useState("");
  const [mostrarFiltros, setMostrarFiltros] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  // Sin Supabase configurado no hay nada que cargar, así que el estado inicial
  // se deriva en vez de corregirse dentro de un efecto.
  const [cargando, setCargando] = useState(configurado);

  const refrescando = useRef(false);

  /** Devuelve la instantánea recién leída, o null si no se pudo. */
  const refrescar = useCallback(async (): Promise<Instantanea | null> => {
    if (refrescando.current) return null;
    refrescando.current = true;
    try {
      const nuevo = await cargarInstantanea();
      setDatos(nuevo);
      setError(null);
      return nuevo;
    } catch (e) {
      // Con mala señal, un error transitorio no debe borrar de la pantalla los
      // datos que ya se estaban viendo, así que sólo se avisa y se reintenta.
      //
      // El detalle va incluido a propósito: decir sólo "sin conexión" hizo que un
      // fallo del service worker se confundiera durante un buen rato con un
      // problema de señal que no existía.
      const detalle = e instanceof Error ? e.message : String(e);
      setError(`No se pudo leer del servidor. Reintentando… (${detalle})`);
      return null;
    } finally {
      refrescando.current = false;
      setCargando(false);
    }
  }, []);

  // Los catálogos son lo único sin lo que la app queda inservible: sin ellos no
  // hay tipos de lugar que elegir ni recursos que reportar. Por eso se
  // reintentan en cada ciclo mientras falten, en vez de rendirse tras el primer
  // intento y dejar la app a medias hasta que alguien la recargue.
  const catalogosListos = useRef(false);

  const asegurarCatalogos = useCallback(async () => {
    if (catalogosListos.current) return;
    try {
      const cat = await cargarCatalogos();
      if (cat.tipos.length === 0 || cat.recursos.length === 0) return;
      setTipos(cat.tipos);
      setRecursos(cat.recursos);
      catalogosListos.current = true;
    } catch {
      // Se reintenta en el siguiente ciclo; el detalle del fallo lo da `refrescar`.
    }
  }, []);

  useEffect(() => {
    if (!configurado) return;

    let vivo = true;
    (async () => {
      await asegurarCatalogos();
      await refrescar();
      if (vivo) setPresenciaEn(await miPresencia(idDispositivo()));
    })();

    const ciclo = () => {
      void asegurarCatalogos();
      void refrescar();
    };
    const reloj = setInterval(ciclo, REFRESCO_MS);
    // El puntaje de cada necesidad cambia con el paso del tiempo aunque no
    // entren datos nuevos, así que refrescar por reloj no es opcional.
    const alVolver = () => {
      if (document.visibilityState === "visible") ciclo();
    };
    document.addEventListener("visibilitychange", alVolver);

    return () => {
      vivo = false;
      clearInterval(reloj);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [refrescar, asegurarCatalogos]);

  // Service worker y bandeja de salida. Van juntos y sin depender de que
  // Supabase esté configurado: el objetivo es que la app siga sirviendo aunque
  // la red se caiga a mitad de uso.
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .then(async () => {
          const registro = await navigator.serviceWorker.ready;
          // La página sabe exactamente qué recursos cargó, incluidos los
          // fragmentos que se piden dinámicamente (el mapa, entre otros) y que
          // el service worker no llegó a ver porque se activó después. Se los
          // pasa para que los guarde y la app pueda abrirse sin señal.
          registro.active?.postMessage({
            tipo: "precalentar",
            urls: performance
              .getEntriesByType("resource")
              .map((r) => r.name)
              .filter((u) => u.includes("/_next/static/")),
          });
        })
        .catch(() => {
          // Sin service worker la app funciona igual, sólo pierde el modo offline.
        });
    }
    return arrancarCola();
  }, []);

  // Mantener la URL en sincronía con el punto abierto, para que se pueda copiar
  // y compartir el enlace a un punto concreto.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (seleccionado) url.searchParams.set("p", seleccionado);
    else url.searchParams.delete("p");
    window.history.replaceState(null, "", url);
  }, [seleccionado]);

  // Mantener viva la sesión de presencia mientras la app esté abierta.
  useEffect(() => {
    if (!presenciaEn) return;
    const reloj = setInterval(() => void latido(), LATIDO_MS);
    return () => clearInterval(reloj);
  }, [presenciaEn]);

  const trasCambio = useCallback(async () => {
    await refrescar();
    setPresenciaEn(await miPresencia(idDispositivo()));
  }, [refrescar]);

  function ubicarme() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const aqui: [number, number] = [pos.coords.latitude, pos.coords.longitude];
        setUbicacion(aqui);
        setDestino(aqui);
      },
      () => setError("No pudimos obtener tu ubicación. Puedes tocar el mapa a mano."),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  // Los filtros se aplican una sola vez y alimentan tanto el mapa como la lista,
  // para que ambas vistas muestren siempre el mismo subconjunto.
  const puntosFiltrados = useMemo(
    () => aplicarFiltros(datos.puntos, filtros, busqueda),
    [datos.puntos, filtros, busqueda],
  );

  const seleccionar = useCallback((p: PuntoMapa) => {
    setColocando(false);
    setSeleccionado(p.id);
  }, []);

  if (!configurado) {
    return (
      <main className="mx-auto max-w-lg p-6 text-slate-200">
        <h1 className="mb-3 text-xl font-semibold">Falta configurar Supabase</h1>
        <p className="mb-4 text-slate-400">
          Copia <code className="text-slate-200">.env.example</code> a{" "}
          <code className="text-slate-200">.env.local</code> y llena las dos variables
          con los datos de tu proyecto. Luego reinicia el servidor.
        </p>
        <p className="text-slate-400">
          Las instrucciones completas están en el <code className="text-slate-200">README.md</code>.
        </p>
      </main>
    );
  }

  // La hoja de un punto se abre desde la lista completa (no la filtrada) para que
  // un enlace profundo o un punto ya abierto no desaparezca al filtrar.
  const punto = datos.puntos.find((p) => p.id === seleccionado) ?? null;
  const hojaAbierta = !!punto || !!nuevoLugar || mostrarFiltros;

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-slate-950">
      <BarraGlobal datos={datos.global} />

      {/* El mapa no se desmonta al pasar a la lista. Recrearlo perdía el zoom y
          la posición, y volvía a pedir todas las teselas: caro con mala señal y
          justo el tipo de tráfico que la política de uso de OpenStreetMap pide
          evitar. La lista es opaca, así que basta con ponerla encima. */}
      <div
        className="absolute inset-0"
        aria-hidden={vista === "lista"}
        inert={vista === "lista"}
      >
        <Mapa
          puntos={puntosFiltrados}
          calor={datos.calor}
          mostrarCalor={mostrarCalor}
          destino={destino}
          onSeleccionar={seleccionar}
          onClicMapa={(lat, lng) => {
            if (colocando) {
              setNuevoLugar({ lat, lng });
              setColocando(false);
            }
          }}
        />
      </div>

      {vista === "lista" && (
        <div className="lista">
          <ListaPuntos
            puntos={puntosFiltrados}
            ubicacion={ubicacion}
            onSeleccionar={seleccionar}
          />
        </div>
      )}

      <EstadoConexion />

      {colocando && (
        <div className="banner" role="status" aria-live="polite">
          Toca en el mapa el lugar exacto.
          <button onClick={() => setColocando(false)} className="ml-3 underline">
            Cancelar
          </button>
        </div>
      )}

      {mensaje && (
        <div className="banner" role="status" aria-live="polite">
          {mensaje}
        </div>
      )}

      {error && !colocando && !mensaje && (
        <div className="banner banner-error" role="alert" aria-live="assertive">
          {error}
        </div>
      )}

      {cargando && (
        <div className="banner" role="status" aria-live="polite">
          Cargando información…
        </div>
      )}

      {!hojaAbierta && (
        <div className="controles">
          <button
            onClick={() => setVista((v) => (v === "mapa" ? "lista" : "mapa"))}
            className="btn-flotante"
            aria-label={vista === "mapa" ? "Ver como lista" : "Ver el mapa"}
            aria-pressed={vista === "lista"}
          >
            {vista === "mapa" ? "☰" : "🗺️"}
          </button>
          <button
            onClick={() => setMostrarFiltros(true)}
            className={`btn-flotante ${
              filtros.tipos.size > 0 || filtros.soloCriticos || busqueda.trim() !== ""
                ? "btn-flotante-activo"
                : ""
            }`}
            aria-label="Filtrar y buscar"
          >
            🔍
          </button>
          {vista === "mapa" && (
            <>
              <button onClick={ubicarme} className="btn-flotante" aria-label="Ubicarme">
                ◎
              </button>
              <button
                onClick={() => setMostrarCalor((v) => !v)}
                className={`btn-flotante ${mostrarCalor ? "btn-flotante-activo" : ""}`}
                aria-label="Mapa de calor"
                aria-pressed={mostrarCalor}
              >
                🔥
              </button>
            </>
          )}
          <button
            onClick={() => {
              setVista("mapa");
              setColocando(true);
            }}
            className="btn-fab"
          >
            ＋ Marcar lugar
          </button>
        </div>
      )}

      {mostrarFiltros && (
        <Filtros
          tipos={tipos}
          filtros={filtros}
          busqueda={busqueda}
          total={datos.puntos.length}
          mostrados={puntosFiltrados.length}
          onFiltros={setFiltros}
          onBusqueda={setBusqueda}
          onCerrar={() => setMostrarFiltros(false)}
        />
      )}

      {punto && (
        <HojaPunto
          punto={punto}
          recursos={recursos}
          aqui={presenciaEn === punto.id}
          onCerrar={() => setSeleccionado(null)}
          onCambio={trasCambio}
        />
      )}

      {nuevoLugar && (
        <CrearPunto
          lat={nuevoLugar.lat}
          lng={nuevoLugar.lng}
          tipos={tipos}
          onCerrar={() => setNuevoLugar(null)}
          onCreado={async (id) => {
            setNuevoLugar(null);
            const nuevo = await refrescar();
            setSeleccionado(id);
            // El lugar ya quedó guardado en el servidor. Si el refresco falló, no
            // estará en el mapa todavía y la hoja no se abrirá: hay que decirlo,
            // porque si no parece que la creación no funcionó y la persona la
            // repite hasta chocar contra el límite de cinco por hora.
            if (!nuevo?.puntos.some((p) => p.id === id)) {
              setMensaje("Lugar marcado. Aparecerá en el mapa en cuanto responda el servidor.");
              setTimeout(() => setMensaje(null), 6000);
            }
          }}
        />
      )}
    </main>
  );
}
