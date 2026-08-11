"use client";

import { useEffect, useMemo } from "react";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.heat";

import type { PuntoCalor, PuntoMapa } from "@/lib/tipos";

export const CALI: [number, number] = [3.4516, -76.532];

/**
 * Marcador construido con divIcon en vez de una imagen: el estado del punto se
 * lee de un vistazo sin abrirlo. El emoji dice qué es, el color el tipo, el
 * borde punteado que aún nadie lo ha verificado, el anillo rojo que tiene alguna
 * necesidad crítica, y la burbuja cuánta gente hay.
 */
function icono(p: PuntoMapa): L.DivIcon {
  const critico = p.necesidades.some((n) => n.nivel === "muy_requerido");
  const borde = p.verificado ? "solid" : "dashed";

  return L.divIcon({
    className: "",
    html: `
      <div class="marcador ${critico ? "marcador-critico" : ""}"
           style="--color:${p.color};border-style:${borde}">
        <span>${p.emoji}</span>
        ${p.personas > 0 ? `<b class="marcador-personas">${p.personas}</b>` : ""}
      </div>`,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
  });
}

function CapaCalor({ datos, visible }: { datos: PuntoCalor[]; visible: boolean }) {
  const mapa = useMap();

  useEffect(() => {
    if (!visible || datos.length === 0) return;

    const capa = L.heatLayer(
      datos.map((d) => [d.lat, d.lng, d.intensidad] as L.PuntoCalor),
      {
        radius: 45,
        blur: 32,
        minOpacity: 0.35,
        // El máximo se ajusta al punto más concentrado del momento, para que el
        // mapa siga siendo legible tanto con 5 personas como con 500.
        max: Math.max(6, ...datos.map((d) => d.intensidad)),
        gradient: { 0.2: "#1d4ed8", 0.45: "#0891b2", 0.7: "#f59e0b", 1: "#dc2626" },
      },
    ).addTo(mapa);

    return () => {
      mapa.removeLayer(capa);
    };
  }, [mapa, datos, visible]);

  return null;
}

function CapturarClic({ onClic }: { onClic?: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onClic?.(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function IrA({ destino }: { destino: [number, number] | null }) {
  const mapa = useMap();
  useEffect(() => {
    if (destino) mapa.flyTo(destino, Math.max(mapa.getZoom(), 16), { duration: 0.8 });
  }, [mapa, destino]);
  return null;
}

export default function Mapa({
  puntos,
  calor,
  mostrarCalor,
  onSeleccionar,
  onClicMapa,
  destino,
}: {
  puntos: PuntoMapa[];
  calor: PuntoCalor[];
  mostrarCalor: boolean;
  onSeleccionar: (p: PuntoMapa) => void;
  onClicMapa?: (lat: number, lng: number) => void;
  destino: [number, number] | null;
}) {
  const marcadores = useMemo(
    () =>
      puntos.map((p) => (
        <Marker
          key={p.id}
          position={[p.lat, p.lng]}
          icon={icono(p)}
          eventHandlers={{ click: () => onSeleccionar(p) }}
        />
      )),
    [puntos, onSeleccionar],
  );

  return (
    <MapContainer
      center={CALI}
      zoom={13}
      className="h-full w-full"
      zoomControl={false}
      preferCanvas
    >
      {/* Teselas de OpenStreetMap: sin llave de API y sin riesgo de factura
          sorpresa si la aplicación se difunde de golpe. */}
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        maxZoom={19}
      />
      <CapaCalor datos={calor} visible={mostrarCalor} />
      <CapturarClic onClic={onClicMapa} />
      <IrA destino={destino} />
      {marcadores}
    </MapContainer>
  );
}
