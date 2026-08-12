import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "infoCaliEmergencia — Mapa de emergencia de Cali",
    short_name: "infoCali",
    description:
      "Qué se necesita, qué hay y cuánta gente está en cada punto de Cali. Reportado y verificado por la comunidad.",
    lang: "es",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#020617",
    theme_color: "#020617",
    // Un SVG con `sizes: "any"` cumple el requisito de instalación de Chrome en
    // Android, que es el grueso del uso esperado, y evita meter binarios al
    // repositorio.
    //
    // El PNG rompe esa regla y hay un motivo concreto: las notificaciones push
    // no aceptan SVG. Android descarta el `icon` y deja el aviso con un cuadro
    // gris genérico, que en una alerta de emergencia es exactamente lo que no
    // puede pasar. Se generan desde este mismo dibujo (ver `public/icono.svg`);
    // el otro, `badge-96.png`, no va en el manifiesto porque sólo lo usa
    // `sw.js` al mostrar la notificación.
    icons: [
      {
        src: "/icono.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icono-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
