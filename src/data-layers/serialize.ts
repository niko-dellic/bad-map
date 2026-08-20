import type { GeoJsonProperties, Geometry } from "geojson";
import type {
  LowResDataLayer,
  LowResDataLayerState,
  LowResError,
  LowResWaypointStyle,
  RGB,
} from "../types.js";
import {
  accessor,
  coordinate,
  dataWarning,
  finite,
  geoJsonFeatures,
  nonnegative,
  normalizeHeatmapPoints,
  positive,
  unit,
  waypointStyle,
} from "./utils.js";

export interface SerializedBase {
  id: string;
  type: LowResDataLayer["type"];
  visible: boolean;
  opacity: number;
  order: number;
  pickable: boolean;
  warnings: LowResError[];
}

export interface SerializedHeatmapLayer extends SerializedBase {
  type: "heatmap";
  points: Float32Array;
  radius: number;
  intensity: number;
  maxDensity: number;
  palette: readonly [RGB, RGB, RGB, RGB];
}

export interface SerializedFeature {
  id?: string | number;
  properties: GeoJsonProperties;
  geometry: Geometry;
  pointColor: RGB;
  pointRadius: number;
  lineColor: RGB;
  lineWidth: number;
  lineDash?: readonly [number, number];
  fillColor: RGB;
  fillOpacity: number;
  outlineColor: RGB;
  outlineWidth: number;
}

export interface SerializedGeoJSONLayer extends SerializedBase {
  type: "geojson";
  features: SerializedFeature[];
}

export interface SerializedWaypoint {
  id?: string | number;
  position: readonly [number, number];
  properties: GeoJsonProperties;
  color: RGB;
  haloColor: RGB;
  size: number;
  style: LowResWaypointStyle;
}

export interface SerializedWaypointLayer extends SerializedBase {
  type: "waypoint";
  waypoints: SerializedWaypoint[];
}

export interface SerializedTrip {
  id?: string | number;
  path: readonly (readonly [number, number])[];
  timestamps: readonly number[];
  properties: GeoJsonProperties;
  color: RGB;
}

export interface SerializedTripsLayer extends SerializedBase {
  type: "trips";
  trips: SerializedTrip[];
  color: RGB;
  width: number;
  trailLength: number;
  currentTime: number;
  loopLength: number;
  speed: number;
  playing: boolean;
}

export type SerializedDataLayer =
  | SerializedHeatmapLayer
  | SerializedWaypointLayer
  | SerializedGeoJSONLayer
  | SerializedTripsLayer;

const DEFAULT_PALETTE = [
  [40, 109, 155],
  [87, 173, 133],
  [239, 178, 75],
  [226, 76, 91],
] as const satisfies readonly [RGB, RGB, RGB, RGB];

export function serializeDataLayer(
  layer: LowResDataLayer,
): SerializedDataLayer {
  if (!layer.id.trim()) throw new TypeError("Data layer IDs cannot be empty");
  const warnings: LowResError[] = [];
  const base = {
    id: layer.id,
    type: layer.type,
    visible: layer.visible ?? true,
    opacity: unit(layer.opacity ?? 1, "opacity"),
    order: finite(layer.order ?? 0, "order"),
    pickable: layer.pickable ?? layer.type !== "heatmap",
    warnings,
  };
  if (layer.type === "heatmap") {
    const points = normalizeHeatmapPoints(layer.data);
    return {
      ...base,
      type: "heatmap",
      points,
      radius: positive(layer.radius ?? 36, "radius"),
      intensity: nonnegative(layer.intensity ?? 1, "intensity"),
      maxDensity: nonnegative(layer.maxDensity ?? 0, "maxDensity"),
      palette: layer.palette ?? DEFAULT_PALETTE,
    };
  }
  if (layer.type === "waypoint") {
    const waypoints: SerializedWaypoint[] = [];
    layer.data.forEach((point, index) => {
      try {
        waypoints.push({
          ...(point.id === undefined ? {} : { id: point.id }),
          position: coordinate(point.position),
          properties: point.properties ?? {},
          color: point.color ?? layer.color ?? [255, 102, 136],
          haloColor: point.haloColor ?? layer.haloColor ?? [15, 17, 20],
          size: positive(point.size ?? layer.size ?? 24, "waypoint size"),
          style: waypointStyle(point.style ?? layer.style ?? "locator"),
        });
      } catch (cause) {
        warnings.push(
          dataWarning(layer.id, `Skipped malformed waypoint ${index}`, cause),
        );
      }
    });
    return {
      ...base,
      type: "waypoint",
      waypoints,
    };
  }
  if (layer.type === "geojson") {
    const features: SerializedFeature[] = [];
    geoJsonFeatures(layer.data).forEach((feature, index) => {
      try {
        features.push({
          ...(feature.id === undefined ? {} : { id: feature.id }),
          properties: feature.properties ?? {},
          geometry: feature.geometry,
          pointColor: accessor(
            layer.point?.color,
            feature,
            index,
            [255, 102, 136],
          ),
          pointRadius: positive(
            accessor(layer.point?.radius, feature, index, 5),
            "point radius",
          ),
          lineColor: accessor(
            layer.line?.color,
            feature,
            index,
            [255, 190, 80],
          ),
          lineWidth: positive(
            accessor(layer.line?.width, feature, index, 2),
            "line width",
          ),
          ...(layer.line?.dash ? { lineDash: layer.line.dash } : {}),
          fillColor: accessor(
            layer.fill?.color,
            feature,
            index,
            [71, 184, 151],
          ),
          fillOpacity: unit(
            accessor(layer.fill?.opacity, feature, index, 0.42),
            "fill opacity",
          ),
          outlineColor: accessor(
            layer.fill?.outlineColor,
            feature,
            index,
            [133, 230, 202],
          ),
          outlineWidth: nonnegative(
            accessor(layer.fill?.outlineWidth, feature, index, 1),
            "outline width",
          ),
        });
      } catch (cause) {
        warnings.push(
          dataWarning(
            layer.id,
            `Skipped malformed GeoJSON feature ${index}`,
            cause,
          ),
        );
      }
    });
    return {
      ...base,
      type: "geojson",
      features,
    };
  }
  const trips: SerializedTrip[] = [];
  layer.data.forEach((trip, index) => {
    try {
      if (trip.path.length !== trip.timestamps.length)
        throw new TypeError(
          "Trip paths and timestamps must have equal lengths",
        );
      if (trip.path.length < 2)
        throw new TypeError("Trips need at least two path positions");
      const timestamps = trip.timestamps.map((value) =>
        finite(value, "timestamp"),
      );
      if (
        timestamps.some(
          (value, item) => item > 0 && value <= timestamps[item - 1]!,
        )
      )
        throw new TypeError("Trip timestamps must be strictly increasing");
      trips.push({
        ...(trip.id === undefined ? {} : { id: trip.id }),
        path: trip.path.map(coordinate),
        timestamps,
        properties: trip.properties ?? {},
        color: trip.color ?? layer.color ?? [255, 102, 136],
      });
    } catch (cause) {
      warnings.push(
        dataWarning(layer.id, `Skipped malformed trip ${index}`, cause),
      );
    }
  });
  return {
    ...base,
    type: "trips",
    trips,
    color: layer.color ?? [255, 102, 136],
    width: positive(layer.width ?? 2, "trip width"),
    trailLength: nonnegative(layer.trailLength ?? 180, "trail length"),
    currentTime: finite(layer.currentTime ?? 0, "current time"),
    loopLength: positive(layer.loopLength ?? 1800, "loop length"),
    speed: finite(layer.speed ?? 1, "trip speed"),
    playing: layer.playing ?? true,
  };
}

export function dataLayerState(
  layer: SerializedDataLayer,
): LowResDataLayerState {
  return {
    id: layer.id,
    type: layer.type,
    visible: layer.visible,
    opacity: layer.opacity,
    order: layer.order,
    pickable: layer.pickable,
    featureCount:
      layer.type === "heatmap"
        ? layer.points.length / 3
        : layer.type === "waypoint"
          ? layer.waypoints.length
          : layer.type === "geojson"
            ? layer.features.length
            : layer.trips.length,
  };
}
