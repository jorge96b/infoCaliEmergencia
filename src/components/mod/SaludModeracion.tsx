"use client";

import { haceCuanto } from "@/lib/formato";
import type { Salud } from "@/lib/tipos";

/**
 * Una avalancha de denuncias en poco tiempo casi nunca es la comunidad
 * poniéndose de acuerdo: es gente coordinada tumbando información que molesta.
 * Por eso el ritmo va arriba del todo — conviene verlo ANTES de empezar a
 * aprobar y ocultar de a una.
 */
export default function SaludModeracion({ datos }: { datos: Salud | null }) {
  if (!datos) return null;

  const avalancha = datos.denuncias_1h >= 20;

  return (
    <div className="mb-4 rounded-xl border border-slate-700 bg-slate-900/60 p-3">
      <div className="grid grid-cols-3 gap-3 text-center">
        <Cifra valor={datos.pendientes} texto="Sin revisar" alerta={datos.pendientes > 0} />
        <Cifra valor={datos.denuncias_1h} texto="Denuncias 1 h" alerta={avalancha} />
        <Cifra valor={datos.bloqueados} texto="Bloqueados" />
        <Cifra valor={datos.ocultas} texto="Ocultas" />
        <Cifra valor={datos.denuncias_24h} texto="Denuncias 24 h" />
        <Cifra valor={datos.acciones_24h} texto="Acciones 24 h" />
      </div>

      {avalancha && (
        <p className="mt-3 rounded-lg border border-amber-600/40 bg-amber-500/10 p-2.5 text-sm text-amber-200">
          ⚠️ Muchas denuncias en la última hora. Puede ser un grupo coordinado
          intentando tumbar información buena: mira quién denuncia antes de ocultar nada.
        </p>
      )}

      <p className="mt-2 text-center text-xs text-slate-500">
        Actualizado {haceCuanto(datos.generado_en)}
      </p>
    </div>
  );
}

function Cifra({
  valor,
  texto,
  alerta = false,
}: {
  valor: number;
  texto: string;
  alerta?: boolean;
}) {
  return (
    <div>
      <p className={`text-2xl font-bold ${alerta ? "text-amber-300" : "text-slate-100"}`}>
        {valor}
      </p>
      <p className="text-xs text-slate-500">{texto}</p>
    </div>
  );
}
