import type { PointLike } from "maplibre-gl";
import { lngLatToWorld } from "../core/geometry.js";
import type {
  LowResFeature,
  LowResLayerPackDescriptor,
  RasterViewState,
} from "../types.js";

export function rgbCss(color: readonly [number, number, number]): string {
  return `rgb(${color[0]} ${color[1]} ${color[2]})`;
}

export function pointLike(point: PointLike): { x: number; y: number } {
  if (Array.isArray(point)) return { x: Number(point[0]), y: Number(point[1]) };
  return { x: point.x, y: point.y };
}

export function normalizeLayers(
  layers: readonly LowResLayerPackDescriptor[],
): LowResLayerPackDescriptor[] {
  const ids = new Set<string>();
  return layers.map((layer) => {
    if (!layer.id.trim()) throw new TypeError("Layer pack IDs cannot be empty");
    if (ids.has(layer.id))
      throw new TypeError(`Duplicate layer pack ID: ${layer.id}`);
    ids.add(layer.id);
    return {
      ...layer,
      sourceLayers: [...layer.sourceLayers],
      enabled: layer.enabled ?? true,
      priority: layer.priority ?? 0,
    };
  });
}

export function featureKey(
  feature: Pick<
    LowResFeature,
    "sourceId" | "packId" | "sourceLayer" | "class" | "name" | "properties"
  >,
): string {
  return [
    feature.sourceId,
    feature.packId,
    feature.sourceLayer,
    feature.class,
    feature.name,
    String(
      feature.properties.id ??
        feature.properties.osm_id ??
        feature.properties.ref ??
        "",
    ),
  ].join("\u0000");
}

export function geographicFramePoint(
  frame: RasterViewState,
  lng: number,
  lat: number,
): readonly [number, number] {
  const [centerX, centerY] = lngLatToWorld(frame.center.lng, frame.center.lat);
  let [x, y] = lngLatToWorld(lng, lat);
  while (x - centerX > 0.5) x -= 1;
  while (x - centerX < -0.5) x += 1;
  const worldSize = 512 * 2 ** frame.zoom;
  return [
    (x - centerX) * worldSize + frame.width / 2,
    (y - centerY) * worldSize + frame.height / 2,
  ];
}
