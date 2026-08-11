"use client";

import { TABLA_DENUNCIABLE, haceCuanto } from "@/lib/formato";
import type { EntradaBitacora, TablaDenunciable } from "@/lib/tipos";

const ACCION: Record<EntradaBitacora["accion"], { texto: string; color: string }> = {
  aprobar: { texto: "Aprobó", color: "text-emerald-300" },
  ocultar: { texto: "Ocultó", color: "text-red-300" },
  bloquear: { texto: "Bloqueó", color: "text-red-300" },
  desbloquear: { texto: "Desbloqueó", color: "text-emerald-300" },
  ocultar_todo: { texto: "Bloqueó y ocultó todo de", color: "text-red-300" },
};

export default function Bitacora({ entradas }: { entradas: EntradaBitacora[] }) {
  if (entradas.length === 0) {
    return (
      <p className="rounded-xl border border-slate-700 bg-slate-900/60 p-6 text-center text-sm text-slate-500">
        Todavía no hay acciones registradas.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {entradas.map((e) => {
        const a = ACCION[e.accion];
        return (
          <li key={e.id} className="rounded-xl border border-slate-700 bg-slate-900/60 p-3">
            <p className="text-sm text-slate-200">
              <b>{e.moderador}</b> <span className={a.color}>{a.texto.toLowerCase()}</span>{" "}
              {e.tabla
                ? (TABLA_DENUNCIABLE[e.tabla as TablaDenunciable] ?? e.tabla).toLowerCase()
                : "un dispositivo"}
            </p>
            {e.dispositivo_id && (
              <p className="truncate font-mono text-xs text-slate-500">{e.dispositivo_id}</p>
            )}
            {e.motivo && <p className="mt-1 text-sm text-slate-400">«{e.motivo}»</p>}
            <p className="mt-1 text-xs text-slate-500">{haceCuanto(e.creado_en)}</p>
          </li>
        );
      })}
    </ul>
  );
}
