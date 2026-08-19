import "maplibre-gl/dist/maplibre-gl.css";
import "@phosphor-icons/web/regular";
import { Map, Marker, NavigationControl } from "maplibre-gl";
import {
  landuse,
  LowResBasemap,
  marine,
  political,
  streets,
  topographic,
  transit,
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
];
const basemap = new LowResBasemap({
  source: BASE_SOURCE,
  layers: packDescriptors,
  colorMode: "greyscale",
  featureInteraction: false,
  camera: { rotation: true, pitch: false, maxPitch: 70 },
});
const status = document.querySelector<HTMLSpanElement>("#status")!;
const readout = document.querySelector<HTMLElement>("#readout")!;
const featureQueryToggle = document.querySelector<HTMLButtonElement>(
  "#feature-query-toggle",
)!;
const settings = document.querySelector<HTMLElement>("#settings")!;
const settingsToggle =
  document.querySelector<HTMLButtonElement>("#settings-toggle")!;
const settingsResize = document.querySelector<HTMLElement>("#settings-resize")!;
const tabButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>(".panel-tab"),
);
const tabPanels = Array.from(
  document.querySelectorAll<HTMLElement>(".tab-panel"),
);

const activateTab = (tab: string, focus = false) => {
  for (const button of tabButtons) {
    const active = button.dataset.tab === tab;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
    if (active && focus) button.focus();
  }
  for (const panel of tabPanels) panel.hidden = panel.id !== `panel-${tab}`;
  document.querySelector<HTMLElement>(".panel-scroll")!.scrollTop = 0;
};

tabButtons.forEach((button, index) => {
  button.onclick = () => activateTab(button.dataset.tab!);
  button.onkeydown = (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabButtons.length - 1
          : (index +
              (event.key === "ArrowRight" ? 1 : -1) +
              tabButtons.length) %
            tabButtons.length;
    activateTab(tabButtons[nextIndex]!.dataset.tab!, true);
  };
});

const SETTINGS_MIN_WIDTH = 280;
const SETTINGS_MAX_WIDTH = 560;
const setSettingsWidth = (width: number) => {
  const viewportMaximum = Math.max(SETTINGS_MIN_WIDTH, window.innerWidth - 28);
  const next = Math.round(
    Math.min(
      SETTINGS_MAX_WIDTH,
      viewportMaximum,
      Math.max(SETTINGS_MIN_WIDTH, width),
    ),
  );
  document.documentElement.style.setProperty("--settings-width", `${next}px`);
  settingsResize.setAttribute("aria-valuenow", String(next));
};

let resizeStart: { pointerX: number; width: number } | undefined;
settingsResize.onpointerdown = (event) => {
  if (settings.classList.contains("is-collapsed")) return;
  resizeStart = {
    pointerX: event.clientX,
    width: settings.getBoundingClientRect().width,
  };
  settingsResize.setPointerCapture(event.pointerId);
  document.body.classList.add("is-resizing");
};
settingsResize.onpointermove = (event) => {
  if (!resizeStart) return;
  setSettingsWidth(resizeStart.width + resizeStart.pointerX - event.clientX);
};
const finishResize = (event: PointerEvent) => {
  if (!resizeStart) return;
  resizeStart = undefined;
  if (settingsResize.hasPointerCapture(event.pointerId))
    settingsResize.releasePointerCapture(event.pointerId);
  document.body.classList.remove("is-resizing");
};
settingsResize.onpointerup = finishResize;
settingsResize.onpointercancel = finishResize;
settingsResize.onkeydown = (event) => {
  const step = event.shiftKey ? 40 : 10;
  if (event.key === "ArrowLeft")
    setSettingsWidth(settings.getBoundingClientRect().width + step);
  else if (event.key === "ArrowRight")
    setSettingsWidth(settings.getBoundingClientRect().width - step);
  else if (event.key === "Home") setSettingsWidth(SETTINGS_MIN_WIDTH);
  else if (event.key === "End") setSettingsWidth(SETTINGS_MAX_WIDTH);
  else return;
  event.preventDefault();
};
const diagnostics = {
  renderEvents: 0,
  styleEvents: 0,
  lastGeneration: -1,
  lastDurationMs: 0,
  generations: [] as number[],
  heatmapEvents: 0,
  featureEnterEvents: 0,
};

interface PhotonFeature {
  type: "Feature";
  geometry: {
    type: "Point";
    coordinates: [number, number];
  };
  properties: {
    osm_id?: number;
    osm_type?: string;
    type?: string;
    name?: string;
    housenumber?: string;
    street?: string;
    locality?: string;
    district?: string;
    city?: string;
    county?: string;
    state?: string;
    postcode?: string;
    country?: string;
  };
}

interface PhotonResponse {
  type: "FeatureCollection";
  features: PhotonFeature[];
}

const PLACE_SEARCH_ENDPOINT = "https://photon.komoot.io/api/";
const placeSearch = document.querySelector<HTMLElement>("#place-search")!;
const placeSearchToggle = document.querySelector<HTMLButtonElement>(
  "#place-search-toggle",
)!;
const placeSearchContent = document.querySelector<HTMLElement>(
  "#place-search-content",
)!;
const placeSearchInput = document.querySelector<HTMLInputElement>(
  "#place-search-input",
)!;
const placeSearchClear = document.querySelector<HTMLButtonElement>(
  "#place-search-clear",
)!;
const placeSearchStatus = document.querySelector<HTMLSpanElement>(
  "#place-search-status",
)!;
const placeSearchResults = document.querySelector<HTMLUListElement>(
  "#place-search-results",
)!;
const placeSearchCache = new globalThis.Map<string, PhotonFeature[]>();
let placeSearchTimer: ReturnType<typeof setTimeout> | undefined;
let placeSearchRequest: AbortController | undefined;
let placeSearchRequestId = 0;
let placeSearchMatches: PhotonFeature[] = [];
let activePlaceIndex = -1;
let placeMarker: Marker | undefined;

const placeName = (feature: PhotonFeature) =>
  feature.properties.name ||
  [feature.properties.housenumber, feature.properties.street]
    .filter(Boolean)
    .join(" ") ||
  "Unnamed place";

const placeDetail = (feature: PhotonFeature) => {
  const properties = feature.properties;
  const primary = placeName(feature);
  const street = [properties.housenumber, properties.street]
    .filter(Boolean)
    .join(" ");
  return [
    street !== primary ? street : undefined,
    properties.locality,
    properties.district,
    properties.city,
    properties.county,
    properties.state,
    properties.postcode,
    properties.country,
  ]
    .filter(
      (part, index, parts) => Boolean(part) && parts.indexOf(part) === index,
    )
    .join(", ");
};

const setPlaceResultsOpen = (open: boolean) => {
  placeSearchResults.hidden = !open;
  placeSearchInput.setAttribute("aria-expanded", String(open));
};

const setPlaceSearchExpanded = (expanded: boolean) => {
  placeSearch.classList.toggle("is-collapsed", !expanded);
  placeSearchContent.hidden = !expanded;
  placeSearchToggle.setAttribute("aria-expanded", String(expanded));
  if (!expanded) setPlaceResultsOpen(false);
};

const updateActivePlace = (nextIndex: number) => {
  activePlaceIndex = nextIndex;
  const options =
    placeSearchResults.querySelectorAll<HTMLButtonElement>(".place-result");
  options.forEach((option, index) => {
    const active = index === activePlaceIndex;
    option.classList.toggle("is-active", active);
    option.setAttribute("aria-selected", String(active));
    if (active) option.scrollIntoView({ block: "nearest" });
  });
};

const zoomForPlace = (type?: string) => {
  if (type === "country") return 5;
  if (type === "state" || type === "county") return 7;
  if (type === "city" || type === "town") return 11;
  if (type === "village" || type === "district") return 13;
  return 16;
};

const selectPlace = (feature: PhotonFeature) => {
  const [longitude, latitude] = feature.geometry.coordinates;
  placeSearchInput.value = placeName(feature);
  placeSearchClear.hidden = false;
  placeSearchStatus.textContent = placeDetail(feature) || "place selected";
  setPlaceSearchExpanded(false);
  placeSearchToggle.focus();
  placeMarker?.remove();
  placeMarker = new Marker({ color: "#ff6688" })
    .setLngLat([longitude, latitude])
    .addTo(map);
  map.flyTo({
    center: [longitude, latitude],
    zoom: zoomForPlace(feature.properties.type),
    duration: 900,
    essential: true,
  });
};

const renderPlaceResults = (features: PhotonFeature[]) => {
  placeSearchMatches = features;
  activePlaceIndex = -1;
  placeSearchResults.replaceChildren();
  for (const [index, feature] of features.entries()) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    const name = document.createElement("span");
    const detail = document.createElement("span");
    button.type = "button";
    button.className = "place-result";
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", "false");
    name.className = "place-result-name";
    name.textContent = placeName(feature);
    detail.className = "place-result-detail";
    detail.textContent =
      placeDetail(feature) || feature.properties.type || "place";
    button.append(name, detail);
    button.onpointermove = () => updateActivePlace(index);
    button.onclick = () => selectPlace(feature);
    item.append(button);
    placeSearchResults.append(item);
  }
  setPlaceResultsOpen(
    features.length > 0 && !placeSearch.classList.contains("is-collapsed"),
  );
};

const runPlaceSearch = async (query: string, requestId: number) => {
  const cacheKey = query.toLocaleLowerCase();
  const cached = placeSearchCache.get(cacheKey);
  if (cached) {
    renderPlaceResults(cached);
    placeSearchStatus.textContent = `${cached.length} cached result${cached.length === 1 ? "" : "s"}`;
    return;
  }

  placeSearchRequest = new AbortController();
  placeSearchStatus.textContent = "searching…";
  const params = new URLSearchParams({
    q: query,
    limit: "6",
  });
  try {
    const response = await fetch(`${PLACE_SEARCH_ENDPOINT}?${params}`, {
      signal: placeSearchRequest.signal,
    });
    if (!response.ok)
      throw new Error(`Place lookup failed (${response.status})`);
    const payload = (await response.json()) as PhotonResponse;
    if (!Array.isArray(payload.features))
      throw new TypeError("Place lookup returned an unexpected response");
    if (requestId !== placeSearchRequestId) return;
    const features = payload.features.filter(
      (feature) =>
        feature?.geometry?.type === "Point" &&
        feature.geometry.coordinates.length === 2 &&
        feature.geometry.coordinates.every(Number.isFinite),
    );
    placeSearchCache.set(cacheKey, features);
    renderPlaceResults(features);
    placeSearchStatus.textContent = features.length
      ? `${features.length} result${features.length === 1 ? "" : "s"}`
      : "no places found";
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    if (requestId !== placeSearchRequestId) return;
    renderPlaceResults([]);
    placeSearchStatus.textContent =
      error instanceof Error ? error.message : "Place lookup failed";
  }
};

const schedulePlaceSearch = () => {
  const query = placeSearchInput.value.trim();
  placeSearchClear.hidden = query.length === 0;
  if (placeSearchTimer) clearTimeout(placeSearchTimer);
  placeSearchRequest?.abort();
  const requestId = ++placeSearchRequestId;
  if (query.length < 2) {
    renderPlaceResults([]);
    placeSearchStatus.textContent = "type at least 2 characters";
    return;
  }
  placeSearchStatus.textContent = "waiting…";
  placeSearchTimer = setTimeout(
    () => void runPlaceSearch(query, requestId),
    350,
  );
};

placeSearchToggle.onclick = () => {
  setPlaceSearchExpanded(true);
  placeSearchInput.focus();
};
placeSearchInput.oninput = schedulePlaceSearch;
placeSearchInput.onkeydown = (event) => {
  if (event.key === "ArrowDown" && placeSearchMatches.length) {
    event.preventDefault();
    updateActivePlace((activePlaceIndex + 1) % placeSearchMatches.length);
  } else if (event.key === "ArrowUp" && placeSearchMatches.length) {
    event.preventDefault();
    updateActivePlace(
      (activePlaceIndex - 1 + placeSearchMatches.length) %
        placeSearchMatches.length,
    );
  } else if (event.key === "Enter" && activePlaceIndex >= 0) {
    event.preventDefault();
    selectPlace(placeSearchMatches[activePlaceIndex]!);
  } else if (event.key === "Escape") {
    setPlaceSearchExpanded(false);
    placeSearchToggle.focus();
  }
};
placeSearchInput.onfocus = () => {
  if (placeSearchMatches.length && placeSearchInput.value.trim().length >= 2)
    setPlaceResultsOpen(true);
};
placeSearchClear.onclick = () => {
  placeSearchInput.value = "";
  placeMarker?.remove();
  placeMarker = undefined;
  schedulePlaceSearch();
  setPlaceSearchExpanded(false);
  placeSearchToggle.focus();
};
document.addEventListener("pointerdown", (event) => {
  if (!placeSearch.contains(event.target as Node))
    setPlaceSearchExpanded(false);
});

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
  diagnostics.featureEnterEvents += 1;
  const title = feature.name || feature.class || feature.kind;
  readout.textContent = `${title} · ${feature.packId}/${feature.sourceLayer}`;
});
basemap.on("featureleave", () => {
  readout.textContent = basemap.getFeatureInteractionEnabled()
    ? "Move over the map to inspect a feature."
    : "Mouse feature queries are off.";
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
  readout.textContent = enabled
    ? "Move over the map to inspect a feature."
    : "Mouse feature queries are off.";
};

try {
  await basemap.addTo(map);
} catch (error) {
  status.textContent = error instanceof Error ? error.message : String(error);
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
const buildings3D = document.querySelector<HTMLInputElement>("#buildings-3d")!;
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
  if (!surface) {
    buildings3D.checked = false;
    basemap.setBuildings3DVisible(false);
  }
  basemap.setProjectionMode(surface ? "surface" : "screen").setCamera({
    rotation: true,
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
  basemap.setSource({ ...BASE_SOURCE, tileJSON: baseUrl });
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
  settingsToggle.setAttribute("aria-expanded", String(!collapsed));
  const label = collapsed ? "Expand settings panel" : "Collapse settings panel";
  settingsToggle.setAttribute("aria-label", label);
  settingsToggle.title = label;
};

window.addEventListener("beforeunload", () => basemap.remove());

// Read-only demo handles used by the interaction test harness.
Object.assign(window, { __badMapDemo: { map, basemap, diagnostics } });
