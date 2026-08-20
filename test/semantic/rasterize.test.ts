import { describe, expect, it } from "vitest";
import { rasterizeView } from "../../src/semantic/rasterize";
import { FillClass, LineClass } from "../../src/semantic/style";
import type { DecodedFeature } from "../../src/tiles";
import type { RasterViewState } from "../../src/types";

const state: RasterViewState = {
  center: { lng: 0, lat: 0 },
  zoom: 14,
  bearing: 0,
  pitch: 0,
  width: 64,
  height: 64,
  pixelRatio: 1,
  cell: { width: 8, height: 16, dotSize: 2 },
  locale: "en",
};

const tile = { z: 14, x: 8192, y: 8192 };

function feature(
  input: Partial<DecodedFeature> &
    Pick<DecodedFeature, "sourceLayer" | "type" | "geometry">,
): DecodedFeature {
  return {
    tile,
    extent: 4096,
    properties: {},
    ...input,
  };
}

describe("semantic rasterizer", () => {
  it("rasterizes water fills and derives the coast from the same mask", () => {
    const water = feature({
      sourceLayer: "water",
      type: 3,
      properties: { class: "lake", name: "Test Lake" },
      geometry: [
        [
          [0, 0],
          [256, 0],
          [256, 256],
          [0, 256],
        ],
      ],
    });
    const frame = rasterizeView([water], state);
    expect([...frame.fill]).toContain(FillClass.Water);
    expect([...frame.lineClass]).toContain(LineClass.Coast);
    expect(frame.features.some((record) => record.name === "Test Lake")).toBe(
      true,
    );
  });

  it("lets a motorway win a crossed cell regardless of feature order", () => {
    const minor = feature({
      sourceLayer: "transportation",
      type: 2,
      properties: { class: "residential", name: "Small Street" },
      geometry: [
        [
          [0, 128],
          [256, 128],
        ],
      ],
    });
    const motorway = feature({
      sourceLayer: "transportation",
      type: 2,
      properties: { class: "motorway", name: "Big Road" },
      geometry: [
        [
          [128, 0],
          [128, 256],
        ],
      ],
    });
    const first = rasterizeView([motorway, minor], state);
    const second = rasterizeView([minor, motorway], state);
    expect([...first.lineClass]).toContain(LineClass.Motorway);
    expect([...second.lineClass]).toContain(LineClass.Motorway);
    expect([...first.lineMask]).toEqual([...second.lineMask]);
  });

  it("marks tunnel cells for compositor fading", () => {
    const tunnel = feature({
      sourceLayer: "transportation",
      type: 2,
      properties: { class: "primary", brunnel: "tunnel" },
      geometry: [
        [
          [0, 128],
          [256, 128],
        ],
      ],
    });
    const frame = rasterizeView([tunnel], state);
    expect([...frame.lineTone]).toContain(1);
  });

  it("returns transferable hit-test ownership", () => {
    const road = feature({
      sourceLayer: "transportation",
      type: 2,
      properties: { class: "primary", name: "Owned Road" },
      geometry: [
        [
          [0, 128],
          [256, 128],
        ],
      ],
    });
    const frame = rasterizeView([road], state);
    expect([...frame.owner].some(Boolean)).toBe(true);
    const owner = [...frame.owner].find(Boolean)!;
    expect(frame.features[owner - 1]?.name).toBe("Owned Road");
  });

  it("quantizes numeric polygon properties into a scalar texture", () => {
    const radar = feature({
      sourceLayer: "weather",
      type: 3,
      properties: { value: 0.5 },
      numeric: { property: "value", min: 0, max: 1 },
      sourceId: "weather",
      packId: "weather",
      adapter: "weather",
      geometry: [
        [
          [0, 0],
          [256, 0],
          [256, 256],
          [0, 256],
        ],
      ],
    });
    const frame = rasterizeView([radar], state);
    expect(Math.max(...frame.scalar)).toBeGreaterThan(100);
    expect([...frame.owner].some(Boolean)).toBe(true);
    expect(frame.features[0]).toMatchObject({
      sourceId: "weather",
      packId: "weather",
    });
  });
});
