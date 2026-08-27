import type { Map } from "maplibre-gl";
import type { LowResBasemap } from "../../src/index.js";

declare global {
  interface Window {
    __badMapCompatibility: {
      map: Map;
      basemap: LowResBasemap;
    };
  }
}

export {};
