"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";

import BarraGlobal from "@/components/BarraGlobal";
import CrearPunto from "@/components/CrearPunto";
import EstadoConexion from "@/components/EstadoConexion";
import HojaPunto from "@/components/HojaPunto";
import { arrancarCola } from "@/lib/cola";
import { cargarCatalogos, cargarInstantanea, miPresencia } from "@/lib/datos";
import { idDispositivo } from "@/lib/dispositivo";
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
  const [seleccionado, setSeleccionado] = useState<string | null>(null);
  const [colocando, setColocando] = useState(false);
  const [nuevoLugar, setNuevoLugar] = useState<{ lat: number; lng: number } | null>(null);
  const [presenciaEn, setPresenciaEn] = useState<string | null>(null);
  const [mostrarCalor, setMostrarCalor] = useState(true);
  const [destino, setDestino] = useState<[number, number] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Sin Supabase configurado no hay nada que cargar, así que el estado inicial
  // se deriva en vez de corregirse dentro de un efecto.
  const [cargando, setCargando] = useState(configurado);

  const refrescando = useRef(false);

  const refrescar = useCallback(async () => {
    if (refrescando.current) return;
    refrescando.current = true;
    try {
      const nuevo = await cargarInstantanea();
      setDatos(nuevo);
      setError(null);
    } catch {
      // Fallar en silencio y reintentar: con mala señal, un error transitorio no
      // debe borrar de la pantalla los datos que ya se estaban viendo.
      setError("Sin conexión con el servidor. Reintentando…");
    } finally {
      refrescando.current = false;
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    if (!configurado) return;

    let vivo = true;
    (async () => {
      try {
        const cat = await cargarCatalogos();
        if (!vivo) return;
        setTipos(cat.tipos);
        setRecursos(cat.recursos);
      } catch {
        if (vivo) setError("No se pudieron cargar los catálogos.");
      }
      await refrescar();
      if (vivo) setPresenciaEn(await miPresencia(idDispositivo()));
    })();

    const reloj = setInterval(refrescar, REFRESCO_MS);
    // El puntaje de cada necesidad cambia con el paso del tiempo aunque no
    // entren datos nuevos, así que refrescar por reloj no es opcional.
    const alVolver = () => {
      if (document.visibilityState === "visible") refrescar();
    };
    document.addEventListener("visibilitychange", alVolver);

    return () => {
      vivo = false;
      clearInterval(reloj);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [refrescar]);

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
      (pos) => setDestino([pos.coords.latitude, pos.coords.longitude]),
      () => setError("No pudimos obtener tu ubicación. Puedes tocar el mapa a mano."),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

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

  const punto = datos.puntos.find((p) => p.id === seleccionado) ?? null;

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-slate-950">
      <BarraGlobal datos={datos.global} />

      <div className="absolute inset-0">
        <Mapa
          puntos={datos.puntos}
          calor={datos.calor}
          mostrarCalor={mostrarCalor}
          destino={destino}
          onSeleccionar={(p: PuntoMapa) => {
            setColocando(false);
            setSeleccionado(p.id);
          }}
          onClicMapa={(lat, lng) => {
            if (colocando) {
              setNuevoLugar({ lat, lng });
              setColocando(false);
            }
          }}
        />
      </div>

      <EstadoConexion />

      {colocando && (
        <div className="banner">
          Toca en el mapa el lugar exacto.
          <button onClick={() => setColocando(false)} className="ml-3 underline">
            Cancelar
          </button>
        </div>
      )}

      {error && !colocando && <div className="banner banner-error">{error}</div>}

      {cargando && (
        <div className="banner">Cargando información…</div>
      )}

      {!punto && !nuevoLugar && (
        <div className="controles">
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
          <button onClick={() => setColocando(true)} className="btn-fab">
            ＋ Marcar lugar
          </button>
        </div>
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
            await refrescar();
            setSeleccionado(id);
          }}
        />
      )}
    </main>
  );
}
