import { supabase } from "./supabase";
import { idDispositivo, nuevoClientId } from "./dispositivo";
import { encolar, type Pendiente } from "./cola";
import type { EstadoPersona, MotivoDenuncia, NivelStock, TablaDenunciable } from "./tipos";

/**
 * Toda la escritura de la aplicación pasa por aquí.
 *
 * El reparto de responsabilidades es simple y vale la pena tenerlo claro:
 *
 *   · Si el servidor RESPONDE con un error, es un error de verdad (límite de
 *     tasa, dispositivo bloqueado, dato inválido) y se le muestra a la persona.
 *     Encolarlo sería mentirle diciendo que se guardó.
 *
 *   · Si NO hay respuesta, es la señal. El reporte se guarda en la bandeja de
 *     salida y se envía cuando vuelva la conexión.
 *
 * Cada acción genera su `client_id` antes del primer intento de red, así que el
 * reenvío nunca duplica nada.
 */

export type Resultado = "enviado" | "encolado";

export class ErrorReporte extends Error {
  readonly codigo?: string;
  constructor(mensaje: string, codigo?: string) {
    super(mensaje);
    this.codigo = codigo;
  }
}

/**
 * Traduce un error del servidor a algo que la persona pueda leer.
 *
 * Regla aprendida rompiendo esto en producción: **nunca afirmar una causa que no
 * se conoce**. La versión anterior decía "sin señal" ante cualquier error raro, y
 * con la señal intacta eso mandó la depuración en la dirección contraria durante
 * un buen rato. Cuando no se sabe qué pasó, se dice que no se sabe y se muestra
 * el detalle técnico: es feo, pero es la única pista que va a tener quien reporte
 * el problema.
 */
function traducir(error: { message?: string; code?: string }): never {
  const codigo = error.code;
  const bruto = error.message ?? "Error desconocido";

  // Los mensajes de las excepciones del servidor ya vienen redactados en español
  // para mostrarse tal cual (límite de tasa, dispositivo bloqueado).
  if (codigo === "P0001" || codigo === "42501") {
    throw new ErrorReporte(bruto.replace(/^.*?:\s*/, ""), codigo);
  }
  if (codigo === "23514" || codigo === "22P02") {
    throw new ErrorReporte("Ese dato está fuera de los valores permitidos.", codigo);
  }
  if (codigo === "23503") {
    throw new ErrorReporte(
      "Ese tipo de lugar o recurso no existe en el catálogo. Vuelve a abrir la app para recargarlo.",
      codigo,
    );
  }
  throw new ErrorReporte(
    `No se pudo guardar. El servidor respondió: ${bruto}${codigo ? ` (${codigo})` : ""}`,
    codigo,
  );
}

async function ejecutar(p: Omit<Pendiente, "intentos" | "creado_en">): Promise<Resultado> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    await encolar(p);
    return "encolado";
  }

  let respuesta;
  try {
    respuesta = await supabase().rpc(p.fn, p.args);
  } catch {
    // Ni siquiera hubo respuesta: sin señal.
    await encolar(p);
    return "encolado";
  }

  const error = respuesta.error;
  if (!error) return "enviado";

  // Sin código, `supabase-js` está reportando un fallo de red, no del servidor.
  if (!error.code) {
    await encolar(p);
    return "encolado";
  }

  // El mismo `client_id` ya estaba guardado: el reporte sí se aplicó.
  if (error.code === "23505") return "enviado";

  traducir(error);
}

/**
 * Crear un punto no pasa por la cola: la persona necesita saber ya mismo qué
 * identificador quedó, porque puede que el servidor haya devuelto un punto que
 * ya existía a menos de 40 m en vez de crear uno nuevo. Encolarlo dejaría a la
 * interfaz sin saber a dónde ir.
 */
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

  if (error) {
    // Sin código de Postgres no hubo respuesta del servidor. Puede ser falta de
    // señal, pero también un servidor caído o mal configurado: se dice lo que se
    // sabe y se adjunta el detalle, en vez de dar por hecho que es la señal.
    if (!error.code) {
      throw new ErrorReporte(
        `No se pudo contactar el servidor. Si tienes señal, avisa de este detalle: ${
          error.message ?? "sin detalle"
        }`,
      );
    }
    traducir(error);
  }
  return data as string;
}

export function confirmarPunto(puntoId: string, existe: boolean): Promise<Resultado> {
  const client_id = nuevoClientId();
  return ejecutar({
    client_id,
    fn: "rpc_confirmar_punto",
    descripcion: existe ? "Confirmación de un lugar" : "Aviso de lugar inexistente",
    args: {
      p_punto: puntoId,
      p_dispositivo: idDispositivo(),
      p_voto: existe ? 1 : -1,
      p_client_id: client_id,
    },
  });
}

/** `falta = true` → "aquí se necesita"; `falta = false` → "ya llegó". */
export function reportarNecesidad(
  puntoId: string,
  recurso: string,
  falta: boolean,
  etiqueta = recurso,
  /** Texto libre. Es lo único que da sentido al recurso `otro`. */
  nota?: string,
): Promise<Resultado> {
  const client_id = nuevoClientId();
  return ejecutar({
    client_id,
    fn: "rpc_reportar_necesidad",
    descripcion: falta ? `Falta ${etiqueta.toLowerCase()}` : `Ya llegó ${etiqueta.toLowerCase()}`,
    args: {
      p_punto: puntoId,
      p_recurso: recurso,
      p_dispositivo: idDispositivo(),
      p_voto: falta ? 1 : -1,
      p_client_id: client_id,
      p_nota: nota?.trim() || null,
      // La hora del momento del toque, no la del envío: un reporte que estuvo
      // encolado tres horas debe decaer desde que se observó.
      p_reportado_en: new Date().toISOString(),
    },
  });
}

export function reportarInsumo(
  puntoId: string,
  recurso: string,
  nivel: NivelStock,
  etiqueta = recurso,
): Promise<Resultado> {
  const client_id = nuevoClientId();
  return ejecutar({
    client_id,
    fn: "rpc_reportar_insumo",
    descripcion: `Disponibilidad de ${etiqueta.toLowerCase()}`,
    args: {
      p_punto: puntoId,
      p_recurso: recurso,
      p_dispositivo: idDispositivo(),
      p_nivel: nivel,
      p_client_id: client_id,
      p_reportado_en: new Date().toISOString(),
    },
  });
}

export function reportarPersonas(
  puntoId: string,
  estado: EstadoPersona,
  cantidad: number,
): Promise<Resultado> {
  const client_id = nuevoClientId();
  return ejecutar({
    client_id,
    fn: "rpc_reportar_personas",
    descripcion: `Conteo de personas (${estado})`,
    args: {
      p_punto: puntoId,
      p_dispositivo: idDispositivo(),
      p_estado: estado,
      p_cantidad: cantidad,
      p_client_id: client_id,
      p_reportado_en: new Date().toISOString(),
    },
  });
}

export function entrarAPunto(puntoId: string, personas = 1): Promise<Resultado> {
  const client_id = nuevoClientId();
  return ejecutar({
    client_id,
    fn: "rpc_presencia_entrar",
    descripcion: "Llegada a un punto",
    args: {
      p_punto: puntoId,
      p_dispositivo: idDispositivo(),
      p_client_id: client_id,
      p_personas: personas,
    },
  });
}

export function salirDePunto(): Promise<Resultado> {
  return ejecutar({
    client_id: nuevoClientId(),
    fn: "rpc_presencia_salir",
    descripcion: "Salida de un punto",
    args: { p_dispositivo: idDispositivo() },
  });
}

/**
 * Denunciar contenido para que lo revise un moderador.
 *
 * `rpc_denunciar` devuelve `void` y se traga los conflictos a propósito: nadie
 * debe poder contar cuántas denuncias lleva una fila, porque sabría exactamente
 * cuántas le faltan para tumbar información legítima. Por eso quien denuncia no
 * recibe ninguna señal de qué pasó después, y el mensaje de éxito no puede
 * insinuar que ya se tomó una decisión.
 */
export function denunciar(
  tabla: TablaDenunciable,
  filaId: string,
  motivo: MotivoDenuncia,
  detalle?: string,
): Promise<Resultado> {
  const client_id = nuevoClientId();
  return ejecutar({
    client_id,
    fn: "rpc_denunciar",
    descripcion: "Denuncia de contenido",
    args: {
      p_tabla: tabla,
      p_fila_id: filaId,
      p_dispositivo: idDispositivo(),
      p_motivo: motivo,
      p_client_id: client_id,
      p_detalle: detalle?.trim() || null,
    },
  });
}

/** Mantiene viva la sesión de presencia; sin latido caduca a los 90 min. */
export async function latido(): Promise<void> {
  // El latido no se encola a propósito: si no hubo señal, lo que corresponde es
  // que la presencia caduque, no resucitarla media hora después.
  try {
    await supabase().rpc("rpc_presencia_latido", { p_dispositivo: idDispositivo() });
  } catch {
    /* sin señal: la presencia caducará sola, que es el comportamiento correcto */
  }
}

/**
 * Avisa que este dispositivo sigue con la app abierta, para la cifra de
 * personas en línea. Caduca a los 10 minutos sin latir.
 *
 * Es distinto del latido de arriba: aquel mantiene viva una presencia declarada
 * en un punto concreto, y este sólo dice "sigo aquí, mirando". Van por separado
 * porque la mayoría de la gente mira el mapa sin marcarse en ningún sitio, y esa
 * gente también es la ciudad conectada.
 *
 * Tampoco se encola, y por la misma razón: una cifra de "ahora mismo" que se
 * rellenara con latidos de hace media hora estaría mintiendo.
 */
export async function latidoEnLinea(): Promise<void> {
  try {
    await supabase().rpc("rpc_latido_dispositivo", { p_dispositivo: idDispositivo() });
  } catch {
    /* sin señal: se cae solo de la cuenta, que es lo correcto */
  }
}
