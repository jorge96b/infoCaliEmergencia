"use client";

import { FILTROS_VACIOS, type FiltrosPuntos } from "@/lib/filtros";
import type { TipoPunto } from "@/lib/tipos";

/**
 * Filtros y búsqueda en una hoja inferior, al alcance del pulgar. El estado vive
 * en la página y se aplica por igual al mapa y a la lista, así que las dos vistas
 * muestran siempre el mismo subconjunto.
 */
export default function Filtros({
  tipos,
  filtros,
  busqueda,
  total,
  mostrados,
  onFiltros,
  onBusqueda,
  onCerrar,
}: {
  tipos: TipoPunto[];
  filtros: FiltrosPuntos;
  busqueda: string;
  total: number;
  mostrados: number;
  onFiltros: (f: FiltrosPuntos) => void;
  onBusqueda: (s: string) => void;
  onCerrar: () => void;
}) {
  const hayFiltros = filtros.tipos.size > 0 || filtros.soloCriticos || busqueda.trim() !== "";

  function alternarTipo(slug: string) {
    const siguiente = new Set(filtros.tipos);
    if (siguiente.has(slug)) siguiente.delete(slug);
    else siguiente.add(slug);
    onFiltros({ ...filtros, tipos: siguiente });
  }

  function limpiar() {
    onFiltros(FILTROS_VACIOS);
    onBusqueda("");
  }

  return (
    <div className="hoja">
      <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-600" />

      <header className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-50">Filtrar</h2>
        <button onClick={onCerrar} aria-label="Cerrar" className="btn-icono">
          ✕
        </button>
      </header>

      <label htmlFor="buscar-punto" className="etiqueta">
        Buscar por nombre o barrio
      </label>
      <input
        id="buscar-punto"
        type="search"
        value={busqueda}
        onChange={(e) => onBusqueda(e.target.value)}
        placeholder="Ej.: albergue, El Poblado…"
        className="campo"
        autoComplete="off"
      />

      <p className="etiqueta mt-4">Tipo de lugar</p>
      <div className="flex flex-wrap gap-1.5">
        {tipos.map((t) => {
          const activo = filtros.tipos.has(t.slug);
          return (
            <button
              key={t.slug}
              onClick={() => alternarTipo(t.slug)}
              aria-pressed={activo}
              className={`chip ${
                activo
                  ? "border-sky-500 bg-sky-500/15 text-sky-200"
                  : "border-slate-700 bg-slate-800 text-slate-300"
              }`}
            >
              {t.emoji} {t.etiqueta}
            </button>
          );
        })}
      </div>

      <button
        onClick={() => onFiltros({ ...filtros, soloCriticos: !filtros.soloCriticos })}
        aria-pressed={filtros.soloCriticos}
        className={`mt-4 flex w-full items-center justify-between rounded-xl border px-3 py-3 text-left text-sm font-medium transition ${
          filtros.soloCriticos
            ? "border-red-500/50 bg-red-500/15 text-red-200"
            : "border-slate-700 bg-slate-800/60 text-slate-200"
        }`}
      >
        <span>Sólo con necesidad crítica</span>
        <span aria-hidden="true">{filtros.soloCriticos ? "●" : "○"}</span>
      </button>

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-sm text-slate-400" role="status" aria-live="polite">
          {mostrados} de {total} {total === 1 ? "punto" : "puntos"}
        </p>
        {hayFiltros && (
          <button onClick={limpiar} className="text-sm font-medium text-sky-400 underline">
            Limpiar
          </button>
        )}
      </div>

      <button onClick={onCerrar} className="btn-grande btn-entrar mt-4">
        Ver {mostrados} {mostrados === 1 ? "punto" : "puntos"}
      </button>
    </div>
  );
}
