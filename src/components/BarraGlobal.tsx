"use client";

import { useState } from "react";
import { haceCuanto } from "@/lib/formato";
import type { Global } from "@/lib/tipos";

export default function BarraGlobal({
  datos,
  sinLeer,
  onAvisos,
}: {
  datos: Global | null;
  /** Avisos oficiales que esta persona todavía no ha abierto. */
  sinLeer: number;
  onAvisos: () => void;
}) {
  const [abierto, setAbierto] = useState(false);

  const cifras: [string, number][] = datos
    ? [
        ["Puntos", datos.puntos_activos],
        ["Personas", datos.personas_en_terreno],
        ["Desaparecidas", datos.desaparecidos],
        ["Heridas", datos.heridos],
        ["Rescatadas", datos.rescatados],
      ]
    : [];

  return (
    <div className="barra-global">
      <div className="flex items-stretch">
        {/* La campana va aquí arriba y no entre los controles del mapa: la fila
            de abajo ya iba al límite del ancho en pantallas de 360 px, y las
            notificaciones son información de ciudad, que es de lo que habla
            esta barra. */}
        <button
          onClick={onAvisos}
          className="relative grid w-12 shrink-0 place-items-center text-lg"
          aria-label={
            sinLeer > 0
              ? `Información oficial, ${sinLeer} sin leer`
              : "Información oficial"
          }
        >
          <span aria-hidden>🔔</span>
          {sinLeer > 0 && (
            <span
              aria-hidden
              className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-slate-900"
            />
          )}
        </button>

        <button
          onClick={() => setAbierto((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-3 py-2 pr-3 text-left"
          aria-expanded={abierto}
          disabled={!datos}
        >
          <div className="flex flex-1 gap-3 overflow-x-auto">
            {datos ? (
              cifras.map(([texto, valor]) => (
                <div key={texto} className="shrink-0">
                  <div className="text-base font-bold leading-none text-slate-50">{valor}</div>
                  <div className="text-[11px] leading-tight text-slate-400">{texto}</div>
                </div>
              ))
            ) : (
              <span className="text-sm text-slate-500">Cargando cifras…</span>
            )}
          </div>

          {/* Fuera de la franja que hace scroll y anclada a la derecha.
              Dentro quedaba cortada por el borde en cuanto la fila se llenaba
              —que es siempre, ya iba al límite en pantallas de 360 px— y una
              cifra que hay que ir a buscar arrastrando no la ve nadie.
              Separada por una línea porque no es una cifra de la emergencia
              sino del pulso de la app: mezclarla entre las personas
              desaparecidas o heridas le quitaría gravedad a esas. */}
          {datos && (
            <div className="shrink-0 border-l border-slate-800 pl-3">
              <div className="flex items-center gap-1.5">
                <span aria-hidden className="punto-vivo" />
                <span className="text-base font-bold leading-none text-slate-50">
                  {datos.personas_en_linea}
                </span>
              </div>
              <div className="text-[11px] leading-tight text-slate-400">En línea</div>
            </div>
          )}
          {datos && <span className="text-slate-500">{abierto ? "▲" : "▼"}</span>}
        </button>
      </div>

      {abierto && datos && (
        <div className="border-t border-slate-800 px-3 py-3">
          <p className="mb-2 text-xs text-slate-400">
            Lo más pedido en toda la ciudad · actualizado {haceCuanto(datos.generado_en)}
          </p>
          {datos.top_necesidades && datos.top_necesidades.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {datos.top_necesidades.map((n) => (
                <li
                  key={n.recurso}
                  className="chip border-slate-700 bg-slate-800 text-slate-200"
                >
                  {n.emoji} {n.etiqueta}
                  {n.puntos_criticos > 0 && (
                    <b className="ml-1 text-red-300">{n.puntos_criticos}</b>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">Todavía no hay necesidades reportadas.</p>
          )}
          <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
            <b className="text-slate-400">
              {datos.personas_en_linea}{" "}
              {datos.personas_en_linea === 1 ? "persona tiene" : "personas tienen"}
            </b>{" "}
            la app abierta en los últimos 10 minutos. Es distinto de las{" "}
            {datos.personas_en_terreno} que se marcaron presentes en un punto.
          </p>
          <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
            Información reportada por la comunidad, sin verificación oficial. No
            reemplaza a la línea 123 ni a los organismos de socorro.
          </p>
        </div>
      )}
    </div>
  );
}
