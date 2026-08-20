import type { GeoJsonProperties, Geometry, Position } from "geojson";
import { bresenham, lngLatToWorld } from "../core/geometry.js";
import type {
  DataRasterFrame,
  LowResDataFeatureRecord,
  LowResError,
  RGB,
  RasterViewState,
} from "../types.js";
import { rasterizeHeatmap } from "./heatmap.js";
import type {
  SerializedDataLayer,
  SerializedFeature,
  SerializedHeatmapLayer,
  SerializedTrip,
  SerializedTripsLayer,
  SerializedWaypoint,
} from "./serialize.js";
import { dataWarning, finite, interpolateCoordinate, unit } from "./utils.js";

type RGBA = readonly [number, number, number, number];

export function rasterizeDataLayers(
  layers: readonly SerializedDataLayer[],
  state: RasterViewState,
  generation: number,
): DataRasterFrame {
  const started = performance.now();
  const dotColumns = Math.max(
    1,
    Math.ceil((state.width * 2) / state.cell.width),
  );
  const dotRows = Math.max(
    1,
    Math.ceil((state.height * 4) / state.cell.height),
  );
  const data = new Uint8Array(dotColumns * dotRows * 4);
  const markers = new Uint8Array(data.length);
  const dataOwner = new Uint32Array(dotColumns * dotRows);
  const markerOwner = new Uint32Array(dotColumns * dotRows);
  const features: LowResDataFeatureRecord[] = [];
  const warnings: LowResError[] = layers.flatMap((layer) => layer.warnings);
  const target: RasterTarget = {
    state,
    dotColumns,
    dotRows,
    data,
    markers,
    dataOwner,
    markerOwner,
    features,
    warnings,
  };
  const sorted = layers
    .map((layer, index) => ({ layer, index }))
    .filter(({ layer }) => layer.visible && layer.opacity > 0)
    .sort((a, b) => a.layer.order - b.layer.order || a.index - b.index);
  for (const { layer } of sorted) {
    try {
      rasterizeLayer(target, layer);
    } catch (cause) {
      warnings.push({
        code: "data",
        message: `Could not rasterize data layer ${layer.id}`,
        fatal: false,
        cause,
        layerId: layer.id,
      });
    }
  }
  return {
    generation,
    durationMs: performance.now() - started,
    state,
    dotColumns,
    dotRows,
    data,
    markers,
    dataOwner,
    markerOwner,
    features,
    warnings,
  };
}

/** Composites already-rasterized layers without repeating their geometry work. */
export function compositeDataFrames(
  frames: readonly DataRasterFrame[],
  state: RasterViewState,
  generation: number,
): DataRasterFrame {
  const started = performance.now();
  const dotColumns = Math.max(
    1,
    Math.ceil((state.width * 2) / state.cell.width),
  );
  const dotRows = Math.max(
    1,
    Math.ceil((state.height * 4) / state.cell.height),
  );
  const data = new Uint8Array(dotColumns * dotRows * 4);
  const markers = new Uint8Array(data.length);
  const dataOwner = new Uint32Array(dotColumns * dotRows);
  const markerOwner = new Uint32Array(dotColumns * dotRows);
  const features: LowResDataFeatureRecord[] = [];
  const warnings: LowResError[] = [];

  for (const frame of frames) {
    if (frame.dotColumns !== dotColumns || frame.dotRows !== dotRows) continue;
    const owners = new Uint32Array(frame.features.length + 1);
    for (const feature of frame.features) {
      const owner = features.length + 1;
      owners[feature.owner] = owner;
      features.push({ ...feature, owner });
    }
    warnings.push(...frame.warnings);
    for (let pixel = 0; pixel < dataOwner.length; pixel += 1) {
      const offset = pixel * 4;
      if (frame.data[offset + 3])
        writePixel(
          data,
          dataOwner,
          dotColumns,
          pixel % dotColumns,
          Math.floor(pixel / dotColumns),
          [
            frame.data[offset]!,
            frame.data[offset + 1]!,
            frame.data[offset + 2]!,
            frame.data[offset + 3]!,
          ],
          owners[frame.dataOwner[pixel]!] ?? 0,
        );
      if (frame.markers[offset + 3])
        writePixel(
          markers,
          markerOwner,
          dotColumns,
          pixel % dotColumns,
          Math.floor(pixel / dotColumns),
          [
            frame.markers[offset]!,
            frame.markers[offset + 1]!,
            frame.markers[offset + 2]!,
            frame.markers[offset + 3]!,
          ],
          owners[frame.markerOwner[pixel]!] ?? 0,
        );
    }
  }

  return {
    generation,
    durationMs: performance.now() - started,
    state,
    dotColumns,
    dotRows,
    data,
    markers,
    dataOwner,
    markerOwner,
    features,
    warnings,
  };
}

interface RasterTarget {
  state: RasterViewState;
  dotColumns: number;
  dotRows: number;
  data: Uint8Array;
  markers: Uint8Array;
  dataOwner: Uint32Array;
  markerOwner: Uint32Array;
  features: LowResDataFeatureRecord[];
  warnings: LowResError[];
}

function rasterizeLayer(
  target: RasterTarget,
  layer: SerializedDataLayer,
): void {
  if (layer.type === "heatmap") return rasterizeDensity(target, layer);
  if (layer.type === "waypoint") {
    for (const [index, point] of layer.waypoints.entries()) {
      try {
        const owner = featureOwner(target, layer, point.id, point.properties);
        drawWaypoint(target, point, layer.opacity, layer.pickable ? owner : 0);
      } catch (cause) {
        target.warnings.push(
          dataWarning(layer.id, `Skipped malformed waypoint ${index}`, cause),
        );
      }
    }
    return;
  }
  if (layer.type === "geojson") {
    for (const [index, feature] of layer.features.entries()) {
      try {
        const owner = featureOwner(
          target,
          layer,
          feature.id,
          feature.properties,
        );
        drawGeometry(
          target,
          feature.geometry,
          feature,
          layer.opacity,
          layer.pickable ? owner : 0,
        );
      } catch (cause) {
        target.warnings.push(
          dataWarning(
            layer.id,
            `Skipped malformed GeoJSON feature ${index}`,
            cause,
          ),
        );
      }
    }
    return;
  }
  for (const [index, trip] of layer.trips.entries()) {
    try {
      const owner = featureOwner(target, layer, trip.id, trip.properties);
      drawTrip(target, layer, trip, layer.pickable ? owner : 0);
    } catch (cause) {
      target.warnings.push(
        dataWarning(layer.id, `Skipped malformed trip ${index}`, cause),
      );
    }
  }
}

function featureOwner(
  target: RasterTarget,
  layer: SerializedDataLayer,
  featureId: string | number | undefined,
  properties: GeoJsonProperties,
): number {
  const owner = target.features.length + 1;
  target.features.push({
    owner,
    layerId: layer.id,
    layerType: layer.type,
    ...(featureId === undefined ? {} : { featureId }),
    properties,
  });
  return owner;
}

function rasterizeDensity(
  target: RasterTarget,
  layer: SerializedHeatmapLayer,
): void {
  const columns = Math.max(
    1,
    Math.ceil(target.state.width / target.state.cell.width),
  );
  const rows = Math.max(
    1,
    Math.ceil(target.state.height / target.state.cell.height),
  );
  const density = rasterizeHeatmap(layer.points, target.state, columns, rows, {
    visible: layer.visible,
    radius: layer.radius,
    intensity: layer.intensity,
    maxDensity: layer.maxDensity,
  });
  const rank = [0, 3, 5, 6, 2, 1, 7, 4];
  for (let y = 0; y < target.dotRows; y += 1) {
    for (let x = 0; x < target.dotColumns; x += 1) {
      const cellX = Math.min(columns - 1, Math.floor(x / 2));
      const cellY = Math.min(rows - 1, Math.floor(y / 4));
      const value = density[cellY * columns + cellX]! / 255;
      if (!value || value * 8 <= rank[(y % 4) * 2 + (x % 2)]!) continue;
      writePixel(
        target.data,
        target.dataOwner,
        target.dotColumns,
        x,
        y,
        [
          ...paletteColor(layer.palette, value),
          Math.round(255 * layer.opacity),
        ],
        0,
      );
    }
  }
}

function drawGeometry(
  target: RasterTarget,
  geometry: Geometry,
  feature: SerializedFeature,
  opacity: number,
  owner: number,
): void {
  switch (geometry.type) {
    case "Point":
      drawPoint(
        target,
        geometry.coordinates,
        feature.pointRadius,
        rgba(feature.pointColor, opacity),
        owner,
      );
      return;
    case "MultiPoint":
      geometry.coordinates.forEach((point) =>
        drawPoint(
          target,
          point,
          feature.pointRadius,
          rgba(feature.pointColor, opacity),
          owner,
        ),
      );
      return;
    case "LineString":
      drawPath(
        target,
        geometry.coordinates,
        feature.lineWidth,
        rgba(feature.lineColor, opacity),
        owner,
        feature.lineDash,
      );
      return;
    case "MultiLineString":
      geometry.coordinates.forEach((path) =>
        drawPath(
          target,
          path,
          feature.lineWidth,
          rgba(feature.lineColor, opacity),
          owner,
          feature.lineDash,
        ),
      );
      return;
    case "Polygon":
      drawPolygon(target, geometry.coordinates, feature, opacity, owner);
      return;
    case "MultiPolygon":
      geometry.coordinates.forEach((polygon) =>
        drawPolygon(target, polygon, feature, opacity, owner),
      );
      return;
    case "GeometryCollection":
      geometry.geometries.forEach((child) =>
        drawGeometry(target, child, feature, opacity, owner),
      );
  }
}

function drawPoint(
  target: RasterTarget,
  point: readonly number[],
  radius: number,
  color: RGBA,
  owner: number,
): void {
  const [cx, cy] = projectDot(target, point);
  const rx = Math.max(0.5, radius / (target.state.cell.width / 2));
  const ry = Math.max(0.5, radius / (target.state.cell.height / 4));
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y += 1)
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x += 1) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1)
        writePixel(
          target.data,
          target.dataOwner,
          target.dotColumns,
          x,
          y,
          color,
          owner,
        );
    }
}

function drawPath(
  target: RasterTarget,
  path: readonly (readonly number[])[],
  width: number,
  color: RGBA,
  owner: number,
  dash?: readonly [number, number],
): void {
  const points = path.map((point) => projectDot(target, point));
  let step = 0;
  const dotPitch = Math.min(
    target.state.cell.width / 2,
    target.state.cell.height / 4,
  );
  const brush = Math.max(1, Math.round(width / dotPitch));
  const before = Math.floor((brush - 1) / 2);
  const after = brush - before - 1;
  const padding = Math.max(before, after);
  for (let index = 1; index < points.length; index += 1) {
    const clipped = clipSegment(
      points[index - 1]!,
      points[index]!,
      -padding,
      -padding,
      target.dotColumns - 1 + padding,
      target.dotRows - 1 + padding,
    );
    if (!clipped) continue;
    const [a, b] = clipped;
    for (const [x, y] of bresenham(
      Math.round(a[0]),
      Math.round(a[1]),
      Math.round(b[0]),
      Math.round(b[1]),
    )) {
      const on = !dash || step % Math.max(1, dash[0] + dash[1]) < dash[0];
      if (on)
        for (let oy = -before; oy <= after; oy += 1)
          for (let ox = -before; ox <= after; ox += 1)
            writePixel(
              target.data,
              target.dataOwner,
              target.dotColumns,
              x + ox,
              y + oy,
              color,
              owner,
            );
      step += 1;
    }
  }
}

function drawPolygon(
  target: RasterTarget,
  rings: readonly (readonly Position[])[],
  feature: SerializedFeature,
  opacity: number,
  owner: number,
): void {
  const projected = rings.map((ring) =>
    ring.map((point) => projectDot(target, point)),
  );
  const ys = projected.flat().map((point) => point[1]);
  if (!ys.length) throw new TypeError("Polygons need at least one ring");
  const minY = Math.max(0, Math.floor(Math.min(...ys)));
  const maxY = Math.min(target.dotRows - 1, Math.ceil(Math.max(...ys)));
  const color = rgba(feature.fillColor, opacity * feature.fillOpacity);
  for (let y = minY; y <= maxY; y += 1) {
    const intersections: number[] = [];
    for (const ring of projected)
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[j]!;
        const b = ring[i]!;
        if (a[1] > y + 0.5 === b[1] > y + 0.5) continue;
        intersections.push(
          a[0] + ((y + 0.5 - a[1]) * (b[0] - a[0])) / (b[1] - a[1]),
        );
      }
    intersections.sort((a, b) => a - b);
    for (let i = 0; i + 1 < intersections.length; i += 2)
      for (
        let x = Math.ceil(intersections[i]!);
        x < intersections[i + 1]!;
        x += 1
      )
        writePixel(
          target.data,
          target.dataOwner,
          target.dotColumns,
          x,
          y,
          color,
          owner,
        );
  }
  if (feature.outlineWidth > 0)
    rings.forEach((ring) =>
      drawPath(
        target,
        ring,
        feature.outlineWidth,
        rgba(feature.outlineColor, opacity),
        owner,
      ),
    );
}

function drawWaypoint(
  target: RasterTarget,
  point: SerializedWaypoint,
  opacity: number,
  owner: number,
): void {
  const [cx, cy] = projectDot(target, point.position);
  const glyph =
    point.style === "caret"
      ? {
          rows: ["1000001", "0100010", "0010100", "0001000"],
          originX: 3,
          originY: 3,
        }
      : {
          rows: ["01110", "11011", "10001", "11011", "01110", "00100"],
          originX: 2,
          originY: 2,
        };
  const scale = Math.max(1, Math.round(point.size / 20));
  const pixels: [number, number][] = [];
  glyph.rows.forEach((row, y) =>
    [...row].forEach((value, x) => {
      if (value === "1") pixels.push([x - glyph.originX, y - glyph.originY]);
    }),
  );
  const halo = rgba(point.haloColor, opacity);
  for (const [gx, gy] of pixels)
    for (let sy = 0; sy < scale; sy += 1)
      for (let sx = 0; sx < scale; sx += 1)
        for (let oy = -1; oy <= 1; oy += 1)
          for (let ox = -1; ox <= 1; ox += 1)
            writePixel(
              target.markers,
              target.markerOwner,
              target.dotColumns,
              Math.round(cx + gx * scale + sx + ox),
              Math.round(cy + gy * scale + sy + oy),
              halo,
              owner,
            );
  const ink = rgba(point.color, opacity);
  for (const [gx, gy] of pixels)
    for (let sy = 0; sy < scale; sy += 1)
      for (let sx = 0; sx < scale; sx += 1)
        writePixel(
          target.markers,
          target.markerOwner,
          target.dotColumns,
          Math.round(cx + gx * scale + sx),
          Math.round(cy + gy * scale + sy),
          ink,
          owner,
        );
}

function drawTrip(
  target: RasterTarget,
  layer: SerializedTripsLayer,
  trip: SerializedTrip,
  owner: number,
): void {
  const start = layer.currentTime - layer.trailLength;
  for (let index = 1; index < trip.path.length; index += 1) {
    const t0 = trip.timestamps[index - 1]!;
    const t1 = trip.timestamps[index]!;
    if (t1 < start || t0 > layer.currentTime || t1 <= t0) continue;
    const from = Math.max(t0, start);
    const to = Math.min(t1, layer.currentTime);
    if (to < from) continue;
    const a = interpolateCoordinate(
      trip.path[index - 1]!,
      trip.path[index]!,
      (from - t0) / (t1 - t0),
    );
    const b = interpolateCoordinate(
      trip.path[index - 1]!,
      trip.path[index]!,
      (to - t0) / (t1 - t0),
    );
    const age = layer.trailLength ? (to - start) / layer.trailLength : 1;
    drawPath(
      target,
      [a, b],
      layer.width,
      rgba(trip.color, layer.opacity * Math.max(0.18, age)),
      owner,
    );
  }
}

function projectDot(
  target: RasterTarget,
  point: readonly number[],
): readonly [number, number] {
  const [centerX, centerY] = lngLatToWorld(
    target.state.center.lng,
    target.state.center.lat,
  );
  const longitude = finite(point[0], "longitude");
  const latitude = finite(point[1], "latitude");
  let [worldX, worldY] = lngLatToWorld(longitude, latitude);
  while (worldX - centerX > 0.5) worldX -= 1;
  while (worldX - centerX < -0.5) worldX += 1;
  const size = 512 * 2 ** target.state.zoom;
  const dx = (worldX - centerX) * size;
  const dy = (worldY - centerY) * size;
  const angle = (-target.state.bearing * Math.PI) / 180;
  const x =
    Math.cos(angle) * dx - Math.sin(angle) * dy + target.state.width / 2;
  const y =
    Math.sin(angle) * dx + Math.cos(angle) * dy + target.state.height / 2;
  return [
    x / (target.state.cell.width / 2),
    y / (target.state.cell.height / 4),
  ];
}

function clipSegment(
  a: readonly [number, number],
  b: readonly [number, number],
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): readonly [readonly [number, number], readonly [number, number]] | undefined {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  let start = 0;
  let end = 1;
  for (const [p, q] of [
    [-dx, a[0] - minX],
    [dx, maxX - a[0]],
    [-dy, a[1] - minY],
    [dy, maxY - a[1]],
  ] as const) {
    if (p === 0) {
      if (q < 0) return undefined;
      continue;
    }
    const ratio = q / p;
    if (p < 0) start = Math.max(start, ratio);
    else end = Math.min(end, ratio);
    if (start > end) return undefined;
  }
  return [
    [a[0] + start * dx, a[1] + start * dy],
    [a[0] + end * dx, a[1] + end * dy],
  ];
}

function writePixel(
  buffer: Uint8Array,
  owners: Uint32Array,
  width: number,
  x: number,
  y: number,
  color: RGBA,
  owner: number,
): void {
  const height = owners.length / width;
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const pixel = y * width + x;
  const offset = pixel * 4;
  const alpha = color[3] / 255;
  const previous = buffer[offset + 3]! / 255;
  const combined = alpha + previous * (1 - alpha);
  if (!combined) return;
  for (let channel = 0; channel < 3; channel += 1)
    buffer[offset + channel] = Math.round(
      (color[channel]! * alpha +
        buffer[offset + channel]! * previous * (1 - alpha)) /
        combined,
    );
  buffer[offset + 3] = Math.round(combined * 255);
  if (owner) owners[pixel] = owner;
}

function rgba(color: RGB, opacity: number): RGBA {
  return [
    color[0],
    color[1],
    color[2],
    Math.round(unit(opacity, "opacity") * 255),
  ];
}

function paletteColor(
  palette: readonly [RGB, RGB, RGB, RGB],
  value: number,
): RGB {
  const segment = Math.min(2.999999, Math.max(0, value) * 3);
  const left = Math.floor(segment);
  const amount = segment - left;
  const start = palette[left]!;
  const end = palette[left + 1]!;
  return [
    Math.round(start[0] + (end[0] - start[0]) * amount),
    Math.round(start[1] + (end[1] - start[1]) * amount),
    Math.round(start[2] + (end[2] - start[2]) * amount),
  ];
}
