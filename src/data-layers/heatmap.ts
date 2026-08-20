import { lngLatToWorld } from "../core/geometry.js";
import type { RasterViewState } from "../types.js";

export interface HeatmapRasterOptions {
  visible: boolean;
  radius: number;
  intensity: number;
  maxDensity: number;
}

/** Rasterizes compact lng/lat/weight triplets into one density value per cell. */
export function rasterizeHeatmap(
  points: Float32Array,
  state: RasterViewState,
  columns: number,
  rows: number,
  options: HeatmapRasterOptions,
): Uint8Array {
  const output = new Uint8Array(columns * rows);
  if (!options.visible || !points.length || options.radius <= 0) return output;

  const density = new Float32Array(columns * rows);
  const [centerX, centerY] = lngLatToWorld(state.center.lng, state.center.lat);
  const worldSize = 512 * 2 ** state.zoom;
  const angle = (-state.bearing * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const radiusX = Math.max(0.5, options.radius / state.cell.width);
  const radiusY = Math.max(0.5, options.radius / state.cell.height);

  for (let index = 0; index + 1 < points.length; index += 3) {
    const lng = points[index]!;
    const lat = points[index + 1]!;
    const weight = Math.max(0, points[index + 2] ?? 1);
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || !weight) continue;
    let [worldX, worldY] = lngLatToWorld(lng, lat);
    while (worldX - centerX > 0.5) worldX -= 1;
    while (worldX - centerX < -0.5) worldX += 1;
    const dx = (worldX - centerX) * worldSize;
    const dy = (worldY - centerY) * worldSize;
    const screenX = cos * dx - sin * dy + state.width / 2;
    const screenY = sin * dx + cos * dy + state.height / 2;
    const cellX = screenX / state.cell.width;
    const cellY = screenY / state.cell.height;
    const x0 = Math.max(0, Math.floor(cellX - radiusX));
    const x1 = Math.min(columns - 1, Math.ceil(cellX + radiusX));
    const y0 = Math.max(0, Math.floor(cellY - radiusY));
    const y1 = Math.min(rows - 1, Math.ceil(cellY + radiusY));
    for (let y = y0; y <= y1; y += 1) {
      const normalizedY = (y + 0.5 - cellY) / radiusY;
      for (let x = x0; x <= x1; x += 1) {
        const normalizedX = (x + 0.5 - cellX) / radiusX;
        const distanceSquared =
          normalizedX * normalizedX + normalizedY * normalizedY;
        if (distanceSquared >= 1) continue;
        const kernel = 1 - distanceSquared;
        density[y * columns + x]! += weight * kernel * kernel;
      }
    }
  }

  let maximum = options.maxDensity;
  if (!(maximum > 0)) {
    maximum = 0;
    for (const value of density) maximum = Math.max(maximum, value);
  }
  if (!(maximum > 0)) return output;
  for (let index = 0; index < density.length; index += 1) {
    const value = Math.min(
      1,
      (density[index]! * Math.max(0, options.intensity)) / maximum,
    );
    if (value > 0) output[index] = Math.max(1, Math.round(value * 255));
  }
  return output;
}
