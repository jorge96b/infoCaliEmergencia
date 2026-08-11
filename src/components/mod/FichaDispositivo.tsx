"use client";

import { useState } from "react";

import { TABLA_DENUNCIABLE, haceCuanto } from "@/lib/formato";
import type { Ficha, FilaDispositivo } from "@/lib/tipos";

/**
 * Lo que hay que mirar ANTES de bloquear.
 *
 * Bloquear a ciegas por una sola denuncia es la forma más fácil de echar del
 * mapa a alguien que estaba reportando bien. Aquí se ve todo lo que publicó, y
 * también cuántas denuncias EMITIÓ: diez denuncias en media hora es alguien
 * intentando tumbar información legítima, y eso es abuso aunque no haya
 * publicado nada.
 */
export default function FichaDispositivo({
  ficha,
  filas,
  ocupado,
  onBloquear,
  onCerrar,
}: {
  ficha: Ficha | null;
  filas: FilaDispositivo[];
  ocupado: boolean;
  onBloquear: (bloqueado: boolean, motivo: string, ocultarTodo: boolean) => void;
  onCerrar: () => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [ocultarTodo, setOcultarTodo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!ficha) {
    return (
      <div className="hoja">
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-600" />
        <p className="text-sm text-slate-400">No hay ficha para ese dispositivo.</p>
        <button onClick={onCerrar} className="btn-grande btn-salir mt-4">
          Cerrar
        </button>
      </div>
    );
  }

  function bloquear() {
    if (!motivo.trim()) {
      setError("Hay que decir por qué. Queda en la bitácora.");
      return;
    }
    setError(null);
    onBloquear(true, motivo, ocultarTodo);
  }

  return (
    <div className="hoja">
      <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-600" />

      <header className="mb-4 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-slate-50">Dispositivo</h2>
          <p className="truncate font-mono text-xs text-slate-500">{ficha.id}</p>
          <p className="mt-1 text-sm text-slate-400">
            Visto {haceCuanto(ficha.visto_en)} · registrado {haceCuanto(ficha.creado_en)}
          </p>
        </div>
        <button onClick={onCerrar} aria-label="Cerrar" className="btn-icono">
          ✕
        </button>
      </header>

      {ficha.bloqueado && (
        <p className="mb-3 rounded-lg border border-red-600/40 bg-red-500/10 p-2.5 text-sm text-red-200">
          Bloqueado{ficha.motivo ? `: ${ficha.motivo}` : "."}
        </p>
      )}

      <div className="grid grid-cols-3 gap-2 text-center">
        <Dato n={ficha.puntos} t="Lugares" />
        <Dato n={ficha.necesidades} t="Necesidades" />
        <Dato n={ficha.insumos} t="Disponibles" />
        <Dato n={ficha.personas} t="Conteos" />
        <Dato n={ficha.denuncias_recibidas} t="Denuncias recibidas" alerta />
        <Dato n={ficha.denuncias_emitidas} t="Denuncias emitidas" alerta />
      </div>

      {ficha.filas_ocultas > 0 && (
        <p className="mt-3 text-sm text-slate-400">
          {ficha.filas_ocultas} de sus filas están ocultas ahora mismo.
        </p>
      )}

      {filas.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-sm font-medium text-slate-400">Lo que ha publicado</p>
          <ul className="space-y-1.5">
            {filas.slice(0, 30).map((f) => (
              <li
                key={`${f.tabla}:${f.fila_id}`}
                className="rounded-lg border border-slate-700 bg-slate-800/40 p-2.5"
              >
                <p className="text-xs uppercase tracking-wide text-slate-500">
                  {TABLA_DENUNCIABLE[f.tabla]} · {f.punto}
                  {f.oculto ? " · oculto" : ""}
                </p>
                <p className="text-sm text-slate-200">{f.texto}</p>
                <p className="text-xs text-slate-500">{haceCuanto(f.creado_en)}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 rounded-xl border border-slate-700 p-3">
        {ficha.bloqueado ? (
          <>
            <p className="mb-2 text-sm text-slate-300">
              Desbloquear le devuelve la capacidad de reportar. Lo que se ocultó sigue
              oculto hasta que se apruebe una por una.
            </p>
            <button
              disabled={ocupado}
              onClick={() => onBloquear(false, motivo, false)}
              className="btn-grande btn-entrar"
            >
              Desbloquear
            </button>
          </>
        ) : (
          <>
            <label htmlFor="motivo-bloqueo" className="etiqueta">
              ¿Por qué se bloquea?
            </label>
            <textarea
              id="motivo-bloqueo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value.slice(0, 280))}
              maxLength={280}
              rows={2}
              className="campo"
            />

            <label className="mt-3 flex items-start gap-2.5 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={ocultarTodo}
                onChange={(e) => setOcultarTodo(e.target.checked)}
                className="mt-0.5 h-5 w-5 shrink-0"
              />
              <span>
                Ocultar también todo lo que publicó.
                <span className="block text-xs text-slate-500">
                  Bloquear sólo impide reportar de aquí en adelante; lo ya publicado
                  sigue en el mapa.
                </span>
              </span>
            </label>

            {error && <p className="mt-2 text-sm text-red-300">{error}</p>}

            <button disabled={ocupado} onClick={bloquear} className="btn-grande btn-salir mt-3">
              Bloquear dispositivo
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function Dato({ n, t, alerta = false }: { n: number; t: string; alerta?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/40 p-2">
      <p className={`text-xl font-bold ${alerta && n > 0 ? "text-amber-300" : "text-slate-100"}`}>
        {n}
      </p>
      <p className="text-xs leading-tight text-slate-500">{t}</p>
    </div>
  );
}
