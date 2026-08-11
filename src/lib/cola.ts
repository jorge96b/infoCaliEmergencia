import { get, set } from "idb-keyval";
import { supabase } from "./supabase";

/**
 * Bandeja de salida en IndexedDB.
 *
 * Cuando no hay señal, el reporte se guarda aquí y se envía solo cuando vuelve.
 * Para quien reporta la acción se siente instantánea, que es justo lo que hace
 * falta cuando se está de pie en la calle con una barra de cobertura.
 *
 * Lo difícil de una cola así no es guardarla, es no duplicar al reenviarla: el
 * caso que rompe estas apps es que la petición llegue al servidor pero la
 * respuesta se pierda, y el cliente reintente creyendo que falló. Aquí eso está
 * resuelto de raíz: cada acción lleva un `client_id` generado ANTES del primer
 * intento de red, y todas las funciones del servidor son idempotentes sobre él.
 * Se puede reenviar la cola cien veces y sigue produciendo una sola fila.
 */

const CLAVE = "mushu-cola-v1";
const MAX_INTENTOS = 8;

export type Pendiente = {
  client_id: string;
  fn: string;
  args: Record<string, unknown>;
  /** Texto para el indicador: "Falta agua en Colegio Santa Librada". */
  descripcion: string;
  creado_en: number;
  intentos: number;
};

/**
 * Errores que no van a mejorar por reintentar: el servidor respondió y dijo que
 * no. Reintentarlos sería dejar la cola atascada para siempre.
 *
 * `23505` (clave duplicada) cuenta como éxito, no como fallo: significa que ese
 * mismo `client_id` ya está guardado, que es exactamente lo que queríamos.
 */
const PERMANENTES = new Set(["23505", "23514", "23503", "22P02", "42501", "42883"]);

const oyentes = new Set<(n: number) => void>();

function notificar(n: number) {
  for (const f of oyentes) f(n);
}

export function suscribir(f: (n: number) => void): () => void {
  oyentes.add(f);
  void pendientes().then((c) => f(c.length));
  return () => {
    oyentes.delete(f);
  };
}

export async function pendientes(): Promise<Pendiente[]> {
  return (await get<Pendiente[]>(CLAVE)) ?? [];
}

async function guardar(cola: Pendiente[]) {
  await set(CLAVE, cola);
  notificar(cola.length);
}

export async function encolar(p: Omit<Pendiente, "intentos" | "creado_en">) {
  const cola = await pendientes();
  // Si ya está encolada la misma acción, no se duplica la entrada.
  if (cola.some((x) => x.client_id === p.client_id)) return;
  cola.push({ ...p, intentos: 0, creado_en: Date.now() });
  await guardar(cola);
}

// Cerrojo: `online`, `visibilitychange` y el temporizador pueden dispararse
// casi a la vez. Sin esto, dos vaciados simultáneos mandarían cada reporte dos
// veces; el `client_id` lo haría inofensivo, pero es tráfico desperdiciado
// justo cuando la red está peor.
let enVuelo = false;

export async function vaciar(): Promise<void> {
  if (enVuelo) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) return;

  enVuelo = true;
  try {
    const cola = await pendientes();
    if (cola.length === 0) return;

    const quedan: Pendiente[] = [];

    for (const item of cola) {
      try {
        const { error } = await supabase().rpc(item.fn, item.args);

        if (error) {
          // Con código, el servidor respondió. Sin código, fue la red.
          if (error.code && PERMANENTES.has(error.code)) continue;
          if (item.intentos + 1 >= MAX_INTENTOS) continue;
          quedan.push({ ...item, intentos: item.intentos + 1 });
        }
      } catch {
        if (item.intentos + 1 < MAX_INTENTOS) {
          quedan.push({ ...item, intentos: item.intentos + 1 });
        }
      }
    }

    await guardar(quedan);
  } finally {
    enVuelo = false;
  }
}

/**
 * Conecta el vaciado a las tres señales que importan: recuperar conexión,
 * volver a la app, y un reloj de respaldo por si ninguna de las dos se dispara
 * (pasa con las redes móviles inestables, donde `online` no siempre llega).
 */
export function arrancarCola(): () => void {
  const alRecuperar = () => void vaciar();
  const alVolver = () => {
    if (document.visibilityState === "visible") void vaciar();
  };

  window.addEventListener("online", alRecuperar);
  document.addEventListener("visibilitychange", alVolver);
  const reloj = setInterval(alRecuperar, 30_000);

  void vaciar();

  return () => {
    window.removeEventListener("online", alRecuperar);
    document.removeEventListener("visibilitychange", alVolver);
    clearInterval(reloj);
  };
}
