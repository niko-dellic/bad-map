import { describe, expect, it } from "vitest";
import {
  compositeDataFrames,
  rasterizeDataLayers,
  serializeDataLayer,
} from "../../src/data-layers";
import { LowResBasemap } from "../../src/basemap/low-res-basemap";
import type { LowResDataLayer, RasterViewState } from "../../src/types";

const state: RasterViewState = {
  center: { lng: 0, lat: 0 },
  zoom: 10,
  bearing: 0,
  pitch: 0,
  width: 128,
  height: 128,
  pixelRatio: 1,
  cell: { width: 8, height: 16, dotSize: 2 },
  locale: "en",
};

const render = (...layers: LowResDataLayer[]) =>
  rasterizeDataLayers(layers.map(serializeDataLayer), state, 1);

describe("extensible low-resolution data layers", () => {
  it("renders and owns every GeoJSON geometry family", () => {
    const frame = render({
      id: "geometry",
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { kind: "point" },
            geometry: { type: "Point", coordinates: [0, 0] },
          },
          {
            type: "Feature",
            properties: { kind: "multipoint" },
            geometry: {
              type: "MultiPoint",
              coordinates: [
                [0.01, 0],
                [-0.01, 0],
              ],
            },
          },
          {
            type: "Feature",
            properties: { kind: "line" },
            geometry: {
              type: "LineString",
              coordinates: [
                [-0.02, -0.01],
                [0.02, -0.01],
              ],
            },
          },
          {
            type: "Feature",
            properties: { kind: "multiline" },
            geometry: {
              type: "MultiLineString",
              coordinates: [
                [
                  [0, -0.02],
                  [0, 0.02],
                ],
              ],
            },
          },
          {
            type: "Feature",
            properties: { kind: "polygon" },
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [-0.02, -0.02],
                  [0.02, -0.02],
                  [0.02, 0.02],
                  [-0.02, 0.02],
                  [-0.02, -0.02],
                ],
              ],
            },
          },
          {
            type: "Feature",
            properties: { kind: "collection" },
            geometry: {
              type: "GeometryCollection",
              geometries: [
                { type: "Point", coordinates: [0.015, 0.015] },
                {
                  type: "LineString",
                  coordinates: [
                    [-0.02, 0.02],
                    [0.02, 0.02],
                  ],
                },
              ],
            },
          },
        ],
      },
    });

    expect(frame.features).toHaveLength(6);
    expect(frame.data.some(Boolean)).toBe(true);
    expect(frame.dataOwner.some(Boolean)).toBe(true);
  });

  it("uses even/odd polygon filling for holes", () => {
    const frame = render({
      id: "holes",
      type: "geojson",
      data: {
        type: "Polygon",
        coordinates: [
          [
            [-0.03, -0.03],
            [0.03, -0.03],
            [0.03, 0.03],
            [-0.03, 0.03],
            [-0.03, -0.03],
          ],
          [
            [-0.008, -0.008],
            [-0.008, 0.008],
            [0.008, 0.008],
            [0.008, -0.008],
            [-0.008, -0.008],
          ],
        ],
      },
      fill: { outlineWidth: 0 },
    });
    const center =
      Math.floor(frame.dotRows / 2) * frame.dotColumns +
      Math.floor(frame.dotColumns / 2);
    expect(frame.dataOwner[center]).toBe(0);
    expect(frame.dataOwner.some(Boolean)).toBe(true);
  });

  it("routes locator targets to the marker buffer and keeps their owner", () => {
    const frame = render({
      id: "places",
      type: "waypoint",
      data: [
        { id: "center", position: [0, 0], properties: { name: "Center" } },
      ],
    });
    expect(frame.data.some(Boolean)).toBe(false);
    expect(frame.markers.some(Boolean)).toBe(true);
    expect(frame.markerOwner.some(Boolean)).toBe(true);
    expect(frame.features[0]).toMatchObject({
      layerId: "places",
      featureId: "center",
    });
  });

  it("draws only the active trip trail and validates timestamps", () => {
    const frame = render({
      id: "trips",
      type: "trips",
      currentTime: 10,
      trailLength: 5,
      playing: false,
      data: [
        {
          path: [
            [-0.02, 0],
            [0.02, 0],
          ],
          timestamps: [0, 10],
        },
      ],
    });
    expect(frame.data.some(Boolean)).toBe(true);
    const invalid = serializeDataLayer({
      id: "invalid",
      type: "trips",
      data: [{ path: [[0, 0]], timestamps: [] }],
    });
    expect(invalid.type).toBe("trips");
    if (invalid.type !== "trips") throw new Error("Unexpected layer type");
    expect(invalid.trips).toHaveLength(0);
    expect(invalid.warnings[0]).toMatchObject({
      code: "data",
      fatal: false,
      layerId: "invalid",
    });
  });

  it("preserves deterministic order and evaluates style accessors before transfer", () => {
    const frame = render(
      {
        id: "back",
        type: "geojson",
        order: 0,
        data: { type: "Point", coordinates: [0, 0] },
        point: { color: [255, 0, 0], radius: 8 },
      },
      {
        id: "front",
        type: "geojson",
        order: 1,
        data: { type: "Point", coordinates: [0, 0] },
        point: {
          color: (feature) =>
            feature.type === "Feature" ? [0, 255, 0] : [0, 0, 0],
          radius: 4,
        },
      },
    );
    const center =
      (Math.floor(frame.dotRows / 2) * frame.dotColumns +
        Math.floor(frame.dotColumns / 2)) *
      4;
    expect([...frame.data.slice(center, center + 3)]).toEqual([0, 255, 0]);
    expect(frame.features[frame.dataOwner[center / 4]! - 1]?.layerId).toBe(
      "front",
    );
  });

  it("wraps antimeridian paths and clips very long offscreen segments", () => {
    const wrappedState = {
      ...state,
      center: { lng: 179.9, lat: 0 },
      zoom: 8,
    };
    const frame = rasterizeDataLayers(
      [
        serializeDataLayer({
          id: "wrapped",
          type: "geojson",
          data: {
            type: "LineString",
            coordinates: [
              [179.8, 0],
              [-179.8, 0],
            ],
          },
        }),
      ],
      wrappedState,
      1,
    );
    expect(frame.dataOwner.some(Boolean)).toBe(true);

    const clipped = render({
      id: "clipped",
      type: "geojson",
      data: {
        type: "LineString",
        coordinates: [
          [-5, 0.02],
          [5, 0.02],
        ],
      },
    });
    expect(clipped.data.some(Boolean)).toBe(true);
  });

  it("skips malformed features while retaining valid geometry and typed warnings", () => {
    const layer = serializeDataLayer({
      id: "recovery",
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { valid: true },
            geometry: { type: "Point", coordinates: [0, 0] },
          },
          {
            type: "Feature",
            properties: { valid: false },
            geometry: { type: "Point", coordinates: [Number.NaN, 0] },
          },
        ],
      },
    });
    const frame = rasterizeDataLayers([layer], state, 1);
    expect(frame.dataOwner.some(Boolean)).toBe(true);
    expect(frame.warnings).toContainEqual(
      expect.objectContaining({
        code: "data",
        fatal: false,
        layerId: "recovery",
      }),
    );
  });

  it("scales waypoint stencils, switches glyphs, retains a halo, and clips", () => {
    const small = render({
      id: "small",
      type: "waypoint",
      data: [{ position: [0, 0] }],
      color: [255, 0, 0],
      haloColor: [0, 0, 255],
      size: 20,
      style: "locator",
    });
    const caret = render({
      id: "caret",
      type: "waypoint",
      data: [{ position: [0, 0] }],
      size: 20,
      style: "caret",
    });
    const large = render({
      id: "large",
      type: "waypoint",
      data: [{ position: [0, 0] }, { position: [0.11, 0.11] }],
      size: 40,
    });
    const smallDots = small.markerOwner.filter(Boolean).length;
    const largeDots = large.markerOwner.filter(Boolean).length;
    expect(largeDots).toBeGreaterThan(smallDots);
    expect([...caret.markers]).not.toEqual([...small.markers]);
    const center =
      Math.floor(caret.dotRows / 2) * caret.dotColumns +
      Math.floor(caret.dotColumns / 2);
    expect(caret.markerOwner[center]).toBeGreaterThan(0);
    expect(
      [...small.markers].some((value, index) => index % 4 === 2 && value > 0),
    ).toBe(true);
    expect(large.markerOwner.length).toBe(large.dotColumns * large.dotRows);

    const overrides = serializeDataLayer({
      id: "overrides",
      type: "waypoint",
      style: "locator",
      data: [{ position: [0, 0] }, { position: [0.01, 0], style: "caret" }],
    });
    expect(overrides.type).toBe("waypoint");
    if (overrides.type !== "waypoint") throw new Error("Unexpected layer");
    expect(overrides.waypoints.map((waypoint) => waypoint.style)).toEqual([
      "locator",
      "caret",
    ]);
  });

  it("composites cached static and animated frames in deterministic order", () => {
    const staticFrame = render({
      id: "static",
      type: "geojson",
      order: 0,
      data: { type: "Point", coordinates: [0, 0] },
      point: { color: [255, 0, 0], radius: 8 },
    });
    const animatedFrame = render({
      id: "animated",
      type: "trips",
      order: 1,
      currentTime: 10,
      trailLength: 10,
      data: [
        {
          path: [
            [-0.02, 0],
            [0.02, 0],
          ],
          timestamps: [0, 10],
          color: [0, 255, 0],
        },
      ],
    });
    const frame = compositeDataFrames([staticFrame, animatedFrame], state, 2);
    const center =
      Math.floor(frame.dotRows / 2) * frame.dotColumns +
      Math.floor(frame.dotColumns / 2);
    expect(frame.features[frame.dataOwner[center]! - 1]?.layerId).toBe(
      "animated",
    );
    expect(staticFrame.generation).toBe(1);
  });

  it("seeks and steps trip playback with clamp and wrap semantics", () => {
    const basemap = new LowResBasemap({
      dataLayers: [
        {
          id: "transport",
          type: "trips",
          data: [
            {
              path: [
                [0, 0],
                [0.01, 0.01],
              ],
              timestamps: [0, 1800],
            },
          ],
          currentTime: 300,
          loopLength: 1800,
          playing: true,
        },
      ],
    });

    basemap.seekTripsPlayback("transport", 900, { playing: false });
    expect(basemap.getTripsPlayback("transport")).toMatchObject({
      currentTime: 900,
      playing: false,
    });

    basemap.stepTripsPlayback("transport", 15);
    expect(basemap.getTripsPlayback("transport").currentTime).toBe(915);
    basemap.stepTripsPlayback("transport", 2000);
    expect(basemap.getTripsPlayback("transport").currentTime).toBe(1800);
    basemap.stepTripsPlayback("transport", 15, { wrap: true });
    expect(basemap.getTripsPlayback("transport").currentTime).toBe(15);
    basemap.seekTripsPlayback("transport", -15, { wrap: true });
    expect(basemap.getTripsPlayback("transport").currentTime).toBe(1785);

    expect(() => basemap.seekTripsPlayback("transport", Number.NaN)).toThrow(
      "finite",
    );
    expect(() =>
      basemap.stepTripsPlayback("transport", Number.POSITIVE_INFINITY),
    ).toThrow("finite");
  });
});
