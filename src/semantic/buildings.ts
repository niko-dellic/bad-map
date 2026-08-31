import earcut from "earcut";
import { lngLatToWorld, visibleTiles, type TileKey } from "../core/geometry.js";
import type { DecodedFeature, GeometryPoint } from "../tiles/index.js";
import type {
  BuildingMeshFrame,
  BuildingMeshTile,
  RasterViewState,
} from "../types.js";

const EARTH_CIRCUMFERENCE_METERS = 40_075_016.68557849;
const VERTEX_STRIDE = 8;

type ProjectedPoint = readonly [number, number, number];

function tileKey(tile: TileKey): string {
  return `${tile.z}/${tile.x}/${tile.y}`;
}

function tileDistance(tile: TileKey, state: RasterViewState): number {
  const [centerX, centerY] = lngLatToWorld(state.center.lng, state.center.lat);
  const scale = 2 ** tile.z;
  const tileCenterX = (tile.x + 0.5) / scale;
  const tileCenterY = (tile.y + 0.5) / scale;
  let deltaX = tileCenterX - centerX;
  while (deltaX > 0.5) deltaX -= 1;
  while (deltaX < -0.5) deltaX += 1;
  return deltaX * deltaX + (tileCenterY - centerY) ** 2;
}

/** Keeps building attributes at source detail zoom while bounding tile work. */
export function selectBuildingTiles(
  coverageState: RasterViewState,
  detailState: RasterViewState,
  requestedZoom: number,
  maxTiles = 32,
): { zoom: number; tiles: TileKey[] } {
  const zoom = Math.max(0, Math.floor(requestedZoom));
  const complete = visibleTiles(
    coverageState,
    zoom,
    Number.MAX_SAFE_INTEGER,
  ).tiles;
  if (complete.length <= maxTiles) return { zoom, tiles: complete };

  const focusKeys = new Set(
    visibleTiles(detailState, zoom, Number.MAX_SAFE_INTEGER).tiles.map(tileKey),
  );
  const tiles = [...complete]
    .sort((left, right) => {
      const focusDelta =
        Number(focusKeys.has(tileKey(right))) -
        Number(focusKeys.has(tileKey(left)));
      return (
        focusDelta ||
        tileDistance(left, detailState) - tileDistance(right, detailState)
      );
    })
    .slice(0, Math.max(1, maxTiles));
  return { zoom, tiles };
}

function samePoint(left: GeometryPoint, right: GeometryPoint): boolean {
  return left[0] === right[0] && left[1] === right[1];
}

function normalizeRing(ring: readonly GeometryPoint[]): GeometryPoint[] {
  const output = [...ring];
  if (output.length > 2 && samePoint(output[0]!, output.at(-1)!)) output.pop();
  return output;
}

function signedArea(ring: readonly GeometryPoint[]): number {
  let sum = 0;
  for (
    let index = 0, previous = ring.length - 1;
    index < ring.length;
    previous = index++
  ) {
    const currentPoint = ring[index]!;
    const previousPoint = ring[previous]!;
    sum +=
      (previousPoint[0] - currentPoint[0]) *
      (currentPoint[1] + previousPoint[1]);
  }
  return sum;
}

/** Groups MVT rings into their exterior-first polygon sets. */
export function classifyBuildingRings(
  input: readonly (readonly GeometryPoint[])[],
): GeometryPoint[][][] {
  const polygons: GeometryPoint[][][] = [];
  let polygon: GeometryPoint[][] | undefined;
  let exteriorNegative: boolean | undefined;
  for (const sourceRing of input) {
    const ring = normalizeRing(sourceRing);
    if (ring.length < 3) continue;
    const area = signedArea(ring);
    if (area === 0) continue;
    exteriorNegative ??= area < 0;
    if (area < 0 === exteriorNegative) {
      if (polygon) polygons.push(polygon);
      polygon = [ring];
    } else if (polygon) {
      polygon.push(ring);
    }
  }
  if (polygon) polygons.push(polygon);
  return polygons;
}

function worldPoint(
  tile: TileKey,
  extent: number,
  point: GeometryPoint,
  referenceX: number,
): readonly [number, number] {
  const scale = 2 ** tile.z;
  let x = (tile.x + point[0] / extent) / scale;
  const y = (tile.y + point[1] / extent) / scale;
  while (x - referenceX > 0.5) x -= 1;
  while (x - referenceX < -0.5) x += 1;
  return [x, y];
}

function framePoint(
  world: readonly [number, number],
  state: RasterViewState,
  center: readonly [number, number],
  worldSize: number,
): readonly [number, number] {
  const dx = (world[0] - center[0]) * worldSize;
  const dy = (world[1] - center[1]) * worldSize;
  const angle = (-state.bearing * Math.PI) / 180;
  return [
    Math.cos(angle) * dx - Math.sin(angle) * dy + state.width / 2,
    Math.sin(angle) * dx + Math.cos(angle) * dy + state.height / 2,
  ];
}

function heightPixels(
  meters: number,
  worldY: number,
  worldSize: number,
): number {
  const mercatorLatitude = Math.PI - 2 * Math.PI * worldY;
  return (
    (meters * worldSize * Math.cosh(mercatorLatitude)) /
    EARTH_CIRCUMFERENCE_METERS
  );
}

function pushVertex(
  output: number[],
  position: ProjectedPoint,
  uv: readonly [number, number],
  normal: readonly [number, number, number],
): number {
  const index = output.length / VERTEX_STRIDE;
  output.push(...position, ...uv, ...normal);
  return index;
}

function pushEdge(
  output: number[],
  start: ProjectedPoint,
  end: ProjectedPoint,
  strength: number,
): void {
  const corners = [
    [0, -1],
    [0, 1],
    [1, -1],
    [1, -1],
    [0, 1],
    [1, 1],
  ] as const;
  for (const [position, side] of corners)
    output.push(...start, ...end, position, side, strength);
}

function isTileBoundaryPoint(point: GeometryPoint, extent: number): boolean {
  return (
    point[0] === 0 ||
    point[1] === 0 ||
    point[0] === extent ||
    point[1] === extent
  );
}

function tileClip(
  tile: TileKey,
  center: readonly [number, number],
): readonly [number, number, number, number] {
  const corners = [
    worldPoint(tile, 1, [0, 0], center[0]),
    worldPoint(tile, 1, [1, 0], center[0]),
    worldPoint(tile, 1, [1, 1], center[0]),
    worldPoint(tile, 1, [0, 1], center[0]),
  ];
  return [
    Math.min(...corners.map(([x]) => x)),
    Math.min(...corners.map(([, y]) => y)),
    Math.max(...corners.map(([x]) => x)),
    Math.max(...corners.map(([, y]) => y)),
  ];
}

function isTileBoundaryEdge(
  first: GeometryPoint,
  second: GeometryPoint,
  extent: number,
): boolean {
  return (
    (first[0] === 0 && second[0] === 0) ||
    (first[1] === 0 && second[1] === 0) ||
    (first[0] === extent && second[0] === extent) ||
    (first[1] === extent && second[1] === extent)
  );
}

function finiteHeight(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function appendBuilding(
  feature: DecodedFeature,
  state: RasterViewState,
  center: readonly [number, number],
  worldSize: number,
  vertices: number[],
  indices: number[],
  edgeVertices: number[],
): void {
  if (
    feature.type !== 3 ||
    feature.sourceLayer !== "building" ||
    feature.properties.hide_3d === true
  )
    return;
  const topMeters = finiteHeight(feature.properties.render_height, 6);
  const baseMeters = finiteHeight(feature.properties.render_min_height, 0);
  if (topMeters <= baseMeters) return;

  for (const polygon of classifyBuildingRings(feature.geometry)) {
    const projected = polygon.map((ring) =>
      ring.map((point) => {
        const world = worldPoint(
          feature.tile,
          feature.extent,
          point,
          center[0],
        );
        const [x, y] = framePoint(world, state, center, worldSize);
        return {
          source: point,
          world,
          x,
          y,
          base: heightPixels(baseMeters, world[1], worldSize),
          top: heightPixels(topMeters, world[1], worldSize),
        };
      }),
    );

    const roofCoordinates: number[] = [];
    const holes: number[] = [];
    const roofVertices: number[] = [];
    let roofCount = 0;
    projected.forEach((ring, ringIndex) => {
      if (ringIndex > 0) holes.push(roofCount);
      for (const point of ring) {
        roofCoordinates.push(point.x, point.y);
        roofVertices.push(
          pushVertex(
            vertices,
            [point.x, point.y, point.top],
            [point.x, point.y],
            [0, 0, 1],
          ),
        );
        roofCount += 1;
      }
    });
    for (const roofIndex of earcut(roofCoordinates, holes, 2))
      indices.push(roofVertices[roofIndex]!);

    projected.forEach((ring, ringIndex) => {
      let perimeter = 0;
      const sourceRing = polygon[ringIndex]!;
      const area = ring.reduce((sum, point, index) => {
        const next = ring[(index + 1) % ring.length]!;
        return sum + point.x * next.y - next.x * point.y;
      }, 0);
      for (let index = 0; index < ring.length; index += 1) {
        const first = ring[index]!;
        const second = ring[(index + 1) % ring.length]!;
        const length = Math.hypot(second.x - first.x, second.y - first.y);
        if (
          length <= Number.EPSILON ||
          isTileBoundaryEdge(
            sourceRing[index]!,
            sourceRing[(index + 1) % sourceRing.length]!,
            feature.extent,
          )
        ) {
          perimeter += length;
          continue;
        }
        pushEdge(
          edgeVertices,
          [first.x, first.y, first.top],
          [second.x, second.y, second.top],
          1,
        );
        const direction = area >= 0 ? 1 : -1;
        const normal: readonly [number, number, number] = [
          (direction * (second.y - first.y)) / length,
          (-direction * (second.x - first.x)) / length,
          0,
        ];
        const start = pushVertex(
          vertices,
          [first.x, first.y, first.base],
          [perimeter, first.base],
          normal,
        );
        const next = pushVertex(
          vertices,
          [second.x, second.y, second.base],
          [perimeter + length, second.base],
          normal,
        );
        const nextTop = pushVertex(
          vertices,
          [second.x, second.y, second.top],
          [perimeter + length, second.top],
          normal,
        );
        const startTop = pushVertex(
          vertices,
          [first.x, first.y, first.top],
          [perimeter, first.top],
          normal,
        );
        indices.push(start, next, nextTop, start, nextTop, startTop);
        perimeter += length;
      }
      for (let index = 0; index < ring.length; index += 1) {
        const point = ring[index]!;
        if (isTileBoundaryPoint(sourceRing[index]!, feature.extent)) continue;
        pushEdge(
          edgeVertices,
          [point.x, point.y, point.base],
          [point.x, point.y, point.top],
          0.72,
        );
      }
    });
  }
}

export function buildBuildingMeshTile(
  tile: TileKey,
  features: readonly DecodedFeature[],
  state: RasterViewState,
): BuildingMeshTile | undefined {
  const center = lngLatToWorld(state.center.lng, state.center.lat);
  const worldSize = 512 * 2 ** state.zoom;
  const vertices: number[] = [];
  const indices: number[] = [];
  const edgeVertices: number[] = [];
  for (const feature of features) {
    if (
      feature.tile.z !== tile.z ||
      feature.tile.x !== tile.x ||
      feature.tile.y !== tile.y
    )
      continue;
    appendBuilding(
      feature,
      state,
      center,
      worldSize,
      vertices,
      indices,
      edgeVertices,
    );
  }
  if (!indices.length) return undefined;
  return {
    tile,
    clip: tileClip(tile, center),
    vertices: new Float32Array(vertices),
    indices: new Uint32Array(indices),
    edgeVertices: new Float32Array(edgeVertices),
  };
}

export function buildBuildingMesh(
  generation: number,
  features: readonly DecodedFeature[],
  tiles: readonly TileKey[],
  state: RasterViewState,
): BuildingMeshFrame {
  const batches = tiles
    .map((tile) => buildBuildingMeshTile(tile, features, state))
    .filter((tile): tile is BuildingMeshTile => tile !== undefined);
  return { generation, state, tiles: batches };
}
