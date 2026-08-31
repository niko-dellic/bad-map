import {
  HIGHWAY_ACCIDENTS_URL,
  HIGHWAY_ROADS_URL,
  PHOTON_SEARCH_URL,
  TRIPS_DATA_URL,
  accidentFixture,
  diagnostics,
  expect,
  highwayFixture,
  pickupFixture,
  setupDemoTests,
  test,
} from "./demo-fixture";

setupDemoTests({ fixtureTiles: true });

test("exposes stable slots and switches between bearing and surface cameras", async ({
  page,
}) => {
  const slots = await page.evaluate(() => {
    const { map, basemap } = (
      window as typeof window & {
        __badMapDemo: {
          map: {
            getLayer(id: string): { type?: string } | undefined;
            getZoom(): number;
          };
          basemap: {
            layerIds: { data: string } & Record<string, string>;
            getLayers(): { id: string }[];
            getLabelsBillboard(): boolean;
            setLabelsBillboard(value: boolean): void;
          };
        };
      }
    ).__badMapDemo;
    return {
      ids: basemap.layerIds,
      present: Object.values(basemap.layerIds).every((id) => map.getLayer(id)),
      dataType: map.getLayer(basemap.layerIds.data)?.type,
      packs: basemap.getLayers().map((pack) => pack.id),
      labelsBillboard: basemap.getLabelsBillboard(),
      zoom: map.getZoom(),
    };
  });
  expect(slots.present).toBe(true);
  expect(slots.dataType).toBe("custom");
  expect(slots.ids).toMatchObject({
    data: "bad-map-data",
    markers: "bad-map-markers",
    fog: "bad-map-fog",
    interaction: "bad-map-interaction",
  });
  expect(slots.packs).toEqual(
    expect.arrayContaining(["streets", "transit", "topographic"]),
  );
  expect(slots.packs).not.toContain("weather");
  expect(slots.labelsBillboard).toBe(true);
  expect(slots.zoom).toBeCloseTo(13.8);
  await expect(page.locator("#projection")).toHaveValue("surface");
  await expect(page.locator("#pitch")).toBeEnabled();
  expect(
    await page.evaluate(() =>
      (
        window as typeof window & {
          __badMapDemo: { map: { getPitch(): number } };
        }
      ).__badMapDemo.map.getPitch(),
    ),
  ).toBe(0);

  await page.locator("#bearing").fill("32");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as typeof window & {
            __badMapDemo: { map: { getBearing(): number } };
          }
        ).__badMapDemo.map.getBearing(),
      ),
    )
    .toBeCloseTo(32, 0);

  await page.locator("#projection").selectOption("screen");
  await expect(page.locator("#pitch")).toBeDisabled();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as typeof window & {
            __badMapDemo: { map: { getPitch(): number } };
          }
        ).__badMapDemo.map.getPitch(),
      ),
    )
    .toBe(0);

  await page.locator("#projection").selectOption("surface");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as typeof window & {
            __badMapDemo: { map: { getPitch(): number } };
          }
        ).__badMapDemo.map.getPitch(),
      ),
    )
    .toBeGreaterThan(20);
  await expect(page.locator("#pitch")).toBeEnabled();
  const billboardOptOut = await page.evaluate(() => {
    const { basemap } = (
      window as typeof window & {
        __badMapDemo: {
          basemap: {
            setLabelsBillboard(value: boolean): void;
            getLabelsBillboard(): boolean;
          };
        };
      }
    ).__badMapDemo;
    basemap.setLabelsBillboard(false);
    return basemap.getLabelsBillboard();
  });
  expect(billboardOptOut).toBe(false);
});

test("keeps the bearing slider aligned with mouse rotation", async ({
  page,
}) => {
  const bearing = page.locator("#bearing");

  await page.mouse.move(400, 300);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(500, 300, { steps: 10 });
  await page.mouse.up({ button: "right" });
  const mouseBearing = await page.evaluate(() =>
    (
      window as typeof window & {
        __badMapDemo: { map: { getBearing(): number } };
      }
    ).__badMapDemo.map.getBearing(),
  );
  expect(mouseBearing).toBeLessThan(0);

  await page.evaluate(() =>
    (
      window as typeof window & {
        __badMapDemo: { map: { setBearing(value: number): void } };
      }
    ).__badMapDemo.map.setBearing(0),
  );
  const box = await bearing.boundingBox();
  expect(box).not.toBeNull();
  await bearing.click({
    position: { x: box!.width * 0.75, y: box!.height / 2 },
  });

  const sliderBearing = await page.evaluate(() =>
    (
      window as typeof window & {
        __badMapDemo: { map: { getBearing(): number } };
      }
    ).__badMapDemo.map.getBearing(),
  );
  expect(sliderBearing).toBeLessThan(0);
  await expect(bearing).toHaveCSS("direction", "rtl");
});

test("toggles theme-aware 3D buildings in the surface stack", async ({
  page,
}) => {
  const webglErrors: string[] = [];
  page.on("console", (message) => {
    if (/WebGL: INVALID_OPERATION/.test(message.text()))
      webglErrors.push(message.text());
  });
  const cameraBefore = await page.evaluate(() => {
    const { map } = (
      window as typeof window & {
        __badMapDemo: {
          map: { getBearing(): number; getPitch(): number };
        };
      }
    ).__badMapDemo;
    return { bearing: map.getBearing(), pitch: map.getPitch() };
  });
  await page.locator("#tab-layers").click();
  await expect(page.locator("#buildings-3d")).toBeChecked();
  await page.locator("#buildings-3d").uncheck();
  await expect(page.locator("#buildings-3d")).not.toBeChecked();
  const generationBefore = (await diagnostics(page)).lastGeneration;
  await page.locator("#buildings-3d").check();
  await expect(page.locator("#projection")).toHaveValue("surface");
  const enabled = await page.evaluate(() => {
    const { map, basemap } = (
      window as typeof window & {
        __badMapDemo: {
          map: {
            getBearing(): number;
            getLayer(id: string): { type?: string } | undefined;
            getLayersOrder(): string[];
            getSource(id: string): unknown;
            getPitch(): number;
          };
          basemap: {
            layerIds: {
              base: string;
              buildings: string;
              data: string;
            };
            getBuildings3DVisible(): boolean;
          };
        };
      }
    ).__badMapDemo;
    const ids = map.getLayersOrder();
    return {
      requested: basemap.getBuildings3DVisible(),
      type: map.getLayer(basemap.layerIds.buildings)?.type,
      nativeSource: Boolean(map.getSource("bad-map-buildings-source")),
      baseIndex: ids.indexOf(basemap.layerIds.base),
      buildingIndex: ids.indexOf(basemap.layerIds.buildings),
      dataIndex: ids.indexOf(basemap.layerIds.data),
      camera: { bearing: map.getBearing(), pitch: map.getPitch() },
    };
  });
  expect(enabled.requested).toBe(true);
  expect(enabled.type).toBe("custom");
  expect(enabled.nativeSource).toBe(false);
  expect(enabled.baseIndex).toBeLessThan(enabled.buildingIndex);
  expect(enabled.buildingIndex).toBeLessThan(enabled.dataIndex);
  expect(enabled.camera).toEqual(cameraBefore);
  await expect
    .poll(async () => (await diagnostics(page)).lastGeneration)
    .toBeGreaterThan(generationBefore);

  const pitchedGeneration = (await diagnostics(page)).lastGeneration;
  await page.evaluate(() => {
    (
      window as typeof window & {
        __badMapDemo: {
          map: { jumpTo(options: unknown): void };
        };
      }
    ).__badMapDemo.map.jumpTo({ zoom: 16, pitch: 62, bearing: 24 });
  });
  await expect
    .poll(async () => (await diagnostics(page)).lastGeneration, {
      timeout: 30_000,
    })
    .toBeGreaterThan(pitchedGeneration);
  const edgeOnly = await page.evaluate(() => {
    const basemap = (
      window as typeof window & {
        __badMapDemo: {
          basemap: {
            setBuildings3DAppearance(options: unknown): void;
            getBuildings3DAppearance(): Record<string, boolean | number>;
          };
        };
      }
    ).__badMapDemo.basemap;
    basemap.setBuildings3DAppearance({
      fill: false,
      dots: false,
      edges: true,
      edgeStrength: 1.4,
    });
    return basemap.getBuildings3DAppearance();
  });
  expect(edgeOnly).toMatchObject({
    fill: false,
    dots: false,
    edges: true,
    edgeStrength: 1.4,
  });
  await page.waitForTimeout(250);
  expect(webglErrors).toEqual([]);

  await page.locator("#tab-display").click();
  await page.locator("#projection").selectOption("screen");
  await expect(page.locator("#buildings-3d")).not.toBeChecked();
  const disabled = await page.evaluate(() => {
    const { map, basemap } = (
      window as typeof window & {
        __badMapDemo: {
          map: { getLayer(id: string): { type?: string } | undefined };
          basemap: {
            layerIds: { buildings: string };
            getBuildings3DVisible(): boolean;
          };
        };
      }
    ).__badMapDemo;
    return {
      type: map.getLayer(basemap.layerIds.buildings)?.type,
      requested: basemap.getBuildings3DVisible(),
    };
  });
  expect(disabled).toEqual({ type: "custom", requested: false });
});

test("retains native MapLibre extrusions as a fallback", async ({ page }) => {
  await page.goto("/demo/?building-style=native");
  await expect(page.locator("#status")).toContainText("rendered in");
  await page.locator("#settings-toggle").click();
  await page.locator("#tab-layers").click();
  await page.locator("#buildings-3d").check();
  const native = await page.evaluate(() => {
    const { map, basemap } = (
      window as typeof window & {
        __badMapDemo: {
          map: {
            getLayer(id: string): { type?: string } | undefined;
            getSource(id: string): unknown;
            getLayoutProperty(id: string, property: string): unknown;
            getPaintProperty(id: string, property: string): unknown;
          };
          basemap: { layerIds: { buildings: string } };
        };
      }
    ).__badMapDemo;
    return {
      type: map.getLayer(basemap.layerIds.buildings)?.type,
      source: Boolean(map.getSource("bad-map-buildings-source")),
      visibility: map.getLayoutProperty(
        basemap.layerIds.buildings,
        "visibility",
      ),
      color: map.getPaintProperty(
        basemap.layerIds.buildings,
        "fill-extrusion-color",
      ),
    };
  });
  expect(native).toMatchObject({
    type: "fill-extrusion",
    source: true,
    visibility: "visible",
  });
  expect(native.color).toMatch(/^rgb/);
});

test("keeps producing exact frames after pan, zoom, and resize", async ({
  page,
}) => {
  const before = await diagnostics(page);
  const centerBefore = await page.evaluate(() => {
    const center = (
      window as typeof window & {
        __badMapDemo: { map: { getCenter(): { lng: number; lat: number } } };
      }
    ).__badMapDemo.map.getCenter();
    return [center.lng, center.lat];
  });

  await page.mouse.move(480, 320);
  await page.mouse.down();
  await page.mouse.move(620, 390, { steps: 16 });
  await page.mouse.up();
  await expect
    .poll(async () => (await diagnostics(page)).lastGeneration)
    .toBeGreaterThan(before.lastGeneration);

  const centerAfter = await page.evaluate(() => {
    const center = (
      window as typeof window & {
        __badMapDemo: { map: { getCenter(): { lng: number; lat: number } } };
      }
    ).__badMapDemo.map.getCenter();
    return [center.lng, center.lat];
  });
  expect(centerAfter).not.toEqual(centerBefore);

  const afterPan = await diagnostics(page);
  await page.evaluate(() => {
    const map = (
      window as typeof window & {
        __badMapDemo: {
          map: { getZoom(): number; setZoom(zoom: number): void };
        };
      }
    ).__badMapDemo.map;
    map.setZoom(map.getZoom() + 1);
  });
  await expect
    .poll(async () => (await diagnostics(page)).lastGeneration)
    .toBeGreaterThan(afterPan.lastGeneration);

  const afterZoom = await diagnostics(page);
  await page.setViewportSize({ width: 820, height: 560 });
  await expect
    .poll(async () => (await diagnostics(page)).lastGeneration)
    .toBeGreaterThan(afterZoom.lastGeneration);

  const final = await diagnostics(page);
  expect(final.generations).toEqual(
    [...final.generations].sort((left, right) => left - right),
  );
});
