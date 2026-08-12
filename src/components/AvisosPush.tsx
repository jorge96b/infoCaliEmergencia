"use client";

import { useEffect, useState } from "react";

import { activarPush, desactivarPush, estadoPush, pushConfigurado } from "@/lib/push";
import type { EstadoPush } from "@/lib/tipos";

/**
 * Interruptor de las notificaciones.
 *
 * Vive dentro de la hoja de avisos porque es donde la gente ya viene a buscar
 * "qué hay de nuevo", y porque el permiso conviene pedirlo cuando alguien está
 * mirando esto y no nada más abrir la app, que es el momento en que más gente
 * lo deniega para siempre — y una denegación en Chrome no se puede volver a
 * pedir desde la página.
 *
 * Dice lo que hace con la ubicación en la propia pantalla y no en una política
 * de privacidad. Es la única parte de la app que manda al servidor algo sobre
 * dónde está quien la usa, y quien lo activa tiene derecho a saberlo ahí mismo.
 */
export default function AvisosPush() {
  const [estado, setEstado] = useState<EstadoPush | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pushConfigurado) return;
    let vivo = true;
    void estadoPush().then((e) => {
      if (vivo) setEstado(e);
    });
    return () => {
      vivo = false;
    };
  }, []);

  // Sin claves VAPID en el despliegue no hay push posible: mejor no enseñar un
  // interruptor que no puede funcionar.
  if (!pushConfigurado || estado === null) return null;

  async function alternar(activar: boolean) {
    setOcupado(true);
    setError(null);
    try {
      setEstado(activar ? await activarPush() : await desactivarPush());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }

  if (estado === "no_soportado") return null;

  if (estado === "requiere_instalar") {
    return (
      <Caja>
        <p className="font-medium text-slate-200">🔔 Avisos en el teléfono</p>
        <p className="mt-1 text-slate-400">
          En iPhone y iPad hay que añadir la app a la pantalla de inicio para poder
          recibirlos. Toca <b className="text-slate-300">Compartir</b> y luego{" "}
          <b className="text-slate-300">Añadir a pantalla de inicio</b>.
        </p>
      </Caja>
    );
  }

  if (estado === "denegado") {
    return (
      <Caja>
        <p className="font-medium text-slate-200">🔕 Avisos bloqueados</p>
        <p className="mt-1 text-slate-400">
          Este navegador tiene los avisos bloqueados para el sitio. Se vuelven a
          permitir desde el candado de la barra de direcciones; desde aquí ya no se
          puede volver a preguntar.
        </p>
      </Caja>
    );
  }

  const activo = estado === "activo";

  return (
    <Caja>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-slate-200">
            {activo ? "🔔 Avisos activados" : "🔔 Avisos en el teléfono"}
          </p>
          <p className="mt-1 text-slate-400">
            {activo
              ? "Recibirás lo oficial y las alertas nuevas cerca de ti, aunque tengas la app cerrada."
              : "Te avisamos de lo que publique la Alcaldía y de las alertas nuevas cerca de ti, aunque tengas la app cerrada."}
          </p>
        </div>
        <button
          onClick={() => void alternar(!activo)}
          disabled={ocupado}
          className={`btn-mini shrink-0 ${
            activo
              ? "border border-slate-600 bg-slate-800 text-slate-200"
              : "bg-sky-600 text-white"
          }`}
        >
          {ocupado ? "…" : activo ? "Desactivar" : "Activar"}
        </button>
      </div>

      {activo && (
        <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
          Para saber qué te queda cerca guardamos tu ubicación redondeada a un
          kilómetro, y sólo mientras esto esté activado. La posición exacta se queda
          en tu teléfono. Toca ◎ en el mapa para actualizarla.
        </p>
      )}

      {error && (
        <p className="mt-2 text-xs text-amber-300">No se pudo cambiar: {error}</p>
      )}
    </Caja>
  );
}

function Caja({ children }: { children: React.ReactNode }) {
  return (
    <section className="mb-4 rounded-xl border border-slate-700 bg-slate-800/60 p-3 text-sm">
      {children}
    </section>
  );
}
