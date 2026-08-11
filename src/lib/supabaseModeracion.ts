import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const configurado = Boolean(url && anon);

let cliente: SupabaseClient | null = null;

/**
 * Cliente aparte del público, y tiene que serlo por tres razones concretas:
 *
 *   · El de `supabase.ts` usa `persistSession: false`. Aquí hace falta lo
 *     contrario: un moderador no puede volver a escribir la contraseña cada vez
 *     que la pantalla se apaga.
 *   · Aquel hornea la cabecera `x-device-id` al construirse. Un moderador no
 *     actúa como dispositivo, actúa como persona identificada; mandar el
 *     identificador de dispositivo aquí sólo confundiría los registros.
 *   · La clave de almacenamiento es distinta a propósito. Ambos clientes viven
 *     en el mismo origen, y con la clave por omisión el segundo pisaría la
 *     sesión del primero.
 *
 * Sigue siendo la `anon key` pública: quien manda es la sesión de Supabase Auth
 * y `es_moderador()` del lado del servidor. Aquí no hay ningún secreto.
 */
export function supabaseModeracion(): SupabaseClient {
  if (!configurado) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
        "Copia .env.example a .env.local y llénalas.",
    );
  }

  if (!cliente) {
    cliente = createClient(url!, anon!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        storageKey: "ice-moderacion-auth",
      },
    });
  }
  return cliente;
}
