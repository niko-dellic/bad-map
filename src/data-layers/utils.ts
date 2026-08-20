import type { Feature, Geometry } from "geojson";
import type {
  LowResDataAccessor,
  LowResError,
  LowResWaypointStyle,
} from "../types.js";

export function accessor<T>(
  value: LowResDataAccessor<T> | undefined,
  feature: Feature,
  index: number,
  fallback: T,
): T {
  return value === undefined
    ? fallback
    : typeof value === "function"
      ? (value as (feature: Feature, index: number) => T)(feature, index)
      : value;
}

export function geoJsonFeatures(data: import("geojson").GeoJSON): Feature[];
export function geoJsonFeatures(data: import("geojson").GeoJSON): Feature[] {
  if (data.type === "FeatureCollection")
    return data.features.filter((feature): feature is Feature<Geometry> =>
      Boolean(feature.geometry),
    );
  if (data.type === "Feature")
    return data.geometry ? [data as Feature<Geometry>] : [];
  return [{ type: "Feature", properties: {}, geometry: data as Geometry }];
}

export function normalizeHeatmapPoints(
  data: readonly (readonly [number, number, number?])[] | Float32Array,
): Float32Array {
  if (data instanceof Float32Array) return data.slice();
  const output = new Float32Array(data.length * 3);
  data.forEach((point, index) => {
    const [lng, lat] = coordinate(point);
    output[index * 3] = lng;
    output[index * 3 + 1] = lat;
    output[index * 3 + 2] = finite(point[2] ?? 1, "heatmap weight");
  });
  return output;
}

export function coordinate(
  point: readonly (number | undefined)[],
): readonly [number, number] {
  if (point.length < 2)
    throw new TypeError("Coordinates need longitude and latitude");
  return [finite(point[0], "longitude"), finite(point[1], "latitude")];
}

export function interpolateCoordinate(
  a: readonly [number, number],
  b: readonly [number, number],
  amount: number,
): readonly [number, number] {
  return [a[0] + (b[0] - a[0]) * amount, a[1] + (b[1] - a[1]) * amount];
}

export function finite(value: number | undefined, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new TypeError(`${name} must be finite`);
  return value;
}
export function positive(value: number, name: string): number {
  if (!(finite(value, name) > 0))
    throw new RangeError(`${name} must be positive`);
  return value;
}
export function waypointStyle(value: string): LowResWaypointStyle {
  if (value !== "locator" && value !== "caret")
    throw new TypeError(`Unknown waypoint style: ${value}`);
  return value;
}
export function nonnegative(value: number, name: string): number {
  if (finite(value, name) < 0)
    throw new RangeError(`${name} cannot be negative`);
  return value;
}
export function unit(value: number, name: string): number {
  if (finite(value, name) < 0 || value > 1)
    throw new RangeError(`${name} must be between zero and one`);
  return value;
}

export function dataWarning(
  layerId: string,
  message: string,
  cause: unknown,
): LowResError {
  return { code: "data", message, fatal: false, cause, layerId };
}
