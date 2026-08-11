import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "infoCaliEmergencia — Mapa de emergencia de Cali",
  description:
    "Mapa colaborativo para saber, punto por punto, qué se necesita, qué hay y cuánta gente está en cada lugar tras el terremoto en Cali.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "infoCali", statusBarStyle: "black-translucent" },
  icons: { icon: "/icono.svg", apple: "/icono.svg" },
};

export const viewport: Viewport = {
  themeColor: "#020617",
  width: "device-width",
  initialScale: 1,
  // La app se usa de pie, con una mano y con prisa; el zoom accidental estorba.
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="bg-slate-950 text-slate-100 antialiased">{children}</body>
    </html>
  );
}
