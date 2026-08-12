import {
  barrer,
  problemaPush,
  repartir,
  secretoValido,
  type FilaBarrido,
  type Senal,
} from "@/lib/pushServidor";

/**
 * Vía por barrido: lo que reporta la comunidad, agrupado.
 *
 * Lo llama `pg_cron` cada 3 minutos a través de `pg_net`, el mismo mecanismo que
 * usan los Database Webhooks. No va por webhook y no es un descuido:
 * `muy_requerido` no es una columna de ninguna tabla, es un nivel de consenso
 * que calcula `v_necesidades` con decaimiento y que cambia con el paso del
 * tiempo aunque no entre ningún reporte. No hay INSERT que observar.
 *
 * Y sale ganando, porque el otro problema de esta mitad era el volumen: aquí la
 * agrupación por dispositivo hace que tres necesidades críticas en el mismo
 * barrio sean una notificación y no tres. El límite de tasa deja de ser una
 * heurística y pasa a ser una consecuencia del período, igual que el `slot`
 * horario hace estructuralmente imposible el spam de reportes.
 *
 * La ventana es de 15 minutos y el período de 3: cada señal se ve cinco veces a
 * propósito. Perder una por una ventana corta sería un fallo de verdad;
 * repetirla sale gratis porque `envios_push` la deduplica.
 */

const VENTANA_MIN = 15;

function aSenal(fila: FilaBarrido): Senal {
  const lugar = [fila.punto, fila.barrio].filter(Boolean).join(" · ");

  if (fila.origen === "punto") {
    return {
      origen: "punto",
      fila_id: fila.fila_id,
      titulo: `${fila.emoji ?? "📍"} Nueva zona afectada`,
      cuerpo: lugar,
      etiqueta: `punto-${fila.punto_id}`,
      punto_id: fila.punto_id,
      lat: fila.lat,
      lng: fila.lng,
      // Sin tramo fijo: aquí la prioridad la decide la cercanía, que es de lo
      // que va toda esta función.
      tramo: null,
    };
  }

  return {
    origen: "necesidad",
    fila_id: fila.fila_id,
    // Misma redacción que la línea de tiempo (`tituloEvento`, caso "falta"),
    // para que la notificación y la app digan lo mismo con las mismas palabras.
    titulo: `${fila.emoji ?? "❗"} Falta ${(fila.etiqueta ?? "algo").toLowerCase()}`,
    cuerpo: lugar,
    etiqueta: `necesidad-${fila.punto_id}`,
    punto_id: fila.punto_id,
    lat: fila.lat,
    lng: fila.lng,
    tramo: null,
  };
}

export async function POST(peticion: Request) {
  if (!secretoValido(peticion.headers.get("x-push-secret"))) {
    return Response.json({ error: "No autorizado." }, { status: 401 });
  }

  if (problemaPush) {
    console.error("push/barrer: sin configurar —", problemaPush);
    return Response.json({ error: problemaPush }, { status: 503 });
  }

  try {
    const filas = await barrer(VENTANA_MIN);
    if (filas.length === 0) return Response.json({ senales: 0 });
    return Response.json(await repartir(filas.map(aSenal)));
  } catch (e) {
    const detalle = e instanceof Error ? e.message : String(e);
    console.error("push/barrer:", detalle);
    return Response.json({ error: detalle }, { status: 500 });
  }
}
