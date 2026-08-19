import { describe, expect, it } from "vitest";
import {
  featureMatches,
  marine,
  political,
  streets,
  topographic,
  transit,
  weather,
} from "../src/packs";
import type { DecodedFeature } from "../src/tile";
import { featureBelongsToPack } from "../src/packs";

const feature = (sourceLayer: string, cls: string): DecodedFeature => ({
  tile: { z: 0, x: 0, y: 0 },
  extent: 4096,
  sourceLayer,
  type: 2,
  properties: { class: cls },
  geometry: [],
});

describe("semantic layer packs", () => {
  it("creates serializable built-in descriptors", () => {
    for (const descriptor of [
      streets(),
      transit(),
      topographic(),
      weather(),
      political(),
      marine(),
    ]) {
      expect(JSON.parse(JSON.stringify(descriptor))).toEqual(descriptor);
      expect(descriptor.sourceLayers.length).toBeGreaterThan(0);
    }
  });

  it("limits the transit adapter to transit classes", () => {
    expect(
      featureBelongsToPack(feature("transportation", "rail"), transit()),
    ).toBe(true);
    expect(
      featureBelongsToPack(feature("transportation", "residential"), transit()),
    ).toBe(false);
  });

  it("filters queried features by source and pack provenance", () => {
    expect(
      featureMatches(
        {
          id: 1,
          kind: "line",
          class: "rail",
          name: "A",
          sourceLayer: "transportation",
          sourceId: "base",
          packId: "transit",
          properties: {},
          cell: { column: 0, row: 0 },
          lngLat: { lng: 0, lat: 0 },
        },
        { sourceId: "base", packId: "transit" },
      ),
    ).toBe(true);
  });
});
