"use client";

import { useEffect, useState } from "react";
import { suscribir, vaciar } from "@/lib/cola";

/**
 * Sin señal, la persona tiene que saber dos cosas de inmediato: que la app se
 * dio cuenta, y que lo que reportó no se perdió. Callarse cualquiera de las dos
 * hace que la gente reporte otra vez, o que deje de reportar.
 */
export default function EstadoConexion() {
  const [enLinea, setEnLinea] = useState(true);
  const [cola, setCola] = useState(0);

  useEffect(() => {
    setEnLinea(navigator.onLine);

    const conectado = () => {
      setEnLinea(true);
      void vaciar();
    };
    const desconectado = () => setEnLinea(false);

    window.addEventListener("online", conectado);
    window.addEventListener("offline", desconectado);
    const desuscribir = suscribir(setCola);

    return () => {
      window.removeEventListener("online", conectado);
      window.removeEventListener("offline", desconectado);
      desuscribir();
    };
  }, []);

  if (enLinea && cola === 0) return null;

  return (
    <div className={`estado ${enLinea ? "estado-cola" : "estado-sin-red"}`}>
      {!enLinea && <span>Sin señal. Puedes seguir reportando.</span>}
      {cola > 0 && (
        <span>
          {enLinea ? "Enviando " : "Guardados "}
          <b>{cola}</b> {cola === 1 ? "reporte" : "reportes"}
          {enLinea ? "…" : " para cuando vuelva la señal."}
        </span>
      )}
    </div>
  );
}
