"use client";

import { useState } from "react";
import {
  confirmarPunto,
  entrarAPunto,
  reportarInsumo,
  reportarNecesidad,
  reportarPersonas,
  salirDePunto,
  ErrorReporte,
  type Resultado,
} from "@/lib/reportes";
import {
  DEMANDA,
  ESTADO_PERSONA,
  NIVELES_STOCK,
  STOCK,
  estaObsoleto,
  haceCuanto,
} from "@/lib/formato";
import type { EstadoPersona, NivelStock, PuntoMapa, Recurso } from "@/lib/tipos";

type Pestana = "necesidades" | "disponible" | "personas";

export default function HojaPunto({
  punto,
  recursos,
  aqui,
  onCerrar,
  onCambio,
}: {
  punto: PuntoMapa;
  recursos: Recurso[];
  aqui: boolean;
  onCerrar: () => void;
  onCambio: () => void;
}) {
  const [pestana, setPestana] = useState<Pestana>("necesidades");
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  /** Envoltorio común: bloquea, ejecuta, avisa y refresca. */
  async function accion(fn: () => Promise<Resultado>, exito: string) {
    setOcupado(true);
    setAviso(null);
    try {
      const resultado = await fn();
      // Sin señal el reporte queda en la bandeja de salida. Decirlo con todas
      // las letras evita que la persona lo reporte otra vez creyendo que falló.
      setAviso(
        resultado === "encolado"
          ? "Guardado. Se enviará solo cuando vuelva la señal."
          : exito,
      );
      onCambio();
    } catch (e) {
      setAviso(e instanceof ErrorReporte ? e.message : "No se pudo enviar. Intenta de nuevo.");
    } finally {
      setOcupado(false);
      setTimeout(() => setAviso(null), 4000);
    }
  }

  const destacados = recursos.filter((r) => r.destacado);
  const yaPedidos = new Set(punto.necesidades.map((n) => n.recurso));

  return (
    <div className="hoja">
      <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-600" />

      <header className="mb-4 flex items-start gap-3">
        <span className="text-3xl leading-none">{punto.emoji}</span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold text-slate-50">{punto.nombre}</h2>
          <p className="text-sm text-slate-400">
            {punto.tipo_etiqueta}
            {punto.barrio ? ` · ${punto.barrio}` : ""}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {punto.origen === "oficial" ? (
              <span className="chip border-sky-500/50 bg-sky-500/15 text-sky-300">
                🛡️ Fuente oficial
              </span>
            ) : punto.verificado ? (
              <span className="chip border-emerald-500/50 bg-emerald-500/15 text-emerald-300">
                ✓ Verificado por {punto.confirmaciones} personas
              </span>
            ) : (
              <span className="chip border-slate-600 bg-slate-700/40 text-slate-300">
                Sin verificar
              </span>
            )}
            {punto.personas > 0 && (
              <span className="chip border-slate-600 bg-slate-700/40 text-slate-300">
                👥 {punto.personas} aquí
              </span>
            )}
          </div>
        </div>
        <button onClick={onCerrar} aria-label="Cerrar" className="btn-icono">
          ✕
        </button>
      </header>

      {punto.descripcion && (
        <p className="mb-3 text-sm text-slate-300">{punto.descripcion}</p>
      )}

      {estaObsoleto(punto.ultimo_movimiento) && (
        <p className="mb-3 rounded-lg border border-amber-600/40 bg-amber-500/10 p-2.5 text-sm text-amber-200">
          ⚠️ Sin reportes recientes. La información puede estar desactualizada.
        </p>
      )}

      {/* Presencia: la acción más frecuente, siempre visible y de un solo toque. */}
      <button
        disabled={ocupado}
        onClick={() =>
          aqui
            ? accion(salirDePunto, "Listo, ya no apareces en este punto.")
            : accion(() => entrarAPunto(punto.id), "Listo, apareces en este punto.")
        }
        className={aqui ? "btn-grande btn-salir" : "btn-grande btn-entrar"}
      >
        {aqui ? "📍 Ya me fui de aquí" : "📍 Estoy en este punto"}
      </button>

      <nav className="mt-4 flex gap-1 rounded-xl bg-slate-800/60 p-1">
        {(
          [
            ["necesidades", "Qué falta"],
            ["disponible", "Qué hay"],
            ["personas", "Personas"],
          ] as [Pestana, string][]
        ).map(([id, texto]) => (
          <button
            key={id}
            onClick={() => setPestana(id)}
            className={`flex-1 rounded-lg px-2 py-2.5 text-sm font-medium transition ${
              pestana === id ? "bg-slate-700 text-slate-50" : "text-slate-400"
            }`}
          >
            {texto}
          </button>
        ))}
      </nav>

      <div className="mt-4 space-y-4">
        {pestana === "necesidades" && (
          <>
            {punto.necesidades.length > 0 && (
              <ul className="space-y-2">
                {punto.necesidades.map((n) => {
                  const d = DEMANDA[n.nivel];
                  return (
                    <li
                      key={n.recurso}
                      className={`flex items-center gap-3 rounded-xl border p-3 ${d.borde} ${d.fondo}`}
                    >
                      <span className="text-2xl">{n.emoji}</span>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-slate-100">{n.etiqueta}</p>
                        <p className={`text-sm ${d.texto_color}`}>
                          {d.texto} · {n.confirmaciones}{" "}
                          {n.confirmaciones === 1 ? "persona" : "personas"} ·{" "}
                          {haceCuanto(n.ultimo_reporte)}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col gap-1.5">
                        <button
                          disabled={ocupado}
                          onClick={() =>
                            accion(
                              () => reportarNecesidad(punto.id, n.recurso, true, n.etiqueta),
                              `Confirmaste que falta ${n.etiqueta.toLowerCase()}.`,
                            )
                          }
                          className="btn-mini btn-falta"
                        >
                          Sí, falta
                        </button>
                        <button
                          disabled={ocupado}
                          onClick={() =>
                            accion(
                              () => reportarNecesidad(punto.id, n.recurso, false, n.etiqueta),
                              `Reportaste que ya llegó ${n.etiqueta.toLowerCase()}.`,
                            )
                          }
                          className="btn-mini btn-llego"
                        >
                          Ya llegó
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            <div>
              <p className="mb-2 text-sm font-medium text-slate-400">
                Reportar que falta algo
              </p>
              <div className="grid grid-cols-3 gap-2">
                {destacados
                  .filter((r) => !yaPedidos.has(r.slug))
                  .map((r) => (
                    <button
                      key={r.slug}
                      disabled={ocupado}
                      onClick={() =>
                        accion(
                          () => reportarNecesidad(punto.id, r.slug, true, r.etiqueta),
                          `Reportaste que falta ${r.etiqueta.toLowerCase()}.`,
                        )
                      }
                      className="btn-recurso"
                    >
                      <span className="text-2xl">{r.emoji}</span>
                      <span className="text-xs leading-tight">{r.etiqueta}</span>
                    </button>
                  ))}
              </div>
            </div>
          </>
        )}

        {pestana === "disponible" && (
          <div className="space-y-3">
            {punto.insumos.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {punto.insumos.map((i) => (
                  <li
                    key={i.recurso}
                    className="chip border-slate-600 bg-slate-700/40 text-slate-200"
                  >
                    {i.emoji} {i.etiqueta}:{" "}
                    <b className={STOCK[i.nivel].color}>{STOCK[i.nivel].texto}</b>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-sm text-slate-400">
              ¿Cuánto hay ahora mismo? Toca el recurso y luego la cantidad.
            </p>
            {destacados.slice(0, 8).map((r) => (
              <div key={r.slug} className="rounded-xl border border-slate-700 p-2.5">
                <p className="mb-2 text-sm font-medium text-slate-200">
                  {r.emoji} {r.etiqueta}
                </p>
                <div className="grid grid-cols-4 gap-1.5">
                  {NIVELES_STOCK.map((nivel) => (
                    <button
                      key={nivel}
                      disabled={ocupado}
                      onClick={() =>
                        accion(
                          () => reportarInsumo(punto.id, r.slug, nivel as NivelStock, r.etiqueta),
                          `Reportaste ${STOCK[nivel].texto.toLowerCase()} de ${r.etiqueta.toLowerCase()}.`,
                        )
                      }
                      className="btn-nivel"
                    >
                      {STOCK[nivel].texto}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {pestana === "personas" && (
          <div className="space-y-3">
            <p className="rounded-lg border border-slate-700 bg-slate-800/60 p-2.5 text-sm text-slate-300">
              Sólo cifras, sin nombres ni datos personales. Para buscar a una persona
              en concreto usa los canales oficiales: línea 123 y Cruz Roja Colombiana.
            </p>
            {(["desaparecido", "herido", "rescatado"] as EstadoPersona[]).map((estado) => {
              const actual = punto.personas_estado?.[estado] ?? 0;
              return (
                <div key={estado} className="rounded-xl border border-slate-700 p-3">
                  <div className="mb-2 flex items-baseline justify-between">
                    <span className="font-medium text-slate-200">
                      {ESTADO_PERSONA[estado]}
                    </span>
                    <span className="text-2xl font-bold text-slate-50">{actual}</span>
                  </div>
                  <div className="grid grid-cols-5 gap-1.5">
                    {[0, 1, 2, 5, 10].map((n) => (
                      <button
                        key={n}
                        disabled={ocupado}
                        onClick={() =>
                          accion(
                            () => reportarPersonas(punto.id, estado, n),
                            `Reportaste ${n} ${ESTADO_PERSONA[estado].toLowerCase()}.`,
                          )
                        }
                        className="btn-nivel"
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!punto.verificado && punto.origen !== "oficial" && (
          <div className="rounded-xl border border-slate-700 p-3">
            <p className="mb-2 text-sm text-slate-300">
              ¿Este lugar existe y la información es correcta?
            </p>
            <div className="flex gap-2">
              <button
                disabled={ocupado}
                onClick={() =>
                  accion(() => confirmarPunto(punto.id, true), "Gracias por confirmarlo.")
                }
                className="btn-mini btn-falta flex-1"
              >
                Sí, existe
              </button>
              <button
                disabled={ocupado}
                onClick={() =>
                  accion(() => confirmarPunto(punto.id, false), "Gracias, lo revisaremos.")
                }
                className="btn-mini btn-llego flex-1"
              >
                No existe
              </button>
            </div>
          </div>
        )}
      </div>

      {aviso && <p className="aviso">{aviso}</p>}
    </div>
  );
}
