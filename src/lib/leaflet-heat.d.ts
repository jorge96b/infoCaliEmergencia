// `leaflet.heat` no trae tipos: se importa por su efecto secundario, que es
// colgar `heatLayer` del objeto L. Aquí se declara esa extensión.
declare module "leaflet.heat";

import "leaflet";

declare module "leaflet" {
  type PuntoCalor = [number, number, number?];

  interface OpcionesCalor {
    minOpacity?: number;
    maxZoom?: number;
    max?: number;
    radius?: number;
    blur?: number;
    gradient?: Record<number, string>;
  }

  interface CapaCalor extends Layer {
    setLatLngs(latlngs: PuntoCalor[]): this;
    addLatLng(latlng: PuntoCalor): this;
    setOptions(options: OpcionesCalor): this;
  }

  function heatLayer(latlngs: PuntoCalor[], options?: OpcionesCalor): CapaCalor;
}
