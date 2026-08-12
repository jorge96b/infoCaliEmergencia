import { TIPO_AVISO, vigencia } from "@/lib/formato";
import { problemaPush, repartir, secretoValido, type Senal } from "@/lib/pushServidor";
import { tramoPorSeveridad } from "@/lib/pushTramos";
import type { SeveridadAviso, TipoAviso } from "@/lib/tipos";

/**
 * Vía instantánea: lo que publica un moderador sale al instante.
 *
 * Lo llama un Database Webhook de Supabase sobre el INSERT de `avisos` y de
 * `reportes_oficiales`. Es poco volumen y muy revisado —sólo un moderador
 * escribe ahí— y la latencia sí importa: un toque de queda que empieza a las
 * 6 p. m. no sirve de nada a las 6:03.
 *
 * Lo de la comunidad NO pasa por aquí, va por `barrer`. La razón está explicada
 * allí y en la migración 0011: `muy_requerido` no es una columna, así que no hay
 * INSERT sobre el que enganchar un webhook.
 *
 * Sobre el runtime: no se declara. En Next 16 `nodejs` ya es el valor por
 * omisión y el de Edge está obsoleto; la propia documentación pide quitar el
 * `export const runtime` de los route handlers.
 */

type Webhook = {
  type?: string;
  table?: string;
  record?: Record<string, unknown> | null;
};

function texto(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function numero(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Un aviso anunciado para dentro de una semana no se notifica hoy: la misma
 * ventana de 48 h que aplica `v_avisos` para decidir qué se muestra. Y uno que
 * nace ya vencido —o retirado— no se notifica nunca.
 */
function senalDeAviso(r: Record<string, unknown>): Senal | null {
  const id = texto(r.id);
  const titulo = texto(r.titulo);
  const desde = texto(r.vigente_desde);
  if (!id || !titulo || !desde) return null;
  if (r.retirado === true) return null;

  const ahora = Date.now();
  const inicio = new Date(desde).getTime();
  const hasta = texto(r.vigente_hasta);
  if (hasta && new Date(hasta).getTime() <= ahora) return null;
  if (inicio > ahora + 48 * 3600 * 1000) return null;

  const tipo = (texto(r.tipo) ?? "otro") as TipoAviso;
  const severidad = (texto(r.severidad) ?? "importante") as SeveridadAviso;
  const aspecto = TIPO_AVISO[tipo] ?? TIPO_AVISO.otro;

  return {
    origen: "aviso",
    fila_id: id,
    titulo: `${aspecto.emoji} ${titulo}`,
    // La vigencia y no el cuerpo: es lo que decide si alguien sale a la calle, y
    // en una notificación no caben las dos cosas.
    cuerpo: vigencia({
      estado: ahora >= inicio ? "vigente" : "proximo",
      vigente_desde: desde,
      vigente_hasta: hasta,
    }),
    etiqueta: `aviso-${id}`,
    punto_id: null,
    // Un aviso oficial no tiene coordenadas: rige para toda la ciudad.
    lat: null,
    lng: null,
    tramo: tramoPorSeveridad(severidad),
  };
}

function senalDeReporte(r: Record<string, unknown>): Senal | null {
  const id = texto(r.id);
  if (!id) return null;

  const num = numero(r.numero);
  const cifras: string[] = [];
  const fallecidos = numero(r.fallecidos);
  const rescatados = numero(r.rescatados);
  const colapsadas = numero(r.colapsadas);
  if (fallecidos !== null) cifras.push(`${fallecidos} fallecidos`);
  if (rescatados !== null) cifras.push(`${rescatados} rescatados`);
  if (colapsadas !== null) cifras.push(`${colapsadas} edificaciones colapsadas`);

  return {
    origen: "reporte_oficial",
    fila_id: id,
    titulo: `📋 Reporte de situación${num !== null ? ` #${num}` : ""}`,
    cuerpo:
      cifras.length > 0
        ? `${cifras.join(" · ")}. Cifras preliminares.`
        : texto(r.fuente) ?? "Nuevo reporte oficial.",
    etiqueta: "reporte-oficial",
    punto_id: null,
    lat: null,
    lng: null,
    // Un boletín no trae severidad. Va como `importante`: enterarse importa, y
    // despertar un teléfono a medianoche por una actualización de cifras, no.
    tramo: tramoPorSeveridad("importante"),
  };
}

export async function POST(peticion: Request) {
  if (!secretoValido(peticion.headers.get("x-push-secret"))) {
    return Response.json({ error: "No autorizado." }, { status: 401 });
  }

  if (problemaPush) {
    // Se registra además de responder: nadie mira estos logs hasta que alguien
    // se queja de que no le llegan las notificaciones, y para entonces el
    // mensaje tiene que decir exactamente qué variable falta.
    console.error("push/enviar: sin configurar —", problemaPush);
    return Response.json({ error: problemaPush }, { status: 503 });
  }

  let cuerpo: Webhook;
  try {
    cuerpo = (await peticion.json()) as Webhook;
  } catch {
    return Response.json({ error: "El cuerpo no es JSON." }, { status: 400 });
  }

  if (cuerpo.type && cuerpo.type !== "INSERT") {
    return Response.json({ ignorado: `no es un INSERT (${cuerpo.type})` });
  }

  const registro = cuerpo.record;
  if (!registro) return Response.json({ error: "Falta `record`." }, { status: 400 });

  const senal =
    cuerpo.table === "avisos"
      ? senalDeAviso(registro)
      : cuerpo.table === "reportes_oficiales"
        ? senalDeReporte(registro)
        : undefined;

  if (senal === undefined) {
    return Response.json({ ignorado: `tabla sin notificación: ${cuerpo.table}` });
  }
  if (senal === null) {
    return Response.json({ ignorado: "el registro no merece notificación" });
  }

  try {
    return Response.json(await repartir([senal]));
  } catch (e) {
    // Un endpoint muerto no llega hasta aquí: eso lo absorbe `repartir` y da de
    // baja la suscripción. Si esto revienta es que falló la base o la red hacia
    // ella, y ahí reintentar sí es lo correcto — de ahí el 500 y no un 200.
    const detalle = e instanceof Error ? e.message : String(e);
    console.error("push/enviar:", detalle);
    return Response.json({ error: detalle }, { status: 500 });
  }
}
