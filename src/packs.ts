import type {
  BuiltinLayerAdapter,
  LowResFeature,
  LowResLayerPackDescriptor,
} from "./types";
import type { DecodedFeature } from "./tile";

const LAYERS: Record<BuiltinLayerAdapter, string[]> = {
  streets: [
    "water",
    "park",
    "landcover",
    "landuse",
    "building",
    "transportation",
    "waterway",
    "aeroway",
    "boundary",
    "place",
    "water_name",
    "transportation_name",
    "poi",
    "mountain_peak",
    "aerodrome_label",
  ],
  transit: ["transportation", "transportation_name", "poi"],
  topographic: ["contour", "mountain_peak", "landcover", "park"],
  weather: ["weather", "weather_line", "weather_point"],
  political: ["boundary", "place"],
  marine: ["water", "waterway", "water_name", "marine"],
  landuse: ["landuse", "landcover", "park", "building"],
};

function pack(
  adapter: BuiltinLayerAdapter,
  options: Partial<LowResLayerPackDescriptor> = {},
): LowResLayerPackDescriptor {
  const numeric =
    options.numeric ??
    (adapter === "weather"
      ? { property: "value", min: 0, max: 1 }
      : adapter === "topographic"
        ? { property: "elevation", min: 0, max: 4_000 }
        : undefined);
  return {
    id: options.id ?? adapter,
    source: options.source ?? "base",
    adapter,
    sourceLayers: options.sourceLayers ?? [...LAYERS[adapter]],
    enabled: options.enabled ?? true,
    priority: options.priority ?? 0,
    ...(numeric ? { numeric } : {}),
  };
}

export const streets = (
  options?: Partial<LowResLayerPackDescriptor>,
): LowResLayerPackDescriptor => pack("streets", options);
export const transit = (
  options?: Partial<LowResLayerPackDescriptor>,
): LowResLayerPackDescriptor => pack("transit", options);
export const topographic = (
  options?: Partial<LowResLayerPackDescriptor>,
): LowResLayerPackDescriptor => pack("topographic", options);
export const weather = (
  options?: Partial<LowResLayerPackDescriptor>,
): LowResLayerPackDescriptor => pack("weather", options);
export const political = (
  options?: Partial<LowResLayerPackDescriptor>,
): LowResLayerPackDescriptor => pack("political", options);
export const marine = (
  options?: Partial<LowResLayerPackDescriptor>,
): LowResLayerPackDescriptor => pack("marine", options);
export const landuse = (
  options?: Partial<LowResLayerPackDescriptor>,
): LowResLayerPackDescriptor => pack("landuse", options);

const TRANSIT_CLASSES = new Set([
  "rail",
  "transit",
  "subway",
  "tram",
  "light_rail",
  "busway",
  "bus_guideway",
  "ferry",
]);

export function featureBelongsToPack(
  feature: DecodedFeature,
  descriptor: LowResLayerPackDescriptor,
): boolean {
  if (!descriptor.sourceLayers.includes(feature.sourceLayer)) return false;
  if (descriptor.adapter !== "transit") return true;
  const cls = String(
    feature.properties.class ?? feature.properties.subclass ?? "",
  );
  if (feature.sourceLayer === "poi")
    return ["station", "subway", "railway", "bus_station"].includes(cls);
  return TRANSIT_CLASSES.has(cls);
}

export interface LowResFeatureFilter {
  packId?: string;
  sourceId?: string;
  sourceLayer?: string;
  kind?: LowResFeature["kind"];
  class?: string;
}

export function featureMatches(
  feature: LowResFeature,
  filter: LowResFeatureFilter,
): boolean {
  return Object.entries(filter).every(
    ([key, value]) => feature[key as keyof LowResFeature] === value,
  );
}
