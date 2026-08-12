/*
 * Service worker de infoCaliEmergencia.
 *
 * Escrito a mano en vez de generado por un plugin, y con caché en tiempo de
 * ejecución en vez de precaché. La razón es concreta: precachear obliga a
 * regenerar un manifiesto en cada compilación y a acoplarse al build, y los
 * fragmentos de Next.js ya vienen con hash en el nombre, así que son inmutables
 * y cachearlos al vuelo da el mismo resultado sin ese acoplamiento.
 *
 * Regla que no se rompe: aquí NO pasa ninguna escritura. Los reportes viven en
 * la bandeja de salida de IndexedDB (lib/cola.ts), que sabe de idempotencia y
 * de reintentos. Un service worker reintentando POSTs a ciegas sería justo la
 * forma de duplicar reportes. Las notificaciones push, añadidas después, siguen
 * respetándolo: sólo leen y muestran.
 */

// Al subir la versión se descartan las cachés anteriores. Aquí es obligatorio:
// la v1 llevaba un service worker que fabricaba respuestas 503 y dejaba la app
// inservible, y los celulares que ya lo tengan instalado necesitan reemplazarlo.
//
// v3: se añaden las notificaciones push. Sin subir la versión, los teléfonos que
// ya tengan instalada la v2 se quedarían con un worker sin `push` y no recibirían
// nada, sin ningún síntoma visible.
const VERSION = "ice-v3";
const SHELL = `${VERSION}-shell`;
const TESELAS = `${VERSION}-teselas`;
const DATOS = `${VERSION}-datos`;
const VIGENTES = [SHELL, TESELAS, DATOS];

const MAX_TESELAS = 1200;

// En `next dev` los fragmentos se sirven en rutas que se reutilizan mientras su
// contenido cambia, así que la premisa del hash inmutable —de la que depende
// "caché primero"— no se cumple y el navegador acaba sirviendo código viejo para
// siempre: se edita un componente, se recarga y no pasa nada. Sólo en local se
// deja pasar a la red. En producción no cambia nada.
const DESARROLLO = ["localhost", "127.0.0.1"].includes(self.location.hostname);

/*
 * Un service worker no intercepta las peticiones de la visita en la que se
 * instala: para cuando se activa, el HTML y los fragmentos de esa carga ya
 * viajaron sin pasar por él. Si no se hace nada al respecto, la primera visita
 * no deja copia utilizable y recargar sin señal deja la app en blanco —
 * justo el escenario para el que existe todo esto.
 *
 * Se ataca por dos lados: aquí se guarda el HTML de arranque junto con los
 * recursos estáticos que menciona, y desde la página se envía la lista de lo
 * que realmente cargó (ver el mensaje "precalentar" más abajo), que además
 * cubre los fragmentos que se piden dinámicamente, como el del mapa.
 */
self.addEventListener("install", (evento) => {
  evento.waitUntil(
    (async () => {
      try {
        // En desarrollo no se guarda nada de la app: esos fragmentos no se
        // sirven desde la caché (ver `DESARROLLO`), así que sólo serían basura.
        // La guarda es un `if` y no un `return` porque abajo queda pendiente
        // `skipWaiting`, sin el cual el service worker no llegaría a activarse.
        if (!DESARROLLO) {
          const cache = await caches.open(SHELL);
          const respuesta = await fetch("/", { cache: "reload" });
          if (respuesta.ok) {
            const html = await respuesta.clone().text();
            await cache.put("/", respuesta);
            const estaticos = [...new Set(html.match(/\/_next\/static\/[^"')\s]+/g) ?? [])];
            await Promise.all(estaticos.map((u) => cache.add(u).catch(() => {})));
          }
        }
      } catch {
        // Sin red durante la instalación no hay nada que guardar; se reintentará
        // sola en la siguiente visita.
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("message", (evento) => {
  if (evento.data?.tipo !== "precalentar") return;
  if (DESARROLLO) return;

  evento.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      await Promise.all(
        (evento.data.urls ?? []).map(async (url) => {
          if (await cache.match(url)) return;
          await cache.add(url).catch(() => {});
        }),
      );
    })(),
  );
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    (async () => {
      // En una emergencia, el código más nuevo gana siempre: una pestaña vieja
      // mostrando datos de ayer es exactamente lo que la app existe para evitar.
      const nombres = await caches.keys();
      await Promise.all(nombres.filter((n) => !VIGENTES.includes(n)).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

/** Recorta la caché por orden de inserción para que no crezca sin control. */
async function recortar(nombre, maximo) {
  const cache = await caches.open(nombre);
  const claves = await cache.keys();
  if (claves.length <= maximo) return;
  await Promise.all(claves.slice(0, claves.length - maximo).map((k) => cache.delete(k)));
}

/** Devuelve lo cacheado de inmediato y refresca en segundo plano. */
async function primeroCache(peticion, nombre, maximo) {
  const cache = await caches.open(nombre);
  const guardada = await cache.match(peticion);
  if (guardada) return guardada;

  const respuesta = await fetch(peticion);
  if (respuesta.ok) {
    await cache.put(peticion, respuesta.clone());
    if (maximo) void recortar(nombre, maximo);
  }
  return respuesta;
}

/**
 * Red primero, con la última copia como respaldo.
 *
 * Tres reglas que este service worker aprendió rompiendo la app en producción:
 *
 *   1. NO se le pone un límite de tiempo artificial a la red. La versión
 *      anterior abandonaba a los 3 s toda petición a Supabase; desde un celular
 *      contra un servidor remoto eso se cumple constantemente, así que descartaba
 *      respuestas que iban a llegar perfectamente.
 *
 *   2. NO se fabrica una respuesta de error. Antes, al no haber copia en caché,
 *      esto devolvía un 503 inventado; el cliente lo tomaba como un fallo real
 *      del servidor y la app se quedaba en "Sin conexión" con la señal intacta.
 *      Si la red falla de verdad, el error se propaga tal cual y la app ya sabe
 *      interpretarlo.
 *
 *   3. Guardar en caché NUNCA puede tumbar una respuesta buena: `cache.put` va
 *      con su propio catch y sin await.
 */
async function primeroRed(peticion, nombre) {
  const cache = await caches.open(nombre);

  try {
    const respuesta = await fetch(peticion);
    if (respuesta.ok) {
      cache.put(peticion, respuesta.clone()).catch(() => {});
    }
    return respuesta;
  } catch (error) {
    const guardada = await cache.match(peticion);
    if (guardada) return guardada;
    throw error;
  }
}

self.addEventListener("fetch", (evento) => {
  const { request } = evento;

  // Sólo lecturas. Todo lo demás va directo a la red.
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Teselas del mapa: son inmutables y son lo más pesado de volver a bajar.
  if (url.hostname.endsWith("tile.openstreetmap.org")) {
    evento.respondWith(primeroCache(request, TESELAS, MAX_TESELAS));
    return;
  }

  // Fragmentos de Next.js: llevan hash, así que nunca cambian de contenido.
  // Salvo en desarrollo, donde esa premisa no se cumple (ver `DESARROLLO`).
  if (
    !DESARROLLO &&
    url.origin === self.location.origin &&
    url.pathname.startsWith("/_next/static/")
  ) {
    evento.respondWith(primeroCache(request, SHELL));
    return;
  }

  // El panel de moderación no se cachea nunca, ni su HTML ni sus datos. Moderar
  // sin servidor no significa nada —no se puede aplicar una decisión— y una cola
  // de denuncias guardada en disco es justo lo que no debe quedar en un teléfono
  // prestado.
  if (url.origin === self.location.origin && url.pathname.startsWith("/moderacion")) {
    return;
  }

  // Datos de Supabase. Se compara también el origen: `/rest/v1/` a secas
  // engancharía cualquier ruta que coincida, incluida una del propio sitio.
  //
  // Sólo se cachea lo que lleva `x-device-id`, que es la cabecera que fija el
  // cliente público (lib/supabase.ts) y que el de moderación deliberadamente no
  // manda. Es una regla que falla del lado seguro: si mañana aparece otro
  // cliente con sesión, deja de cachearse en vez de filtrarse.
  if (
    url.origin !== self.location.origin &&
    url.pathname.startsWith("/rest/v1/") &&
    request.headers.get("x-device-id")
  ) {
    evento.respondWith(primeroRed(request, DATOS));
    return;
  }

  // Navegación: red primero, y si no hay, el último HTML que se pudo guardar.
  // Aquí sí tiene sentido sustituir el error por algo mostrable: sin HTML no hay
  // nada que enseñar, mientras que con los datos la app prefiere enterarse del
  // fallo para poder encolar lo que la persona reporte.
  if (request.mode === "navigate") {
    evento.respondWith(
      primeroRed(request, SHELL).catch(async () => {
        const cache = await caches.open(SHELL);
        return (
          (await cache.match("/")) ??
          new Response("<h1>Sin conexión</h1><p>Vuelve a intentar cuando tengas señal.</p>", {
            headers: { "content-type": "text/html; charset=utf-8" },
            status: 503,
          })
        );
      }),
    );
  }
});

/* ===========================================================================
 * Notificaciones push
 *
 * Lo único de la app que llega sin que nadie haya abierto nada. El servidor ya
 * decidió una prioridad usando la ubicación APROXIMADA de este teléfono
 * (redondeada a ~1 km antes de guardarla, ver la migración 0011); aquí se afina
 * con la posición exacta, que nunca sale de este dispositivo.
 *
 * La regla de la cabecera sigue en pie: esto sólo lee y muestra. La única
 * escritura que se roza —volver a registrar una suscripción rotada— se deja
 * para la página, ver `pushsubscriptionchange` al final.
 * ======================================================================== */

const NOMBRE_BD = "keyval-store";
const ALMACEN = "keyval";
const CLAVE_UBICACION = "ice-ubicacion";

/**
 * Lee una clave de la base de `idb-keyval`.
 *
 * A mano y no con la librería porque este archivo no pasa por el compilador: se
 * sirve tal cual desde `public/`, así que no puede importar nada de `node_modules`.
 *
 * El `onupgradeneeded` no es decorativo y es la parte delicada. Si esta base no
 * existe todavía —alguien que recibe un push antes de haber reportado nada—,
 * `open` sin versión la crearía vacía y en la versión 1. Cuando después
 * `idb-keyval` la abriera desde la página, ya estaría en la versión 1 y su
 * propio `onupgradeneeded` no se dispararía: el almacén no se crearía nunca y
 * la bandeja de salida de `cola.ts` quedaría rota para siempre. Crear aquí el
 * mismo almacén que crearía la librería evita exactamente eso.
 */
function leerDeIdb(clave) {
  return new Promise((resolve) => {
    let solicitud;
    try {
      solicitud = indexedDB.open(NOMBRE_BD);
    } catch {
      resolve(null);
      return;
    }

    solicitud.onerror = () => resolve(null);
    solicitud.onblocked = () => resolve(null);
    solicitud.onupgradeneeded = () => {
      const bd = solicitud.result;
      if (!bd.objectStoreNames.contains(ALMACEN)) bd.createObjectStore(ALMACEN);
    };
    solicitud.onsuccess = () => {
      const bd = solicitud.result;
      if (!bd.objectStoreNames.contains(ALMACEN)) {
        bd.close();
        resolve(null);
        return;
      }
      try {
        const transaccion = bd.transaction(ALMACEN, "readonly");
        const pedido = transaccion.objectStore(ALMACEN).get(clave);
        pedido.onsuccess = () => resolve(pedido.result ?? null);
        pedido.onerror = () => resolve(null);
        transaccion.oncomplete = () => bd.close();
      } catch {
        bd.close();
        resolve(null);
      }
    };
  });
}

/**
 * Distancia en metros entre dos `[lat, lng]`.
 *
 * Es una copia de `metros()` de `src/lib/geo.ts`, que a su vez replica la
 * función SQL `metros()` de 0004_rpc. Tres copias de doce líneas es feo, pero
 * las tres viven en runtimes que no comparten módulos —Postgres, el bundle y
 * este archivo sin compilar— y la alternativa era ir al servidor para decidir si
 * una notificación vibra. Si se toca una, hay que tocar las tres.
 */
function metros(a, b) {
  const rad = (g) => (g * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Los mismos umbrales que `src/lib/pushTramos.ts`. Misma nota que arriba.
const CERCA_M = 2000;
const LEJOS_M = 8000;

function porDistancia(m) {
  if (m <= CERCA_M) return "alta";
  if (m <= LEJOS_M) return "media";
  return "baja";
}

/**
 * Una posición de hace horas no dice dónde está nadie. Pasado ese plazo se
 * ignora y manda lo que decidió el servidor, que al menos sabe de cuándo es.
 */
const UBICACION_VIGENTE_MS = 3 * 3600 * 1000;

async function decidirPrioridad(carga) {
  const previa = carga.prioridad === "alta" || carga.prioridad === "baja" ? carga.prioridad : "media";

  if (typeof carga.lat !== "number" || typeof carga.lng !== "number") return previa;

  const guardada = await leerDeIdb(CLAVE_UBICACION);
  if (!guardada || typeof guardada.lat !== "number" || typeof guardada.lng !== "number") {
    return previa;
  }
  if (!guardada.en || Date.now() - guardada.en > UBICACION_VIGENTE_MS) return previa;

  return porDistancia(metros([guardada.lat, guardada.lng], [carga.lat, carga.lng]));
}

self.addEventListener("push", (evento) => {
  evento.waitUntil(mostrarAviso(evento.data));
});

/**
 * Nunca se sale de aquí sin mostrar algo, y ésa es la regla de la que cuelga
 * todo lo demás. Por dos razones:
 *
 *   1. Chrome castiga el push silencioso: si un `push` termina sin notificación,
 *      enseña él mismo un "este sitio se actualizó en segundo plano", que es
 *      más confuso que cualquier aviso nuestro, y a la larga retira el permiso.
 *
 *   2. Una posición vieja guardada en este teléfono no puede ser motivo para
 *      callar un aviso crítico. La recomprobación de distancia sólo sube o baja
 *      el volumen; decidir a quién NO se le manda es cosa del servidor, que para
 *      eso sabe cuándo se guardó cada ubicación.
 */
async function mostrarAviso(datos) {
  let carga = {};
  try {
    if (datos) carga = datos.json() ?? {};
  } catch {
    // Carga ilegible: se avisa igual. Que la app tenga algo nuevo es en sí la
    // mitad del mensaje, y abrirla muestra la otra mitad.
  }

  const prioridad = await decidirPrioridad(carga);
  const alta = prioridad === "alta";

  const opciones = {
    body: typeof carga.cuerpo === "string" ? carga.cuerpo : "Abre la app para ver qué cambió.",
    icon: "/icono-192.png",
    badge: "/badge-96.png",
    lang: "es",
    // Con la misma etiqueta, la notificación nueva sustituye a la anterior en
    // vez de apilarse. Una necesidad que se reactiva no tiene que dejar tres
    // avisos suyos en la bandeja.
    tag: typeof carga.etiqueta === "string" ? carga.etiqueta : "ice",
    renotify: alta,
    requireInteraction: alta,
    timestamp: Date.now(),
    data: { punto_id: typeof carga.punto_id === "string" ? carga.punto_id : null },
  };

  // `silent` y `vibrate` a la vez es contradictorio y algunos navegadores lo
  // rechazan con un TypeError que se llevaría por delante la notificación
  // entera, así que se pone uno u otro, nunca los dos.
  if (prioridad === "baja") opciones.silent = true;
  else if (alta) opciones.vibrate = [200, 100, 200];

  await self.registration.showNotification(
    typeof carga.titulo === "string" ? carga.titulo : "infoCaliEmergencia",
    opciones,
  );
}

self.addEventListener("notificationclick", (evento) => {
  evento.notification.close();
  const puntoId = evento.notification.data?.punto_id ?? null;

  evento.waitUntil(
    (async () => {
      const ventanas = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const abierta = ventanas.find((v) => v.url.startsWith(self.location.origin));

      // Con la app ya abierta se le avisa por mensaje en vez de navegar: navegar
      // recarga la página y se pierden el zoom del mapa y las teselas cargadas,
      // que es caro con mala señal. La página escucha esto en `page.tsx`.
      if (abierta) {
        await abierta.focus();
        abierta.postMessage({ tipo: "ir-a-punto", punto_id: puntoId });
        return;
      }

      // `?p=` es el enlace profundo que la página ya sabe leer al arrancar.
      await self.clients.openWindow(puntoId ? `/?p=${encodeURIComponent(puntoId)}` : "/");
    })(),
  );
});

/**
 * El navegador rota el endpoint por su cuenta de vez en cuando. Sin volver a
 * suscribirse, las notificaciones dejan de llegar sin ningún síntoma.
 *
 * Aquí sólo se rehace la suscripción con el navegador; registrarla en la base es
 * cosa de la página, que lo hace en cada arranque y de forma idempotente
 * (`rpc_push_suscribir` reconcilia por `endpoint`). Se podría escribir desde
 * aquí, pero eso rompería la regla de la cabecera para ahorrar una espera que
 * en la práctica dura hasta que la persona vuelve a abrir la app — y mientras
 * tanto el endpoint viejo devuelve 410 y el servidor lo da de baja solo.
 */
self.addEventListener("pushsubscriptionchange", (evento) => {
  const clave = evento.oldSubscription?.options?.applicationServerKey;
  if (!clave) return;

  evento.waitUntil(
    self.registration.pushManager
      .subscribe({ userVisibleOnly: true, applicationServerKey: clave })
      .catch(() => {
        // Sin permiso o sin red no hay nada que hacer; la página lo reintentará.
      }),
  );
});
