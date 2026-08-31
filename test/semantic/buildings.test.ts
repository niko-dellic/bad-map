import { describe, expect, it } from "vitest";
import {
  buildBuildingMesh,
  buildBuildingMeshTile,
  classifyBuildingRings,
  selectBuildingTiles,
} from "../../src/semantic/buildings";
import type { DecodedFeature, GeometryPoint } from "../../src/tiles";
import type { RasterViewState } from "../../src/types";
import { visibleTiles } from "../../src/core/geometry";
import { rasterizeView } from "../../src/semantic/rasterize";
import { frameTransferables } from "../../src/workers/protocol";

const tile = { z: 0, x: 0, y: 0 };
const state: RasterViewState = {
  center: { lng: 0, lat: 0 },
  zoom: 0,
  bearing: 0,
  pitch: 0,
  width: 512,
  height: 512,
  pixelRatio: 1,
  cell: { width: 8, height: 16, dotSize: 2 },
  locale: "en",
};
const square: GeometryPoint[] = [
  [1600, 1600],
  [2400, 1600],
  [2400, 2400],
  [1600, 2400],
];

function feature(
  geometry: GeometryPoint[][] = [square],
  properties: DecodedFeature["properties"] = {
    render_height: 42,
    render_min_height: 0,
  },
): DecodedFeature {
  return {
    tile,
    extent: 4096,
    sourceLayer: "building",
    type: 3,
    properties,
    geometry,
  };
}

describe("dotted building meshes", () => {
  it("triangulates a roof and emits four wall quads", () => {
    const mesh = buildBuildingMeshTile(tile, [feature()], state)!;
    expect(mesh.vertices).toHaveLength(20 * 8);
    expect(mesh.indices).toHaveLength(6 + 4 * 6);
    expect(mesh.edgeVertices).toHaveLength(8 * 6 * 9);
    expect(mesh.vertices[7]).toBe(1);
    expect(mesh.edgeVertices[8]).toBe(1);
    expect(Math.max(...mesh.vertices)).toBeGreaterThan(0);
  });

  it("classifies holes and multipolygons by MVT winding", () => {
    const hole = [...square]
      .reverse()
      .map(([x, y]) => [x + (2048 - x) * 0.5, y + (2048 - y) * 0.5] as const);
    const second = square.map(([x, y]) => [x + 1000, y] as const);
    const polygons = classifyBuildingRings([square, hole, second]);
    expect(polygons).toHaveLength(2);
    expect(polygons[0]).toHaveLength(2);
    expect(polygons[1]).toHaveLength(1);

    const mesh = buildBuildingMeshTile(tile, [feature([square, hole])], state)!;
    expect(mesh.indices.length).toBeGreaterThan(4 * 6);
  });

  it("preserves elevated bases and falls back to six-meter heights", () => {
    const elevated = buildBuildingMeshTile(
      tile,
      [feature([square], { render_height: 30, render_min_height: 12 })],
      state,
    )!;
    const fallback = buildBuildingMeshTile(
      tile,
      [feature([square], {})],
      state,
    )!;
    const elevatedZ = Array.from(elevated.vertices).filter(
      (_, index) => index % 8 === 2,
    );
    const fallbackZ = Array.from(fallback.vertices).filter(
      (_, index) => index % 8 === 2,
    );
    expect(Math.min(...elevatedZ)).toBeGreaterThan(0);
    expect(Math.max(...fallbackZ)).toBeGreaterThan(0);
  });

  it("filters hidden and invalid extrusions", () => {
    expect(
      buildBuildingMeshTile(
        tile,
        [feature([square], { hide_3d: true, render_height: 42 })],
        state,
      ),
    ).toBeUndefined();
    expect(
      buildBuildingMeshTile(
        tile,
        [feature([square], { render_height: 5, render_min_height: 8 })],
        state,
      ),
    ).toBeUndefined();
    expect(
      buildBuildingMeshTile(
        tile,
        [
          feature([
            [
              [1, 1],
              [2, 2],
            ],
          ]),
        ],
        state,
      ),
    ).toBeUndefined();
  });

  it("omits artificial walls along tile boundaries", () => {
    const boundary: GeometryPoint[] = [
      [0, 1200],
      [800, 1200],
      [800, 2400],
      [0, 2400],
    ];
    const mesh = buildBuildingMeshTile(tile, [feature([boundary])], state)!;
    expect(mesh.indices).toHaveLength(6 + 3 * 6);
    expect(mesh.edgeVertices).toHaveLength(5 * 6 * 9);
  });

  it("unwraps buffered geometry around the antimeridian", () => {
    const wrappedTile = { z: 2, x: 0, y: 2 };
    const wrapped = { ...feature(), tile: wrappedTile };
    const mesh = buildBuildingMeshTile(wrappedTile, [wrapped], {
      ...state,
      center: { lng: 179.9, lat: 0 },
      zoom: 2,
    })!;
    const xs = Array.from(mesh.vertices).filter((_, index) => index % 8 === 0);
    expect(Math.max(...xs.map(Math.abs))).toBeLessThan(2_000);
    expect(mesh.clip[0]).toBe(1);
    expect(mesh.clip[2]).toBe(1.25);
  });

  it("keeps exact world-space tile clips at nonzero bearings", () => {
    const mesh = buildBuildingMeshTile(tile, [feature()], {
      ...state,
      bearing: 37,
    })!;
    expect(mesh.clip).toEqual([0, 0, 1, 1]);
  });

  it("keeps source-detail zoom when pitched coverage exceeds the tile cap", () => {
    const coverage = {
      ...state,
      center: { lng: -74.006, lat: 40.7128 },
      zoom: 12,
      width: 4096,
      height: 4096,
    };
    const detail = {
      ...coverage,
      zoom: 16,
      width: 4096,
      height: 4096,
    };
    const selection = selectBuildingTiles(coverage, detail, 14, 32);
    expect(selection.zoom).toBe(14);
    expect(selection.tiles).toHaveLength(32);
    expect(selection.tiles.every((candidate) => candidate.z === 14)).toBe(true);

    const focus = visibleTiles(detail, 14, Number.MAX_SAFE_INTEGER).tiles;
    const selected = new Set(
      selection.tiles.map(({ z, x, y }) => `${z}/${x}/${y}`),
    );
    expect(focus.every(({ z, x, y }) => selected.has(`${z}/${x}/${y}`))).toBe(
      true,
    );
  });

  it("transfers mesh buffers with the semantic frame", () => {
    const frame = rasterizeView([], state, 7);
    const mesh = buildBuildingMesh(7, [feature()], [tile], state);
    const transfers = frameTransferables(frame, undefined, mesh);
    expect(transfers).toContain(mesh.tiles[0]!.vertices.buffer);
    expect(transfers).toContain(mesh.tiles[0]!.indices.buffer);
    expect(transfers).toContain(mesh.tiles[0]!.edgeVertices.buffer);
  });
});
