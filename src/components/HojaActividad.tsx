"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import Denunciar from "@/components/Denunciar";
import { cargarActividad } from "@/lib/datos";
import {
  EVENTO,
  franjaDia,
  haceCuanto,
  llegoTarde,
  tituloEvento,
} from "@/lib/formato";
import { ErrorReporte, type Resultado } from "@/lib/reportes";
import type { Evento } from "@/lib/tipos";

/**
 * Línea de tiempo de lo que se va reportando en toda la ciudad.
 *
 * El mapa responde "cómo está este punto"; esto responde "qué está pasando".
 * Son preguntas distintas y por eso los datos vienen de sitios distintos: aquí
 * son filas sueltas en orden cronológico, no el agregado con decaimiento.
 *
 * Se refresca sola cada 30 s, y sólo mientras está montada. El intervalo hace
 * además de reloj de los "hace N min": el texto es una función pura de
 * `Date.now()`, así que se actualiza porque el componente se vuelve a dibujar.
 */

const REFRESCO_MS = 30_000;
const INICIAL = 60;
const MAXIMO = 150;

export default function HojaActividad({
  onCerrar,
  onIrAPunto,
}: {
  onCerrar: () => void;
  onIrAPunto: (evento: Evento) => void;
}) {
  // `null` es "todavía no se sabe", que no es lo mismo que "no hay nada": con
  // mala señal la diferencia entre las dos pantallas es lo único que dice si
  // vale la pena esperar.
  const [eventos, setEventos] = useState<Evento[] | null>(null);
  const [limite, setLimite] = useState(INICIAL);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const refrescar = useCallback(async () => {
    try {
      setEventos(await cargarActividad(limite));
      setError(null);
    } catch (e) {
      // No se borra lo que ya se estaba viendo: un fallo pasajero de red no
      // debe dejar la pantalla en blanco. El detalle va incluido porque decir
      // sólo "sin conexión" esconde los fallos que no son de conexión.
      const detalle = e instanceof Error ? e.message : String(e);
      setError(`No se pudo leer del servidor. Reintentando… (${detalle})`);
    }
  }, [limite]);

  // Subir el límite recrea `refrescar` y con ello vuelve a correr este efecto,
  // que es justo lo que debe pasar al tocar "Ver más".
  useEffect(() => {
    // La primera carga va envuelta y no llamada a secas: `refrescar` acaba en
    // un setState y hacerlo en el cuerpo del efecto encadena un render de más.
    void (async () => {
      await refrescar();
    })();

    const reloj = setInterval(() => void refrescar(), REFRESCO_MS);
    const alVolver = () => {
      if (document.visibilityState === "visible") void refrescar();
    };
    document.addEventListener("visibilitychange", alVolver);

    return () => {
      clearInterval(reloj);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [refrescar]);

  /** Envoltorio común: bloquea, ejecuta, avisa y refresca. */
  async function accion(fn: () => Promise<Resultado>, exito: string) {
    setOcupado(true);
    setAviso(null);
    try {
      const resultado = await fn();
      setAviso(
        resultado === "encolado"
          ? "Guardado. Se enviará solo cuando vuelva la señal."
          : exito,
      );
      await refrescar();
    } catch (e) {
      setAviso(e instanceof ErrorReporte ? e.message : "No se pudo enviar. Intenta de nuevo.");
    } finally {
      setOcupado(false);
      setTimeout(() => setAviso(null), 4000);
    }
  }

  // Agrupado por día. Como la vista sólo trae 24 h, salen "Hoy" y a lo sumo
  // "Ayer", así que cada franja aparece una vez y sirve de clave.
  const grupos = useMemo(() => {
    const salida: { franja: string; eventos: Evento[] }[] = [];
    for (const e of eventos ?? []) {
      const franja = franjaDia(e.ocurrido_en);
      const ultimo = salida[salida.length - 1];
      if (ultimo && ultimo.franja === franja) ultimo.eventos.push(e);
      else salida.push({ franja, eventos: [e] });
    }
    return salida;
  }, [eventos]);

  return (
    <div className="hoja">
      <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-600" />

      <header className="mb-4 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-slate-50">Lo que se está reportando</h2>
          <p className="text-sm text-slate-400">Últimas 24 horas en toda la ciudad</p>
        </div>
        <button onClick={onCerrar} aria-label="Cerrar" className="btn-icono">
          ✕
        </button>
      </header>

      {error && (
        <p className="mb-3 rounded-xl border border-amber-600/50 bg-amber-950/90 px-3 py-2.5 text-center text-sm text-amber-200">
          {error}
        </p>
      )}

      {eventos === null && !error && (
        <p className="py-8 text-center text-sm text-slate-500">Cargando…</p>
      )}

      {eventos !== null && eventos.length === 0 && (
        <p className="rounded-xl border border-slate-700 bg-slate-900/60 p-6 text-center text-sm text-slate-500">
          Todavía no hay reportes en las últimas 24 horas.
        </p>
      )}

      {grupos.map((g) => (
        <section key={g.franja}>
          {/* `-top-4` y el sangrado negativo no son adorno: el sticky se ancla
              en la caja de relleno de `.hoja`, que tiene `p-4`, así que con
              `top-0` el contenido se cuela por ese centímetro de arriba y por
              los lados y parece un fallo de pintado. */}
          <h3 className="sticky -top-4 z-10 -mx-4 bg-slate-900/97 px-4 pb-2 pt-6 text-xs font-semibold uppercase tracking-wide text-slate-500 backdrop-blur">
            {g.franja}
          </h3>
          {/* El filo de la izquierda es lo que convierte la lista en una línea
              de tiempo: las insignias van montadas encima de él. En `slate-800`
              —el borde habitual del proyecto— no se distingue del fondo de la
              hoja y la lista vuelve a parecer una lista suelta, así que aquí va
              un tono más claro a propósito. */}
          <ul className="ml-4 border-l border-slate-700">
            {g.eventos.map((e) => (
              <Tarjeta
                key={`${e.tabla}:${e.fila_id}`}
                evento={e}
                ocupado={ocupado}
                accion={accion}
                onIr={() => onIrAPunto(e)}
              />
            ))}
          </ul>
        </section>
      ))}

      {eventos !== null && eventos.length >= limite && limite < MAXIMO && (
        <button onClick={() => setLimite(MAXIMO)} className="btn-grande btn-salir mt-3">
          Ver más
        </button>
      )}

      {aviso && <p className="aviso">{aviso}</p>}
    </div>
  );
}

function Tarjeta({
  evento,
  ocupado,
  accion,
  onIr,
}: {
  evento: Evento;
  ocupado: boolean;
  accion: (fn: () => Promise<Resultado>, exito: string) => void;
  onIr: () => void;
}) {
  const v = EVENTO[evento.accion];

  return (
    <li className="relative py-3 pl-8">
      {/* El emoji del recurso o del tipo de lugar dice más que cualquier icono
          genérico; el del tipo de evento sólo entra cuando no hay ninguno. */}
      <span
        aria-hidden
        className={`absolute -left-4 top-3 grid h-8 w-8 place-items-center rounded-full border text-base ${v.borde} ${v.fondo}`}
      >
        {evento.emoji ?? v.emoji}
      </span>

      <p className={`font-medium ${v.color}`}>{tituloEvento(evento)}</p>

      <p className="text-sm text-slate-400">
        {evento.punto_emoji} {evento.punto}
        {evento.barrio ? ` · ${evento.barrio}` : ""}
      </p>

      {evento.nota && (
        <p className="mt-1 line-clamp-3 text-sm text-slate-300">«{evento.nota}»</p>
      )}

      <p className="mt-1 text-xs text-slate-500">
        {haceCuanto(evento.ocurrido_en)}
        {/* Un reporte que estuvo encolado sin señal llega tarde. Decirlo evita
            que parezca que la lista está mal ordenada. */}
        {llegoTarde(evento) ? " · llegó con retraso" : ""}
      </p>

      <button
        onClick={onIr}
        className="btn-mini mt-2 border border-slate-600 bg-slate-800 text-slate-200 active:bg-slate-700"
      >
        Ver en el mapa
      </button>

      <Denunciar
        tabla={evento.tabla}
        filaId={evento.fila_id}
        ocupado={ocupado}
        accion={accion}
      />
    </li>
  );
}
