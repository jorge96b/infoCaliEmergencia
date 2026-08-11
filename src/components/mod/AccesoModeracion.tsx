"use client";

import { useState } from "react";

import { entrar } from "@/lib/moderacion";

export default function AccesoModeracion({ onEntro }: { onEntro: () => void }) {
  const [correo, setCorreo] = useState("");
  const [contrasena, setContrasena] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!correo.trim() || !contrasena) {
      setError("Faltan el correo y la contraseña.");
      return;
    }
    setOcupado(true);
    setError(null);
    try {
      await entrar(correo.trim(), contrasena);
      onEntro();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo entrar.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <main className="mx-auto max-w-sm p-6">
      <h1 className="mb-1 text-xl font-semibold text-slate-50">Moderación</h1>
      <p className="mb-6 text-sm text-slate-400">
        Sólo para el equipo. Las cuentas se crean a mano; no hay registro.
      </p>

      <form onSubmit={enviar}>
        <label htmlFor="correo" className="etiqueta">
          Correo
        </label>
        <input
          id="correo"
          type="email"
          autoComplete="username"
          value={correo}
          onChange={(e) => setCorreo(e.target.value)}
          className="campo mb-3"
        />

        <label htmlFor="contrasena" className="etiqueta">
          Contraseña
        </label>
        <input
          id="contrasena"
          type="password"
          autoComplete="current-password"
          value={contrasena}
          onChange={(e) => setContrasena(e.target.value)}
          className="campo mb-4"
        />

        {error && <p className="mb-3 text-sm text-red-300">{error}</p>}

        <button disabled={ocupado} className="btn-grande btn-entrar">
          {ocupado ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </main>
  );
}
