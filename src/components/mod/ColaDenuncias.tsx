"use client";

import { useState } from "react";

import { MOTIVO_DENUNCIA, TABLA_DENUNCIABLE, haceCuanto } from "@/lib/formato";
import type { Decision, FilaCola, MotivoDenuncia } from "@/lib/tipos";

export default function ColaDenuncias({
  filas,
  ocupado,
  onDecidir,
  onVerDispositivo,
}: {
  filas: FilaCola[];
  ocupado: boolean;
  onDecidir: (fila: FilaCola, decision: Decision, motivo?: string) => void;
  onVerDispositivo: (dispositivo: string) => void;
}) {
  if (filas.length === 0) {
    return (
      <p className="rounded-xl border border-slate-700 bg-slate-900/60 p-6 text-center text-sm text-slate-500">
        No hay nada esperando revisión.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {filas.map((f) => (
        <Tarjeta
          key={`${f.tabla}:${f.fila_id}`}
          fila={f}
          ocupado={ocupado}
          onDecidir={onDecidir}
          onVerDispositivo={onVerDispositivo}
        />
      ))}
    </ul>
  );
}

function Tarjeta({
  fila,
  ocupado,
  onDecidir,
  onVerDispositivo,
}: {
  fila: FilaCola;
  ocupado: boolean;
  onDecidir: (fila: FilaCola, decision: Decision, motivo?: string) => void;
  onVerDispositivo: (dispositivo: string) => void;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [motivo, setMotivo] = useState("");

  // `resuelto` no es abuso: significa "esto era cierto y ya no". Va aparte
  // porque exige una decisión distinta —está desactualizado, no está mal— y
  // mezclarlo con lo ofensivo hace que se juzguen igual dos cosas que no lo son.
  const abuso = (["ofensivo", "falso", "duplicado", "otro"] as MotivoDenuncia[]).filter(
    (m) => fila[m] > 0,
  );

  return (
    <li
      className={`rounded-xl border p-3 ${
        fila.ofensivo > 0
          ? "border-red-500/50 bg-red-500/5"
          : "border-slate-700 bg-slate-900/60"
      }`}
    >
      {fila.huerfano ? (
        <p className="mb-2 rounded-lg border border-slate-600 bg-slate-800/60 p-2.5 text-sm text-slate-400">
          La fila denunciada ya no existe. Sólo queda descartar la denuncia.
        </p>
      ) : (
        <>
          <p className="text-xs uppercase tracking-wide text-slate-500">
            {TABLA_DENUNCIABLE[fila.tabla]}
            {fila.punto ? ` · ${fila.punto}` : ""}
            {fila.oculto ? " · oculto ahora mismo" : ""}
          </p>
          <p className="mt-0.5 font-medium text-slate-100">{fila.texto}</p>
          {fila.contenido && (
            <p className="mt-1 text-sm text-slate-400">{fila.contenido}</p>
          )}
        </>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {abuso.map((m) => (
          <span
            key={m}
            className={`chip ${
              m === "ofensivo"
                ? "border-red-500/50 bg-red-500/15 text-red-300"
                : "border-slate-600 bg-slate-700/40 text-slate-300"
            }`}
          >
            {MOTIVO_DENUNCIA[m].texto} · {fila[m]}
          </span>
        ))}
        {fila.resuelto > 0 && (
          <span className="chip border-sky-500/50 bg-sky-500/15 text-sky-300">
            Ya se resolvió · {fila.resuelto}
          </span>
        )}
      </div>

      <p className="mt-2 text-sm text-slate-400">
        {fila.denuncias} {fila.denuncias === 1 ? "dispositivo" : "dispositivos"} ·{" "}
        {haceCuanto(fila.ultima)}
        {fila.dispositivo_id && (
          <>
            {" · "}
            <button
              onClick={() => onVerDispositivo(fila.dispositivo_id!)}
              className="underline underline-offset-2"
            >
              ver quién lo publicó
            </button>
          </>
        )}
      </p>

      {fila.detalles.length > 0 && (
        <ul className="mt-2 space-y-1">
          {fila.detalles.slice(0, 4).map((d, i) => (
            <li key={i} className="text-sm text-slate-300">
              «{d}»
            </li>
          ))}
        </ul>
      )}

      {confirmando ? (
        <div className="mt-3">
          <label htmlFor={`motivo-${fila.fila_id}`} className="etiqueta">
            ¿Por qué se oculta? (queda en la bitácora)
          </label>
          <textarea
            id={`motivo-${fila.fila_id}`}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value.slice(0, 280))}
            maxLength={280}
            rows={2}
            className="campo"
          />
          <div className="mt-2 flex gap-2">
            <button
              disabled={ocupado}
              onClick={() => {
                setConfirmando(false);
                onDecidir(fila, "oculto", motivo);
              }}
              className="btn-mini btn-falta flex-1"
            >
              Confirmar
            </button>
            <button
              disabled={ocupado}
              onClick={() => setConfirmando(false)}
              className="btn-mini btn-llego flex-1"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <button
            disabled={ocupado}
            onClick={() => onDecidir(fila, "aprobado")}
            className="btn-mini btn-llego flex-1"
          >
            {fila.huerfano ? "Descartar" : "Está bien, dejarlo"}
          </button>
          {!fila.huerfano && (
            <button
              disabled={ocupado}
              onClick={() => setConfirmando(true)}
              className="btn-mini btn-falta flex-1"
            >
              Ocultar
            </button>
          )}
        </div>
      )}
    </li>
  );
}
