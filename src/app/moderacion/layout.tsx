import type { Metadata } from "next";

/**
 * `noindex` es defensa en profundidad, no la puerta. La puerta es Supabase Auth
 * más `es_moderador()`; esto sólo evita que el panel salga en un buscador y le
 * ahorre el primer paso a quien vaya a probar contraseñas.
 *
 * Va en un layout y no en la página porque `page.tsx` es un componente de
 * cliente, y un componente de cliente no puede exportar `metadata`.
 */
export const metadata: Metadata = {
  title: "Moderación — infoCaliEmergencia",
  robots: { index: false, follow: false },
};

export default function LayoutModeracion({ children }: { children: React.ReactNode }) {
  return children;
}
