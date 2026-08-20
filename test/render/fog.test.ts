import { describe, expect, it } from "vitest";
import { LowResBasemap } from "../../src/basemap/low-res-basemap";
import {
  bayer4Threshold,
  fogBoundaryAmount,
  groundRayIntersection,
  invertMatrix4,
} from "../../src/render";

describe("atmospheric fog", () => {
  it("normalizes options, preserves theme color fallback, and emits resolved state", () => {
    const basemap = new LowResBasemap();
    expect(basemap.getFogOptions()).toEqual({
      visible: true,
      mode: "dithered",
      start: 0.55,
      end: 0.95,
      opacity: 1,
    });
    expect(new LowResBasemap({ fog: false }).getFogOptions().visible).toBe(
      false,
    );

    const events: Array<{ mode: string; color: readonly number[] }> = [];
    basemap.on("fogchange", ({ mode, color }) => events.push({ mode, color }));
    const color = [20, 40, 60] as const;
    basemap.setFog({ mode: "regular", opacity: 0.7, color });
    expect(basemap.getFogOptions()).toMatchObject({
      visible: true,
      mode: "regular",
      opacity: 0.7,
      color,
    });
    expect(events).toEqual([{ mode: "regular", color }]);

    basemap.setFog({ color: undefined });
    expect(basemap.getFogOptions().color).toBeUndefined();
    expect(events.at(-1)?.color).toEqual([15, 15, 15]);
  });

  it("rejects invalid ranges, opacity, colors, and modes without changing state", () => {
    const basemap = new LowResBasemap();
    const initial = basemap.getFogOptions();
    expect(() => basemap.setFog({ start: 0.9, end: 0.4 })).toThrow(
      /start before end/,
    );
    expect(() => basemap.setFog({ opacity: 1.1 })).toThrow(/opacity/);
    expect(() => basemap.setFog({ color: [0, -1, 0] })).toThrow(/color/);
    expect(() => basemap.setFog({ mode: "noise" as "regular" })).toThrow(
      /mode/,
    );
    expect(basemap.getFogOptions()).toEqual(initial);
  });

  it("inverts projection matrices and intersects camera rays with the ground", () => {
    const identity = new Float32Array([
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
    ]);
    expect(invertMatrix4(identity)).toEqual(identity);
    expect(groundRayIntersection(identity, [0.25, -0.5])).toEqual({
      point: [0.25, -0.5, 0],
      distance: 1,
    });
    expect(invertMatrix4(new Float32Array(16))).toBeUndefined();
  });

  it("ramps at frame boundaries and uses every ordered-dither threshold once", () => {
    const bounds = [0, 0, 1, 1] as const;
    expect(fogBoundaryAmount([0.5, 0.5], bounds)).toBe(0);
    expect(fogBoundaryAmount([0, 0.5], bounds)).toBe(1);
    expect(fogBoundaryAmount([-0.1, 0.5], bounds)).toBe(1);
    expect(fogBoundaryAmount([0.06, 0.5], bounds)).toBe(0);

    const thresholds = Array.from({ length: 4 }, (_, y) =>
      Array.from({ length: 4 }, (_, x) => bayer4Threshold(x, y)),
    ).flat();
    expect(new Set(thresholds).size).toBe(16);
    expect(Math.min(...thresholds)).toBe(0.5 / 16);
    expect(Math.max(...thresholds)).toBe(15.5 / 16);
    expect(bayer4Threshold(4, 4)).toBe(bayer4Threshold(0, 0));
  });
});
