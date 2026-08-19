import type { CellGeometry, RasterViewState } from "./types";

export type Point = readonly [number, number];

export const BRAILLE_BITS = [
  [0x01, 0x02, 0x04, 0x40],
  [0x08, 0x10, 0x20, 0x80],
] as const;

export function lngLatToWorld(lng: number, lat: number): Point {
  const x = (lng + 180) / 360;
  const clamped = Math.max(-85.051129, Math.min(85.051129, lat));
  const sin = Math.sin((clamped * Math.PI) / 180);
  const y = 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
  return [x, y];
}

export function worldToLngLat(x: number, y: number): Point {
  const lng = x * 360 - 180;
  const n = Math.PI - 2 * Math.PI * y;
  return [lng, (180 / Math.PI) * Math.atan(Math.sinh(n))];
}

export interface ReprojectionTransform {
  /** Multiplier from current CSS pixels to pixels in the completed frame. */
  scale: number;
  /** Frame-space offset after applying scale. */
  offset: Point;
  zoomDelta: number;
}

export function reprojectionTransform(
  frame: RasterViewState,
  current: RasterViewState,
): ReprojectionTransform {
  const [frameX, frameY] = lngLatToWorld(frame.center.lng, frame.center.lat);
  const [currentX, currentY] = lngLatToWorld(
    current.center.lng,
    current.center.lat,
  );
  let deltaX = currentX - frameX;
  while (deltaX > 0.5) deltaX -= 1;
  while (deltaX < -0.5) deltaX += 1;
  const scale = 2 ** (frame.zoom - current.zoom);
  const frameWorldSize = 512 * 2 ** frame.zoom;
  return {
    scale,
    offset: [
      deltaX * frameWorldSize + frame.width / 2 - (current.width / 2) * scale,
      (currentY - frameY) * frameWorldSize +
        frame.height / 2 -
        (current.height / 2) * scale,
    ],
    zoomDelta: current.zoom - frame.zoom,
  };
}

export function reprojectPoint(
  point: Point,
  transform: ReprojectionTransform,
): Point {
  return [
    point[0] * transform.scale + transform.offset[0],
    point[1] * transform.scale + transform.offset[1],
  ];
}

// Tile z is encoded separately because x/y alone cannot recover it. Keeping
// this function free-standing makes worker projection cheap and testable.
export function projectTilePoint(
  state: RasterViewState,
  z: number,
  tileX: number,
  tileY: number,
  extent: number,
  x: number,
  y: number,
): Point {
  const [centerX, centerY] = lngLatToWorld(state.center.lng, state.center.lat);
  const n = 2 ** z;
  let worldX = (tileX + x / extent) / n;
  const worldY = (tileY + y / extent) / n;
  while (worldX - centerX > 0.5) worldX -= 1;
  while (worldX - centerX < -0.5) worldX += 1;
  const worldSize = 512 * 2 ** state.zoom;
  const screenX = (worldX - centerX) * worldSize + state.width / 2;
  const screenY = (worldY - centerY) * worldSize + state.height / 2;
  return [screenX / (state.cell.width / 2), screenY / (state.cell.height / 4)];
}

export function gridSize(
  width: number,
  height: number,
  cell: CellGeometry,
): { columns: number; rows: number } {
  return {
    columns: Math.max(1, Math.ceil(width / cell.width)),
    rows: Math.max(1, Math.ceil(height / cell.height)),
  };
}

export function* bresenham(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Generator<Point> {
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let error = dx - dy;
  while (true) {
    yield [x, y];
    if (x === x1 && y === y1) return;
    const e2 = error * 2;
    if (e2 > -dy) {
      error -= dy;
      x += sx;
    }
    if (e2 < dx) {
      error += dx;
      y += sy;
    }
  }
}

export function cellPath(
  points: readonly Point[],
  columns: number,
  rows: number,
): Point[] {
  const cells: Point[] = [];
  let previous: Point | undefined;
  let last: Point | undefined;
  for (const [x, y] of points) {
    const cell: Point = [
      Math.min(columns, Math.max(-1, Math.floor(x / 2))),
      Math.min(rows, Math.max(-1, Math.floor(y / 4))),
    ];
    const steps = previous
      ? bresenham(previous[0], previous[1], cell[0], cell[1])
      : [cell];
    for (const step of steps) {
      if (last && step[0] === last[0] && step[1] === last[1]) continue;
      last = step;
      if (step[0] >= 0 && step[0] < columns && step[1] >= 0 && step[1] < rows)
        cells.push(step);
    }
    previous = cell;
  }
  return cells;
}

export interface TileKey {
  z: number;
  x: number;
  y: number;
}

export function visibleTiles(
  state: RasterViewState,
  zoom: number,
  maxTiles = 16,
): { zoom: number; tiles: TileKey[] } {
  let z = Math.max(0, Math.floor(zoom));
  const [cx, cy] = lngLatToWorld(state.center.lng, state.center.lat);
  const worldSize = 512 * 2 ** state.zoom;
  const halfX = state.width / 2 / worldSize;
  const halfY = state.height / 2 / worldSize;

  const collect = (sourceZoom: number): TileKey[] => {
    const n = 2 ** sourceZoom;
    const x0 = Math.floor((cx - halfX) * n);
    const x1 = Math.floor((cx + halfX) * n);
    const y0 = Math.max(0, Math.floor((cy - halfY) * n));
    const y1 = Math.min(n - 1, Math.floor((cy + halfY) * n));
    const out: TileKey[] = [];
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1)
        out.push({ z: sourceZoom, x: ((x % n) + n) % n, y });
    }
    return out;
  };

  let tiles = collect(z);
  while (tiles.length > maxTiles && z > 0) {
    z -= 1;
    tiles = collect(z);
  }
  return { zoom: z, tiles };
}

export function dilate(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  const horizontal = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let hit = false;
      for (let dx = -radius; dx <= radius && !hit; dx += 1) {
        const xx = x + dx;
        hit = xx >= 0 && xx < width && mask[y * width + xx] !== 0;
      }
      horizontal[y * width + x] = hit ? 1 : 0;
    }
  }
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let hit = false;
      for (let dy = -radius; dy <= radius && !hit; dy += 1) {
        const yy = y + dy;
        hit = yy >= 0 && yy < height && horizontal[yy * width + x] !== 0;
      }
      out[y * width + x] = hit ? 1 : 0;
    }
  }
  return out;
}

export function erode(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let full = true;
      for (let dy = -radius; dy <= radius && full; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const xx = x + dx;
          const yy = y + dy;
          // Water is assumed to continue beyond the viewport.
          if (
            xx >= 0 &&
            xx < width &&
            yy >= 0 &&
            yy < height &&
            mask[yy * width + xx] === 0
          ) {
            full = false;
            break;
          }
        }
      }
      out[y * width + x] = full ? 1 : 0;
    }
  }
  return out;
}
