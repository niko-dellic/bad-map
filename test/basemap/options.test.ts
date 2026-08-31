import { describe, expect, it } from "vitest";
import { LowResBasemap } from "../../src/basemap/low-res-basemap";
import { normalizeBuildings3D } from "../../src/basemap/options";

describe("basemap option validation", () => {
  it("rejects invalid constructor camera and projection options", () => {
    expect(
      () => new LowResBasemap({ camera: { maxPitch: Number.NaN } }),
    ).toThrow(/maxPitch/);
    expect(() => new LowResBasemap({ camera: { maxPitch: -1 } })).toThrow(
      /maxPitch/,
    );
    expect(() => new LowResBasemap({ camera: { maxPitch: 181 } })).toThrow(
      /maxPitch/,
    );
    expect(
      () =>
        new LowResBasemap({
          projectionMode: "globe" as "surface",
        }),
    ).toThrow(/projection mode/);
  });

  it("does not retain a rejected camera update", () => {
    const basemap = new LowResBasemap();
    expect(() => basemap.setCamera({ maxPitch: -1 })).toThrow(/maxPitch/);
    expect(() => basemap.setCamera({ rotation: false })).not.toThrow();
    expect(() => basemap.setCamera({ maxPitch: 70 })).not.toThrow();
  });

  it("defaults to visible filled and edged meshes without dots", () => {
    expect(normalizeBuildings3D(undefined)).toMatchObject({
      visible: true,
      style: "dotted",
      fill: true,
      dots: false,
      edges: true,
      edgeStrength: 1,
    });
    expect(normalizeBuildings3D(false).visible).toBe(false);
    expect(normalizeBuildings3D({ style: "native" }).style).toBe("native");
    expect(() => normalizeBuildings3D({ style: "voxel" as "dotted" })).toThrow(
      /buildings3D style/,
    );
    expect(() => normalizeBuildings3D({ edgeStrength: 4.1 })).toThrow(
      /edgeStrength/,
    );
  });

  it("updates dotted building appearance without changing visibility", () => {
    const basemap = new LowResBasemap({ buildings3D: true });
    basemap.setBuildings3DAppearance({
      fill: false,
      dots: false,
      edges: true,
      edgeStrength: 1.5,
      heightScale: 1.25,
    });
    expect(basemap.getBuildings3DVisible()).toBe(true);
    expect(basemap.getBuildings3DAppearance()).toEqual({
      fill: false,
      dots: false,
      edges: true,
      edgeStrength: 1.5,
      heightScale: 1.25,
    });
  });
});
