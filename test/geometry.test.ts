import { describe, expect, it } from "vitest";
import {
  bresenham,
  dilate,
  erode,
  gridSize,
  lngLatToWorld,
  visibleTiles,
  worldToLngLat,
} from "../src/geometry";
import type { RasterViewState } from "../src/types";

const state: RasterViewState = {
  center: { lng: 0, lat: 0 },
  zoom: 5,
  width: 800,
  height: 400,
  pixelRatio: 1,
  cell: { width: 8, height: 16, dotSize: 2 },
  locale: "en",
};

describe("geometry", () => {
  it("round-trips Web Mercator coordinates", () => {
    const world = lngLatToWorld(13.388, 52.517);
    const result = worldToLngLat(...world);
    expect(result[0]).toBeCloseTo(13.388, 7);
    expect(result[1]).toBeCloseTo(52.517, 7);
  });

  it("walks integer lines without gaps", () => {
    expect([...bresenham(0, 0, 4, 2)]).toEqual([
      [0, 0],
      [1, 0],
      [2, 1],
      [3, 1],
      [4, 2],
    ]);
  });

  it("caps pathological tile selections by coarsening", () => {
    const result = visibleTiles({ ...state, width: 100_000 }, 12, 16);
    expect(result.tiles.length).toBeLessThanOrEqual(16);
    expect(result.zoom).toBeLessThan(12);
  });

  it("wraps tiles across the antimeridian", () => {
    const result = visibleTiles(
      { ...state, center: { lng: 179.9, lat: 0 } },
      4,
    );
    expect(result.tiles.every((tile) => tile.x >= 0 && tile.x < 16)).toBe(true);
  });

  it("dilates and erodes dot masks", () => {
    const point = new Uint8Array(25);
    point[12] = 1;
    expect([...dilate(point, 5, 5, 1)].reduce((a, b) => a + b, 0)).toBe(9);
    const full = new Uint8Array(25).fill(1);
    full[12] = 0;
    expect(erode(full, 5, 5, 1)[6]).toBe(0);
  });

  it("uses complete cells at partial viewport edges", () => {
    expect(gridSize(101, 65, state.cell)).toEqual({ columns: 13, rows: 5 });
  });
});
