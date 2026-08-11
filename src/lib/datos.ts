import { supabase } from "./supabase";
import type { Global, Instantanea, PuntoCalor, PuntoMapa, Recurso, TipoPunto } from "./tipos";

/**
 * Toda la lectura de la aplicación pasa por aquí.
 *
 * Es un solo módulo a propósito: cuando el tráfico apriete, basta con cambiar el
 * interior de estas funciones para que peguen a una ruta cacheada en el borde
 * (`/api/instantanea` con revalidate) en vez de a Supabase directamente, sin
 * tocar un solo componente. Esa es la válvula de escape frente al límite de
 * transferencia del plan gratuito.
 *
 * Se usa polling y no Realtime en esta versión por una razón concreta: el plan
 * gratuito de Supabase corta a las 200 conexiones concurrentes y, al llegar al
 * tope, deja de emitir cambios sin lanzar ningún error. Una app de emergencia
 * que se queda callada sin avisar es peor que una que refresca cada 20 s.
 * Además el puntaje cambia con el paso del tiempo aunque no entren datos
 * nuevos, así que refrescar por reloj hace falta de todos modos.
 */

export async function cargarCatalogos(): Promise<{
  tipos: TipoPunto[];
  recursos: Recurso[];
}> {
  const sb = supabase();
  const [tipos, recursos] = await Promise.all([
    sb.from("tipos_punto").select("*").eq("activo", true).order("orden"),
    sb.from("recursos").select("*").eq("activo", true).order("orden"),
  ]);

  if (tipos.error) throw tipos.error;
  if (recursos.error) throw recursos.error;

  return {
    tipos: (tipos.data ?? []) as TipoPunto[],
    recursos: (recursos.data ?? []) as Recurso[],
  };
}

export async function cargarInstantanea(): Promise<Instantanea> {
  const sb = supabase();
  const [puntos, calor, global] = await Promise.all([
    sb.from("v_puntos_mapa").select("*"),
    sb.from("v_mapa_calor").select("*"),
    sb.from("v_global").select("*").single(),
  ]);

  if (puntos.error) throw puntos.error;
  if (calor.error) throw calor.error;

  return {
    puntos: (puntos.data ?? []) as PuntoMapa[],
    calor: (calor.data ?? []) as PuntoCalor[],
    // El tablero global es accesorio: si falla, el mapa igual debe dibujarse.
    global: (global.data as Global | null) ?? null,
  };
}

export async function miPresencia(dispositivo: string): Promise<string | null> {
  const { data, error } = await supabase().rpc("rpc_mi_presencia", {
    p_dispositivo: dispositivo,
  });
  if (error) return null;
  return (data as string | null) ?? null;
}
