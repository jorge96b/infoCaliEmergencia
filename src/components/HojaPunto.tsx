"use client";

import { useState } from "react";
import Denunciar from "@/components/Denunciar";
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
import type { EstadoPersona, NivelStock, PuntoMapa, Recurso, TipoPunto } from "@/lib/tipos";

type Pestana = "necesidades" | "disponible" | "personas";

/** El recurso comodín del catálogo (migración 0008). Aquí manda el texto libre. */
const OTRO = "otro";
const VOLUNTARIOS = "voluntarios";

export default function HojaPunto({
  punto,
  recursos,
  porTipo,
  tipo,
  aqui,
  onCerrar,
  onCambio,
}: {
  punto: PuntoMapa;
  recursos: Recurso[];
  /** Qué recursos vienen al caso en cada tipo de lugar, agrupados por tipo. */
  porTipo: Record<string, Recurso[]>;
  /** La fila del catálogo para el tipo de este punto, si ya se cargó. */
  tipo: TipoPunto | undefined;
  aqui: boolean;
  onCerrar: () => void;
  onCambio: () => void;
}) {
  const [pestana, setPestana] = useState<Pestana>("necesidades");
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [escribiendo, setEscribiendo] = useState(false);
  const [libre, setLibre] = useState("");

  /** Comparte el enlace directo al punto; si no hay hoja nativa, lo copia. */
  async function compartir() {
    const url = `${window.location.origin}?p=${punto.id}`;
    try {
      if (navigator.share) {
        await navigator.share({
          title: punto.nombre,
          text: `${punto.nombre} — ${punto.tipo_etiqueta}${punto.barrio ? ` · ${punto.barrio}` : ""}`,
          url,
        });
      } else {
        await navigator.clipboard.writeText(url);
        setAviso("Enlace copiado.");
        setTimeout(() => setAviso(null), 4000);
      }
    } catch {
      // La persona canceló la hoja de compartir, o el portapapeles no estaba
      // disponible. No es un error que valga la pena mostrar.
    }
  }

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

  // Lo que se pide en un albergue no es lo que se pide en un colapso: la
  // grilla se arma con la lista del tipo de este punto. El respaldo a los
  // destacados de siempre es por si un tipo se quedara sin lista; más vale una
  // grilla genérica que una vacía.
  const delTipo = porTipo[punto.tipo] ?? [];
  const base = delTipo.length > 0 ? delTipo : recursos.filter((r) => r.destacado);

  const yaPedidos = new Set(punto.necesidades.map((n) => n.recurso));

  // "Otra cosa" sale de la grilla rápida y se maneja aparte: es lo único que no
  // se puede reportar de un toque, porque sin el texto no dice nada. Y a
  // diferencia del resto no se esconde cuando ya se pidió una vez, porque la
  // siguiente puede ser una cosa distinta.
  // `otro` se busca en el catálogo completo y no en la lista del tipo: no
  // pertenece a ningún tipo en particular, y ahora es la única vía para
  // reportar algo que nadie previó.
  const otro = recursos.find((r) => r.slug === OTRO);
  // Voluntarios sale de la grilla: tiene su propio bloque arriba y pedir lo
  // mismo en dos sitios sólo confunde sobre cuál de los dos cuenta.
  const rapidos = base.filter(
    (r) => r.slug !== OTRO && r.slug !== VOLUNTARIOS && !yaPedidos.has(r.slug),
  );

  // El estado actual de voluntarios sale de las mismas necesidades que todo lo
  // demás: mismo consenso, mismo decaimiento. Lo único distinto es el peso que
  // se le da en pantalla.
  const voluntarios = punto.necesidades.find((n) => n.recurso === VOLUNTARIOS) ?? null;
  const otrasNecesidades = punto.necesidades.filter((n) => n.recurso !== VOLUNTARIOS);

  // "Qué hay" usa la misma lista del tipo. `otro` no cabe aquí: no se puede
  // reportar cuánto hay de un texto libre.
  const disponibles = base.filter((r) => r.slug !== OTRO);

  // En un albergue o un centro de acopio no hay personas afectadas que contar:
  // hay gente alojada y gente trabajando, y eso ya se mide con la presencia.
  // Preguntar allí por desaparecidos invita a escribir una cifra inventada que
  // termina sumándose al contador de toda la ciudad.
  //
  // Cuando el catálogo todavía no ha cargado —o la migración 0013 no está
  // aplicada— el campo llega indefinido y la pestaña se muestra. Es la
  // dirección segura del error: enseñarla de más en un albergue es ruido;
  // esconderla en un colapso sería quitar la casilla donde más urge llenarla.
  const cuentaPersonas = tipo?.reporta_personas !== false;

  // El catálogo puede llegar después de abrir la ficha. Si para entonces había
  // alguien en la pestaña de personas, se cae a la primera en vez de dejar un
  // hueco en blanco donde estaba el contenido.
  const activa: Pestana = pestana === "personas" && !cuentaPersonas ? "necesidades" : pestana;

  async function enviarOtro() {
    const texto = libre.trim();
    if (texto.length < 3) {
      setAviso("Escribe qué falta, aunque sea en dos palabras.");
      setTimeout(() => setAviso(null), 4000);
      return;
    }
    setLibre("");
    setEscribiendo(false);
    await accion(
      () => reportarNecesidad(punto.id, OTRO, true, texto, texto),
      `Reportaste que falta ${texto.toLowerCase()}.`,
    );
  }

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
        <div className="flex shrink-0 items-center gap-1.5">
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${punto.lat},${punto.lng}`}
            target="_blank"
            rel="noopener"
            aria-label="Cómo llegar"
            className="btn-icono"
          >
            🧭
          </a>
          <button onClick={compartir} aria-label="Compartir" className="btn-icono">
            🔗
          </button>
          <button onClick={onCerrar} aria-label="Cerrar" className="btn-icono">
            ✕
          </button>
        </div>
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

      {/* Voluntarios tiene sección propia y no una casilla más en la grilla.
          Es la necesidad que más se repite y la que más rápido cambia: cuando
          llega gente sobra en minutos, y cuando falta no da tiempo de buscarla
          entre veintitantos recursos. */}
      <section className="mt-4 rounded-xl border border-slate-700 p-3">
        <div className="mb-2 flex items-start gap-2">
          <span aria-hidden className="text-2xl leading-none">
            🙋
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-medium leading-snug text-slate-100">
              ¿Necesitan voluntarios aquí?
            </p>
            {voluntarios ? (
              <p className={`text-sm ${DEMANDA[voluntarios.nivel].texto_color}`}>
                {DEMANDA[voluntarios.nivel].texto} · {voluntarios.confirmaciones}{" "}
                {voluntarios.confirmaciones === 1 ? "persona" : "personas"} ·{" "}
                {haceCuanto(voluntarios.ultimo_reporte)}
              </p>
            ) : (
              <p className="text-sm text-slate-400">Nadie lo ha reportado todavía.</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            disabled={ocupado}
            onClick={() =>
              accion(
                () => reportarNecesidad(punto.id, VOLUNTARIOS, true, "Voluntarios"),
                "Reportaste que faltan voluntarios aquí.",
              )
            }
            className="btn-grande btn-falta"
          >
            Sí, faltan
          </button>
          <button
            disabled={ocupado}
            onClick={() =>
              accion(
                () => reportarNecesidad(punto.id, VOLUNTARIOS, false, "Voluntarios"),
                "Reportaste que ya no hacen falta voluntarios.",
              )
            }
            className="btn-grande btn-llego"
          >
            Ya no hacen falta
          </button>
        </div>
      </section>

      <nav className="mt-4 flex gap-1 rounded-xl bg-slate-800/60 p-1">
        {(
          [
            ["necesidades", "Qué falta"],
            ["disponible", "Qué hay"],
            ...(cuentaPersonas ? [["personas", "Personas"]] : []),
          ] as [Pestana, string][]
        ).map(([id, texto]) => (
          <button
            key={id}
            onClick={() => setPestana(id)}
            className={`flex-1 rounded-lg px-2 py-2.5 text-sm font-medium transition ${
              activa === id ? "bg-slate-700 text-slate-50" : "text-slate-400"
            }`}
          >
            {texto}
          </button>
        ))}
      </nav>

      <div className="mt-4 space-y-4">
        {activa === "necesidades" && (
          <>
            {otrasNecesidades.length > 0 && (
              <ul className="space-y-2">
                {otrasNecesidades.map((n) => {
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
                        {/* Lo que la gente escribió. En "Otra cosa" es el dato:
                            sin esto la fila diría que falta algo sin decir qué. */}
                        {n.notas && n.notas.length > 0 && (
                          <ul className="mt-2 space-y-1.5">
                            {n.notas.map((nota) => (
                              <li
                                key={nota.id}
                                className="rounded-lg border border-slate-700 bg-slate-900/60 px-2.5 py-1.5"
                              >
                                <p className="break-words text-sm text-slate-200">
                                  “{nota.texto}”
                                </p>
                                <Denunciar
                                  tabla="necesidad_reportes"
                                  filaId={nota.id}
                                  ocupado={ocupado}
                                  accion={accion}
                                  texto="Denunciar esta nota"
                                />
                              </li>
                            ))}
                          </ul>
                        )}
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
                {rapidos.map((r) => (
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

                {otro && !escribiendo && (
                  <button
                    disabled={ocupado}
                    onClick={() => setEscribiendo(true)}
                    aria-expanded={false}
                    className="btn-recurso border-dashed"
                  >
                    <span className="text-2xl">{otro.emoji}</span>
                    <span className="text-xs leading-tight">{otro.etiqueta}</span>
                  </button>
                )}
              </div>

              {otro && escribiendo && (
                <div className="mt-2 rounded-xl border border-slate-700 p-3">
                  <label htmlFor="otra-necesidad" className="etiqueta">
                    ¿Qué más falta aquí?
                  </label>
                  <textarea
                    id="otra-necesidad"
                    value={libre}
                    onChange={(e) => setLibre(e.target.value.slice(0, 280))}
                    maxLength={280}
                    rows={2}
                    autoFocus
                    placeholder="Ej: una grúa, pañales de adulto, carpas grandes…"
                    className="campo"
                  />
                  <p className="mt-1.5 text-xs text-slate-500">
                    Esto lo lee cualquiera. No pongas nombres, teléfonos ni datos de
                    personas.
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      disabled={ocupado || libre.trim().length < 3}
                      onClick={enviarOtro}
                      className="btn-mini btn-falta flex-1"
                    >
                      Reportar
                    </button>
                    <button
                      onClick={() => {
                        setEscribiendo(false);
                        setLibre("");
                      }}
                      className="btn-mini btn-llego"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {activa === "disponible" && (
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
            {/* Antes cortaba en los ocho primeros destacados, sin ningún
                criterio: bastaba añadir un recurso con `orden` bajo para que
                los medicamentos desaparecieran de aquí sin que nadie lo notara.
                Ahora es la lista del tipo, completa. */}
            {disponibles.map((r) => (
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

        {activa === "personas" && (
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

        <Denunciar tabla="puntos" filaId={punto.id} ocupado={ocupado} accion={accion} />
      </div>

      {aviso && (
        <p className="aviso" role="status" aria-live="polite">
          {aviso}
        </p>
      )}
    </div>
  );
}
