"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { suscribir } from "@/lib/cola";

/**
 * Sin señal, la persona tiene que saber dos cosas de inmediato: que la app se
 * dio cuenta, y que lo que reportó no se perdió. Callarse cualquiera de las dos
 * hace que la gente reporte otra vez, o que deje de reportar.
 */

function suscribirRed(alCambiar: () => void) {
  window.addEventListener("online", alCambiar);
  window.addEventListener("offline", alCambiar);
  return () => {
    window.removeEventListener("online", alCambiar);
    window.removeEventListener("offline", alCambiar);
  };
}

export default function EstadoConexion() {
  // `useSyncExternalStore` es la forma correcta de leer un estado que vive fuera
  // de React, como el del navegador: se suscribe y lee sin provocar un render en
  // cascada. El tercer argumento es lo que se asume al renderizar en el
  // servidor, donde `navigator` no existe.
  const enLinea = useSyncExternalStore(
    suscribirRed,
    () => navigator.onLine,
    () => true,
  );

  // La cola vive en IndexedDB, así que se lee de forma asíncrona y llega por
  // suscripción. El vaciado no se dispara aquí: de eso ya se encarga
  // `arrancarCola`, que escucha las mismas señales.
  const [cola, setCola] = useState(0);
  useEffect(() => suscribir(setCola), []);

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
