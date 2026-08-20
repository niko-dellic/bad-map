import { describe, expect, it } from "vitest";
import { LowResBasemap } from "../../src/basemap/low-res-basemap";

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
});
