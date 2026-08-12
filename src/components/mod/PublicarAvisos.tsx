"use client";

import { useState } from "react";
import { SEVERIDAD, TIPO_AVISO, fechaHora, vigencia } from "@/lib/formato";
import type { Aviso, SeveridadAviso, TipoAviso } from "@/lib/tipos";

/**
 * Panel para publicar información oficial.
 *
 * Lo que más importa de este formulario es la ventana de vigencia. Un toque de
 * queda mal fechado es peor que no publicarlo: o la gente sale creyendo que
 * puede, o se queda encerrada creyendo que no. Por eso las fechas van primero,
 * el fin es obligatorio para un toque de queda, y antes de guardar se muestra
 * en palabras lo que va a ver la gente.
 */

const TIPOS: TipoAviso[] = ["toque_queda", "movilidad", "servicios", "salud", "otro"];
const SEVERIDADES: SeveridadAviso[] = ["critico", "importante", "informativo"];

/**
 * `datetime-local` habla en hora local del navegador y sin zona. Como el panel
 * lo usa gente en Cali sobre un servidor en UTC, se convierte explícitamente en
 * vez de confiar en la del dispositivo.
 */
function aISO(valorLocal: string): string {
  return new Date(valorLocal).toISOString();
}

function paraCampo(d: Date): string {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export default function PublicarAvisos({
  avisos,
  ocupado,
  onPublicar,
  onRetirar,
}: {
  avisos: Aviso[];
  ocupado: boolean;
  onPublicar: (a: {
    titulo: string;
    tipo: TipoAviso;
    severidad: SeveridadAviso;
    vigenteDesde: string;
    vigenteHasta: string | null;
    cuerpo?: string;
    fijado: boolean;
  }) => void;
  onRetirar: (id: string) => void;
}) {
  const [titulo, setTitulo] = useState("");
  const [tipo, setTipo] = useState<TipoAviso>("toque_queda");
  const [severidad, setSeveridad] = useState<SeveridadAviso>("critico");
  const [cuerpo, setCuerpo] = useState("");
  const [desde, setDesde] = useState(() => paraCampo(new Date()));
  const [hasta, setHasta] = useState("");
  const [fijado, setFijado] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function enviar() {
    if (titulo.trim().length < 3) {
      setError("El título es obligatorio.");
      return;
    }
    if (!desde) {
      setError("Falta la hora de inicio.");
      return;
    }
    if (tipo === "toque_queda" && !hasta) {
      setError("Un toque de queda necesita hora de fin, o se quedará en pantalla para siempre.");
      return;
    }
    if (hasta && new Date(hasta) <= new Date(desde)) {
      setError("La hora de fin tiene que ser posterior a la de inicio.");
      return;
    }

    setError(null);
    onPublicar({
      titulo,
      tipo,
      severidad,
      vigenteDesde: aISO(desde),
      vigenteHasta: hasta ? aISO(hasta) : null,
      cuerpo,
      fijado,
    });
    setTitulo("");
    setCuerpo("");
    setHasta("");
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
        <h2 className="mb-1 text-base font-semibold text-slate-100">Publicar un aviso</h2>
        <p className="mb-4 text-sm text-slate-400">
          Lo verá cualquiera que abra la app, atribuido a la Alcaldía. Desaparece
          solo cuando pase su hora de fin.
        </p>

        <label className="etiqueta" htmlFor="av-titulo">
          Título
        </label>
        <input
          id="av-titulo"
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          maxLength={120}
          placeholder="Ej: Toque de queda esta noche, 9:00 p. m. a 6:00 a. m."
          className="campo mb-3"
        />

        <div className="mb-3 grid grid-cols-2 gap-3">
          <div>
            <label className="etiqueta" htmlFor="av-tipo">
              Tipo
            </label>
            <select
              id="av-tipo"
              value={tipo}
              onChange={(e) => setTipo(e.target.value as TipoAviso)}
              className="campo"
            >
              {TIPOS.map((t) => (
                <option key={t} value={t}>
                  {TIPO_AVISO[t].emoji} {TIPO_AVISO[t].etiqueta}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="etiqueta" htmlFor="av-severidad">
              Severidad
            </label>
            <select
              id="av-severidad"
              value={severidad}
              onChange={(e) => setSeveridad(e.target.value as SeveridadAviso)}
              className="campo"
            >
              {SEVERIDADES.map((s) => (
                <option key={s} value={s}>
                  {SEVERIDAD[s].texto}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mb-3 grid grid-cols-2 gap-3">
          <div>
            <label className="etiqueta" htmlFor="av-desde">
              Rige desde
            </label>
            <input
              id="av-desde"
              type="datetime-local"
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
              className="campo"
            />
          </div>
          <div>
            <label className="etiqueta" htmlFor="av-hasta">
              Hasta{" "}
              <span className="font-normal text-slate-500">
                {tipo === "toque_queda" ? "(obligatorio)" : "(opcional)"}
              </span>
            </label>
            <input
              id="av-hasta"
              type="datetime-local"
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
              className="campo"
            />
          </div>
        </div>

        <label className="etiqueta" htmlFor="av-cuerpo">
          Detalle <span className="font-normal text-slate-500">(opcional)</span>
        </label>
        <textarea
          id="av-cuerpo"
          value={cuerpo}
          onChange={(e) => setCuerpo(e.target.value)}
          maxLength={2000}
          rows={4}
          placeholder="Excepciones, horarios, a quién aplica…"
          className="campo mb-3"
        />

        <label className="mb-4 flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={fijado}
            onChange={(e) => setFijado(e.target.checked)}
            className="h-4 w-4"
          />
          Mostrarlo en la franja sobre el mapa
        </label>

        {/* Lo que va a leer la gente, antes de guardarlo. Una hora mal puesta se
            ve aquí y no cuando ya está publicada. */}
        {desde && (
          <p className="mb-3 rounded-lg border border-slate-700 bg-slate-800/60 p-2.5 text-sm text-slate-300">
            Se mostrará como:{" "}
            <b className="text-slate-100">
              {vigencia({
                estado: new Date(desde) <= new Date() ? "vigente" : "proximo",
                vigente_desde: aISO(desde),
                vigente_hasta: hasta ? aISO(hasta) : null,
              })}
            </b>
          </p>
        )}

        {error && (
          <p className="mb-3 rounded-lg border border-amber-600/50 bg-amber-950/90 p-2.5 text-sm text-amber-200">
            {error}
          </p>
        )}

        <button onClick={enviar} disabled={ocupado} className="btn-grande btn-entrar">
          {ocupado ? "Publicando…" : "Publicar aviso"}
        </button>
      </section>

      <section>
        <h2 className="mb-3 text-base font-semibold text-slate-100">
          Avisos activos ({avisos.length})
        </h2>
        {avisos.length === 0 ? (
          <p className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 text-sm text-slate-400">
            No hay ninguno publicado ahora mismo.
          </p>
        ) : (
          <ul className="space-y-2">
            {avisos.map((a) => (
              <li
                key={a.id}
                className={`rounded-xl border p-3 ${SEVERIDAD[a.severidad].borde} ${
                  SEVERIDAD[a.severidad].fondo
                }`}
              >
                <div className="flex items-start gap-2">
                  <span aria-hidden className="text-lg leading-none">
                    {TIPO_AVISO[a.tipo].emoji}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium leading-snug text-slate-100">{a.titulo}</p>
                    <p className={`text-sm ${SEVERIDAD[a.severidad].texto_color}`}>
                      {a.estado === "proximo" && (
                        <span className="mr-1 font-semibold">Aún no rige ·</span>
                      )}
                      {vigencia(a)}
                      {a.fijado && " · fijado en el mapa"}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Desde {fechaHora(a.vigente_desde)}
                    </p>
                  </div>
                  <button
                    onClick={() => onRetirar(a.id)}
                    disabled={ocupado}
                    className="btn-mini btn-llego shrink-0"
                  >
                    Retirar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
