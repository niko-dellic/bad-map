import { describe, expect, it } from "vitest";
import { rasterizeHeatmap } from "../../src/data-layers/heatmap";
import { LowResBasemap } from "../../src/basemap/low-res-basemap";
import type { RasterViewState } from "../../src/types";

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

  it("validates compact data and keeps its palette outside basemap greyscale", () => {
    const palette = [
      [0, 20, 80],
      [0, 120, 200],
      [240, 180, 20],
      [240, 40, 40],
    ] as const;
    const basemap = new LowResBasemap({
      heatmap: {
        data: [[0, 0, 2]],
        visible: true,
        palette,
      },
    });
    const options = basemap.getHeatmapOptions();
    expect(options.pointCount).toBe(1);
    expect(options.palette).toEqual(palette);
    basemap.setColorMode("color");
    expect(basemap.getHeatmapOptions().palette).toEqual(palette);
    expect(() => basemap.setHeatmapData(new Float32Array([0, 0]))).toThrow(
      /triplets/,
    );
    expect(() => basemap.setHeatmap({ opacity: 2 })).toThrow(/opacity/);
  });
});
