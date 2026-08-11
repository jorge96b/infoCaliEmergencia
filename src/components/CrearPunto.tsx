"use client";

import { useState } from "react";
import { crearPunto, ErrorReporte } from "@/lib/reportes";
import type { TipoPunto } from "@/lib/tipos";

export default function CrearPunto({
  lat,
  lng,
  tipos,
  onCerrar,
  onCreado,
}: {
  lat: number;
  lng: number;
  tipos: TipoPunto[];
  onCerrar: () => void;
  onCreado: (id: string) => void;
}) {
  const [nombre, setNombre] = useState("");
  const [tipo, setTipo] = useState(tipos[0]?.slug ?? "otro");
  const [barrio, setBarrio] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enviar() {
    if (nombre.trim().length < 3) {
      setError("Ponle un nombre de al menos 3 letras.");
      return;
    }
    setOcupado(true);
    setError(null);
    try {
      // Si ya existe un punto del mismo tipo a menos de 40 m, el servidor
      // devuelve ese en vez de crear uno nuevo. Para quien reporta es lo mismo:
      // termina viendo el punto correcto.
      const id = await crearPunto({
        nombre: nombre.trim(),
        tipo,
        lat,
        lng,
        barrio: barrio.trim() || undefined,
        descripcion: descripcion.trim() || undefined,
      });
      onCreado(id);
    } catch (e) {
      setError(e instanceof ErrorReporte ? e.message : "No se pudo crear el punto.");
      setOcupado(false);
    }
  }

  return (
    <div className="hoja">
      <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-600" />

      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-50">Marcar un lugar</h2>
          <p className="text-sm text-slate-400">
            {lat.toFixed(5)}, {lng.toFixed(5)}
          </p>
        </div>
        <button onClick={onCerrar} aria-label="Cancelar" className="btn-icono">
          ✕
        </button>
      </header>

      <label className="etiqueta">¿Qué es este lugar?</label>
      <div className="mb-4 grid grid-cols-2 gap-2">
        {tipos.map((t) => (
          <button
            key={t.slug}
            onClick={() => setTipo(t.slug)}
            className={`flex items-center gap-2 rounded-xl border p-3 text-left text-sm transition ${
              tipo === t.slug
                ? "border-sky-500 bg-sky-500/15 text-slate-50"
                : "border-slate-700 text-slate-300"
            }`}
          >
            <span className="text-xl">{t.emoji}</span>
            <span className="leading-tight">{t.etiqueta}</span>
          </button>
        ))}
      </div>

      <label className="etiqueta" htmlFor="nombre">
        Nombre del lugar
      </label>
      <input
        id="nombre"
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        placeholder="Ej: Colegio San José"
        maxLength={80}
        className="campo mb-3"
      />

      <label className="etiqueta" htmlFor="barrio">
        Barrio <span className="font-normal text-slate-500">(opcional)</span>
      </label>
      <input
        id="barrio"
        value={barrio}
        onChange={(e) => setBarrio(e.target.value)}
        placeholder="Ej: Siloé"
        maxLength={60}
        className="campo mb-3"
      />

      <label className="etiqueta" htmlFor="descripcion">
        Detalles <span className="font-normal text-slate-500">(opcional)</span>
      </label>
      <textarea
        id="descripcion"
        value={descripcion}
        onChange={(e) => setDescripcion(e.target.value)}
        placeholder="Cómo llegar, a quién buscar, horarios…"
        maxLength={500}
        rows={3}
        className="campo mb-4"
      />

      <p className="mb-3 text-sm text-slate-400">
        No pongas nombres, teléfonos ni datos de personas. Esta información es
        pública.
      </p>

      {error && <p className="mb-3 text-sm text-red-300">{error}</p>}

      <button onClick={enviar} disabled={ocupado} className="btn-grande btn-entrar">
        {ocupado ? "Guardando…" : "Marcar este lugar"}
      </button>
    </div>
  );
}
