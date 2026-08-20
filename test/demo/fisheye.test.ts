import { describe, expect, it } from "vitest";
import {
  normalizeScreenFisheyeOptions,
  screenFisheyeSampleUv,
} from "../../demo/fisheye";

describe("demo screen fisheye", () => {
  it("keeps the screen center fixed", () => {
    expect(
      screenFisheyeSampleUv([0.5, 0.5], 1600, 900, {
        enabled: true,
        k1: 1,
        k2: 0.5,
        strength: 2,
      }),
    ).toEqual([0.5, 0.5]);
  });

  it("uses the draaimolen radial polynomial with aspect-corrected UVs", () => {
    const sample = screenFisheyeSampleUv([0.75, 0.5], 200, 100, {
      enabled: true,
      k1: 0.5,
      k2: 0,
      strength: 1,
      radius: 1,
    });
    // r² = 0.2 at this point, so scale = 1 + 0.5 × 0.2 = 1.1.
    expect(sample[0]).toBeCloseTo(0.775);
    expect(sample[1]).toBe(0.5);
  });

  it("supports higher-order edge curvature and negative distortion", () => {
    const base = screenFisheyeSampleUv([0.7, 0.5], 100, 100, {
      enabled: true,
      k1: -0.5,
      k2: 0,
      strength: 1,
    });
    const edgeWeighted = screenFisheyeSampleUv([0.7, 0.5], 100, 100, {
      enabled: true,
      k1: -0.5,
      k2: -1,
      strength: 1,
    });
    expect(base[0]).toBeLessThan(0.7);
    expect(edgeWeighted[0]).toBeLessThan(base[0]);
  });

  it("passes pixels through while disabled and clamps control ranges", () => {
    expect(
      screenFisheyeSampleUv([0.2, 0.8], 100, 100, { enabled: false }),
    ).toEqual([0.2, 0.8]);
    expect(
      normalizeScreenFisheyeOptions({
        k1: 4,
        k2: -4,
        strength: 4,
        radius: 0.1,
      }),
    ).toMatchObject({
      enabled: true,
      k1: 2,
      k2: -2,
      strength: 2,
      radius: 0.5,
    });
  });
});
