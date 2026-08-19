import { describe, expect, it } from "vitest";
import {
  screenVignetteAmount,
  screenVignetteBayerThreshold,
  screenVignetteFalloff,
} from "../demo/vignette";

describe("demo screen vignette", () => {
  it("fades from a clear center to opaque viewport edges", () => {
    expect(screenVignetteAmount(100, 50, 200, 100, 0.2, 0)).toBe(0);
    expect(screenVignetteAmount(100, 0, 200, 100, 0.2, 0)).toBeCloseTo(1);
  });

  it("applies a rectangle base evenly at edge midpoints and corners", () => {
    const midpoint = screenVignetteAmount(100, 10, 200, 100, 0.4, 0);
    const corner = screenVignetteAmount(20, 10, 200, 100, 0.4, 0);
    const ovalCorner = screenVignetteAmount(
      20,
      10,
      200,
      100,
      0.4,
      0,
      "linear",
      "oval",
    );
    expect(corner).toBe(midpoint);
    expect(ovalCorner).toBeGreaterThan(corner);
  });

  it("morphs either base shape toward a true circle", () => {
    const rectangle = screenVignetteAmount(20, 50, 200, 100, 0.25, 0);
    const circle = screenVignetteAmount(20, 50, 200, 100, 0.25, 1);
    expect(circle).toBeGreaterThan(rectangle);
    expect(circle).toBe(1);
  });

  it("supports linear, smooth, and edge-weighted falloff curves", () => {
    expect(screenVignetteFalloff(0.25, "linear")).toBe(0.25);
    expect(screenVignetteFalloff(0.25, "smooth")).toBe(0.15625);
    expect(screenVignetteFalloff(0.25, "edge")).toBe(0.0625);
  });

  it("uses each 8x8 ordered-dither threshold once", () => {
    const thresholds = Array.from({ length: 8 }, (_, y) =>
      Array.from({ length: 8 }, (_, x) => screenVignetteBayerThreshold(x, y)),
    ).flat();
    expect(new Set(thresholds).size).toBe(64);
    expect(Math.min(...thresholds)).toBe(0.5 / 64);
    expect(Math.max(...thresholds)).toBe(63.5 / 64);
  });
});
