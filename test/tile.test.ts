import { afterEach, describe, expect, it, vi } from "vitest";
import { semanticFixtureTile } from "./fixtures/mvt";
import { decodeMvt, TileLoader } from "../src/tile";

afterEach(() => vi.unstubAllGlobals());

describe("deterministic MVT fixture", () => {
  it("decodes crossings, tunnels, water, and localized labels", () => {
    const fixture = semanticFixtureTile();
    const features = decodeMvt(fixture.buffer as ArrayBuffer, {
      z: 10,
      x: 512,
      y: 512,
    });
    expect(features).toHaveLength(8);
    expect(
      features.find((feature) => feature.properties.brunnel === "tunnel"),
    ).toMatchObject({ sourceLayer: "transportation", type: 2 });
    expect(
      features.find((feature) => feature.properties["name:es"]),
    ).toMatchObject({ sourceLayer: "place", type: 1 });
    expect(
      features.find((feature) => feature.sourceLayer === "water"),
    ).toMatchObject({ properties: { name: "Fixture Lake" }, type: 3 });
    expect(features.map((feature) => feature.sourceLayer)).toEqual(
      expect.arrayContaining([
        "park",
        "building",
        "transportation_name",
        "poi",
      ]),
    );
  });

  it("is byte-for-byte deterministic", () => {
    expect([...semanticFixtureTile()]).toEqual([...semanticFixtureTile()]);
  });

  it("rejects malformed protobuf data", () => {
    expect(() =>
      decodeMvt(new Uint8Array([0xff, 0xff, 0xff]).buffer, {
        z: 0,
        x: 0,
        y: 0,
      }),
    ).toThrow();
  });

  it("reports missing tiles as typed nonfatal warnings", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ tiles: ["https://tiles.test/{z}/{x}/{y}.mvt"] }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    const loader = new TileLoader({ tileJSON: "https://tiles.test/source" });
    const result = await loader.load([{ z: 2, x: 1, y: 1 }]);
    expect(result.features).toEqual([]);
    expect(result.warnings).toMatchObject([
      {
        code: "tile",
        fatal: false,
        message: "Unable to read vector tile 2/1/1",
      },
    ]);
  });

  it("isolates malformed tile payloads without failing the view", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ tiles: ["https://tiles.test/{z}/{x}/{y}.mvt"] }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([0xff, 0xff, 0xff]), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const loader = new TileLoader({ tileJSON: "https://tiles.test/source" });
    const result = await loader.load([{ z: 2, x: 1, y: 1 }]);
    expect(result.features).toEqual([]);
    expect(result.warnings[0]).toMatchObject({ code: "tile", fatal: false });
  });
});
