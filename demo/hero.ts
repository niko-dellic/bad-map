import "@fontsource/silkscreen/400.css";
import "maplibre-gl/dist/maplibre-gl.css";
import { Map } from "maplibre-gl";
import { LowResBasemap, streets, transit } from "../src";
import { heroCameraAt, selectHeroCity } from "./hero-camera";

const container = document.querySelector<HTMLElement>("#hero-map");

if (!container) throw new Error("Unable to find the hero map container");

const city = selectHeroCity();
const motionPhase = Math.random() * Math.PI * 2;
const colorMode = "greyscale";
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
  center: [...city.center],
  zoom: city.zoom,
  minZoom: 2,
  maxZoom: 19,
  bearing: city.bearing,
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
  colorMode,
  dataLayers: [],
  labels: false,
  attribution: false,
  featureInteraction: false,
  cell: { width: 8, height: 16, dotSize: 2 },
  camera: { rotation: true, pitch: true, maxPitch: 70 },
  fog: { visible: true, mode: "dithered", start: 0.58 },
});

await basemap.addTo(map);
container.dataset.ready = "true";
container.dataset.city = city.slug;
container.dataset.cityName = city.name;
container.dataset.colorMode = colorMode;
container.dataset.dataLayerCount = String(basemap.getDataLayers().length);
container.dataset.center = city.center.join(",");
container.dataset.bearing = String(city.bearing);

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let visible = true;
let frame = 0;
let elapsed = 0;
let previousTime = performance.now();

const animate = (time: number) => {
  if (visible && !document.hidden && !reducedMotion.matches) {
    elapsed += Math.min(Math.max(time - previousTime, 0), 100);
    const camera = heroCameraAt(city, elapsed, motionPhase);
    map.jumpTo(camera);
    container.dataset.center = camera.center
      .map((coordinate) => coordinate.toFixed(6))
      .join(",");
    container.dataset.bearing = camera.bearing.toFixed(3);
  }
  previousTime = time;
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
