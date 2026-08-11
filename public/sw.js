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
 * forma de duplicar reportes.
 */

const VERSION = "ice-v1";
const SHELL = `${VERSION}-shell`;
const TESELAS = `${VERSION}-teselas`;
const DATOS = `${VERSION}-datos`;
const VIGENTES = [SHELL, TESELAS, DATOS];

const MAX_TESELAS = 1200;

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
        const cache = await caches.open(SHELL);
        const respuesta = await fetch("/", { cache: "reload" });
        if (respuesta.ok) {
          const html = await respuesta.clone().text();
          await cache.put("/", respuesta);
          const estaticos = [...new Set(html.match(/\/_next\/static\/[^"')\s]+/g) ?? [])];
          await Promise.all(estaticos.map((u) => cache.add(u).catch(() => {})));
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

/** Intenta la red con límite de tiempo; si no llega, sirve lo último que se vio. */
async function primeroRed(peticion, nombre, msLimite) {
  const cache = await caches.open(nombre);

  try {
    const respuesta = await (msLimite
      ? Promise.race([
          fetch(peticion),
          new Promise((_, rechazar) => setTimeout(() => rechazar(new Error("lento")), msLimite)),
        ])
      : fetch(peticion));

    if (respuesta && respuesta.ok) {
      await cache.put(peticion, respuesta.clone());
    }
    return respuesta;
  } catch {
    const guardada = await cache.match(peticion);
    if (guardada) return guardada;
    throw new Error("sin red y sin copia");
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
  if (url.origin === self.location.origin && url.pathname.startsWith("/_next/static/")) {
    evento.respondWith(primeroCache(request, SHELL));
    return;
  }

  // Datos de Supabase: se prefiere lo fresco, pero con 3 s de paciencia como
  // máximo. Pasado eso vale más un mapa de hace un rato que una pantalla vacía.
  if (url.pathname.startsWith("/rest/v1/")) {
    evento.respondWith(
      primeroRed(request, DATOS, 3000).catch(
        () =>
          new Response(JSON.stringify({ message: "sin conexión" }), {
            status: 503,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    return;
  }

  // Navegación: red primero, y si no hay, el último HTML que se pudo guardar.
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
