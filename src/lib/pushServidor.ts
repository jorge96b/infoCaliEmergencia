import { createHash, timingSafeEqual } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import webpush, { WebPushError } from "web-push";

import { LEJOS_M, construirCarga, tramoPorDistancia, type Tramo } from "./pushTramos";
import { urlEnUso } from "./supabase";
import type { CargaPush, OrigenPush, PrioridadPush } from "./tipos";

/**
 * El único código de este proyecto que corre en un servidor nuestro.
 *
 * Todo lo demás va del navegador a Supabase con la `anon key`, que es pública
 * por diseño. Enviar un push no se puede hacer así: exige firmar cada mensaje
 * con una clave privada VAPID, y exige leer los endpoints de la gente, que son
 * credenciales de envío. Ninguna de las dos cosas puede estar en el navegador.
 *
 * De ahí las dos reglas de este archivo:
 *
 *   · Nada de aquí se importa jamás desde un componente. Si algún día alguien lo
 *     hace, `VAPID_PRIVATE_KEY` llegaría al bundle como `undefined` y el envío
 *     fallaría en silencio — que es peor que romperse.
 *
 *   · La clave de servicio se salta RLS por completo. Por eso el acceso a la
 *     base pasa sólo por los cuatro `rpc_push_*` de servidor de la migración
 *     0011, que son estrechos a propósito, y nunca por consultas sueltas.
 */

function limpio(bruto: string | undefined): string {
  return (bruto ?? "").trim().replace(/^["']|["']$/g, "").trim();
}

const SERVICIO = limpio(process.env.SUPABASE_SERVICE_ROLE_KEY);
const VAPID_PUBLICA = limpio(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);
const VAPID_PRIVADA = limpio(process.env.VAPID_PRIVATE_KEY);
const VAPID_SUJETO = limpio(process.env.VAPID_SUBJECT);
const SECRETO = limpio(process.env.PUSH_WEBHOOK_SECRET);

/**
 * Qué falta para poder enviar, o null si no falta nada.
 *
 * Mismo criterio que `problemaConfiguracion` en `supabase.ts`: decir cuál de las
 * variables está mal, y no un "error al enviar" que deja la causa a tres
 * pantallas de distancia. Aquí importa más todavía, porque nadie mira estos logs
 * hasta que alguien se queja de que no le llegan las notificaciones.
 */
export const problemaPush: string | null = (() => {
  if (!urlEnUso) return "Falta NEXT_PUBLIC_SUPABASE_URL.";
  if (!SERVICIO) return "Falta SUPABASE_SERVICE_ROLE_KEY.";
  if (!VAPID_PUBLICA) return "Falta NEXT_PUBLIC_VAPID_PUBLIC_KEY.";
  if (!VAPID_PRIVADA) return "Falta VAPID_PRIVATE_KEY.";
  if (!VAPID_SUJETO) return "Falta VAPID_SUBJECT (un 'mailto:' o una URL https).";
  if (!/^(mailto:|https:\/\/)/i.test(VAPID_SUJETO)) {
    return "VAPID_SUBJECT tiene que empezar por 'mailto:' o 'https://'.";
  }
  if (!SECRETO) return "Falta PUSH_WEBHOOK_SECRET.";
  return null;
})();

/**
 * Compara el secreto en tiempo constante.
 *
 * Los dos textos se pasan primero por sha256 y no por su forma cruda: además de
 * lo evidente, `timingSafeEqual` revienta si los búferes miden distinto, así
 * que sin el hash la propia longitud del secreto se filtraría por la diferencia
 * entre "falso" y "excepción".
 */
export function secretoValido(recibido: string | null | undefined): boolean {
  if (!SECRETO || !recibido) return false;
  return timingSafeEqual(
    createHash("sha256").update(SECRETO).digest(),
    createHash("sha256").update(recibido).digest(),
  );
}

let cliente: SupabaseClient | null = null;

function servicio(): SupabaseClient {
  if (!cliente) {
    // Sin `x-device-id`, a propósito y por el mismo motivo que el cliente de
    // moderación tampoco lo manda: esto no actúa en nombre de ningún teléfono.
    cliente = createClient(urlEnUso, SERVICIO, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cliente;
}

let vapidListo = false;

function asegurarVapid() {
  if (vapidListo) return;
  webpush.setVapidDetails(VAPID_SUJETO, VAPID_PUBLICA, VAPID_PRIVADA);
  vapidListo = true;
}

// ---------------------------------------------------------------------------
// Reparto
// ---------------------------------------------------------------------------

/**
 * Un hecho que merece una notificación.
 *
 * `lat` nulo significa "toda la ciudad": es el caso de los avisos oficiales, que
 * no tienen coordenadas porque un toque de queda no las tiene. Cuando las hay,
 * sólo se avisa dentro de `LEJOS_M`.
 *
 * `tramo` fijo es para lo oficial, donde la prioridad la marca la severidad y no
 * la distancia. Si va nulo, lo decide la cercanía.
 */
export type Senal = {
  origen: OrigenPush;
  /** Clave de idempotencia dentro de su origen. */
  fila_id: string;
  titulo: string;
  cuerpo: string;
  etiqueta: string;
  punto_id: string | null;
  lat: number | null;
  lng: number | null;
  tramo: Tramo | null;
};

type Destinatario = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  distancia_m: number | null;
};

type Pendiente = { senal: Senal; distancia_m: number | null };

export type Resumen = {
  senales: number;
  destinatarios: number;
  enviadas: number;
  fallidas: number;
  bajas: number;
  /** Ya estaban en `envios_push`: un reintento del webhook, o el solape del barrido. */
  repetidas: number;
};

const ORDEN: Record<PrioridadPush, number> = { baja: 0, media: 1, alta: 2 };

/**
 * Cuántos envíos simultáneos. No es una optimización: sin tope, un aviso de
 * ciudad con miles de suscripciones abriría miles de conexiones HTTPS a la vez y
 * la función se quedaría sin descriptores antes de mandar la mitad.
 */
const EN_PARALELO = 50;

/**
 * Junta todo lo que le toca a una misma persona en UNA notificación.
 *
 * Esto es el límite de tasa del barrido de comunidad. Tres necesidades que se
 * vuelven críticas en el mismo barrio dentro del mismo barrido son un aviso, no
 * tres: mandar tres es exactamente cómo se consigue que la gente apague las
 * notificaciones el día que más falta hacen.
 */
function componer(pendientes: Pendiente[]): { carga: CargaPush; tramo: Tramo } {
  // De lo más cerca a lo más lejos: si hay que resumir, que el titular sea el
  // hecho que más le toca a quien lo recibe.
  const orden = [...pendientes].sort(
    (a, b) => (a.distancia_m ?? Infinity) - (b.distancia_m ?? Infinity),
  );

  const tramos = orden.map((p) => p.senal.tramo ?? tramoPorDistancia(p.distancia_m));
  const tramo = tramos.reduce((a, b) => (ORDEN[b.prioridad] > ORDEN[a.prioridad] ? b : a));

  const primera = orden[0].senal;

  if (orden.length === 1) {
    return {
      tramo,
      carga: construirCarga(
        {
          origen: primera.origen,
          titulo: primera.titulo,
          cuerpo: primera.cuerpo,
          lat: primera.lat,
          lng: primera.lng,
          punto_id: primera.punto_id,
          etiqueta: primera.etiqueta,
        },
        tramo,
      ),
    };
  }

  const titulares = orden.slice(0, 2).map((p) => p.senal.titulo);
  const resto = orden.length - titulares.length;

  return {
    tramo,
    carga: construirCarga(
      {
        origen: primera.origen,
        titulo: `${orden.length} alertas nuevas cerca de ti`,
        cuerpo: resto > 0 ? `${titulares.join(" · ")} y ${resto} más` : titulares.join(" · "),
        // Las del hecho más cercano: son las que hacen útil que el service
        // worker recalcule la distancia real contra la posición del teléfono.
        lat: primera.lat,
        lng: primera.lng,
        // Sin ficha concreta que abrir: al tocarla se abre el mapa.
        punto_id: null,
        etiqueta: "cercanas",
      },
      tramo,
    ),
  };
}

/**
 * Elige destinatarios, reserva el envío y manda. Devuelve el recuento.
 *
 * El orden importa: se apunta en `envios_push` ANTES de enviar, no después. Si
 * el proceso se cae a mitad, lo que se pierde es una notificación; si fuera al
 * revés, lo que se ganaría es una repetida, y en una app de emergencia repetir
 * es lo que hace que la gente deje de mirar.
 */
export async function repartir(senales: Senal[]): Promise<Resumen> {
  const resumen: Resumen = {
    senales: senales.length,
    destinatarios: 0,
    enviadas: 0,
    fallidas: 0,
    bajas: 0,
    repetidas: 0,
  };
  if (senales.length === 0) return resumen;

  const sb = servicio();
  // Marca de inicio, para poder soltar exactamente las reservas de esta tanda si
  // el envío falla. Se toma del reloj de la base y no del de aquí: comparar dos
  // relojes distintos con un `>=` es cómo se sueltan reservas de más.
  const { data: inicio } = await sb.rpc("rpc_push_ahora");
  const porSuscripcion = new Map<string, { destino: Destinatario; pendientes: Pendiente[] }>();

  for (const senal of senales) {
    const { data: destinos, error } = await sb.rpc("rpc_push_destinatarios", {
      p_lat: senal.lat,
      p_lng: senal.lng,
      p_radio_m: senal.lat === null ? null : LEJOS_M,
    });
    if (error) throw new Error(`No se pudieron elegir destinatarios: ${error.message}`);

    const lista = (destinos ?? []) as Destinatario[];
    if (lista.length === 0) continue;

    const { data: admitidos, error: errorReserva } = await sb.rpc("rpc_push_reservar", {
      p_origen: senal.origen,
      p_fila_id: senal.fila_id,
      p_suscripciones: lista.map((d) => d.id),
    });
    if (errorReserva) throw new Error(`No se pudo reservar el envío: ${errorReserva.message}`);

    const nuevos = new Set((admitidos ?? []) as string[]);
    resumen.repetidas += lista.length - nuevos.size;

    for (const destino of lista) {
      if (!nuevos.has(destino.id)) continue;
      const entrada = porSuscripcion.get(destino.id) ?? { destino, pendientes: [] };
      entrada.pendientes.push({ senal, distancia_m: destino.distancia_m });
      porSuscripcion.set(destino.id, entrada);
    }
  }

  const tandas = [...porSuscripcion.values()];
  resumen.destinatarios = tandas.length;
  if (tandas.length === 0) return resumen;

  asegurarVapid();

  const ok: string[] = [];
  const muertas: string[] = [];
  const fallidas: string[] = [];

  for (let i = 0; i < tandas.length; i += EN_PARALELO) {
    await Promise.all(
      tandas.slice(i, i + EN_PARALELO).map(async ({ destino, pendientes }) => {
        const { carga, tramo } = componer(pendientes);
        try {
          await webpush.sendNotification(
            {
              endpoint: destino.endpoint,
              keys: { p256dh: destino.p256dh, auth: destino.auth },
            },
            JSON.stringify(carga),
            { TTL: tramo.ttl, urgency: tramo.urgencia, timeout: 10_000 },
          );
          ok.push(destino.id);
        } catch (e) {
          // 404 y 410 no son fallos transitorios: esa suscripción ya no existe y
          // no va a volver. Insistir contra endpoints muertos es además lo que
          // hace que los servicios de push empiecen a limitarte.
          if (e instanceof WebPushError && (e.statusCode === 404 || e.statusCode === 410)) {
            muertas.push(destino.id);
          } else {
            fallidas.push(destino.id);
          }
        }
      }),
    );
  }

  resumen.enviadas = ok.length;
  resumen.bajas = muertas.length;
  resumen.fallidas = fallidas.length;

  // Lo que falló por algo pasajero suelta su reserva, para que el siguiente
  // barrido lo reintente en vez de darlo por enviado. Los 410 no: esa
  // suscripción ya no existe y reintentarla no la resucita.
  if (fallidas.length > 0 && inicio) {
    const { error } = await sb.rpc("rpc_push_liberar", {
      p_suscripciones: fallidas,
      p_desde: inicio,
    });
    if (error) console.error("push: no se pudieron soltar las reservas", error.message);
  }

  const { error } = await sb.rpc("rpc_push_resultado", {
    p_ok: ok,
    p_muertas: muertas,
    p_fallidas: fallidas,
  });
  if (error) {
    // Ya se envió: que no se pueda anotar el resultado no cambia lo que la gente
    // recibió, así que se deja constancia y no se convierte en un fallo.
    console.error("push: no se pudo anotar el resultado", error.message);
  }

  return resumen;
}

/** Las señales del barrido, tal como las devuelve `rpc_push_barrido`. */
export type FilaBarrido = {
  origen: "punto" | "necesidad";
  fila_id: string;
  punto_id: string;
  punto: string;
  barrio: string | null;
  lat: number;
  lng: number;
  emoji: string | null;
  etiqueta: string | null;
};

export async function barrer(ventanaMinutos = 15): Promise<FilaBarrido[]> {
  const { data, error } = await servicio().rpc("rpc_push_barrido", {
    p_ventana: `${ventanaMinutos} minutes`,
  });
  if (error) throw new Error(`No se pudo barrer: ${error.message}`);
  return (data ?? []) as FilaBarrido[];
}
