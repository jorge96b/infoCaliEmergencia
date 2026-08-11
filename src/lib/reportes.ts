import { supabase } from "./supabase";
import { idDispositivo, nuevoClientId } from "./dispositivo";
import type { EstadoPersona, NivelStock } from "./tipos";

/**
 * Toda la escritura de la aplicación pasa por aquí.
 *
 * Cada acción genera su `client_id` ANTES del primer intento de red, y todas las
 * funciones del servidor son idempotentes sobre ese identificador. Eso resuelve
 * el caso clásico que rompe las apps con mala señal: la petición llegó, la
 * respuesta se perdió, el cliente reintenta. Con `client_id` el reintento no
 * duplica nada, y es también lo que hará segura la cola offline de la fase 2.
 */

export class ErrorReporte extends Error {
  readonly codigo?: string;
  constructor(mensaje: string, codigo?: string) {
    super(mensaje);
    this.codigo = codigo;
  }
}

function traducir(error: { message?: string; code?: string } | null): never {
  const codigo = error?.code;
  const bruto = error?.message ?? "Error desconocido";

  // Los mensajes de las excepciones del servidor ya están redactados en español
  // para mostrarse tal cual (límite de tasa, dispositivo bloqueado).
  if (codigo === "P0001" || codigo === "42501") {
    throw new ErrorReporte(bruto.replace(/^.*?:\s*/, ""), codigo);
  }
  if (codigo === "23505") {
    throw new ErrorReporte("Ya habías reportado esto. Gracias.", codigo);
  }
  if (codigo === "23514") {
    throw new ErrorReporte("Ese dato está fuera de los valores permitidos.", codigo);
  }
  throw new ErrorReporte("No se pudo enviar el reporte. Intenta de nuevo.", codigo);
}

export async function crearPunto(datos: {
  nombre: string;
  tipo: string;
  lat: number;
  lng: number;
  direccion?: string;
  descripcion?: string;
  barrio?: string;
  contacto?: string;
}): Promise<string> {
  const { data, error } = await supabase().rpc("rpc_crear_punto", {
    p_nombre: datos.nombre,
    p_tipo: datos.tipo,
    p_lat: datos.lat,
    p_lng: datos.lng,
    p_dispositivo: idDispositivo(),
    p_client_id: nuevoClientId(),
    p_direccion: datos.direccion || null,
    p_descripcion: datos.descripcion || null,
    p_barrio: datos.barrio || null,
    p_contacto: datos.contacto || null,
  });

  if (error) traducir(error);
  return data as string;
}

export async function confirmarPunto(puntoId: string, existe: boolean): Promise<void> {
  const { error } = await supabase().rpc("rpc_confirmar_punto", {
    p_punto: puntoId,
    p_dispositivo: idDispositivo(),
    p_voto: existe ? 1 : -1,
    p_client_id: nuevoClientId(),
  });
  if (error) traducir(error);
}

/** `falta = true` → "aquí se necesita"; `falta = false` → "ya llegó". */
export async function reportarNecesidad(
  puntoId: string,
  recurso: string,
  falta: boolean,
): Promise<void> {
  const { error } = await supabase().rpc("rpc_reportar_necesidad", {
    p_punto: puntoId,
    p_recurso: recurso,
    p_dispositivo: idDispositivo(),
    p_voto: falta ? 1 : -1,
    p_client_id: nuevoClientId(),
    p_reportado_en: new Date().toISOString(),
  });
  if (error) traducir(error);
}

export async function reportarInsumo(
  puntoId: string,
  recurso: string,
  nivel: NivelStock,
): Promise<void> {
  const { error } = await supabase().rpc("rpc_reportar_insumo", {
    p_punto: puntoId,
    p_recurso: recurso,
    p_dispositivo: idDispositivo(),
    p_nivel: nivel,
    p_client_id: nuevoClientId(),
    p_reportado_en: new Date().toISOString(),
  });
  if (error) traducir(error);
}

export async function reportarPersonas(
  puntoId: string,
  estado: EstadoPersona,
  cantidad: number,
): Promise<void> {
  const { error } = await supabase().rpc("rpc_reportar_personas", {
    p_punto: puntoId,
    p_dispositivo: idDispositivo(),
    p_estado: estado,
    p_cantidad: cantidad,
    p_client_id: nuevoClientId(),
    p_reportado_en: new Date().toISOString(),
  });
  if (error) traducir(error);
}

export async function entrarAPunto(puntoId: string, personas = 1): Promise<void> {
  const { error } = await supabase().rpc("rpc_presencia_entrar", {
    p_punto: puntoId,
    p_dispositivo: idDispositivo(),
    p_client_id: nuevoClientId(),
    p_personas: personas,
  });
  if (error) traducir(error);
}

export async function salirDePunto(): Promise<void> {
  const { error } = await supabase().rpc("rpc_presencia_salir", {
    p_dispositivo: idDispositivo(),
  });
  if (error) traducir(error);
}

/** Mantiene viva la sesión de presencia; sin latido caduca a los 90 min. */
export async function latido(): Promise<void> {
  await supabase().rpc("rpc_presencia_latido", { p_dispositivo: idDispositivo() });
}
