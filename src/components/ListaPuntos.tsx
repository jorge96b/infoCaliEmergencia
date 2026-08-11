"use client";

import { useMemo } from "react";

import { DEMANDA, estaObsoleto, haceCuanto } from "@/lib/formato";
import { esCritico } from "@/lib/filtros";
import { formatearDistancia, metros } from "@/lib/geo";
import type { NecesidadResumen, PuntoMapa } from "@/lib/tipos";

/**
 * Alternativa textual al mapa: la misma información en una lista navegable con
 * teclado y lector de pantalla, y liviana para conexiones malas. Tocar una
 * tarjeta abre la misma `HojaPunto` que un marcador, así que no duplica lógica.
 *
 * La tarjeta repite el lenguaje visual del marcador —color del tipo, borde
 * punteado si no está verificado— para que mapa y lista se lean igual. Lo que
 * falta va en rojo y en su propia línea: en una emergencia es lo único que
 * justifica bajar por la lista.
 */

/** La necesidad que manda en la tarjeta: primero lo crítico, si no lo tibio. */
function necesidadDestacada(p: PuntoMapa): NecesidadResumen | null {
  return (
    p.necesidades.find((n) => n.nivel === "muy_requerido") ??
    p.necesidades.find((n) => n.nivel === "poco_requerido") ??
    null
  );
}

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
      <div className="px-6 py-16 text-center">
        <p className="text-3xl" aria-hidden="true">
          🗺️
        </p>
        <p className="mt-3 font-medium text-slate-300">No hay puntos que coincidan</p>
        <p className="mt-1 text-sm text-slate-500">
          Prueba quitando algún filtro o cambiando la búsqueda.
        </p>
      </div>
    );
  }

  return (
    <div className="p-3">
      <p className="px-1 pb-2 text-xs text-slate-500">
        {ordenados.length} {ordenados.length === 1 ? "punto" : "puntos"} ·{" "}
        {ubicacion ? "más cercanos primero" : "más urgentes primero"}
      </p>

      <ul className="space-y-2">
        {ordenados.map((p) => {
          const critico = esCritico(p);
          const destacada = necesidadDestacada(p);
          const otras = p.necesidades.filter(
            (n) => n.nivel !== "no_requerido" && n.recurso !== destacada?.recurso,
          ).length;
          const obsoleto = estaObsoleto(p.ultimo_movimiento);
          const dist = ubicacion
            ? formatearDistancia(metros(ubicacion, [p.lat, p.lng]))
            : null;
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
                aria-label={`${p.nombre}, ${p.tipo_etiqueta}${
                  p.barrio ? `, ${p.barrio}` : ""
                }, ${estado}${
                  destacada
                    ? `, ${DEMANDA[destacada.nivel].texto.toLowerCase()}: ${destacada.etiqueta}`
                    : ""
                }${
                  p.personas > 0
                    ? `, ${p.personas} ${p.personas === 1 ? "persona" : "personas"}`
                    : ""
                }${
                  dist ? `, a ${dist}` : ""
                }, actualizado ${haceCuanto(p.ultimo_movimiento)}`}
                className={`relative flex w-full items-start gap-3 overflow-hidden rounded-xl border py-3 pl-4 pr-3 text-left transition active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/50 ${
                  critico
                    ? "border-red-500/40 bg-red-950/25 active:bg-red-950/40"
                    : "border-slate-800 bg-slate-900/70 active:bg-slate-800/80"
                }`}
              >
                {/* Franja del color del tipo: agrupa de un vistazo al bajar. */}
                <span
                  aria-hidden="true"
                  className="absolute inset-y-0 left-0 w-1"
                  style={{ background: p.color }}
                />

                {/* Misma insignia que el marcador del mapa. */}
                <span
                  aria-hidden="true"
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-full border-2 bg-slate-950/80 text-lg"
                  style={{
                    borderColor: p.color,
                    borderStyle: p.verificado || p.origen === "oficial" ? "solid" : "dashed",
                  }}
                >
                  {p.emoji}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="truncate font-semibold text-slate-50">
                      {p.origen === "oficial" && (
                        <span className="mr-1 text-sky-400" title="Fuente oficial">
                          🛡️
                        </span>
                      )}
                      {p.nombre}
                    </h3>
                    {dist && (
                      <span className="shrink-0 text-xs font-medium tabular-nums text-slate-400">
                        {dist}
                      </span>
                    )}
                  </div>

                  <p className="truncate text-xs text-slate-400">
                    {p.tipo_etiqueta}
                    {p.barrio ? ` · ${p.barrio}` : ""}
                  </p>

                  {destacada && (
                    <p
                      className={`mt-2 flex items-center gap-1.5 text-sm font-medium ${
                        DEMANDA[destacada.nivel].texto_color
                      }`}
                    >
                      <span aria-hidden="true">{destacada.emoji}</span>
                      <span className="truncate">
                        {destacada.nivel === "muy_requerido" ? "Falta" : "Necesita"}{" "}
                        {destacada.etiqueta.toLowerCase()}
                      </span>
                      {otras > 0 && (
                        <span className="shrink-0 text-xs font-normal text-slate-500">
                          +{otras}
                        </span>
                      )}
                    </p>
                  )}

                  {/* Una sola línea de metadatos en vez de una pila de chips. */}
                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                    {p.personas > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-slate-800 px-1.5 py-0.5 font-medium text-slate-300">
                        <span aria-hidden="true">👥</span> {p.personas}
                      </span>
                    )}
                    {p.origen !== "oficial" &&
                      (p.verificado ? (
                        <span className="text-emerald-400">✓ Verificado</span>
                      ) : (
                        <span className="text-slate-500">Sin verificar</span>
                      ))}
                    <span className={obsoleto ? "text-amber-400" : "text-slate-500"}>
                      {obsoleto && <span aria-hidden="true">⚠ </span>}
                      {haceCuanto(p.ultimo_movimiento)}
                    </span>
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
