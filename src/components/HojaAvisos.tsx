"use client";

import { SEVERIDAD, TIPO_AVISO, fechaHora, haceCuanto, vigencia } from "@/lib/formato";
import type { Aviso, ReporteOficial } from "@/lib/tipos";

/**
 * Hoja de notificaciones: todo lo oficial en un solo sitio.
 *
 * El encabezado insiste en que esto viene de la Alcaldía y no de la comunidad.
 * En el resto de la app cualquiera reporta y el consenso decide; aquí no se
 * vota nada, y la diferencia tiene que quedar clara o las dos clases de
 * información se confunden.
 */

function Tarjeta({ aviso }: { aviso: Aviso }) {
  const s = SEVERIDAD[aviso.severidad];
  const t = TIPO_AVISO[aviso.tipo];

  return (
    <li className={`rounded-xl border p-3 ${s.borde} ${s.fondo}`}>
      <div className="mb-1 flex items-start gap-2">
        <span aria-hidden className="text-xl leading-none">
          {t.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium leading-snug text-slate-100">{aviso.titulo}</p>
          <p className={`text-sm ${s.texto_color}`}>
            {aviso.estado === "proximo" && (
              <span className="mr-1 font-semibold">Aún no rige ·</span>
            )}
            {vigencia(aviso)}
          </p>
        </div>
      </div>

      {aviso.cuerpo && (
        // `whitespace-pre-line` conserva los saltos con que se redactó el aviso;
        // las listas de excepciones son ilegibles en un solo bloque.
        <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-300">
          {aviso.cuerpo}
        </p>
      )}

      <p className="mt-2 text-[11px] text-slate-500">
        {aviso.fuente} · publicado {haceCuanto(aviso.creado_en)}
      </p>

      {aviso.enlace && (
        <a
          href={aviso.enlace}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-block text-sm text-sky-300 underline"
        >
          Ver la publicación oficial
        </a>
      )}
    </li>
  );
}

function Cifra({ valor, etiqueta }: { valor: number | null; etiqueta: string }) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-3 text-center">
      <div className="text-2xl font-bold leading-none text-slate-50">{valor ?? "—"}</div>
      <div className="mt-1 text-[11px] leading-tight text-slate-400">{etiqueta}</div>
    </div>
  );
}

export default function HojaAvisos({
  avisos,
  reporte,
  onCerrar,
}: {
  avisos: Aviso[];
  reporte: ReporteOficial | null;
  onCerrar: () => void;
}) {
  const vigentes = avisos.filter((a) => a.estado === "vigente");
  const proximos = avisos.filter((a) => a.estado === "proximo");

  return (
    <div className="hoja">
      <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-600" />

      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-50">Información oficial</h2>
          <p className="text-sm text-slate-400">
            Publicada por la Alcaldía de Cali. No la reporta la comunidad.
          </p>
        </div>
        <button onClick={onCerrar} aria-label="Cerrar" className="btn-icono">
          ✕
        </button>
      </header>

      {avisos.length === 0 && !reporte && (
        <p className="rounded-xl border border-slate-700 bg-slate-800/60 p-3 text-sm text-slate-400">
          No hay avisos oficiales en este momento.
        </p>
      )}

      {vigentes.length > 0 && (
        <section className="mb-5">
          <h3 className="etiqueta">Rige ahora</h3>
          <ul className="space-y-2">
            {vigentes.map((a) => (
              <Tarjeta key={a.id} aviso={a} />
            ))}
          </ul>
        </section>
      )}

      {proximos.length > 0 && (
        <section className="mb-5">
          <h3 className="etiqueta">Empieza pronto</h3>
          <ul className="space-y-2">
            {proximos.map((a) => (
              <Tarjeta key={a.id} aviso={a} />
            ))}
          </ul>
        </section>
      )}

      {reporte && (
        <section className="mb-2">
          <h3 className="etiqueta">
            Reporte de situación{reporte.numero ? ` #${reporte.numero}` : ""}
          </h3>
          <p className="mb-3 text-sm text-slate-400">
            {reporte.fuente} · {fechaHora(reporte.reportado_en)}
          </p>

          <div className="mb-3 grid grid-cols-2 gap-2">
            <Cifra valor={reporte.fallecidos} etiqueta="Fallecidos" />
            <Cifra valor={reporte.rescatados} etiqueta="Personas rescatadas" />
            <Cifra valor={reporte.colapsadas} etiqueta="Edificaciones colapsadas" />
            <Cifra valor={reporte.con_danos} etiqueta="Con daños estructurales" />
          </div>

          {reporte.salud && (
            <div className="mb-2 rounded-xl border border-slate-700 p-3">
              <p className="mb-1 text-sm font-medium text-slate-200">🏥 Atención de salud</p>
              <p className="text-sm leading-relaxed text-slate-300">{reporte.salud}</p>
            </div>
          )}

          {reporte.servicios && (
            <div className="mb-2 rounded-xl border border-slate-700 p-3">
              <p className="mb-1 text-sm font-medium text-slate-200">⚡ Servicios públicos</p>
              <p className="text-sm leading-relaxed text-slate-300">{reporte.servicios}</p>
            </div>
          )}

          <p className="mt-3 rounded-lg border border-amber-600/40 bg-amber-500/10 p-2.5 text-xs leading-relaxed text-amber-200">
            Cifras preliminares. Pueden variar a medida que avance la consolidación
            de la información oficial.
          </p>
        </section>
      )}

      <p className="mt-4 text-[11px] leading-relaxed text-slate-500">
        Ante una emergencia llama al 123. Esta aplicación no reemplaza a los
        organismos de socorro.
      </p>
    </div>
  );
}
