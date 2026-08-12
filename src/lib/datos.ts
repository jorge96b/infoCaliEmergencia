import { supabase } from "./supabase";
import type {
  Evento,
  Global,
  Instantanea,
  PuntoCalor,
  PuntoMapa,
  Recurso,
  TipoPunto,
  Aviso,
  Oficial,
  ReporteOficial,
} from "./tipos";

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
  porTipo: Record<string, Recurso[]>;
}> {
  const sb = supabase();
  const [tipos, recursos, porTipo] = await Promise.all([
    sb.from("tipos_punto").select("*").eq("activo", true).order("orden"),
    sb.from("recursos").select("*").eq("activo", true).order("orden"),
    // Qué recursos vienen al caso en cada tipo de lugar. La vista ya llega
    // unida y ordenada por el orden propio de cada tipo.
    sb.from("v_recursos_tipo").select("*"),
  ]);

  if (tipos.error) throw tipos.error;
  if (recursos.error) throw recursos.error;
  if (porTipo.error) throw porTipo.error;

  // Se agrupa una sola vez aquí y no en cada render de la ficha del punto.
  const agrupado: Record<string, Recurso[]> = {};
  for (const fila of (porTipo.data ?? []) as (Recurso & { tipo: string })[]) {
    (agrupado[fila.tipo] ??= []).push(fila);
  }

  return {
    tipos: (tipos.data ?? []) as TipoPunto[],
    recursos: (recursos.data ?? []) as Recurso[],
    porTipo: agrupado,
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

/**
 * Lo que se ha reportado en las últimas 24 h, lo más reciente primero.
 *
 * Va aparte de `cargarInstantanea` a propósito. La instantánea se pide cada 20 s
 * pase lo que pase, y colgarle sesenta eventos por vuelta sería tráfico
 * permanente contra el límite del plan gratuito para una lista que casi nunca
 * está abierta. Esta se pide sólo mientras la hoja se ve, con su propio reloj.
 */
export async function cargarActividad(limite = 60): Promise<Evento[]> {
  const { data, error } = await supabase()
    .from("v_actividad")
    .select("*")
    .order("ocurrido_en", { ascending: false })
    .limit(limite);

  if (error) throw error;
  return (data ?? []) as Evento[];
}

export async function miPresencia(dispositivo: string): Promise<string | null> {
  const { data, error } = await supabase().rpc("rpc_mi_presencia", {
    p_dispositivo: dispositivo,
  });
  if (error) return null;
  return (data as string | null) ?? null;
}

/**
 * Información oficial: avisos vigentes o próximos, y el último reporte de
 * situación. Va en su propia función y no dentro de `cargarInstantanea` porque
 * cambia con mucha menos frecuencia que el mapa y porque, si falla, el mapa
 * tiene que seguir dibujándose igual.
 */
export async function cargarOficial(): Promise<Oficial> {
  const sb = supabase();
  const [avisos, reporte] = await Promise.all([
    sb.from("v_avisos").select("*"),
    sb.from("v_reporte_oficial").select("*").maybeSingle(),
  ]);

  if (avisos.error) throw avisos.error;

  return {
    avisos: (avisos.data ?? []) as Aviso[],
    // El reporte es accesorio: sin él los avisos siguen sirviendo.
    reporte: (reporte.data as ReporteOficial | null) ?? null,
  };
}
