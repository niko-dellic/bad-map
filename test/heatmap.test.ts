import { describe, expect, it } from "vitest";
import { rasterizeHeatmap } from "../src/heatmap";
import { LowResBasemap } from "../src/low-res-basemap";
import type { RasterViewState } from "../src/types";

const state: RasterViewState = {
  center: { lng: 0, lat: 0 },
  zoom: 10,
  bearing: 0,
  pitch: 0,
  width: 80,
  height: 64,
  pixelRatio: 1,
  cell: { width: 8, height: 16, dotSize: 2 },
  locale: "en",
};

describe("low-resolution heatmaps", () => {
  it("accumulates point weights through a bounded kernel", () => {
    const light = rasterizeHeatmap(new Float32Array([0, 0, 1]), state, 10, 4, {
      visible: true,
      radius: 20,
      intensity: 1,
      maxDensity: 10,
    });
    const heavy = rasterizeHeatmap(new Float32Array([0, 0, 8]), state, 10, 4, {
      visible: true,
      radius: 20,
      intensity: 1,
      maxDensity: 10,
    });
    expect(Math.max(...light)).toBeGreaterThan(0);
    expect(Math.max(...heavy)).toBeGreaterThan(Math.max(...light));
    expect([...heavy].filter(Boolean).length).toBeGreaterThan(1);
  });

  it("normalizes an automatic domain and ignores hidden or distant data", () => {
    const automatic = rasterizeHeatmap(
      new Float32Array([0, 0, 1, 120, 50, 100]),
      state,
      10,
      4,
      { visible: true, radius: 16, intensity: 1, maxDensity: 0 },
    );
    expect(Math.max(...automatic)).toBe(255);
    expect(
      rasterizeHeatmap(new Float32Array([0, 0, 1]), state, 10, 4, {
        visible: false,
        radius: 16,
        intensity: 1,
        maxDensity: 0,
      }),
    ).toEqual(new Uint8Array(40));
  });

  it("validates compact data and applies greyscale to the heatmap palette", () => {
    const basemap = new LowResBasemap({
      heatmap: {
        data: [[0, 0, 2]],
        visible: true,
        palette: [
          [0, 20, 80],
          [0, 120, 200],
          [240, 180, 20],
          [240, 40, 40],
        ],
      },
    });
    const options = basemap.getHeatmapOptions();
    expect(options.pointCount).toBe(1);
    expect(options.palette?.every(([r, g, b]) => r === g && g === b)).toBe(
      true,
    );
    expect(() => basemap.setHeatmapData(new Float32Array([0, 0]))).toThrow(
      /triplets/,
    );
    expect(() => basemap.setHeatmap({ opacity: 2 })).toThrow(/opacity/);
  });
});
