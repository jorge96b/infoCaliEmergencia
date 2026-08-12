import { set } from "idb-keyval";

import { idDispositivo } from "./dispositivo";
import { configurado, supabase } from "./supabase";
import type { EstadoPush } from "./tipos";

/**
 * Alta y baja de las notificaciones push, desde el navegador.
 *
 * Es lo único de la app que se pide de forma explícita, y hay una razón: el
 * resto se puede usar sin conceder nada, y esto no. Por eso nunca se pide el
 * permiso al arrancar —el momento en que más gente lo deniega para siempre—
 * sino sólo cuando alguien toca el interruptor de la hoja de avisos.
 *
 * La ubicación funciona parecido pero se guarda distinto: la exacta se queda en
 * IndexedDB de este teléfono, para que el service worker pueda afinar la
 * distancia sin preguntarle a nadie; al servidor sólo sube redondeada a dos
 * decimales, poco más de un kilómetro. Redondear aquí no sustituye al redondeo
 * del servidor (`fn_rejilla` en la migración 0011), lo complementa: así la
 * posición precisa no llega a viajar ni a aparecer en un log intermedio.
 */

const CLAVE_UBICACION = "ice-ubicacion";

const VAPID = (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "")
  .trim()
  .replace(/^["']|["']$/g, "")
  .trim();

/**
 * Sin clave VAPID no hay push posible, y el interruptor no debe ni aparecer:
 * enseñar un botón que no puede funcionar es peor que no enseñar nada.
 */
export const pushConfigurado = VAPID.length >= 40 && configurado;

/**
 * La clave viaja en base64url y `subscribe` la quiere en bytes.
 *
 * El búfer se crea explícito en vez de dejar que `new Uint8Array(n)` lo elija:
 * así el tipo es `ArrayBuffer` y no `ArrayBufferLike`, que incluye
 * `SharedArrayBuffer` y no encaja donde se espera un `BufferSource`.
 */
function claveAplicacion(base64: string): Uint8Array<ArrayBuffer> {
  const relleno = "=".repeat((4 - (base64.length % 4)) % 4);
  const normal = (base64 + relleno).replace(/-/g, "+").replace(/_/g, "/");
  const bruto = window.atob(normal);
  const bytes = new Uint8Array(new ArrayBuffer(bruto.length));
  for (let i = 0; i < bruto.length; i += 1) bytes[i] = bruto.charCodeAt(i);
  return bytes;
}

function soportado(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** iPadOS 13+ se anuncia como Mac, así que el táctil es parte de la prueba. */
function esIOS(): boolean {
  const ua = navigator.userAgent;
  return (
    /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  );
}

function instalada(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

async function suscripcionActual(): Promise<PushSubscription | null> {
  if (!soportado()) return null;
  const registro = await navigator.serviceWorker.getRegistration();
  return (await registro?.pushManager.getSubscription()) ?? null;
}

export async function estadoPush(): Promise<EstadoPush> {
  // En iOS el push sólo existe si la app está añadida a la pantalla de inicio
  // (16.4+). Se comprueba antes que el soporte porque en Safari a secas las API
  // pueden estar declaradas y aun así fallar al suscribirse, y "no compatible"
  // sería una respuesta falsa: sí lo es, hace falta instalarla.
  if (typeof window !== "undefined" && esIOS() && !instalada()) return "requiere_instalar";
  if (!soportado()) return "no_soportado";
  if (Notification.permission === "denied") return "denegado";
  return (await suscripcionActual()) ? "activo" : "inactivo";
}

async function registrar(suscripcion: PushSubscription): Promise<void> {
  const { keys } = suscripcion.toJSON() as { keys?: { p256dh?: string; auth?: string } };
  if (!keys?.p256dh || !keys.auth) {
    throw new Error("El navegador devolvió una suscripción sin claves.");
  }

  const { error } = await supabase().rpc("rpc_push_suscribir", {
    p_dispositivo: idDispositivo(),
    p_endpoint: suscripcion.endpoint,
    p_p256dh: keys.p256dh,
    p_auth: keys.auth,
  });
  if (error) throw new Error(error.message);
}

export async function activarPush(): Promise<EstadoPush> {
  // Las tres comprobaciones son síncronas y esto no es casualidad:
  // `requestPermission()` tiene que salir dentro del gesto del usuario que lo
  // pidió. Cualquier `await` antes rompe esa cadena y Safari —el navegador
  // donde más caro sale, porque ahí el push ya cuesta instalar la app— descarta
  // la petición sin enseñar nada. Por eso aquí no se llama a `estadoPush()`,
  // que sí espera.
  if (esIOS() && !instalada()) return "requiere_instalar";
  if (!soportado()) return "no_soportado";
  if (Notification.permission === "denied") return "denegado";

  const permiso = await Notification.requestPermission();
  if (permiso !== "granted") return permiso === "denied" ? "denegado" : "inactivo";

  const registro = await navigator.serviceWorker.ready;
  const suscripcion =
    (await registro.pushManager.getSubscription()) ??
    (await registro.pushManager.subscribe({
      // Obligatorio en todos los navegadores: prometemos que cada push produce
      // una notificación visible. `sw.js` lo cumple sin excepciones.
      userVisibleOnly: true,
      applicationServerKey: claveAplicacion(VAPID),
    }));

  await registrar(suscripcion);
  return "activo";
}

export async function desactivarPush(): Promise<EstadoPush> {
  const suscripcion = await suscripcionActual();
  if (suscripcion) {
    // El orden importa: primero la baja en el servidor y después soltar la
    // suscripción. Al revés, un fallo de red dejaría al servidor mandando
    // notificaciones a un endpoint que este teléfono ya no escucha, y tardaría
    // hasta el primer 410 en enterarse.
    const { error } = await supabase().rpc("rpc_push_baja", {
      p_dispositivo: idDispositivo(),
      p_endpoint: suscripcion.endpoint,
    });
    if (error) throw new Error(error.message);
    await suscripcion.unsubscribe();
  }
  return "inactivo";
}

/**
 * Vuelve a registrar la suscripción que ya tenga el navegador.
 *
 * Hace falta porque el navegador rota el endpoint por su cuenta: `sw.js` rehace
 * la suscripción cuando eso pasa, pero deliberadamente no escribe en la base
 * —ahí no pasa ninguna escritura— así que la reconciliación ocurre aquí, al
 * abrir la app. Es idempotente: `rpc_push_suscribir` reconcilia por `endpoint`.
 *
 * No pide permisos ni suscribe a nadie que no lo estuviera ya.
 */
export async function reconciliarPush(): Promise<void> {
  if (!pushConfigurado) return;
  const suscripcion = await suscripcionActual();
  if (!suscripcion) return;
  try {
    await registrar(suscripcion);
  } catch {
    // Accesorio: si falla, se reintenta en la siguiente apertura.
  }
}

/**
 * Guarda dónde está la persona. Dos destinos y dos precisiones distintas.
 *
 * La exacta se queda en este teléfono y la lee el service worker para decidir si
 * una notificación vibra. La aproximada sube al servidor, que la necesita para
 * saber a quién mandarle qué; sin ella, la prioridad por cercanía no existe.
 *
 * Lo segundo sólo pasa si las notificaciones están activadas. Quien no las
 * quiere no manda su ubicación a ninguna parte.
 */
export async function guardarUbicacion(lat: number, lng: number): Promise<void> {
  try {
    await set(CLAVE_UBICACION, { lat, lng, en: Date.now() });
  } catch {
    // Sin IndexedDB el push sigue llegando, sólo pierde el ajuste fino.
  }

  if (!pushConfigurado) return;
  if (!(await suscripcionActual())) return;

  const { error } = await supabase().rpc("rpc_push_ubicacion", {
    p_dispositivo: idDispositivo(),
    p_lat: Math.round(lat * 100) / 100,
    p_lng: Math.round(lng * 100) / 100,
  });
  if (error) throw new Error(error.message);
}
