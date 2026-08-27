import "maplibre-gl/dist/maplibre-gl.css";
import { Map } from "maplibre-gl";
import { LowResBasemap } from "../../dist/bad-map.js";

const map = new Map({
  container: "map",
  center: [-74.006, 40.7128],
  zoom: 14,
  style: { version: 8, sources: {}, layers: [] },
});
const basemap = new LowResBasemap({
  source: { tileJSON: "https://tiles.compatibility.test/source" },
  attribution: false,
  labels: false,
});

basemap.on("render", () => {
  document.documentElement.dataset.rendered = "true";
});
basemap.on("error", ({ error }) => {
  document.documentElement.dataset.error = error.message;
});

await basemap.addTo(map);

window.__badMapCompatibility = { map, basemap };
