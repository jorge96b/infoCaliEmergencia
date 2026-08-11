import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Mushu — Mapa de emergencia de Cali",
    short_name: "Mushu",
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
    icons: [
      {
        src: "/icono.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
