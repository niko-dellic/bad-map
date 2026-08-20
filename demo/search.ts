import type { Map } from "maplibre-gl";
import type { LowResBasemap } from "../src";
import { requiredElement } from "./dom";

const SEARCH_WAYPOINT_LAYER = "demo-search-waypoint";
const PLACE_SEARCH_ENDPOINT = "https://photon.komoot.io/api/";

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

export function setupPlaceSearch(map: Map, basemap: LowResBasemap): void {
  const container = requiredElement<HTMLElement>("#place-search");
  const toggle = requiredElement<HTMLButtonElement>("#place-search-toggle");
  const content = requiredElement<HTMLElement>("#place-search-content");
  const input = requiredElement<HTMLInputElement>("#place-search-input");
  const clear = requiredElement<HTMLButtonElement>("#place-search-clear");
  const status = requiredElement<HTMLSpanElement>("#place-search-status");
  const results = requiredElement<HTMLUListElement>("#place-search-results");
  const waypointStyle = requiredElement<HTMLSelectElement>("#waypoint-style");
  const waypointSize = requiredElement<HTMLInputElement>("#waypoint-size");
  const waypointSizeValue = requiredElement<HTMLOutputElement>(
    "#waypoint-size-value",
  );
  const waypointStatus = requiredElement<HTMLOutputElement>("#waypoint-status");
  const cache = new globalThis.Map<string, PhotonFeature[]>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let request: AbortController | undefined;
  let requestId = 0;
  let matches: PhotonFeature[] = [];
  let activeIndex = -1;
  let selected: PhotonFeature | undefined;

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

  const setResultsOpen = (open: boolean) => {
    results.hidden = !open;
    input.setAttribute("aria-expanded", String(open));
  };

  const setExpanded = (expanded: boolean) => {
    container.classList.toggle("is-collapsed", !expanded);
    content.hidden = !expanded;
    toggle.setAttribute("aria-expanded", String(expanded));
    if (!expanded) setResultsOpen(false);
  };

  const updateActive = (nextIndex: number) => {
    activeIndex = nextIndex;
    const options =
      results.querySelectorAll<HTMLButtonElement>(".place-result");
    options.forEach((option, index) => {
      const active = index === activeIndex;
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

  const renderWaypoint = (feature: PhotonFeature) => {
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
    selected = feature;
    input.value = placeName(feature);
    clear.hidden = false;
    status.textContent = placeDetail(feature) || "place selected";
    setExpanded(false);
    toggle.focus();
    renderWaypoint(feature);
    map.flyTo({
      center: [longitude, latitude],
      zoom: zoomForPlace(feature.properties.type),
      duration: 900,
      essential: true,
    });
  };

  const renderResults = (features: PhotonFeature[]) => {
    matches = features;
    activeIndex = -1;
    results.replaceChildren();
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
      button.onpointermove = () => updateActive(index);
      button.onclick = () => selectPlace(feature);
      item.append(button);
      results.append(item);
    }
    setResultsOpen(
      features.length > 0 && !container.classList.contains("is-collapsed"),
    );
  };

  const runSearch = async (query: string, currentRequestId: number) => {
    const cacheKey = query.toLocaleLowerCase();
    const cached = cache.get(cacheKey);
    if (cached) {
      renderResults(cached);
      status.textContent = `${cached.length} cached result${cached.length === 1 ? "" : "s"}`;
      return;
    }

    request = new AbortController();
    status.textContent = "searching…";
    const params = new URLSearchParams({ q: query, limit: "6" });
    try {
      const response = await fetch(`${PLACE_SEARCH_ENDPOINT}?${params}`, {
        signal: request.signal,
      });
      if (!response.ok)
        throw new Error(`Place lookup failed (${response.status})`);
      const payload = (await response.json()) as PhotonResponse;
      if (!Array.isArray(payload.features))
        throw new TypeError("Place lookup returned an unexpected response");
      if (currentRequestId !== requestId) return;
      const features = payload.features.filter(
        (feature) =>
          feature?.geometry?.type === "Point" &&
          feature.geometry.coordinates.length === 2 &&
          feature.geometry.coordinates.every(Number.isFinite),
      );
      cache.set(cacheKey, features);
      renderResults(features);
      status.textContent = features.length
        ? `${features.length} result${features.length === 1 ? "" : "s"}`
        : "no places found";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (currentRequestId !== requestId) return;
      renderResults([]);
      status.textContent =
        error instanceof Error ? error.message : "Place lookup failed";
    }
  };

  const scheduleSearch = () => {
    const query = input.value.trim();
    clear.hidden = query.length === 0;
    if (timer) clearTimeout(timer);
    request?.abort();
    const currentRequestId = ++requestId;
    if (query.length < 2) {
      renderResults([]);
      status.textContent = "type at least 2 characters";
      return;
    }
    status.textContent = "waiting…";
    timer = setTimeout(() => void runSearch(query, currentRequestId), 350);
  };

  toggle.onclick = () => {
    setExpanded(true);
    input.focus();
  };
  input.oninput = scheduleSearch;
  input.onkeydown = (event) => {
    if (event.key === "ArrowDown" && matches.length) {
      event.preventDefault();
      updateActive((activeIndex + 1) % matches.length);
    } else if (event.key === "ArrowUp" && matches.length) {
      event.preventDefault();
      updateActive((activeIndex - 1 + matches.length) % matches.length);
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      selectPlace(matches[activeIndex]!);
    } else if (event.key === "Escape") {
      setExpanded(false);
      toggle.focus();
    }
  };
  input.onfocus = () => {
    if (matches.length && input.value.trim().length >= 2) setResultsOpen(true);
  };
  clear.onclick = () => {
    input.value = "";
    selected = undefined;
    basemap.removeDataLayer(SEARCH_WAYPOINT_LAYER);
    waypointStatus.textContent = "applies to the place-search waypoint";
    scheduleSearch();
    setExpanded(false);
    toggle.focus();
  };
  waypointStyle.onchange = () => {
    if (selected) renderWaypoint(selected);
  };
  waypointSize.oninput = () => {
    waypointSizeValue.textContent = waypointSize.value;
    if (selected)
      basemap.updateDataLayer(SEARCH_WAYPOINT_LAYER, {
        type: "waypoint",
        size: Number(waypointSize.value),
      });
  };
  document.addEventListener("pointerdown", (event) => {
    if (!container.contains(event.target as Node)) setExpanded(false);
  });
}
