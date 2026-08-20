import { describe, expect, it } from "vitest";
import { Occupancy } from "../../src/semantic/labels";
import { LowResBasemap } from "../../src/basemap/low-res-basemap";
import { billboardGlyphs } from "../../src/render";
import type { RasterFrame } from "../../src/types";

describe("label occupancy", () => {
  it("requires a one-cell horizontal halo but no vertical halo", () => {
    const occupancy = new Occupancy(20, 4);
    expect(occupancy.free(1, 3, 5)).toBe(true);
    occupancy.claim(1, 3, 5);
    expect(occupancy.free(1, 9, 2)).toBe(false);
    expect(occupancy.free(2, 3, 5)).toBe(true);
  });

  it("rejects labels outside the viewport", () => {
    const occupancy = new Occupancy(10, 2);
    expect(occupancy.free(-1, 0, 2)).toBe(false);
    expect(occupancy.free(0, 9, 2)).toBe(false);
  });
});

describe("surface label billboards", () => {
  it("uses one geographic anchor and screen-space offsets for a label run", () => {
    const frame: RasterFrame = {
      generation: 1,
      durationMs: 0,
      state: {
        center: { lng: 0, lat: 0 },
        zoom: 10,
        bearing: 0,
        pitch: 0,
        width: 80,
        height: 48,
        pixelRatio: 1,
        cell: { width: 8, height: 16, dotSize: 2 },
        locale: "en",
      },
      columns: 10,
      rows: 3,
      fill: new Uint8Array(60),
      lineMask: new Uint8Array(30),
      lineClass: new Uint8Array(30),
      lineTone: new Uint8Array(30),
      owner: new Uint32Array(30),
      ribbon: new Uint8Array(30),
      scalar: new Uint8Array(30),
      heatmap: new Uint8Array(30),
      labels: [
        { column: 4, row: 1, text: "AB", ink: 0, bold: false, owner: 1 },
      ],
      features: [],
      warnings: [],
    };

    const glyphs = billboardGlyphs(frame);
    expect(glyphs).toHaveLength(2);
    expect(glyphs[0]!.anchor[0]).toBeCloseTo(0.5);
    expect(glyphs[0]!.anchor[1]).toBeCloseTo(0.5);
    expect(glyphs[1]!.anchor).toEqual(glyphs[0]!.anchor);
    expect(glyphs.map((glyph) => glyph.offset)).toEqual([
      [-4, 0],
      [4, 0],
    ]);
    expect(glyphs[0]!.uv).toEqual([0.4, 1 / 3, 0.5, 2 / 3]);
  });

  it("defaults to billboarding and supports constructor and runtime opt-out", () => {
    expect(new LowResBasemap().getLabelsBillboard()).toBe(true);
    const basemap = new LowResBasemap({ labels: { billboard: false } });
    expect(basemap.getLabelsBillboard()).toBe(false);
    expect(basemap.setLabelsBillboard(true)).toBe(basemap);
    expect(basemap.getLabelsBillboard()).toBe(true);
  });
});
