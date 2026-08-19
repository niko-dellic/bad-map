import "maplibre-gl/dist/maplibre-gl.css";
import { Map, NavigationControl } from "maplibre-gl";
import {
  landuse,
  LowResBasemap,
  marine,
  political,
  streets,
  topographic,
  transit,
  weather,
} from "../src";
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
  dragRotate: true,
  touchPitch: true,
  attributionControl: false,
});

map.addControl(new NavigationControl({ showCompass: true }), "bottom-left");

const BASE_SOURCE = {
  tileJSON: "https://tiles.openfreemap.org/planet",
  attribution: "OpenFreeMap © OpenMapTiles · Data © OpenStreetMap contributors",
};
const UBER_DATA_URL =
  "https://raw.githubusercontent.com/visgl/deck.gl-data/master/examples/screen-grid/uber-pickup-locations.json";
const NATIVE_HEATMAP_SOURCE = "demo-uber-pickups";
const NATIVE_HEATMAP_LAYER = "demo-uber-native-heatmap";
const packDescriptors = [
  streets(),
  transit({ enabled: false, priority: 20 }),
  topographic({ enabled: false, priority: 10 }),
  political({ enabled: false, priority: 15 }),
  marine({ enabled: false, priority: 12 }),
  landuse({ enabled: false, priority: 8 }),
  weather({ source: "weather", enabled: false, priority: 30 }),
];
const basemap = new LowResBasemap({
  source: BASE_SOURCE,
  layers: packDescriptors,
  colorMode: "greyscale",
  camera: { rotation: false, pitch: false, maxPitch: 70 },
});
const status = document.querySelector<HTMLSpanElement>("#status")!;
const readout = document.querySelector<HTMLElement>("#readout")!;
const settings = document.querySelector<HTMLElement>("#settings")!;
const settingsToggle =
  document.querySelector<HTMLButtonElement>("#settings-toggle")!;
const diagnostics = {
  renderEvents: 0,
  styleEvents: 0,
  lastGeneration: -1,
  lastDurationMs: 0,
  generations: [] as number[],
  heatmapEvents: 0,
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
basemap.on("heatmapchange", () => {
  diagnostics.heatmapEvents += 1;
});
basemap.on("error", ({ error }) => {
  status.textContent = error.message;
});
basemap.on("featureenter", ({ feature }) => {
  const title = feature.name || feature.class || feature.kind;
  readout.textContent = `${title} · ${feature.packId}/${feature.sourceLayer}`;
});
basemap.on("featureleave", () => {
  readout.textContent = "Move over the map to inspect a feature.";
});

try {
  await basemap.addTo(map);
} catch (error) {
  status.textContent = error instanceof Error ? error.message : String(error);
  throw error;
}

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
  basemap.layerIds.markers,
);

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
const buildings3D = document.querySelector<HTMLInputElement>("#buildings-3d")!;
const rotation = document.querySelector<HTMLInputElement>("#rotation")!;
const bearing = document.querySelector<HTMLInputElement>("#bearing")!;
const pitch = document.querySelector<HTMLInputElement>("#pitch")!;
const updateCameraLabels = () => {
  document.querySelector("#bearing-value")!.textContent =
    `${Math.round(map.getBearing())}°`;
  document.querySelector("#pitch-value")!.textContent =
    `${Math.round(map.getPitch())}°`;
};
const applyProjection = () => {
  const surface = projection.value === "surface";
  pitch.disabled = !surface;
  rotation.checked = surface || rotation.checked;
  if (!surface) {
    buildings3D.checked = false;
    basemap.setBuildings3DVisible(false);
  }
  basemap.setProjectionMode(surface ? "surface" : "screen").setCamera({
    rotation: rotation.checked,
    pitch: surface,
    maxPitch: 70,
  });
  map.easeTo({ pitch: surface ? Number(pitch.value) || 45 : 0, duration: 450 });
};
projection.onchange = applyProjection;
buildings3D.onchange = () => {
  if (buildings3D.checked && projection.value !== "surface") {
    projection.value = "surface";
    applyProjection();
  }
  basemap.setBuildings3DVisible(buildings3D.checked);
};
rotation.onchange = () =>
  basemap.setCamera({
    rotation: rotation.checked,
    pitch: projection.value === "surface",
  });
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

type PickupRow = readonly [number, number, number];
interface PickupData {
  rows: PickupRow[];
  compact: Float32Array;
}

const heatmapMode = document.querySelector<HTMLSelectElement>("#heatmap-mode")!;
const heatmapRadius =
  document.querySelector<HTMLInputElement>("#heatmap-radius")!;
const heatmapIntensity =
  document.querySelector<HTMLInputElement>("#heatmap-intensity")!;
const heatmapOpacity =
  document.querySelector<HTMLInputElement>("#heatmap-opacity")!;
const heatmapStatus =
  document.querySelector<HTMLOutputElement>("#heatmap-status")!;
let pickupDataPromise: Promise<PickupData> | undefined;
let lowResHeatmapLoaded = false;

const loadPickupData = (): Promise<PickupData> => {
  pickupDataPromise ??= fetch(UBER_DATA_URL)
    .then((response) => {
      if (!response.ok)
        throw new Error(`Pickup request failed (${response.status})`);
      return response.json() as Promise<unknown>;
    })
    .then((value) => {
      if (!Array.isArray(value)) throw new TypeError("Unexpected pickup data");
      const rows: PickupRow[] = [];
      for (const candidate of value) {
        if (
          !Array.isArray(candidate) ||
          candidate.length < 2 ||
          !candidate.slice(0, 3).every(Number.isFinite)
        )
          continue;
        rows.push([
          Number(candidate[0]),
          Number(candidate[1]),
          Number(candidate[2] ?? 1),
        ]);
      }
      const compact = new Float32Array(rows.length * 3);
      rows.forEach(([lng, lat, weight], index) => {
        compact[index * 3] = lng;
        compact[index * 3 + 1] = lat;
        compact[index * 3 + 2] = weight;
      });
      return { rows, compact };
    });
  return pickupDataPromise;
};

const ensureNativeHeatmap = (rows: readonly PickupRow[]) => {
  if (!map.getSource(NATIVE_HEATMAP_SOURCE)) {
    map.addSource(NATIVE_HEATMAP_SOURCE, {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: rows.map(([lng, lat, weight]) => ({
          type: "Feature" as const,
          properties: { weight },
          geometry: {
            type: "Point" as const,
            coordinates: [lng, lat],
          },
        })),
      },
    });
  }
  if (!map.getLayer(NATIVE_HEATMAP_LAYER))
    map.addLayer(
      {
        id: NATIVE_HEATMAP_LAYER,
        type: "heatmap",
        source: NATIVE_HEATMAP_SOURCE,
        paint: {
          "heatmap-weight": ["/", ["get", "weight"], 15],
          "heatmap-radius": Number(heatmapRadius.value),
          "heatmap-intensity": Number(heatmapIntensity.value) * 0.2,
          "heatmap-opacity": Number(heatmapOpacity.value),
          "heatmap-color": [
            "interpolate",
            ["linear"],
            ["heatmap-density"],
            0,
            "rgba(24, 54, 92, 0)",
            0.25,
            "#286d9b",
            0.5,
            "#57ad85",
            0.75,
            "#efb24b",
            1,
            "#e24c5b",
          ],
        },
      },
      basemap.layerIds.markers,
    );
};

const applyHeatmapControls = () => {
  const radius = Number(heatmapRadius.value);
  const intensity = Number(heatmapIntensity.value);
  const opacity = Number(heatmapOpacity.value);
  document.querySelector("#heatmap-radius-value")!.textContent = String(radius);
  document.querySelector("#heatmap-intensity-value")!.textContent = intensity
    .toFixed(2)
    .replace(/0$/, "");
  document.querySelector("#heatmap-opacity-value")!.textContent =
    opacity.toFixed(2);
  if (heatmapMode.value === "native" && map.getLayer(NATIVE_HEATMAP_LAYER)) {
    map.setPaintProperty(NATIVE_HEATMAP_LAYER, "heatmap-radius", radius);
    map.setPaintProperty(
      NATIVE_HEATMAP_LAYER,
      "heatmap-intensity",
      intensity * 0.2,
    );
    map.setPaintProperty(NATIVE_HEATMAP_LAYER, "heatmap-opacity", opacity);
  }
  if (heatmapMode.value === "lowres")
    basemap.setHeatmap({ radius, intensity, opacity });
};

const applyHeatmapMode = async () => {
  const mode = heatmapMode.value;
  if (mode === "off") {
    if (map.getLayer(NATIVE_HEATMAP_LAYER))
      map.setLayoutProperty(NATIVE_HEATMAP_LAYER, "visibility", "none");
    basemap.setHeatmapVisible(false);
    heatmapStatus.textContent = pickupDataPromise
      ? "pickup data ready"
      : "loads 100,000 NYC pickups on selection";
    return;
  }
  heatmapMode.disabled = true;
  heatmapStatus.textContent = "loading pickup data…";
  try {
    const data = await loadPickupData();
    if (mode === "native") {
      basemap.setHeatmapVisible(false);
      ensureNativeHeatmap(data.rows);
      map.setLayoutProperty(NATIVE_HEATMAP_LAYER, "visibility", "visible");
    } else {
      if (map.getLayer(NATIVE_HEATMAP_LAYER))
        map.setLayoutProperty(NATIVE_HEATMAP_LAYER, "visibility", "none");
      if (!lowResHeatmapLoaded) {
        basemap.setHeatmap({
          data: data.compact,
          visible: true,
          radius: Number(heatmapRadius.value),
          intensity: Number(heatmapIntensity.value),
          maxDensity: 192,
          opacity: Number(heatmapOpacity.value),
          palette: [
            [40, 109, 155],
            [87, 173, 133],
            [239, 178, 75],
            [226, 76, 91],
          ],
        });
        lowResHeatmapLoaded = true;
      } else basemap.setHeatmapVisible(true);
    }
    heatmapStatus.textContent = `${data.rows.length.toLocaleString()} weighted pickups · ${mode}`;
    applyHeatmapControls();
  } catch (error) {
    heatmapMode.value = "off";
    heatmapStatus.textContent =
      error instanceof Error ? error.message : String(error);
  } finally {
    heatmapMode.disabled = false;
  }
};

heatmapMode.onchange = () => void applyHeatmapMode();
heatmapRadius.oninput = applyHeatmapControls;
heatmapIntensity.oninput = applyHeatmapControls;
heatmapOpacity.oninput = applyHeatmapControls;

document.querySelector<HTMLButtonElement>("#apply-sources")!.onclick = () => {
  const baseUrl =
    document.querySelector<HTMLInputElement>("#base-source")!.value;
  const weatherUrl =
    document.querySelector<HTMLInputElement>("#weather-source")!.value;
  const timeKey =
    document.querySelector<HTMLInputElement>("#weather-time")!.value;
  basemap.setSources({
    base: { ...BASE_SOURCE, tileJSON: baseUrl },
    ...(weatherUrl
      ? {
          weather: {
            tileJSON: weatherUrl,
            attribution: "Weather source",
            ...(timeKey ? { timeKey } : {}),
          },
        }
      : {}),
  });
  const weatherToggle = document.querySelector<HTMLInputElement>(
    '[data-pack="weather"]',
  )!;
  weatherToggle.checked = Boolean(weatherUrl);
  basemap.setLayerVisible("weather", Boolean(weatherUrl));
};

document.querySelector<HTMLButtonElement>("#reset")!.onclick = () => {
  map.easeTo({
    center: [-74.006, 40.7128],
    zoom: 14.4,
    bearing: 0,
    pitch: 0,
    duration: 500,
  });
};

settingsToggle.onclick = () => {
  const collapsed = settings.classList.toggle("is-collapsed");
  settingsToggle.textContent = collapsed ? "expand" : "collapse";
  settingsToggle.setAttribute("aria-expanded", String(!collapsed));
  settingsToggle.setAttribute(
    "aria-label",
    collapsed ? "Expand settings panel" : "Collapse settings panel",
  );
};

window.addEventListener("beforeunload", () => basemap.remove());

// Read-only demo handles used by the interaction test harness.
Object.assign(window, { __badMapDemo: { map, basemap, diagnostics } });
