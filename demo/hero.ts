import "@fontsource/silkscreen/400.css";
import "maplibre-gl/dist/maplibre-gl.css";
import { Map } from "maplibre-gl";
import { LowResBasemap, streets, transit } from "../src";

const container = document.querySelector<HTMLElement>("#hero-map");

if (!container) throw new Error("Unable to find the hero map container");

const initialBearing = -28;
const map = new Map({
  container,
  style: {
    version: 8,
    sources: {},
    layers: [
      {
        id: "transparent",
        type: "background",
        paint: { "background-color": "rgba(0,0,0,0)" },
      },
    ],
  },
  center: [-73.9857, 40.725],
  zoom: 10.9,
  minZoom: 2,
  maxZoom: 19,
  bearing: initialBearing,
  pitch: 58,
  interactive: false,
  attributionControl: false,
  fadeDuration: 0,
});

const basemap = new LowResBasemap({
  source: {
    tileJSON: "https://tiles.openfreemap.org/planet",
    attribution:
      "OpenFreeMap © OpenMapTiles · Data © OpenStreetMap contributors",
  },
  layers: [streets(), transit({ priority: 20 })],
  colorMode: "color",
  labels: false,
  attribution: false,
  featureInteraction: false,
  cell: { width: 8, height: 16, dotSize: 2 },
  camera: { rotation: true, pitch: true, maxPitch: 70 },
  fog: { visible: true, mode: "dithered", start: 0.58 },
});

await basemap.addTo(map);
container.dataset.ready = "true";
container.dataset.bearing = String(initialBearing);

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let visible = true;
let frame = 0;
let start = performance.now();
let pausedBearing = initialBearing;

const animate = (time: number) => {
  if (visible && !document.hidden && !reducedMotion.matches) {
    const bearing = pausedBearing + (time - start) * 0.0018;
    map.jumpTo({ bearing });
    container.dataset.bearing = bearing.toFixed(3);
  } else {
    pausedBearing = map.getBearing();
    start = time;
  }
  frame = requestAnimationFrame(animate);
};

const visibilityObserver = new IntersectionObserver(
  ([entry]) => {
    visible = entry?.isIntersecting ?? false;
  },
  { threshold: 0.01 },
);
visibilityObserver.observe(container);

const resizeObserver = new ResizeObserver(() => map.resize());
resizeObserver.observe(container);
frame = requestAnimationFrame(animate);

window.addEventListener("beforeunload", () => {
  cancelAnimationFrame(frame);
  visibilityObserver.disconnect();
  resizeObserver.disconnect();
  basemap.remove();
  map.remove();
});
