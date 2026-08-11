"use client";

import { useState } from "react";
import { haceCuanto } from "@/lib/formato";
import type { Global } from "@/lib/tipos";

export default function BarraGlobal({ datos }: { datos: Global | null }) {
  const [abierto, setAbierto] = useState(false);

  if (!datos) return null;

  const cifras: [string, number][] = [
    ["Puntos", datos.puntos_activos],
    ["Personas", datos.personas_en_terreno],
    ["Desaparecidas", datos.desaparecidos],
    ["Heridas", datos.heridos],
    ["Rescatadas", datos.rescatados],
  ];

  return (
    <div className="barra-global">
      <button
        onClick={() => setAbierto((v) => !v)}
        className="flex w-full items-center gap-3 px-3 py-2 text-left"
        aria-expanded={abierto}
      >
        <div className="flex flex-1 gap-3 overflow-x-auto">
          {cifras.map(([texto, valor]) => (
            <div key={texto} className="shrink-0">
              <div className="text-base font-bold leading-none text-slate-50">{valor}</div>
              <div className="text-[11px] leading-tight text-slate-400">{texto}</div>
            </div>
          ))}
        </div>
        <span className="text-slate-500">{abierto ? "▲" : "▼"}</span>
      </button>

      {abierto && (
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
            Información reportada por la comunidad, sin verificación oficial. No
            reemplaza a la línea 123 ni a los organismos de socorro.
          </p>
        </div>
      )}
    </div>
  );
}
