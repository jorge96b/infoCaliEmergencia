import { supabaseModeracion } from "./supabaseModeracion";
import type {
  Decision,
  EntradaBitacora,
  Ficha,
  FilaCola,
  FilaDispositivo,
  Salud,
  TablaDenunciable,
  Aviso,
  SeveridadAviso,
  TipoAviso,
} from "./tipos";

/**
 * Toda la moderación —lectura y escritura— pasa por aquí, igual que `datos.ts` y
 * `reportes.ts` concentran las del mapa.
 *
 * Diferencia deliberada con `datos.ts`: allí un fallo del tablero global se
 * traga y se dibuja el mapa igual, porque enseñar el mapa incompleto es mejor
 * que no enseñar nada. Aquí no hay nada accesorio. Una cola de denuncias a la
 * que le faltan filas sin avisar hace que alguien dé por revisado lo que nadie
 * miró, así que todo error se lanza.
 *
 * Ninguna de estas funciones comprueba si quien llama es moderador: eso lo
 * decide `es_moderador()` en el servidor, y las vistas devuelven cero filas a
 * quien no lo sea. Comprobarlo también aquí daría la falsa impresión de que la
 * interfaz es lo que protege los datos.
 */

export type Sesion = { id: string; correo: string };

export async function sesion(): Promise<Sesion | null> {
  const { data } = await supabaseModeracion().auth.getSession();
  const u = data.session?.user;
  return u ? { id: u.id, correo: u.email ?? "" } : null;
}

export async function entrar(correo: string, contrasena: string): Promise<void> {
  const { error } = await supabaseModeracion().auth.signInWithPassword({
    email: correo,
    password: contrasena,
  });
  // Sin distinguir cuál de los dos falló: decirlo confirmaría qué correos son
  // moderadores a quien esté probando.
  if (error) throw new Error("Correo o contraseña incorrectos.");
}

export async function salir(): Promise<void> {
  await supabaseModeracion().auth.signOut();
}

/** ¿La sesión actual está en `moderadores` y activa? */
export async function soyModerador(): Promise<boolean> {
  const { data, error } = await supabaseModeracion().rpc("es_moderador");
  if (error) return false;
  return data === true;
}

export async function cargarCola(soloPendientes = true): Promise<FilaCola[]> {
  let q = supabaseModeracion()
    .from("v_cola_moderacion")
    .select("*")
    // Lo más grave primero: una denuncia por contenido ofensivo puede estar
    // poniendo a alguien en riesgo, y no puede esperar detrás de veinte avisos
    // de "esto está repetido".
    .order("ofensivo", { ascending: false })
    .order("denuncias", { ascending: false })
    .order("ultima", { ascending: false })
    .limit(200);

  if (soloPendientes) q = q.is("decision", null);

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as FilaCola[];
}

export async function cargarSalud(): Promise<Salud | null> {
  const { data, error } = await supabaseModeracion()
    .from("v_salud_moderacion")
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data as Salud) ?? null;
}

export async function cargarFicha(
  dispositivo: string,
): Promise<{ ficha: Ficha | null; filas: FilaDispositivo[] }> {
  const sb = supabaseModeracion();
  const [ficha, filas] = await Promise.all([
    sb.from("v_ficha_dispositivo").select("*").eq("id", dispositivo).maybeSingle(),
    sb
      .from("v_filas_denunciables")
      .select("*")
      .eq("dispositivo_id", dispositivo)
      .order("creado_en", { ascending: false })
      .limit(100),
  ]);

  if (ficha.error) throw ficha.error;
  if (filas.error) throw filas.error;

  return {
    ficha: (ficha.data as Ficha) ?? null,
    filas: (filas.data ?? []) as FilaDispositivo[],
  };
}

export async function cargarBitacora(limite = 50): Promise<EntradaBitacora[]> {
  const { data, error } = await supabaseModeracion()
    .from("v_bitacora")
    .select("*")
    .order("creado_en", { ascending: false })
    .limit(limite);
  if (error) throw error;
  return (data ?? []) as EntradaBitacora[];
}

export async function decidir(
  tabla: TablaDenunciable,
  filaId: string,
  decision: Decision,
  motivo?: string,
): Promise<void> {
  const { error } = await supabaseModeracion().rpc("rpc_mod_decidir", {
    p_tabla: tabla,
    p_fila_id: filaId,
    p_decision: decision,
    p_motivo: motivo?.trim() || null,
  });
  if (error) throw new Error(mensaje(error));
}

export async function bloquear(
  dispositivo: string,
  bloqueado: boolean,
  motivo: string,
  ocultarTodo = false,
): Promise<void> {
  const { error } = await supabaseModeracion().rpc("rpc_mod_bloquear", {
    p_dispositivo: dispositivo,
    p_bloqueado: bloqueado,
    p_motivo: motivo.trim(),
    p_ocultar_todo: ocultarTodo,
  });
  if (error) throw new Error(mensaje(error));
}

/**
 * Los RPC de moderación lanzan sus excepciones ya redactadas en español, igual
 * que las del mapa. Cuando el código no es uno de los conocidos se muestra el
 * detalle crudo en vez de inventar una causa: la misma regla que en
 * `reportes.ts`, aprendida rompiéndolo en producción.
 */
function mensaje(error: { message?: string; code?: string }): string {
  const bruto = error.message ?? "Error desconocido";
  if (error.code === "42501" || error.code === "P0001" || error.code === "22P02") {
    return bruto.replace(/^.*?:\s*/, "");
  }
  return `No se pudo aplicar. El servidor respondió: ${bruto}${
    error.code ? ` (${error.code})` : ""
  }`;
}

// ---------------------------------------------------------------------------
// Publicación de información oficial
//
// Primera vía por la que un moderador CREA contenido público, en vez de sólo
// ocultar o bloquear. Por eso el servidor valida más de lo habitual: un toque
// de queda sin hora de fin, por ejemplo, se rechaza ahí y no aquí.
// ---------------------------------------------------------------------------

/** Los avisos vigentes o próximos, tal como los ve cualquiera. */
export async function cargarAvisosMod(): Promise<Aviso[]> {
  const { data, error } = await supabaseModeracion().from("v_avisos").select("*");
  if (error) throw error;
  return (data ?? []) as Aviso[];
}

export async function publicarAviso(a: {
  titulo: string;
  tipo: TipoAviso;
  severidad: SeveridadAviso;
  vigenteDesde: string;
  vigenteHasta: string | null;
  cuerpo?: string;
  fijado: boolean;
  enlace?: string;
}): Promise<string> {
  const { data, error } = await supabaseModeracion().rpc("rpc_mod_publicar_aviso", {
    p_titulo: a.titulo.trim(),
    p_tipo: a.tipo,
    p_severidad: a.severidad,
    p_vigente_desde: a.vigenteDesde,
    p_vigente_hasta: a.vigenteHasta,
    p_cuerpo: a.cuerpo?.trim() || null,
    p_fijado: a.fijado,
    p_enlace: a.enlace?.trim() || null,
  });
  if (error) throw new Error(mensaje(error));
  return data as string;
}

export async function retirarAviso(id: string, motivo?: string): Promise<void> {
  const { error } = await supabaseModeracion().rpc("rpc_mod_retirar_aviso", {
    p_id: id,
    p_motivo: motivo?.trim() || null,
  });
  if (error) throw new Error(mensaje(error));
}

export async function publicarReporte(r: {
  reportadoEn: string;
  numero?: number | null;
  fallecidos?: number | null;
  rescatados?: number | null;
  colapsadas?: number | null;
  conDanos?: number | null;
  salud?: string;
  servicios?: string;
}): Promise<void> {
  const { error } = await supabaseModeracion().rpc("rpc_mod_publicar_reporte", {
    p_reportado_en: r.reportadoEn,
    p_numero: r.numero ?? null,
    p_fallecidos: r.fallecidos ?? null,
    p_rescatados: r.rescatados ?? null,
    p_colapsadas: r.colapsadas ?? null,
    p_con_danos: r.conDanos ?? null,
    p_salud: r.salud?.trim() || null,
    p_servicios: r.servicios?.trim() || null,
  });
  if (error) throw new Error(mensaje(error));
}
