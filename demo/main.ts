import "maplibre-gl/dist/maplibre-gl.css";
import { Map, NavigationControl } from "maplibre-gl";
import { LowResBasemap } from "../src";
import "./style.css";

const map = new Map({
  container: "map",
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
  center: [-74.006, 40.7128],
  zoom: 14.4,
  minZoom: 2,
  maxZoom: 19,
  bearing: 0,
  pitch: 0,
  dragRotate: false,
  touchPitch: false,
  attributionControl: false,
});

map.addControl(new NavigationControl({ showCompass: false }), "top-right");

const basemap = new LowResBasemap();
const status = document.querySelector<HTMLSpanElement>("#status")!;
const readout = document.querySelector<HTMLElement>("#readout")!;
const diagnostics = {
  renderEvents: 0,
  styleEvents: 0,
  lastGeneration: -1,
  lastDurationMs: 0,
  generations: [] as number[],
};

basemap.on("render", ({ durationMs, generation }) => {
  diagnostics.renderEvents += 1;
  diagnostics.lastGeneration = generation;
  diagnostics.lastDurationMs = durationMs;
  diagnostics.generations.push(generation);
  status.textContent = `rendered in ${durationMs.toFixed(0)} ms`;
});
basemap.on("stylechange", () => {
  diagnostics.styleEvents += 1;
});
basemap.on("error", ({ error }) => {
  status.textContent = error.message;
});
basemap.on("featureenter", ({ feature }) => {
  readout.textContent =
    feature.name || `${feature.class || feature.kind} · ${feature.sourceLayer}`;
});
basemap.on("featureleave", () => {
  readout.textContent = "Move over the map to inspect a feature.";
});

await basemap.addTo(map);

// A regular MapLibre visualization lives above the low-res basemap and below
// its labels. This is the package's central layering contract.
map.addSource("demo-data", {
  type: "geojson",
  data: {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { magnitude: 18 },
        geometry: { type: "Point", coordinates: [-74.006, 40.7128] },
      },
      {
        type: "Feature",
        properties: { magnitude: 11 },
        geometry: { type: "Point", coordinates: [-73.9857, 40.7484] },
      },
      {
        type: "Feature",
        properties: { magnitude: 8 },
        geometry: { type: "Point", coordinates: [-74.0445, 40.6892] },
      },
    ],
  },
});
map.addLayer(
  {
    id: "demo-points",
    type: "circle",
    source: "demo-data",
    paint: {
      "circle-radius": ["get", "magnitude"],
      "circle-color": "#ff6688",
      "circle-opacity": 0.42,
      "circle-stroke-color": "#ffb0c0",
      "circle-stroke-width": 1,
    },
  },
  basemap.layerIds.labels,
);

let dark = true;
document.querySelector<HTMLButtonElement>("#theme")!.onclick = (event) => {
  dark = !dark;
  basemap.setTheme(dark ? "dark" : "light");
  (event.currentTarget as HTMLButtonElement).textContent = dark
    ? "light theme"
    : "dark theme";
};

let greyscale = false;
document.querySelector<HTMLButtonElement>("#color-mode")!.onclick = (event) => {
  greyscale = !greyscale;
  basemap.setColorMode(greyscale ? "greyscale" : "color");
  (event.currentTarget as HTMLButtonElement).textContent = greyscale
    ? "full color"
    : "greyscale";
};

let large = false;
document.querySelector<HTMLButtonElement>("#cells")!.onclick = (event) => {
  large = !large;
  basemap.setCell(
    large
      ? { width: 10, height: 20, dotSize: 2.5 }
      : { width: 8, height: 16, dotSize: 2 },
  );
  (event.currentTarget as HTMLButtonElement).textContent = large
    ? "smaller cells"
    : "larger cells";
};

let labels = true;
document.querySelector<HTMLButtonElement>("#labels")!.onclick = (event) => {
  labels = !labels;
  basemap.setLabelsVisible(labels);
  (event.currentTarget as HTMLButtonElement).textContent = labels
    ? "hide labels"
    : "show labels";
};

window.addEventListener("beforeunload", () => basemap.remove());

// Read-only demo handles used by the interaction test harness.
Object.assign(window, { __badMapDemo: { map, basemap, diagnostics } });
