import "maplibre-gl/dist/maplibre-gl.css";
import "@phosphor-icons/web/regular";
import { Map } from "maplibre-gl";
import type {
  Feature,
  FeatureCollection,
  LineString,
  MultiLineString,
} from "geojson";
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
import {
  highwayKey,
  loadHighwayData,
  type HighwayFeature,
  type HighwayProperties,
} from "./data-sources/highways";
import { loadPickupData, type PickupRow } from "./data-sources/pickups";
import { loadTrips } from "./data-sources/trips";
import {
  DEFAULT_SCREEN_FISHEYE,
  ScreenFisheyeLayer,
  type ScreenFisheyeOptions,
} from "./fisheye";
import {
  DEFAULT_SCREEN_VIGNETTE,
  drawScreenVignette,
  type ScreenVignetteBase,
  type ScreenVignetteFalloff,
  type ScreenVignetteOptions,
} from "./vignette";
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

const BASE_SOURCE = {
  tileJSON: "https://tiles.openfreemap.org/planet",
  attribution: "OpenFreeMap © OpenMapTiles · Data © OpenStreetMap contributors",
};
const SEARCH_WAYPOINT_LAYER = "demo-search-waypoint";
const HIGHWAY_LAYER = "demo-highway-safety";
const TRIPS_LAYER = "demo-nyc-trips";
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
  labels: false,
  featureInteraction: false,
  camera: { rotation: true, pitch: true, maxPitch: 70 },
});
const fisheye = new ScreenFisheyeLayer();
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
const vignetteCanvas =
  document.querySelector<HTMLCanvasElement>("#screen-vignette")!;
const vignetteEnabled =
  document.querySelector<HTMLInputElement>("#vignette-enabled")!;
const vignetteReach =
  document.querySelector<HTMLInputElement>("#vignette-reach")!;
const vignetteCircularity = document.querySelector<HTMLInputElement>(
  "#vignette-circularity",
)!;
const vignetteOpacity =
  document.querySelector<HTMLInputElement>("#vignette-opacity")!;
const vignetteFalloff =
  document.querySelector<HTMLSelectElement>("#vignette-falloff")!;
const vignetteBase =
  document.querySelector<HTMLSelectElement>("#vignette-base")!;
const vignetteColor =
  document.querySelector<HTMLInputElement>("#vignette-color")!;
const vignetteThemeColor = document.querySelector<HTMLInputElement>(
  "#vignette-theme-color",
)!;
const vignetteStatus =
  document.querySelector<HTMLOutputElement>("#vignette-status")!;
let themeVignetteColor: RGB = [...DEFAULT_SCREEN_VIGNETTE.color] as RGB;
const vignetteRgbToHex = (color: RGB) =>
  `#${color.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
const vignetteHexToRgb = (color: string): RGB => [
  Number.parseInt(color.slice(1, 3), 16),
  Number.parseInt(color.slice(3, 5), 16),
  Number.parseInt(color.slice(5, 7), 16),
];
vignetteEnabled.checked = DEFAULT_SCREEN_VIGNETTE.enabled;
vignetteReach.value = String(DEFAULT_SCREEN_VIGNETTE.reach);
vignetteCircularity.value = String(DEFAULT_SCREEN_VIGNETTE.circularity);
vignetteOpacity.value = String(DEFAULT_SCREEN_VIGNETTE.opacity);
vignetteFalloff.value = DEFAULT_SCREEN_VIGNETTE.falloff;
vignetteBase.value = DEFAULT_SCREEN_VIGNETTE.base;
vignetteColor.value = vignetteRgbToHex(themeVignetteColor);
let vignetteFrame = 0;
const currentVignetteOptions = (): ScreenVignetteOptions => ({
  enabled: vignetteEnabled.checked,
  reach: Number(vignetteReach.value),
  base: vignetteBase.value as ScreenVignetteBase,
  circularity: Number(vignetteCircularity.value),
  opacity: Number(vignetteOpacity.value),
  falloff: vignetteFalloff.value as ScreenVignetteFalloff,
  color: vignetteThemeColor.checked
    ? themeVignetteColor
    : vignetteHexToRgb(vignetteColor.value),
});
const renderVignette = () => {
  cancelAnimationFrame(vignetteFrame);
  vignetteFrame = requestAnimationFrame(() => {
    const options = currentVignetteOptions();
    document.querySelector("#vignette-reach-value")!.textContent =
      `${Math.round(options.reach * 100)}%`;
    document.querySelector("#vignette-circularity-value")!.textContent =
      `${Math.round(options.circularity * 100)}%`;
    document.querySelector("#vignette-opacity-value")!.textContent =
      `${Math.round(options.opacity * 100)}%`;
    vignetteStatus.textContent = options.enabled
      ? `${vignetteFalloff.selectedOptions[0]?.textContent ?? "linear"} · ${vignetteBase.value} base · 8×8 CSS-pixel dither · ${vignetteThemeColor.checked ? "theme color" : vignetteColor.value}`
      : "overlay disabled";
    drawScreenVignette(vignetteCanvas, options);
  });
};
vignetteEnabled.onchange = renderVignette;
vignetteReach.oninput = renderVignette;
vignetteCircularity.oninput = renderVignette;
vignetteOpacity.oninput = renderVignette;
vignetteFalloff.onchange = renderVignette;
vignetteBase.onchange = renderVignette;
vignetteColor.oninput = () => {
  vignetteThemeColor.checked = false;
  renderVignette();
};
vignetteThemeColor.onchange = () => {
  if (vignetteThemeColor.checked)
    vignetteColor.value = vignetteRgbToHex(themeVignetteColor);
  renderVignette();
};
window.addEventListener("resize", renderVignette);
const demoResizeObserver = new ResizeObserver(() => {
  map.resize();
  renderVignette();
});
demoResizeObserver.observe(document.querySelector<HTMLElement>("#app")!);
renderVignette();

const fisheyeEnabled =
  document.querySelector<HTMLInputElement>("#fisheye-enabled")!;
const fisheyeK1 = document.querySelector<HTMLInputElement>("#fisheye-k1")!;
const fisheyeK2 = document.querySelector<HTMLInputElement>("#fisheye-k2")!;
const fisheyeRadius =
  document.querySelector<HTMLInputElement>("#fisheye-radius")!;
const fisheyeStatus =
  document.querySelector<HTMLOutputElement>("#fisheye-status")!;
fisheyeEnabled.checked = DEFAULT_SCREEN_FISHEYE.enabled;
fisheyeK1.value = String(DEFAULT_SCREEN_FISHEYE.k1);
fisheyeK2.value = String(DEFAULT_SCREEN_FISHEYE.k2);
fisheyeRadius.value = String(DEFAULT_SCREEN_FISHEYE.radius);
const currentFisheyeOptions = (): ScreenFisheyeOptions => ({
  enabled: fisheyeEnabled.checked,
  k1: Number(fisheyeK1.value),
  k2: Number(fisheyeK2.value),
  strength: 1,
  radius: Number(fisheyeRadius.value),
});
const renderFisheye = () => {
  const options = currentFisheyeOptions();
  document.querySelector("#fisheye-k1-value")!.textContent =
    options.k1.toFixed(2);
  document.querySelector("#fisheye-k2-value")!.textContent =
    options.k2.toFixed(2);
  document.querySelector("#fisheye-radius-value")!.textContent =
    `${Math.round(options.radius * 100)}%`;
  fisheyeStatus.textContent = options.enabled
    ? `broad ${options.k1.toFixed(2)} · edge ${options.k2.toFixed(2)}`
    : "effect disabled";
  fisheye.setOptions(options);
};
fisheyeEnabled.onchange = renderFisheye;
fisheyeK1.oninput = renderFisheye;
fisheyeK2.oninput = renderFisheye;
fisheyeRadius.oninput = renderFisheye;
renderFisheye();

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

const SETTINGS_MIN_WIDTH = 248;
const SETTINGS_MAX_WIDTH = 480;
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
  dataRenderEvents: 0,
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
const waypointStyle =
  document.querySelector<HTMLSelectElement>("#waypoint-style")!;
const waypointSize =
  document.querySelector<HTMLInputElement>("#waypoint-size")!;
const waypointSizeValue = document.querySelector<HTMLOutputElement>(
  "#waypoint-size-value",
)!;
const waypointStatus =
  document.querySelector<HTMLOutputElement>("#waypoint-status")!;
const placeSearchCache = new globalThis.Map<string, PhotonFeature[]>();
let placeSearchTimer: ReturnType<typeof setTimeout> | undefined;
let placeSearchRequest: AbortController | undefined;
let placeSearchRequestId = 0;
let placeSearchMatches: PhotonFeature[] = [];
let activePlaceIndex = -1;
let selectedPlace: PhotonFeature | undefined;

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

const currentWaypointStyle = () =>
  waypointStyle.value === "caret" ? ("caret" as const) : ("locator" as const);

const renderSelectedWaypoint = (feature: PhotonFeature) => {
  const [longitude, latitude] = feature.geometry.coordinates;
  basemap.setDataLayer({
    id: SEARCH_WAYPOINT_LAYER,
    type: "waypoint",
    order: 1000,
    pickable: false,
    style: currentWaypointStyle(),
    size: Number(waypointSize.value),
    data: [
      {
        ...(feature.properties.osm_id === undefined
          ? {}
          : { id: feature.properties.osm_id }),
        position: [longitude, latitude],
        properties: { name: placeName(feature) },
      },
    ],
  });
  waypointStatus.textContent = `${placeName(feature)} · ${waypointStyle.selectedOptions[0]?.textContent ?? "waypoint"}`;
};

const selectPlace = (feature: PhotonFeature) => {
  const [longitude, latitude] = feature.geometry.coordinates;
  selectedPlace = feature;
  placeSearchInput.value = placeName(feature);
  placeSearchClear.hidden = false;
  placeSearchStatus.textContent = placeDetail(feature) || "place selected";
  setPlaceSearchExpanded(false);
  placeSearchToggle.focus();
  renderSelectedWaypoint(feature);
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
  selectedPlace = undefined;
  basemap.removeDataLayer(SEARCH_WAYPOINT_LAYER);
  waypointStatus.textContent = "applies to the place-search waypoint";
  schedulePlaceSearch();
  setPlaceSearchExpanded(false);
  placeSearchToggle.focus();
};
waypointStyle.onchange = () => {
  if (selectedPlace) renderSelectedWaypoint(selectedPlace);
};
waypointSize.oninput = () => {
  waypointSizeValue.textContent = waypointSize.value;
  if (selectedPlace)
    basemap.updateDataLayer(SEARCH_WAYPOINT_LAYER, {
      size: Number(waypointSize.value),
    });
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
  if (feature.layerId === HIGHWAY_LAYER) {
    const properties = feature.properties ?? {};
    return `${properties.name ?? `${properties.type ?? "road"}-${properties.id ?? ""}`} · ${properties.state ?? ""} · ${properties.incidents ?? 0} crashes · ${properties.fatalities ?? 0} fatalities`;
  }
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
  themeVignetteColor = theme.fills.ground;
  if (vignetteThemeColor.checked)
    vignetteColor.value = vignetteRgbToHex(themeVignetteColor);
  renderVignette();
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

const heatmapMode = document.querySelector<HTMLSelectElement>("#heatmap-mode")!;
const heatmapRadius =
  document.querySelector<HTMLInputElement>("#heatmap-radius")!;
const heatmapIntensity =
  document.querySelector<HTMLInputElement>("#heatmap-intensity")!;
const heatmapOpacity =
  document.querySelector<HTMLInputElement>("#heatmap-opacity")!;
const heatmapStatus =
  document.querySelector<HTMLOutputElement>("#heatmap-status")!;
let lowResHeatmapLoaded = false;
let pickupDataLoaded = false;

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
    heatmapStatus.textContent = pickupDataLoaded
      ? "pickup data ready"
      : "loads 100,000 NYC pickups on selection";
    return;
  }
  heatmapMode.disabled = true;
  heatmapStatus.textContent = "loading pickup data…";
  try {
    const data = await loadPickupData();
    pickupDataLoaded = true;
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

const highwayMode = document.querySelector<HTMLSelectElement>("#highway-mode")!;
const highwayYear = document.querySelector<HTMLSelectElement>("#highway-year")!;
const highwayColor =
  document.querySelector<HTMLSelectElement>("#highway-color")!;
const highwayWidth =
  document.querySelector<HTMLSelectElement>("#highway-width")!;
const highwayOpacity =
  document.querySelector<HTMLInputElement>("#highway-opacity")!;
const highwayStatus =
  document.querySelector<HTMLOutputElement>("#highway-status")!;
let highwayFocused = false;
let highwayDataLoaded = false;

const SAFETY_COLORS = [
  [26, 152, 80],
  [102, 189, 99],
  [166, 217, 106],
  [217, 239, 139],
  [255, 255, 191],
  [254, 224, 139],
  [253, 174, 97],
  [244, 109, 67],
  [215, 48, 39],
  [168, 0, 0],
] as const;
const SAFETY_THRESHOLDS = [0, 4, 8, 12, 20, 32, 52, 84, 136, 220];
const safetyRate = (
  feature: HighwayFeature,
  metric: "incidents" | "fatalities",
) =>
  ((Number(feature.properties[metric]) || 0) /
    Math.max(0.001, Number(feature.properties.length) || 0.001)) *
  1000;
const safetyColor = (value: number) => {
  let index = 0;
  while (
    index + 1 < SAFETY_THRESHOLDS.length &&
    value >= SAFETY_THRESHOLDS[index + 1]!
  )
    index += 1;
  return SAFETY_COLORS[index]!;
};

const applyHighwayLayer = async () => {
  if (highwayMode.value === "off") {
    basemap.removeDataLayer(HIGHWAY_LAYER);
    highwayStatus.textContent = highwayDataLoaded
      ? "highway data ready"
      : "loads nationwide roads on selection";
    return;
  }
  highwayMode.disabled = true;
  highwayStatus.textContent = "loading highway data…";
  try {
    const data = await loadHighwayData();
    highwayDataLoaded = true;
    const year = Number(highwayYear.value);
    const roads: FeatureCollection<
      LineString | MultiLineString,
      HighwayProperties
    > = {
      type: "FeatureCollection",
      features: data.roads.features.map((feature) => {
        const totals = data.accidents.get(
          `${year}:${highwayKey(feature.properties)}`,
        );
        return {
          ...feature,
          id: highwayKey(feature.properties),
          properties: {
            ...feature.properties,
            incidents: totals?.incidents ?? 0,
            fatalities: totals?.fatalities ?? 0,
          },
        };
      }),
    };
    const colorMetric = highwayColor.value;
    const widthMetric = highwayWidth.value;
    basemap.setDataLayer({
      id: HIGHWAY_LAYER,
      type: "geojson",
      data: roads,
      opacity: Number(highwayOpacity.value),
      order: 20,
      pickable: true,
      line: {
        color: (feature) =>
          colorMetric === "fixed"
            ? [255, 190, 80]
            : safetyColor(
                safetyRate(
                  feature as HighwayFeature,
                  colorMetric as "incidents" | "fatalities",
                ),
              ),
        width: (feature) =>
          widthMetric === "fixed"
            ? 4
            : Math.min(
                4,
                1 +
                  Math.floor(
                    safetyRate(
                      feature as HighwayFeature,
                      widthMetric as "incidents" | "fatalities",
                    ) / 50,
                  ),
              ) * 4,
      },
    });
    if (!basemap.getFeatureInteractionEnabled()) featureQueryToggle.click();
    if (!highwayFocused) {
      highwayFocused = true;
      map.easeTo({ center: [-100, 38], zoom: 4, pitch: 0, duration: 700 });
    }
    highwayStatus.textContent = `${roads.features.length.toLocaleString()} roads · ${year}`;
  } catch (error) {
    highwayMode.value = "off";
    highwayStatus.textContent =
      error instanceof Error ? error.message : String(error);
  } finally {
    highwayMode.disabled = false;
  }
};

highwayMode.onchange = () => void applyHighwayLayer();
highwayYear.onchange = () => void applyHighwayLayer();
highwayColor.onchange = () => void applyHighwayLayer();
highwayWidth.onchange = () => void applyHighwayLayer();
highwayOpacity.oninput = () => {
  document.querySelector("#highway-opacity-value")!.textContent = Number(
    highwayOpacity.value,
  ).toFixed(2);
  if (highwayMode.value !== "off")
    basemap.updateDataLayer(HIGHWAY_LAYER, {
      opacity: Number(highwayOpacity.value),
    });
};

const tripsMode = document.querySelector<HTMLSelectElement>("#trips-mode")!;
const tripsPlay = document.querySelector<HTMLButtonElement>("#trips-play")!;
const tripsPlayIcon = tripsPlay.querySelector<HTMLElement>("i")!;
const tripsStepBack =
  document.querySelector<HTMLButtonElement>("#trips-step-back")!;
const tripsStepForward = document.querySelector<HTMLButtonElement>(
  "#trips-step-forward",
)!;
const tripsTime = document.querySelector<HTMLInputElement>("#trips-time")!;
const tripsTimeValue =
  document.querySelector<HTMLOutputElement>("#trips-time-value")!;
const tripsSpeed = document.querySelector<HTMLInputElement>("#trips-speed")!;
const tripsTrail = document.querySelector<HTMLInputElement>("#trips-trail")!;
const tripsWidth = document.querySelector<HTMLInputElement>("#trips-width")!;
const tripsOpacity =
  document.querySelector<HTMLInputElement>("#trips-opacity")!;
const tripsStatus = document.querySelector<HTMLOutputElement>("#trips-status")!;
let tripsFocused = false;
let tripsDataLoaded = false;
let tripsLayerReady = false;
let tripsScrubbing = false;
let tripsResumeAfterScrub = false;
const TRIPS_STEP = 15;

const formatTripsTime = (currentTime: number, loopLength = 1800) =>
  `${Math.round(currentTime)} / ${Math.round(loopLength)}`;

const syncTripsTime = (currentTime: number, loopLength = 1800) => {
  tripsTime.value = String(Math.round(currentTime));
  tripsTimeValue.textContent = formatTripsTime(currentTime, loopLength);
};

const syncTripsPlayButton = (playing: boolean) => {
  const action = playing ? "Pause" : "Play";
  tripsPlay.setAttribute("aria-label", `${action} trips`);
  tripsPlay.setAttribute("aria-pressed", String(playing));
  tripsPlay.title = `${action} trips`;
  tripsPlayIcon.className = `ph ph-${playing ? "pause" : "play"}`;
};

const setTripsTransportEnabled = (enabled: boolean) => {
  tripsPlay.disabled = !enabled;
  tripsStepBack.disabled = !enabled;
  tripsStepForward.disabled = !enabled;
  tripsTime.disabled = !enabled;
};

const syncTripsOutputs = () => {
  document.querySelector("#trips-speed-value")!.textContent =
    `${Number(tripsSpeed.value)}×`;
  document.querySelector("#trips-trail-value")!.textContent = tripsTrail.value;
  document.querySelector("#trips-width-value")!.textContent = tripsWidth.value;
  document.querySelector("#trips-opacity-value")!.textContent = Number(
    tripsOpacity.value,
  ).toFixed(2);
};

const applyTripsMode = async ({ focus = true }: { focus?: boolean } = {}) => {
  if (tripsMode.value === "off") {
    tripsLayerReady = false;
    basemap.removeDataLayer(TRIPS_LAYER);
    setTripsTransportEnabled(false);
    syncTripsPlayButton(false);
    tripsStatus.textContent = tripsDataLoaded
      ? "trip data ready"
      : "loads NYC trips on selection";
    return;
  }
  tripsMode.disabled = true;
  tripsStatus.textContent = "loading trip data…";
  try {
    const trips = await loadTrips();
    tripsDataLoaded = true;
    basemap.setDataLayer({
      id: TRIPS_LAYER,
      type: "trips",
      data: trips,
      currentTime: Number(tripsTime.value),
      loopLength: 1800,
      trailLength: Number(tripsTrail.value),
      speed: Number(tripsSpeed.value),
      width: Number(tripsWidth.value),
      opacity: Number(tripsOpacity.value),
      playing: true,
      order: 40,
      pickable: true,
    });
    tripsLayerReady = true;
    setTripsTransportEnabled(true);
    syncTripsPlayButton(true);
    syncTripsTime(Number(tripsTime.value), 1800);
    if (focus && !tripsFocused) {
      tripsFocused = true;
      map.easeTo({ center: [-74, 40.72], zoom: 13, duration: 700 });
    }
    tripsStatus.textContent = `${trips.length.toLocaleString()} animated trips`;
    syncTripsOutputs();
  } catch (error) {
    tripsLayerReady = false;
    tripsMode.value = "off";
    tripsStatus.textContent =
      error instanceof Error ? error.message : String(error);
  } finally {
    tripsMode.disabled = false;
  }
};

tripsMode.onchange = () => void applyTripsMode();
tripsPlay.onclick = () => {
  const playback = basemap.getTripsPlayback(TRIPS_LAYER);
  basemap.setTripsPlayback(TRIPS_LAYER, { playing: !playback.playing });
  syncTripsPlayButton(!playback.playing);
};
const stepTrips = (delta: number) => {
  basemap.stepTripsPlayback(TRIPS_LAYER, delta, { playing: false });
  const playback = basemap.getTripsPlayback(TRIPS_LAYER);
  syncTripsTime(playback.currentTime, playback.loopLength);
  syncTripsPlayButton(false);
};
tripsStepBack.onclick = () => stepTrips(-TRIPS_STEP);
tripsStepForward.onclick = () => stepTrips(TRIPS_STEP);

tripsTime.onpointerdown = () => {
  if (tripsMode.value === "off") return;
  const playback = basemap.getTripsPlayback(TRIPS_LAYER);
  tripsScrubbing = true;
  tripsResumeAfterScrub = playback.playing;
  if (playback.playing)
    basemap.setTripsPlayback(TRIPS_LAYER, { playing: false });
  syncTripsPlayButton(false);
};
tripsTime.oninput = () => {
  if (tripsMode.value === "off") return;
  const time = Number(tripsTime.value);
  basemap.seekTripsPlayback(TRIPS_LAYER, time, { playing: false });
  syncTripsTime(time);
  syncTripsPlayButton(false);
};
const finishTripsScrub = () => {
  if (!tripsScrubbing) return;
  tripsScrubbing = false;
  if (tripsResumeAfterScrub)
    basemap.setTripsPlayback(TRIPS_LAYER, { playing: true });
  syncTripsPlayButton(tripsResumeAfterScrub);
  tripsResumeAfterScrub = false;
};
window.addEventListener("pointerup", finishTripsScrub);
window.addEventListener("pointercancel", finishTripsScrub);
tripsTime.onkeydown = (event) => {
  if (tripsMode.value === "off") return;
  const multiplier = event.shiftKey ? 4 : 1;
  if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
    event.preventDefault();
    stepTrips(-TRIPS_STEP * multiplier);
  } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
    event.preventDefault();
    stepTrips(TRIPS_STEP * multiplier);
  } else if (event.key === "Home" || event.key === "End") {
    event.preventDefault();
    const playback = basemap.getTripsPlayback(TRIPS_LAYER);
    basemap.seekTripsPlayback(
      TRIPS_LAYER,
      event.key === "Home" ? 0 : playback.loopLength,
      { playing: false },
    );
    syncTripsTime(
      event.key === "Home" ? 0 : playback.loopLength,
      playback.loopLength,
    );
    syncTripsPlayButton(false);
  } else if (event.key === " ") {
    event.preventDefault();
    tripsPlay.click();
  }
};
tripsSpeed.oninput = () => {
  syncTripsOutputs();
  if (tripsMode.value !== "off")
    basemap.setTripsPlayback(TRIPS_LAYER, { speed: Number(tripsSpeed.value) });
};
tripsTrail.oninput = () => {
  syncTripsOutputs();
  if (tripsMode.value !== "off")
    basemap.setTripsPlayback(TRIPS_LAYER, {
      trailLength: Number(tripsTrail.value),
    });
};
const applyTripStyle = () => {
  syncTripsOutputs();
  if (tripsMode.value !== "off")
    basemap.updateDataLayer(TRIPS_LAYER, {
      width: Number(tripsWidth.value),
      opacity: Number(tripsOpacity.value),
    });
};
tripsWidth.oninput = applyTripStyle;
tripsOpacity.oninput = applyTripStyle;

const updateTripsClock = () => {
  if (tripsLayerReady && tripsMode.value !== "off") {
    const playback = basemap.getTripsPlayback(TRIPS_LAYER);
    if (playback.playing && !tripsScrubbing)
      syncTripsTime(playback.currentTime, playback.loopLength);
  }
  requestAnimationFrame(updateTripsClock);
};
requestAnimationFrame(updateTripsClock);

// The trips example is the demo's initial data view. Loading it here preserves
// the same control path used when visitors turn the layer back on later.
void applyTripsMode({ focus: false });

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

window.addEventListener("beforeunload", () => {
  demoResizeObserver.disconnect();
  basemap.remove();
});

// Read-only demo handles used by the interaction test harness.
Object.assign(window, { __badMapDemo: { map, basemap, fisheye, diagnostics } });
