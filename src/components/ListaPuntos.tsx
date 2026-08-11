"use client";

import { useMemo } from "react";

import { DEMANDA, estaObsoleto, haceCuanto } from "@/lib/formato";
import { esCritico } from "@/lib/filtros";
import { formatearDistancia, metros } from "@/lib/geo";
import type { PuntoMapa } from "@/lib/tipos";

/**
 * Alternativa textual al mapa: la misma información en una lista navegable con
 * teclado y lector de pantalla, y liviana para conexiones malas. Tocar una
 * tarjeta abre la misma `HojaPunto` que un marcador, así que no duplica lógica.
 */
export default function ListaPuntos({
  puntos,
  ubicacion,
  onSeleccionar,
}: {
  puntos: PuntoMapa[];
  ubicacion: [number, number] | null;
  onSeleccionar: (p: PuntoMapa) => void;
}) {
  // Con ubicación se ordena por cercanía, que es lo que más importa a pie. Sin
  // ella, primero lo crítico y luego lo más reciente, para no enterrar una
  // necesidad urgente bajo puntos viejos.
  const ordenados = useMemo(() => {
    const lista = [...puntos];
    if (ubicacion) {
      return lista.sort(
        (a, b) =>
          metros(ubicacion, [a.lat, a.lng]) - metros(ubicacion, [b.lat, b.lng]),
      );
    }
    return lista.sort((a, b) => {
      const ca = esCritico(a) ? 1 : 0;
      const cb = esCritico(b) ? 1 : 0;
      if (ca !== cb) return cb - ca;
      const ma = a.ultimo_movimiento ? new Date(a.ultimo_movimiento).getTime() : 0;
      const mb = b.ultimo_movimiento ? new Date(b.ultimo_movimiento).getTime() : 0;
      return mb - ma;
    });
  }, [puntos, ubicacion]);

  if (ordenados.length === 0) {
    return (
      <p className="px-4 py-10 text-center text-slate-500">
        No hay puntos que coincidan.
      </p>
    );
  }

  return (
    <ul className="space-y-2 p-3">
      {ordenados.map((p) => {
        const critica = p.necesidades.find((n) => n.nivel === "muy_requerido");
        const dist = ubicacion ? formatearDistancia(metros(ubicacion, [p.lat, p.lng])) : null;
        const estado =
          p.origen === "oficial"
            ? "fuente oficial"
            : p.verificado
              ? "verificado"
              : "sin verificar";

        return (
          <li key={p.id}>
            <button
              onClick={() => onSeleccionar(p)}
              className="tarjeta-punto"
              aria-label={`${p.nombre}, ${p.tipo_etiqueta}${
                p.barrio ? `, ${p.barrio}` : ""
              }, ${estado}${critica ? `, falta ${critica.etiqueta}` : ""}${
                dist ? `, a ${dist}` : ""
              }`}
            >
              <span className="text-2xl leading-none" aria-hidden="true">
                {p.emoji}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="truncate font-medium text-slate-100">{p.nombre}</p>
                  {dist && (
                    <span className="shrink-0 text-xs text-slate-400">{dist}</span>
                  )}
                </div>

                <p className="truncate text-sm text-slate-400">
                  {p.tipo_etiqueta}
                  {p.barrio ? ` · ${p.barrio}` : ""}
                </p>

                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {p.origen === "oficial" ? (
                    <span className="chip border-sky-500/50 bg-sky-500/15 text-sky-300">
                      🛡️ Oficial
                    </span>
                  ) : p.verificado ? (
                    <span className="chip border-emerald-500/50 bg-emerald-500/15 text-emerald-300">
                      ✓ Verificado
                    </span>
                  ) : (
                    <span className="chip border-slate-600 bg-slate-700/40 text-slate-300">
                      Sin verificar
                    </span>
                  )}
                  {p.personas > 0 && (
                    <span className="chip border-slate-600 bg-slate-700/40 text-slate-300">
                      👥 {p.personas}
                    </span>
                  )}
                  {critica && (
                    <span
                      className={`chip ${DEMANDA.muy_requerido.borde} ${DEMANDA.muy_requerido.fondo} ${DEMANDA.muy_requerido.texto_color}`}
                    >
                      {critica.emoji} Falta {critica.etiqueta}
                    </span>
                  )}
                </div>

                <p
                  className={`mt-1 text-xs ${
                    estaObsoleto(p.ultimo_movimiento) ? "text-amber-400" : "text-slate-500"
                  }`}
                >
                  {estaObsoleto(p.ultimo_movimiento) && "⚠️ "}
                  {haceCuanto(p.ultimo_movimiento)}
                </p>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
