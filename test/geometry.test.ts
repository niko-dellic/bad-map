import { describe, expect, it } from "vitest";
import {
  bresenham,
  dilate,
  erode,
  gridSize,
  lngLatToWorld,
  reprojectPoint,
  reprojectionTransform,
  visibleTiles,
  worldToLngLat,
} from "../src/geometry";
import type { RasterViewState } from "../src/types";

const state: RasterViewState = {
  center: { lng: 0, lat: 0 },
  zoom: 5,
  bearing: 0,
  pitch: 0,
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

  it("maps an unchanged camera to identical frame pixels", () => {
    const transform = reprojectionTransform(state, state);
    expect(transform).toEqual({
      scale: 1,
      matrix: [1, 0, -0, 1],
      offset: [0, 0],
      zoomDelta: 0,
      bearingDelta: 0,
    });
    expect(reprojectPoint([123, 45], transform)).toEqual([123, 45]);
  });

  it("reprojects bearing changes around the viewport center", () => {
    const current = { ...state, bearing: 90 };
    const transform = reprojectionTransform(state, current);
    expect(
      reprojectPoint([state.width / 2, state.height / 2], transform),
    ).toEqual([state.width / 2, state.height / 2]);
    const east = reprojectPoint(
      [state.width / 2 + 10, state.height / 2],
      transform,
    );
    expect(east[0]).toBeCloseTo(state.width / 2);
    expect(east[1]).toBeCloseTo(state.height / 2 + 10);
  });

  it("reprojects panned and zoomed cameras through Web Mercator", () => {
    const current = {
      ...state,
      center: { lng: 1, lat: 0 },
      zoom: 6,
    };
    const transform = reprojectionTransform(state, current);
    expect(transform.scale).toBe(0.5);
    expect(transform.zoomDelta).toBe(1);
    // The current center lands east of the old frame center.
    expect(
      reprojectPoint([current.width / 2, current.height / 2], transform)[0],
    ).toBeGreaterThan(state.width / 2);
  });

  it("uses the short wrapped distance across the antimeridian", () => {
    const frame = { ...state, center: { lng: 179.9, lat: 0 } };
    const current = { ...state, center: { lng: -179.9, lat: 0 } };
    const transform = reprojectionTransform(frame, current);
    expect(Math.abs(transform.offset[0])).toBeLessThan(20);
  });
});
