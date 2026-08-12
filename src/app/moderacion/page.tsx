"use client";

import { useCallback, useEffect, useState } from "react";

import AccesoModeracion from "@/components/mod/AccesoModeracion";
import Bitacora from "@/components/mod/Bitacora";
import CierresViales from "@/components/mod/CierresViales";
import PublicarAvisos from "@/components/mod/PublicarAvisos";
import ColaDenuncias from "@/components/mod/ColaDenuncias";
import FichaDispositivo from "@/components/mod/FichaDispositivo";
import SaludModeracion from "@/components/mod/SaludModeracion";
import {
  bloquear,
  cargarBitacora,
  cargarCola,
  cargarFicha,
  cargarSalud,
  decidir,
  salir,
  sesion,
  soyModerador,
  cargarAvisosMod,
  publicarAviso,
  retirarAviso,
  crearPuntoOficial,
  cargarPuntosDeTipo,
} from "@/lib/moderacion";
import { configurado } from "@/lib/supabaseModeracion";
import type {
  Aviso,
  Decision,
  EntradaBitacora,
  Ficha,
  FilaCola,
  FilaDispositivo,
  PuntoMapa,
  Salud,
} from "@/lib/tipos";

const REFRESCO_MS = 30_000;

type Pestana = "cola" | "revisadas" | "avisos" | "cierres" | "bitacora";

export default function PaginaModeracion() {
  const [estado, setEstado] = useState<"cargando" | "fuera" | "sinPermiso" | "dentro">(
    "cargando",
  );
  const [pestana, setPestana] = useState<Pestana>("cola");
  const [cola, setCola] = useState<FilaCola[]>([]);
  const [salud, setSalud] = useState<Salud | null>(null);
  const [bitacora, setBitacora] = useState<EntradaBitacora[]>([]);
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [cierres, setCierres] = useState<PuntoMapa[]>([]);
  const [ficha, setFicha] = useState<{ ficha: Ficha | null; filas: FilaDispositivo[] } | null>(
    null,
  );
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const refrescar = useCallback(async (p: Pestana) => {
    try {
      const [filas, s] = await Promise.all([cargarCola(p === "cola"), cargarSalud()]);
      setCola(filas);
      setSalud(s);
      if (p === "bitacora") setBitacora(await cargarBitacora());
      if (p === "avisos") setAvisos(await cargarAvisosMod());
      if (p === "cierres") setCierres(await cargarPuntosDeTipo("via_bloqueada"));
      setError(null);
    } catch (e) {
      // Mismo criterio que en el mapa: no afirmar una causa que no se conoce, y
      // adjuntar el detalle técnico aunque sea feo. Es la única pista que va a
      // tener quien reporte el problema.
      const detalle = e instanceof Error ? e.message : String(e);
      setError(`No se pudo leer del servidor. (${detalle})`);
    }
  }, []);

  // Comprobar la sesión al abrir. Tener sesión no basta: hay que estar en
  // `moderadores` y activo, y eso lo dice el servidor, no el cliente.
  const comprobar = useCallback(async () => {
    if (!configurado) return;
    const s = await sesion();
    if (!s) {
      setEstado("fuera");
      return;
    }
    if (!(await soyModerador())) {
      setEstado("sinPermiso");
      return;
    }
    setEstado("dentro");
    await refrescar("cola");
  }, [refrescar]);

  // La comprobación va dentro de una función asíncrona, no llamada directamente
  // desde el cuerpo del efecto: así el estado se toca sólo después del `await`,
  // sin encadenar un render con otro.
  useEffect(() => {
    void (async () => {
      await comprobar();
    })();
  }, [comprobar]);

  useEffect(() => {
    if (estado !== "dentro") return;
    const reloj = setInterval(() => void refrescar(pestana), REFRESCO_MS);
    return () => clearInterval(reloj);
  }, [estado, pestana, refrescar]);

  /** Envoltorio común: bloquea, ejecuta, avisa y refresca. */
  async function accion(fn: () => Promise<void>, exito: string) {
    setOcupado(true);
    setAviso(null);
    try {
      await fn();
      setAviso(exito);
      await refrescar(pestana);
    } catch (e) {
      setAviso(e instanceof Error ? e.message : "No se pudo aplicar. Intenta de nuevo.");
    } finally {
      setOcupado(false);
      setTimeout(() => setAviso(null), 4000);
    }
  }

  async function verDispositivo(id: string) {
    setOcupado(true);
    try {
      setFicha(await cargarFicha(id));
    } catch (e) {
      setAviso(e instanceof Error ? e.message : "No se pudo abrir la ficha.");
    } finally {
      setOcupado(false);
    }
  }

  async function cambiarPestana(p: Pestana) {
    setPestana(p);
    await refrescar(p);
  }

  if (!configurado) {
    return (
      <main className="mx-auto max-w-lg p-6 text-slate-200">
        <h1 className="mb-3 text-xl font-semibold">Falta configurar Supabase</h1>
        <p className="text-slate-400">
          Las instrucciones están en el <code className="text-slate-200">README.md</code>.
        </p>
      </main>
    );
  }

  if (estado === "cargando") {
    return <main className="grid h-dvh place-items-center text-slate-500">Comprobando…</main>;
  }

  if (estado === "fuera") {
    return <AccesoModeracion onEntro={() => void comprobar()} />;
  }

  if (estado === "sinPermiso") {
    return (
      <main className="mx-auto max-w-sm p-6 text-slate-200">
        <h1 className="mb-3 text-xl font-semibold">Esta cuenta no modera</h1>
        <p className="mb-4 text-slate-400">
          Entraste bien, pero la cuenta no está en la lista de moderadores. Habla con
          quien administra el proyecto.
        </p>
        <button
          onClick={async () => {
            await salir();
            setEstado("fuera");
          }}
          className="btn-grande btn-salir"
        >
          Salir
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <header className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-slate-50">Moderación</h1>
        <div className="flex gap-2">
          <button
            disabled={ocupado}
            onClick={() => void refrescar(pestana)}
            className="btn-mini btn-llego"
          >
            Actualizar
          </button>
          <button
            onClick={async () => {
              await salir();
              setEstado("fuera");
            }}
            className="btn-mini btn-llego"
          >
            Salir
          </button>
        </div>
      </header>

      <SaludModeracion datos={salud} />

      <nav className="mb-4 flex gap-1 rounded-xl bg-slate-800/60 p-1">
        {(
          [
            ["cola", "Sin revisar"],
            ["revisadas", "Todo"],
            ["avisos", "Avisos"],
            ["cierres", "Cierres"],
            ["bitacora", "Bitácora"],
          ] as [Pestana, string][]
        ).map(([id, texto]) => (
          <button
            key={id}
            onClick={() => void cambiarPestana(id)}
            className={`flex-1 rounded-lg px-2 py-2.5 text-sm font-medium transition ${
              pestana === id ? "bg-slate-700 text-slate-50" : "text-slate-400"
            }`}
          >
            {texto}
          </button>
        ))}
      </nav>

      {error && (
        <p className="mb-4 rounded-xl border border-amber-600/50 bg-amber-950/90 px-3 py-2.5 text-center text-sm text-amber-200">
          {error}
        </p>
      )}

      {pestana === "bitacora" ? (
        <Bitacora entradas={bitacora} />
      ) : pestana === "cierres" ? (
        <CierresViales
          puntos={cierres}
          ocupado={ocupado}
          onColocar={async (nombre, texto, lat, lng) => {
            await crearPuntoOficial({
              nombre,
              tipo: "via_bloqueada",
              lat,
              lng,
              direccion: texto,
            });
            // Se recarga la capa para que el cierre recién puesto salga como
            // marcador: es la comprobación de que quedó donde se quería.
            setCierres(await cargarPuntosDeTipo("via_bloqueada"));
          }}
          onRecargar={() => void refrescar("cierres")}
        />
      ) : pestana === "avisos" ? (
        <PublicarAvisos
          avisos={avisos}
          ocupado={ocupado}
          onPublicar={(a) =>
            void accion(async () => {
              await publicarAviso(a);
            }, "Aviso publicado.")
          }
          onRetirar={(id) =>
            void accion(() => retirarAviso(id), "Aviso retirado.")
          }
        />
      ) : (
        <ColaDenuncias
          filas={cola}
          ocupado={ocupado}
          onVerDispositivo={(id) => void verDispositivo(id)}
          onDecidir={(fila, decision: Decision, motivo) =>
            void accion(
              () => decidir(fila.tabla, fila.fila_id, decision, motivo),
              decision === "oculto" ? "Ocultado." : "Aprobado. Vuelve a estar visible.",
            )
          }
        />
      )}

      {/* `.hoja` es `absolute`; sin este contenedor fijo se posicionaría contra
          el final del documento en vez de contra la pantalla. */}
      {ficha && (
        <div className="fixed inset-0 z-[1000] bg-slate-950/70">
          <FichaDispositivo
            ficha={ficha.ficha}
            filas={ficha.filas}
            ocupado={ocupado}
            onCerrar={() => setFicha(null)}
            onBloquear={(bloqueado, motivo, ocultarTodo) => {
              const id = ficha.ficha?.id;
              if (!id) return;
              setFicha(null);
              void accion(
                () => bloquear(id, bloqueado, motivo, ocultarTodo),
                bloqueado ? "Dispositivo bloqueado." : "Dispositivo desbloqueado.",
              );
            }}
          />
        </div>
      )}

      {aviso && <p className="aviso">{aviso}</p>}
    </main>
  );
}
