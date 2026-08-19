import { expect, test } from "@playwright/test";

interface Diagnostics {
  renderEvents: number;
  styleEvents: number;
  lastGeneration: number;
  lastDurationMs: number;
  generations: number[];
  heatmapEvents: number;
  featureEnterEvents: number;
}

const UBER_DATA_URL =
  "https://raw.githubusercontent.com/visgl/deck.gl-data/master/examples/screen-grid/uber-pickup-locations.json";
const PHOTON_SEARCH_URL = "https://photon.komoot.io/api/**";
const pickupFixture = Array.from({ length: 625 }, (_, index) => {
  const x = index % 25;
  const y = Math.floor(index / 25);
  return [-74.025 + x * 0.0015, 40.695 + y * 0.0015, 1 + ((x + y) % 8)];
});

async function diagnostics(page: import("@playwright/test").Page) {
  return page.evaluate<Diagnostics>(() =>
    structuredClone(
      (window as typeof window & { __badMapDemo: { diagnostics: Diagnostics } })
        .__badMapDemo.diagnostics,
    ),
  );
}

test.beforeEach(async ({ page }) => {
  await page.route(UBER_DATA_URL, (route) =>
    route.fulfill({ json: pickupFixture }),
  );
  await page.goto("/");
  await expect(page.locator("#status")).toContainText("rendered in");
});

test("orders data and marker boundaries between base and labels", async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const { map, basemap } = (
      window as typeof window & {
        __badMapDemo: {
          map: {
            getLayersOrder(): string[];
            getLayer(id: string): unknown;
          };
          basemap: {
            layerIds: {
              base: string;
              data: string;
              markers: string;
              labels: string;
            };
          };
        };
      }
    ).__badMapDemo;
    const ids = map.getLayersOrder();
    return {
      ids,
      base: basemap.layerIds.base,
      data: basemap.layerIds.data,
      markers: basemap.layerIds.markers,
      labels: basemap.layerIds.labels,
      hasBase: Boolean(map.getLayer(basemap.layerIds.base)),
      hasLabels: Boolean(map.getLayer(basemap.layerIds.labels)),
    };
  });
  expect(result.hasBase).toBe(true);
  expect(result.hasLabels).toBe(true);
  expect(result.ids.indexOf(result.base)).toBeLessThan(
    result.ids.indexOf(result.data),
  );
  expect(result.ids.indexOf(result.data)).toBeLessThan(
    result.ids.indexOf(result.markers),
  );
  expect(result.ids.indexOf(result.markers)).toBeLessThan(
    result.ids.indexOf(result.labels),
  );
});

test("debounces OSM place lookup and selects a result", async ({ page }) => {
  let requestCount = 0;
  let requestedQuery = "";
  await page.route(PHOTON_SEARCH_URL, (route) => {
    requestCount += 1;
    requestedQuery = new URL(route.request().url()).searchParams.get("q") ?? "";
    return route.fulfill({
      json: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [4.9041, 52.3676] },
            properties: {
              osm_id: 271110,
              osm_type: "R",
              type: "city",
              name: "Amsterdam",
              state: "North Holland",
              country: "Netherlands",
            },
          },
        ],
      },
    });
  });

  const toggle = page.locator("#place-search-toggle");
  const input = page.locator("#place-search-input");
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(input).toBeHidden();
  const [searchBox, settingsToggleBox, headerBox] = await Promise.all([
    page.locator("#place-search").boundingBox(),
    page.locator("#settings-toggle").boundingBox(),
    page.locator("header").boundingBox(),
  ]);
  expect(searchBox).not.toBeNull();
  expect(settingsToggleBox).not.toBeNull();
  expect(headerBox).not.toBeNull();
  expect(searchBox!.width).toBe(settingsToggleBox!.width);
  expect(searchBox!.height).toBe(settingsToggleBox!.height);
  expect(searchBox!.y).toBe(headerBox!.y);
  expect(searchBox!.x).toBeGreaterThan(headerBox!.x + headerBox!.width);
  await toggle.click();
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();
  await input.fill("A");
  await page.waitForTimeout(450);
  expect(requestCount).toBe(0);

  await input.fill("Am");
  await page.waitForTimeout(100);
  await input.fill("Amsterdam");
  const option = page.getByRole("option", { name: /Amsterdam/ });
  await expect(option).toBeVisible();
  expect(requestCount).toBe(1);
  expect(requestedQuery).toBe("Amsterdam");

  await input.press("ArrowDown");
  await input.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(input).toBeHidden();
  await expect(page.locator("#place-search-results")).toBeHidden();
  await expect(input).toHaveValue("Amsterdam");
  await expect(page.locator(".maplibregl-marker")).toHaveCount(1);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              __badMapDemo: { map: { getCenter(): { lng: number } } };
            }
          ).__badMapDemo.map.getCenter().lng,
      ),
    )
    .toBeCloseTo(4.9041, 2);

  await toggle.click();
  await page.locator("#place-search-clear").click();
  await expect(input).toBeHidden();
  await expect(page.locator(".maplibregl-marker")).toHaveCount(0);
});

test("keeps mouse feature queries off until cursor mode is enabled", async ({
  page,
}) => {
  const toggle = page.locator("#feature-query-toggle");
  const readout = page.locator("#readout");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(readout).toHaveText("Mouse feature queries are off.");
  expect((await diagnostics(page)).featureEnterEvents).toBe(0);

  const point = await page.evaluate(() => {
    const { basemap } = (
      window as typeof window & {
        __badMapDemo: {
          basemap: { queryFeatures(point: [number, number]): unknown[] };
        };
      }
    ).__badMapDemo;
    for (let y = 80; y < innerHeight - 80; y += 16) {
      for (let x = 80; x < innerWidth - 360; x += 8) {
        if (basemap.queryFeatures([x, y]).length) return { x, y };
      }
    }
    return null;
  });
  expect(point).not.toBeNull();

  await page.mouse.move(point!.x, point!.y);
  await page.waitForTimeout(100);
  expect((await diagnostics(page)).featureEnterEvents).toBe(0);

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(readout).toHaveText("Move over the map to inspect a feature.");
  await page.mouse.move(point!.x + 20, point!.y + 20);
  await page.mouse.move(point!.x, point!.y);
  await expect
    .poll(async () => (await diagnostics(page)).featureEnterEvents)
    .toBeGreaterThan(0);

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(readout).toHaveText("Mouse feature queries are off.");
  const disabledCount = (await diagnostics(page)).featureEnterEvents;
  await page.mouse.move(point!.x + 20, point!.y + 20);
  await page.mouse.move(point!.x, point!.y);
  await page.waitForTimeout(100);
  expect((await diagnostics(page)).featureEnterEvents).toBe(disabledCount);
});

test("toggles greyscale without worker rasterization", async ({ page }) => {
  const before = await diagnostics(page);
  await page.locator("#color-mode").click();
  await expect(page.locator("#color-mode")).toHaveText("greyscale");
  await page.waitForTimeout(150);
  const after = await diagnostics(page);
  expect(after.styleEvents).toBe(before.styleEvents + 1);
  expect(after.renderEvents).toBe(before.renderEvents);
  expect(after.lastGeneration).toBe(before.lastGeneration);
});

test("exposes stable slots and switches between bearing and surface cameras", async ({
  page,
}) => {
  const slots = await page.evaluate(() => {
    const { map, basemap } = (
      window as typeof window & {
        __badMapDemo: {
          map: { getLayer(id: string): { type?: string } | undefined };
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
    };
  });
  expect(slots.present).toBe(true);
  expect(slots.dataType).toBe("custom");
  expect(slots.ids).toMatchObject({
    data: "bad-map-data",
    markers: "bad-map-markers",
    interaction: "bad-map-interaction",
  });
  expect(slots.packs).toEqual(
    expect.arrayContaining(["streets", "transit", "topographic"]),
  );
  expect(slots.packs).not.toContain("weather");
  expect(slots.labelsBillboard).toBe(true);

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
  await page.locator("#tab-layers").click();
  await page.locator("#buildings-3d").check();
  await expect(page.locator("#projection")).toHaveValue("surface");
  const enabled = await page.evaluate(() => {
    const { map, basemap } = (
      window as typeof window & {
        __badMapDemo: {
          map: {
            getLayersOrder(): string[];
            getLayoutProperty(id: string, property: string): unknown;
            getPaintProperty(id: string, property: string): unknown;
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
      visibility: map.getLayoutProperty(
        basemap.layerIds.buildings,
        "visibility",
      ),
      color: map.getPaintProperty(
        basemap.layerIds.buildings,
        "fill-extrusion-color",
      ),
      baseIndex: ids.indexOf(basemap.layerIds.base),
      buildingIndex: ids.indexOf(basemap.layerIds.buildings),
      dataIndex: ids.indexOf(basemap.layerIds.data),
    };
  });
  expect(enabled.requested).toBe(true);
  expect(enabled.visibility).toBe("visible");
  expect(enabled.color).toMatch(/^rgb/);
  expect(enabled.baseIndex).toBeLessThan(enabled.buildingIndex);
  expect(enabled.buildingIndex).toBeLessThan(enabled.dataIndex);

  await page.locator("#tab-display").click();
  await page.locator("#projection").selectOption("screen");
  await expect(page.locator("#buildings-3d")).not.toBeChecked();
  const disabled = await page.evaluate(() => {
    const { map, basemap } = (
      window as typeof window & {
        __badMapDemo: {
          map: { getLayoutProperty(id: string, property: string): unknown };
          basemap: { layerIds: { buildings: string } };
        };
      }
    ).__badMapDemo;
    return map.getLayoutProperty(basemap.layerIds.buildings, "visibility");
  });
  expect(disabled).toBe("none");
});

test("compares native and worker-rendered pickup heatmaps", async ({
  page,
}) => {
  await page.locator("#tab-data").click();
  await page.locator("#heatmap-mode").selectOption("native");
  await expect(page.locator("#heatmap-status")).toContainText(
    "weighted pickups · native",
  );
  const native = await page.evaluate(() => {
    const { map, basemap } = (
      window as typeof window & {
        __badMapDemo: {
          map: {
            getLayer(id: string): { type?: string } | undefined;
            getLayersOrder(): string[];
            getLayoutProperty(id: string, property: string): unknown;
          };
          basemap: {
            layerIds: { markers: string };
            getHeatmapOptions(): { visible?: boolean; pointCount: number };
          };
        };
      }
    ).__badMapDemo;
    const order = map.getLayersOrder();
    return {
      type: map.getLayer("demo-uber-native-heatmap")?.type,
      visibility: map.getLayoutProperty(
        "demo-uber-native-heatmap",
        "visibility",
      ),
      belowMarkers:
        order.indexOf("demo-uber-native-heatmap") <
        order.indexOf(basemap.layerIds.markers),
      lowResVisible: basemap.getHeatmapOptions().visible,
    };
  });
  expect(native).toEqual({
    type: "heatmap",
    visibility: "visible",
    belowMarkers: true,
    lowResVisible: false,
  });

  const before = await diagnostics(page);
  await page.locator("#heatmap-mode").selectOption("lowres");
  await expect(page.locator("#heatmap-status")).toContainText(
    "weighted pickups · lowres",
  );
  await expect
    .poll(async () => (await diagnostics(page)).lastGeneration)
    .toBeGreaterThan(before.lastGeneration);
  const lowRes = await page.evaluate(() => {
    const { map, basemap } = (
      window as typeof window & {
        __badMapDemo: {
          map: { getLayoutProperty(id: string, property: string): unknown };
          basemap: {
            getHeatmapOptions(): {
              visible?: boolean;
              pointCount: number;
              palette?: readonly (readonly [number, number, number])[];
            };
          };
        };
      }
    ).__badMapDemo;
    const options = basemap.getHeatmapOptions();
    return {
      ...options,
      nativeVisibility: map.getLayoutProperty(
        "demo-uber-native-heatmap",
        "visibility",
      ),
      greyscale: options.palette?.every(
        ([red, green, blue]) => red === green && green === blue,
      ),
    };
  });
  expect(lowRes).toMatchObject({
    visible: true,
    pointCount: pickupFixture.length,
    nativeVisibility: "none",
    greyscale: false,
  });

  const palette = lowRes.palette;
  await page.locator("#tab-display").click();
  await page.locator("#color-mode").click();
  const paletteAfterColorMode = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __badMapDemo: {
            basemap: {
              getHeatmapOptions(): {
                palette?: readonly (readonly [number, number, number])[];
              };
            };
          };
        }
      ).__badMapDemo.basemap.getHeatmapOptions().palette,
  );
  expect(paletteAfterColorMode).toEqual(palette);

  await page.locator("#tab-data").click();
  const afterMode = await diagnostics(page);
  await page.locator("#heatmap-radius").fill("52");
  await expect
    .poll(async () => (await diagnostics(page)).lastGeneration)
    .toBeGreaterThan(afterMode.lastGeneration);
  expect((await diagnostics(page)).heatmapEvents).toBeGreaterThan(
    before.heatmapEvents,
  );
});

test("collapses the settings panel without hiding hover information", async ({
  page,
}) => {
  const readout = page.locator("#readout");
  const settings = page.locator("#settings");
  const header = page.locator("header");

  await expect(settings.locator("#readout")).toHaveCount(0);
  const [readoutBox, headerBox] = await Promise.all([
    readout.boundingBox(),
    header.boundingBox(),
  ]);
  expect(readoutBox).not.toBeNull();
  expect(headerBox).not.toBeNull();
  expect(readoutBox!.x).toBeLessThan(40);
  expect(readoutBox!.y).toBeGreaterThan(headerBox!.y + headerBox!.height);

  await page.locator("#settings-toggle").click();
  await expect(settings).toHaveClass(/is-collapsed/);
  await expect(page.locator("#settings-toggle")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expect(settings.locator("section").first()).toBeHidden();
  await expect(page.locator("#settings-toggle i")).toBeVisible();
  await expect(readout).toBeVisible();

  await page.locator("#settings-toggle").click();
  await expect(settings).not.toHaveClass(/is-collapsed/);
  await expect(settings.locator("section").first()).toBeVisible();
});

test("organizes controls into tabs and names the next cell preset", async ({
  page,
}) => {
  await expect(page.locator("#settings .panel-title")).toHaveCount(0);
  const tabRow = await page.locator(".panel-tabs").boundingBox();
  const reset = await page.locator("#reset").boundingBox();
  expect(tabRow).not.toBeNull();
  expect(reset).not.toBeNull();
  expect(reset!.y + reset!.height / 2).toBeCloseTo(
    tabRow!.y + tabRow!.height / 2,
    1,
  );
  for (const [tab, label] of [
    ["#tab-display", "Display settings"],
    ["#tab-layers", "Layer settings"],
    ["#tab-data", "Data settings"],
  ] as const) {
    await expect(page.locator(tab)).toHaveAttribute("aria-label", label);
    await expect(page.locator(tab)).toHaveAttribute("title", label);
    await expect(page.locator(`${tab} span`)).toHaveCount(0);
  }
  await expect(page.locator("#tab-display")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator("#panel-data")).toBeHidden();
  await page.locator("#tab-layers").click();
  await expect(page.locator("#panel-layers")).toBeVisible();
  for (const control of ["#labels", "#buildings-3d"]) {
    await expect(
      page.locator(control).locator("xpath=ancestor::section/h2"),
    ).toHaveText("Map layers");
  }
  await expect(page.locator("#weather-source")).toHaveCount(0);
  await expect(page.locator("#weather-time")).toHaveCount(0);

  await page.locator("#tab-display").click();
  const preset = page.locator("#cells");
  await expect(preset).toHaveText("larger cell preset");
  await preset.click();
  await expect(preset).toHaveText("smaller cell preset");
  await expect(page.locator("#cell-width-value")).toHaveText("12");
  await expect(page.locator("#cell-height-value")).toHaveText("24");
  await preset.click();
  await expect(preset).toHaveText("larger cell preset");
  await expect(page.locator("#cell-width-value")).toHaveText("8");
  await expect(page.locator("#cell-height-value")).toHaveText("16");
});

test("resizes the sidebar while keeping tabs pinned above scrolling content", async ({
  page,
}) => {
  const settings = page.locator("#settings");
  const handle = page.locator("#settings-resize");
  const tabs = page.locator(".panel-tabs");
  const scroll = page.locator(".panel-scroll");
  const initialWidth = (await settings.boundingBox())!.width;
  const handleBox = (await handle.boundingBox())!;

  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + 80);
  await page.mouse.down();
  await page.mouse.move(handleBox.x - 90, handleBox.y + 80, { steps: 8 });
  await page.mouse.up();
  const resizedWidth = (await settings.boundingBox())!.width;
  expect(resizedWidth).toBeGreaterThan(initialWidth + 70);
  await expect(handle).toHaveAttribute(
    "aria-valuenow",
    String(Math.round(resizedWidth)),
  );

  const tabsBefore = (await tabs.boundingBox())!.y;
  await scroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const tabsAfter = (await tabs.boundingBox())!.y;
  expect(tabsAfter).toBeCloseTo(tabsBefore, 1);

  await page.locator("#tab-data").click();
  await expect(page.locator("#panel-data")).toBeVisible();
  await expect(page.locator("#heatmap-mode")).toBeVisible();
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
  await page.locator(".maplibregl-ctrl-zoom-in").click();
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

test("meets cached render and interaction baselines", async ({ page }) => {
  const initial = await diagnostics(page);
  expect(initial.lastDurationMs).toBeLessThan(200);

  const metrics = await page.evaluate(async () => {
    const demo = (
      window as typeof window & {
        __badMapDemo: {
          map: {
            getCenter(): { lng: number; lat: number };
            easeTo(options: unknown): void;
            once(type: string, listener: () => void): void;
          };
          diagnostics: Diagnostics;
        };
      }
    ).__badMapDemo;
    let animationFrames = 0;
    let running = true;
    const count = () => {
      animationFrames += 1;
      if (running) requestAnimationFrame(count);
    };
    requestAnimationFrame(count);
    const center = demo.map.getCenter();
    const started = performance.now();
    const moveEnded = new Promise<void>((resolve) =>
      demo.map.once("moveend", resolve),
    );
    demo.map.easeTo({
      // Keep the motion inside the already loaded tile set so this measures
      // cached composition rather than network latency.
      center: [center.lng + 0.001, center.lat + 0.0005],
      duration: 600,
      easing: (value: number) => value,
    });
    await moveEnded;
    const moveDuration = performance.now() - started;
    running = false;
    const generationAtMoveEnd = demo.diagnostics.lastGeneration;
    const exactStarted = performance.now();
    while (
      demo.diagnostics.lastGeneration <= generationAtMoveEnd &&
      performance.now() - exactStarted < 2_000
    )
      await new Promise((resolve) => setTimeout(resolve, 10));
    return {
      fps: animationFrames / (moveDuration / 1_000),
      exactLatencyMs: performance.now() - exactStarted,
      renderDurationMs: demo.diagnostics.lastDurationMs,
    };
  });

  console.info(`motion benchmark ${JSON.stringify(metrics)}`);
  expect(metrics.fps).toBeGreaterThan(55);
  expect(metrics.exactLatencyMs).toBeLessThan(200);
  expect(metrics.renderDurationMs).toBeLessThan(200);
});

test("queries features and removes all package-owned state", async ({
  page,
}) => {
  const feature = await page.evaluate(() => {
    const { basemap } = (
      window as typeof window & {
        __badMapDemo: {
          basemap: {
            queryFeatures(point: [number, number]): { name: string }[];
          };
        };
      }
    ).__badMapDemo;
    for (let y = 80; y < innerHeight - 80; y += 16) {
      for (let x = 80; x < innerWidth - 80; x += 8) {
        const found = basemap.queryFeatures([x, y])[0];
        if (found) return found;
      }
    }
    return null;
  });
  expect(feature).not.toBeNull();

  const removed = await page.evaluate(() => {
    const { map, basemap } = (
      window as typeof window & {
        __badMapDemo: {
          map: { getLayer(id: string): unknown };
          basemap: {
            layerIds: { base: string; labels: string };
            remove(): void;
          };
        };
      }
    ).__badMapDemo;
    basemap.remove();
    return {
      base: map.getLayer(basemap.layerIds.base),
      labels: map.getLayer(basemap.layerIds.labels),
    };
  });
  expect(removed.base).toBeUndefined();
  expect(removed.labels).toBeUndefined();
});
