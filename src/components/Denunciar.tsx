"use client";

import { useState } from "react";

import { MOTIVOS_DENUNCIA, MOTIVO_DENUNCIA } from "@/lib/formato";
import { denunciar, type Resultado } from "@/lib/reportes";
import type { MotivoDenuncia, TablaDenunciable } from "@/lib/tipos";

/**
 * Denunciar contenido para que lo revise un moderador.
 *
 * Va plegado y en letra pequeña a propósito. Un botón grande de denunciar
 * termina usándose como "no me gusta", y cada denuncia de más es trabajo humano
 * robado a las que sí importan. Quien de verdad quiere denunciar algo encuentra
 * un enlace pequeño; quien está molesto por otra cosa, no.
 */
export default function Denunciar({
  tabla,
  filaId,
  ocupado,
  accion,
  texto = "Denunciar este contenido",
}: {
  tabla: TablaDenunciable;
  filaId: string;
  ocupado: boolean;
  /** El envoltorio de la hoja: bloquea, ejecuta, avisa y refresca. */
  accion: (fn: () => Promise<Resultado>, exito: string) => void;
  /** Con qué palabras se ofrece. Cambia si lo denunciable no es el punto. */
  texto?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState<MotivoDenuncia | null>(null);
  const [detalle, setDetalle] = useState("");

  function enviar() {
    if (!motivo) return;
    const elegido = motivo;
    const texto = detalle;
    setAbierto(false);
    setMotivo(null);
    setDetalle("");
    // Nunca "se ocultó" ni "lo quitamos": denunciar no decide nada, y prometer
    // un resultado que depende de otras personas es la forma más rápida de que
    // alguien denuncie diez veces creyendo que la primera no sirvió.
    accion(
      () => denunciar(tabla, filaId, elegido, texto),
      "Gracias. Lo revisará un moderador.",
    );
  }

  if (!abierto) {
    return (
      <button
        onClick={() => setAbierto(true)}
        aria-expanded={false}
        className="mx-auto mt-2 block text-xs text-slate-500 underline underline-offset-2"
      >
        {texto}
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-slate-700 p-3">
      <div className="mb-2 flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-slate-300">¿Qué pasa con este contenido?</p>
        <button
          onClick={() => setAbierto(false)}
          aria-label="Cancelar la denuncia"
          className="btn-icono"
        >
          ✕
        </button>
      </div>

      <div className="space-y-1.5">
        {MOTIVOS_DENUNCIA.map((m) => (
          <button
            key={m}
            onClick={() => setMotivo(m)}
            aria-pressed={motivo === m}
            className={`w-full rounded-lg border px-3 py-2.5 text-left transition ${
              motivo === m
                ? "border-sky-500 bg-sky-950 text-sky-200"
                : "border-slate-700 bg-slate-800/60 text-slate-300"
            }`}
          >
            <span className="block text-sm font-medium">{MOTIVO_DENUNCIA[m].texto}</span>
            <span className="block text-xs text-slate-500">{MOTIVO_DENUNCIA[m].ayuda}</span>
          </button>
        ))}
      </div>

      {motivo && (
        <div className="mt-3">
          <label htmlFor="detalle-denuncia" className="etiqueta">
            Detalle {motivo === "otro" ? "" : "(opcional)"}
          </label>
          <textarea
            id="detalle-denuncia"
            value={detalle}
            onChange={(e) => setDetalle(e.target.value.slice(0, 280))}
            maxLength={280}
            rows={2}
            placeholder="Lo que ayude a quien lo revise"
            className="campo"
          />
          <button
            disabled={ocupado || (motivo === "otro" && detalle.trim().length === 0)}
            onClick={enviar}
            className="btn-grande btn-entrar mt-2"
          >
            Enviar denuncia
          </button>
        </div>
      )}
    </div>
  );
}
