import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { idDispositivo } from "./dispositivo";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** Falso cuando faltan las variables de entorno; la app lo dice en pantalla. */
export const configurado = Boolean(url && anon);

let cliente: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!configurado) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
        "Copia .env.example a .env.local y llénalas.",
    );
  }

  if (!cliente) {
    cliente = createClient(url!, anon!, {
      auth: { persistSession: false },
      // El identificador del dispositivo viaja en cada petición. Las políticas
      // de RLS lo leen desde `request.headers`.
      global: { headers: { "x-device-id": idDispositivo() } },
    });
  }
  return cliente;
}
