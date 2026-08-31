import "maplibre-gl/dist/maplibre-gl.css";
import "@phosphor-icons/web/regular";
import { Map, setWorkerUrl } from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import type { Feature } from "geojson";
import {
  landuse,
  LowResBasemap,
  marine,
  political,
  streets,
  topographic,
  transit,
  type LowResDataFeature,
  type RGB,
} from "../src";
import { setupEffects } from "./effects";
import { setupHeatmapControls } from "./heatmap-controls";
import {
  describeHighwayFeature,
  setupHighwayControls,
} from "./highway-controls";
import { setupSettingsPanel } from "./panel";
import { setupPlaceSearch } from "./search";
import { setupPresentationControls } from "./presentation-controls";
import { setupTripsControls } from "./trips-controls";
import { ScreenFisheyeLayer } from "./fisheye";
import "./style.css";

setWorkerUrl(maplibreWorkerUrl);

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
  zoom: 13.8,
  minZoom: 2,
  maxZoom: 19,
  bearing: 0,
  pitch: 0,
  dragRotate: true,
  touchPitch: true,
  attributionControl: false,
});

const BASE_SOURCE = {
  tileJSON: "https://tiles.openfreemap.org/planet",
  attribution: "OpenFreeMap © OpenMapTiles · Data © OpenStreetMap contributors",
};
const packDescriptors = [
  streets(),
  transit({ enabled: false, priority: 20 }),
  topographic({ enabled: false, priority: 10 }),
  political({ enabled: false, priority: 15 }),
  marine({ enabled: false, priority: 12 }),
  landuse({ enabled: false, priority: 8 }),
];
const buildingsStyle = new URLSearchParams(location.search).get(
  "building-style",
);
const basemap = new LowResBasemap({
  source: BASE_SOURCE,
  layers: packDescriptors,
  colorMode: "greyscale",
  labels: false,
  featureInteraction: false,
  camera: { rotation: true, pitch: true, maxPitch: 70 },
  ...(buildingsStyle === "native"
    ? { buildings3D: { style: "native" as const } }
    : {}),
});
const fisheye = new ScreenFisheyeLayer();
const app = document.querySelector<HTMLElement>("#app")!;
const status = document.querySelector<HTMLSpanElement>("#status")!;
const readout = document.querySelector<HTMLElement>("#readout")!;
const featureQueryToggle = document.querySelector<HTMLButtonElement>(
  "#feature-query-toggle",
)!;
setupSettingsPanel();
const effects = setupEffects(map, fisheye);
const disconnectPresentationControls = setupPresentationControls(map);

const diagnostics = {
  renderEvents: 0,
  styleEvents: 0,
  lastGeneration: -1,
  lastDurationMs: 0,
  generations: [] as number[],
  heatmapEvents: 0,
  dataRenderEvents: 0,
  featureEnterEvents: 0,
};

setupPlaceSearch(map, basemap);

let revealScheduled = false;
const revealApp = () => {
  if (revealScheduled) return;
  revealScheduled = true;
  requestAnimationFrame(() => {
    app.style.removeProperty("visibility");
    app.removeAttribute("aria-busy");
  });
};

basemap.on("render", ({ durationMs, generation }) => {
  diagnostics.renderEvents += 1;
  diagnostics.lastGeneration = generation;
  diagnostics.lastDurationMs = durationMs;
  diagnostics.generations.push(generation);
  status.textContent = `rendered in ${durationMs.toFixed(0)} ms`;
  revealApp();
});
basemap.on("stylechange", () => {
  diagnostics.styleEvents += 1;
});
basemap.on("heatmapchange", () => {
  diagnostics.heatmapEvents += 1;
});
basemap.on("datarender", () => {
  diagnostics.dataRenderEvents += 1;
});
basemap.on("error", ({ error }) => {
  if (error.fatal) status.textContent = error.message;
  else console.warn(`[bad-map] ${error.message}`, error.cause ?? "");
});
basemap.on("featureenter", ({ feature }) => {
  diagnostics.featureEnterEvents += 1;
  const title = feature.name || feature.class || feature.kind;
  readout.textContent = `${title} · ${feature.packId}/${feature.sourceLayer}`;
});
basemap.on("featureleave", () => {
  readout.textContent = "Move over the map to inspect a feature.";
});
const describeDataFeature = (feature: LowResDataFeature) => {
  const highway = describeHighwayFeature(feature);
  if (highway) return highway;
  return `${String(feature.properties?.name ?? feature.featureId ?? feature.layerType)} · ${feature.layerId}`;
};
basemap.on("datafeatureenter", ({ feature }) => {
  readout.textContent = describeDataFeature(feature);
});
basemap.on("datafeatureleave", () => {
  readout.textContent = "Move over the map to inspect a feature.";
});

featureQueryToggle.onclick = () => {
  const enabled = !basemap.getFeatureInteractionEnabled();
  basemap.setFeatureInteractionEnabled(enabled);
  featureQueryToggle.setAttribute("aria-pressed", String(enabled));
  const label = enabled
    ? "Disable mouse feature queries"
    : "Enable mouse feature queries";
  featureQueryToggle.setAttribute("aria-label", label);
  featureQueryToggle.title = label;
  document.querySelector("#map")!.classList.toggle("is-querying", enabled);
  readout.hidden = !enabled;
  readout.textContent = "Move over the map to inspect a feature.";
};

try {
  await basemap.addTo(map);
  map.addLayer(fisheye, basemap.layerIds.interaction);
} catch (error) {
  status.textContent = error instanceof Error ? error.message : String(error);
  revealApp();
  throw error;
}

const theme = document.querySelector<HTMLSelectElement>("#theme")!;
theme.onchange = () => {
  basemap.setTheme(theme.value === "light" ? "light" : "dark");
};

let greyscale = true;
document.querySelector<HTMLButtonElement>("#color-mode")!.onclick = (event) => {
  greyscale = !greyscale;
  basemap.setColorMode(greyscale ? "greyscale" : "color");
  (event.currentTarget as HTMLButtonElement).textContent = greyscale
    ? "full color"
    : "greyscale";
};

const cellWidth = document.querySelector<HTMLInputElement>("#cell-width")!;
const cellHeight = document.querySelector<HTMLInputElement>("#cell-height")!;
const dotSize = document.querySelector<HTMLInputElement>("#dot-size")!;
const applyCell = () => {
  const width = Number(cellWidth.value);
  const height = Number(cellHeight.value);
  const maximum = Math.min(width / 2, height / 4);
  const dot = Math.min(Number(dotSize.value), maximum);
  dotSize.max = String(maximum);
  dotSize.value = String(dot);
  document.querySelector("#cell-width-value")!.textContent = String(width);
  document.querySelector("#cell-height-value")!.textContent = String(height);
  document.querySelector("#dot-size-value")!.textContent = String(dot);
  basemap.setCell({ width, height, dotSize: dot });
};
cellWidth.oninput = applyCell;
cellHeight.oninput = applyCell;
dotSize.oninput = applyCell;
let large = false;
const cellPreset = document.querySelector<HTMLButtonElement>("#cells")!;
cellPreset.onclick = () => {
  large = !large;
  cellWidth.value = large ? "12" : "8";
  cellHeight.value = large ? "24" : "16";
  dotSize.value = large ? "3" : "2";
  cellPreset.textContent = large ? "smaller cell preset" : "larger cell preset";
  applyCell();
};

const labels = document.querySelector<HTMLInputElement>("#labels")!;
labels.onchange = () => basemap.setLabelsVisible(labels.checked);
const locale = document.querySelector<HTMLSelectElement>("#locale")!;
locale.onchange = () => basemap.setLocale(locale.value);

const projection = document.querySelector<HTMLSelectElement>("#projection")!;
const fogMode = document.querySelector<HTMLSelectElement>("#fog-mode")!;
const fogStart = document.querySelector<HTMLInputElement>("#fog-start")!;
const fogEnd = document.querySelector<HTMLInputElement>("#fog-end")!;
const fogColor = document.querySelector<HTMLInputElement>("#fog-color")!;
const fogThemeColor =
  document.querySelector<HTMLInputElement>("#fog-theme-color")!;
const fogStatus = document.querySelector<HTMLOutputElement>("#fog-status")!;
const buildings3D = document.querySelector<HTMLInputElement>("#buildings-3d")!;
const buildingFill =
  document.querySelector<HTMLInputElement>("#building-fill")!;
const buildingDots =
  document.querySelector<HTMLInputElement>("#building-dots")!;
const buildingEdges =
  document.querySelector<HTMLInputElement>("#building-edges")!;
const buildingEdgeStrength = document.querySelector<HTMLInputElement>(
  "#building-edge-strength",
)!;
const buildingHeight =
  document.querySelector<HTMLInputElement>("#building-height")!;
const buildingStyleStatus = document.querySelector<HTMLOutputElement>(
  "#building-style-status",
)!;
const bearing = document.querySelector<HTMLInputElement>("#bearing")!;
const pitch = document.querySelector<HTMLInputElement>("#pitch")!;
let themeFogColor: RGB = [15, 15, 15];
const rgbToHex = (color: RGB) =>
  `#${color.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
const hexToRgb = (color: string): RGB => [
  Number.parseInt(color.slice(1, 3), 16),
  Number.parseInt(color.slice(3, 5), 16),
  Number.parseInt(color.slice(5, 7), 16),
];
const syncFogControls = () => {
  const fog = basemap.getFogOptions();
  const surface = projection.value === "surface";
  fogMode.value = fog.visible ? fog.mode : "disabled";
  fogStart.value = String(fog.start);
  fogEnd.value = String(fog.end);
  document.querySelector("#fog-start-value")!.textContent =
    fog.start.toFixed(2);
  document.querySelector("#fog-end-value")!.textContent = fog.end.toFixed(2);
  fogThemeColor.checked = fog.color === undefined;
  fogColor.value = rgbToHex(fog.color ?? themeFogColor);
  fogStatus.textContent = !surface
    ? "available in 3D surface mode"
    : fog.visible
      ? `${fog.mode} · ${Math.round(fog.start * 100)}–${Math.round(fog.end * 100)}% viewport depth · ${fog.color ? fogColor.value : "theme color"}`
      : "fog disabled";
};
fogMode.onchange = () => {
  if (fogMode.value === "disabled") basemap.setFogVisible(false);
  else
    basemap.setFog({
      visible: true,
      mode: fogMode.value === "dithered" ? "dithered" : "regular",
    });
};
fogStart.oninput = () => {
  const start = Math.min(Number(fogStart.value), Number(fogEnd.value) - 0.01);
  basemap.setFog({ start: Math.max(0, start) });
};
fogEnd.oninput = () => {
  const end = Math.max(Number(fogEnd.value), Number(fogStart.value) + 0.01);
  basemap.setFog({ end: Math.min(1, end) });
};
fogColor.oninput = () => basemap.setFog({ color: hexToRgb(fogColor.value) });
fogThemeColor.onchange = () =>
  basemap.setFog({
    color: fogThemeColor.checked ? undefined : hexToRgb(fogColor.value),
  });
basemap.on("fogchange", ({ color }) => {
  if (basemap.getFogOptions().color === undefined) themeFogColor = color;
  syncFogControls();
});
basemap.on("stylechange", ({ theme }) => {
  themeFogColor = theme.fills.ground;
  effects.setThemeColor(theme.fills.ground);
  syncFogControls();
});
const updateCameraLabels = () => {
  document.querySelector("#bearing-value")!.textContent =
    `${Math.round(map.getBearing())}°`;
  document.querySelector("#pitch-value")!.textContent =
    `${Math.round(map.getPitch())}°`;
};
const applyProjection = () => {
  const surface = projection.value === "surface";
  pitch.disabled = !surface;
  if (!surface) {
    buildings3D.checked = false;
    basemap.setBuildings3DVisible(false);
  }
  basemap.setProjectionMode(surface ? "surface" : "screen").setCamera({
    rotation: true,
    pitch: surface,
    maxPitch: 70,
  });
  syncFogControls();
  map.easeTo({ pitch: surface ? Number(pitch.value) || 45 : 0, duration: 450 });
};
syncFogControls();
projection.onchange = applyProjection;
buildings3D.onchange = () => {
  basemap.setBuildings3DVisible(buildings3D.checked);
};
const applyBuildingAppearance = () => {
  basemap.setBuildings3DAppearance({
    fill: buildingFill.checked,
    dots: buildingDots.checked,
    edges: buildingEdges.checked,
    edgeStrength: Number(buildingEdgeStrength.value),
    heightScale: Number(buildingHeight.value),
  });
  document.querySelector("#building-edge-strength-value")!.textContent =
    `${Number(buildingEdgeStrength.value).toFixed(2)}×`;
  document.querySelector("#building-height-value")!.textContent =
    `${Number(buildingHeight.value).toFixed(2)}×`;
  const layers = [
    buildingFill.checked ? "three-band fill" : undefined,
    buildingDots.checked ? "interior dots" : undefined,
    buildingEdges.checked ? "edge ink" : undefined,
  ].filter(Boolean);
  buildingStyleStatus.textContent = layers.length
    ? layers.join(" · ")
    : "building geometry hidden";
};
buildingFill.onchange = applyBuildingAppearance;
buildingDots.onchange = applyBuildingAppearance;
buildingEdges.onchange = applyBuildingAppearance;
buildingEdgeStrength.oninput = applyBuildingAppearance;
buildingHeight.oninput = applyBuildingAppearance;
bearing.oninput = () => map.setBearing(Number(bearing.value));
pitch.oninput = () => map.setPitch(Number(pitch.value));
map.on("rotate", () => {
  bearing.value = String(Math.round(map.getBearing()));
  updateCameraLabels();
});
map.on("pitch", () => {
  pitch.value = String(Math.round(map.getPitch()));
  updateCameraLabels();
});

const packs = document.querySelector<HTMLDivElement>("#packs")!;
for (const descriptor of packDescriptors) {
  const label = document.createElement("label");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = descriptor.enabled !== false;
  input.dataset.pack = descriptor.id;
  input.onchange = () => basemap.setLayerVisible(descriptor.id, input.checked);
  label.append(input, descriptor.id);
  packs.append(label);
}

setupHeatmapControls(map, basemap);

setupHighwayControls(map, basemap, () => featureQueryToggle.click());

const disconnectTrips = setupTripsControls(map, basemap);

document.querySelector<HTMLButtonElement>("#apply-sources")!.onclick = () => {
  const baseUrl =
    document.querySelector<HTMLInputElement>("#base-source")!.value;
  basemap.setSource({ ...BASE_SOURCE, tileJSON: baseUrl });
};

document.querySelector<HTMLButtonElement>("#reset")!.onclick = () => {
  map.easeTo({
    center: [-74.006, 40.7128],
    zoom: 13.8,
    bearing: 0,
    pitch: 0,
    duration: 500,
  });
};

window.addEventListener("beforeunload", () => {
  disconnectPresentationControls();
  disconnectTrips();
  effects.disconnect();
  basemap.remove();
});

// Read-only demo handles used by the interaction test harness.
Object.assign(window, { __badMapDemo: { map, basemap, fisheye, diagnostics } });
