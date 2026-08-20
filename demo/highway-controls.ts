import type { FeatureCollection, LineString, MultiLineString } from "geojson";
import type { Map } from "maplibre-gl";
import type { LowResBasemap, LowResDataFeature } from "../src";
import {
  highwayKey,
  loadHighwayData,
  type HighwayFeature,
  type HighwayProperties,
} from "./data-sources/highways";
import { requiredElement } from "./dom";

const LAYER_ID = "demo-highway-safety";
const COLORS = [
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
const THRESHOLDS = [0, 4, 8, 12, 20, 32, 52, 84, 136, 220];

const rate = (feature: HighwayFeature, metric: "incidents" | "fatalities") =>
  ((Number(feature.properties[metric]) || 0) /
    Math.max(0.001, Number(feature.properties.length) || 0.001)) *
  1000;

const colorFor = (value: number) => {
  let index = 0;
  while (index + 1 < THRESHOLDS.length && value >= THRESHOLDS[index + 1]!)
    index += 1;
  return COLORS[index]!;
};

export function describeHighwayFeature(
  feature: LowResDataFeature,
): string | undefined {
  if (feature.layerId !== LAYER_ID) return undefined;
  const properties = feature.properties ?? {};
  return `${properties.name ?? `${properties.type ?? "road"}-${properties.id ?? ""}`} · ${properties.state ?? ""} · ${properties.incidents ?? 0} crashes · ${properties.fatalities ?? 0} fatalities`;
}

export function setupHighwayControls(
  map: Map,
  basemap: LowResBasemap,
  enableFeatureQueries: () => void,
): void {
  const mode = requiredElement<HTMLSelectElement>("#highway-mode");
  const year = requiredElement<HTMLSelectElement>("#highway-year");
  const color = requiredElement<HTMLSelectElement>("#highway-color");
  const width = requiredElement<HTMLSelectElement>("#highway-width");
  const opacity = requiredElement<HTMLInputElement>("#highway-opacity");
  const opacityValue = requiredElement<HTMLElement>("#highway-opacity-value");
  const status = requiredElement<HTMLOutputElement>("#highway-status");
  let focused = false;
  let loaded = false;

  const applyLayer = async () => {
    if (mode.value === "off") {
      basemap.removeDataLayer(LAYER_ID);
      status.textContent = loaded
        ? "highway data ready"
        : "loads nationwide roads on selection";
      return;
    }
    mode.disabled = true;
    status.textContent = "loading highway data…";
    try {
      const data = await loadHighwayData();
      loaded = true;
      const selectedYear = Number(year.value);
      const roads: FeatureCollection<
        LineString | MultiLineString,
        HighwayProperties
      > = {
        type: "FeatureCollection",
        features: data.roads.features.map((feature) => {
          const totals = data.accidents.get(
            `${selectedYear}:${highwayKey(feature.properties)}`,
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
      const colorMetric = color.value;
      const widthMetric = width.value;
      basemap.setDataLayer({
        id: LAYER_ID,
        type: "geojson",
        data: roads,
        opacity: Number(opacity.value),
        order: 20,
        pickable: true,
        line: {
          color: (feature) =>
            colorMetric === "fixed"
              ? [255, 190, 80]
              : colorFor(
                  rate(
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
                      rate(
                        feature as HighwayFeature,
                        widthMetric as "incidents" | "fatalities",
                      ) / 50,
                    ),
                ) * 4,
        },
      });
      if (!basemap.getFeatureInteractionEnabled()) enableFeatureQueries();
      if (!focused) {
        focused = true;
        map.easeTo({ center: [-100, 38], zoom: 4, pitch: 0, duration: 700 });
      }
      status.textContent = `${roads.features.length.toLocaleString()} roads · ${selectedYear}`;
    } catch (error) {
      mode.value = "off";
      status.textContent =
        error instanceof Error ? error.message : String(error);
    } finally {
      mode.disabled = false;
    }
  };

  mode.onchange = () => void applyLayer();
  year.onchange = () => void applyLayer();
  color.onchange = () => void applyLayer();
  width.onchange = () => void applyLayer();
  opacity.oninput = () => {
    opacityValue.textContent = Number(opacity.value).toFixed(2);
    if (mode.value !== "off")
      basemap.updateDataLayer(LAYER_ID, {
        type: "geojson",
        opacity: Number(opacity.value),
      });
  };
}
