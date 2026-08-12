import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { idDispositivo } from "./dispositivo";

/**
 * Cliente de Supabase y validación de su configuración.
 *
 * Lo segundo importa tanto como lo primero. La versión anterior daba por buena
 * cualquier variable de entorno con contenido, así que una URL mal pegada en
 * Vercel se saltaba la pantalla de configuración —que existe justo para eso— y
 * en su lugar hacía reventar cada petición con "Invalid supabaseUrl". El síntoma
 * aparecía como un problema de red y la causa quedaba a tres pantallas de
 * distancia.
 *
 * Nota: la URL y la `anon key` son públicas por diseño; viajan en el navegador
 * de todo el que abra la app. Mostrarlas en la pantalla de diagnóstico no filtra
 * nada que no esté ya expuesto.
 */

/**
 * Corrige los descuidos de copiar y pegar, que son la causa real de casi todos
 * los fallos de configuración: espacios sobrantes, comillas que se arrastran
 * desde un `.env`, barra final, y el `https://` que falta. Ninguno de estos
 * cambia la intención de quien lo escribió, así que se arreglan sin avisar.
 */
function sanearUrl(bruto: string | undefined): string {
  const limpio = (bruto ?? "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .trim()
    .replace(/\/+$/, "");

  if (!limpio) return "";
  if (/^https?:\/\//i.test(limpio)) return limpio;
  // Sin protocolo no hay ambigüedad posible: Supabase siempre es https.
  return `https://${limpio}`;
}

function esUrlUsable(valor: string): boolean {
  try {
    const { protocol, hostname } = new URL(valor);
    return (protocol === "https:" || protocol === "http:") && hostname.length > 0;
  } catch {
    return false;
  }
}

const urlBruta = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonBruta = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const url = sanearUrl(urlBruta);
const anon = (anonBruta ?? "").trim().replace(/^["']|["']$/g, "").trim();

/** Descripción de qué está mal, o null si la configuración sirve. */
export const problemaConfiguracion: string | null = (() => {
  if (!url && !anon) return "Faltan las dos variables de entorno.";
  if (!url) return "Falta NEXT_PUBLIC_SUPABASE_URL.";
  if (!anon) return "Falta NEXT_PUBLIC_SUPABASE_ANON_KEY.";
  if (!esUrlUsable(url)) {
    return `NEXT_PUBLIC_SUPABASE_URL no es una dirección válida. Llegó: ${JSON.stringify(
      urlBruta ?? "",
    )}`;
  }
  // Sólo se comprueba que tenga una longitud plausible, y a propósito no su
  // forma: las claves antiguas son JWT de tres partes, pero Supabase ya emite
  // claves `sb_publishable_…` que no lo son. Validar la forma habría rechazado
  // una clave perfectamente válida y dejado la app inservible, que es mucho
  // peor que dejar pasar una mala y que el servidor la rechace con un mensaje
  // claro.
  if (anon.length < 20) {
    return `NEXT_PUBLIC_SUPABASE_ANON_KEY parece incompleta (${anon.length} caracteres). Cópiala entera desde Settings → API.`;
  }
  return null;
})();

/** Verdadero sólo cuando se puede construir un cliente que funcione. */
export const configurado = problemaConfiguracion === null;

/** Para la pantalla de diagnóstico. La URL es pública, no es un secreto. */
export const urlEnUso = url;

let cliente: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!configurado) {
    throw new Error(problemaConfiguracion ?? "Supabase no está configurado.");
  }

  if (!cliente) {
    cliente = createClient(url, anon, {
      auth: { persistSession: false },
      // El identificador del dispositivo viaja en cada petición. Las políticas
      // de RLS lo leen desde `request.headers`.
      global: { headers: { "x-device-id": idDispositivo() } },
    });
  }
  return cliente;
}
