import { expect, test } from "@playwright/test";

interface Diagnostics {
  renderEvents: number;
  styleEvents: number;
  lastGeneration: number;
  lastDurationMs: number;
  generations: number[];
  heatmapEvents: number;
  dataRenderEvents: number;
  featureEnterEvents: number;
}

const UBER_DATA_URL =
  "https://raw.githubusercontent.com/visgl/deck.gl-data/master/examples/screen-grid/uber-pickup-locations.json";
const HIGHWAY_ROADS_URL =
  "https://raw.githubusercontent.com/visgl/deck.gl-data/master/examples/highway/roads.json";
const HIGHWAY_ACCIDENTS_URL =
  "https://raw.githubusercontent.com/visgl/deck.gl-data/master/examples/highway/accidents.csv";
const TRIPS_DATA_URL =
  "https://raw.githubusercontent.com/visgl/deck.gl-data/master/examples/trips/trips-v7.json";
const PHOTON_SEARCH_URL = "https://photon.komoot.io/api/**";
const pickupFixture = Array.from({ length: 625 }, (_, index) => {
  const x = index % 25;
  const y = Math.floor(index / 25);
  return [-74.025 + x * 0.0015, 40.695 + y * 0.0015, 1 + ((x + y) % 8)];
});
const highwayFixture = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [-101.2, 38],
          [-98.8, 38.2],
        ],
      },
      properties: {
        state: "KS",
        type: "I",
        id: "70",
        name: "Interstate 70",
        length: 120,
      },
    },
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [-100.2, 36.8],
          [-99.7, 39.2],
        ],
      },
      properties: {
        state: "KS",
        type: "US",
        id: "83",
        name: "US Highway 83",
        length: 90,
      },
    },
  ],
};
const accidentFixture = [
  "state,type,id,year,incidents,fatalities",
  "KS,I,70,2015,24,9",
  "KS,US,83,2015,40,14",
  "KS,I,70,2010,18,6",
  "KS,US,83,2010,30,11",
].join("\n");
const tripsFixture = [
  {
    vendor: 0,
    path: [
      [-74.02, 40.7],
      [-74.005, 40.715],
      [-73.99, 40.73],
    ],
    timestamps: [0, 900, 1800],
  },
  {
    vendor: 1,
    path: [
      [-73.985, 40.7],
      [-74.0, 40.72],
      [-74.015, 40.735],
    ],
    timestamps: [0, 900, 1800],
  },
];

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
  await page.route(TRIPS_DATA_URL, async (route) => {
    // Keep the request pending across at least one animation frame. This
    // catches UI clocks that assume a selected layer has already loaded.
    await new Promise((resolve) => setTimeout(resolve, 50));
    await route.fulfill({ json: tripsFixture });
  });
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
              fog: string;
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
      fog: basemap.layerIds.fog,
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
  expect(result.ids.indexOf(result.labels)).toBeLessThan(
    result.ids.indexOf(result.fog),
  );
});

test("picks markers above overlapping data and emits data transitions", async ({
  page,
}) => {
  const generation = await page.evaluate(() => {
    const { map, basemap, diagnostics } = (
      window as typeof window & {
        __badMapDemo: {
          map: { getCenter(): { lng: number; lat: number } };
          diagnostics: { dataRenderEvents: number };
          basemap: {
            setFeatureInteractionEnabled(enabled: boolean): void;
            setProjectionMode(mode: "screen"): void;
            setDataLayer(layer: unknown): void;
            on(
              type: string,
              listener: (event: { feature: { layerId: string } }) => void,
            ): void;
          };
        };
        __dataEvents?: { enter: string[]; leave: string[]; click: string[] };
      }
    ).__badMapDemo;
    const events = {
      enter: [] as string[],
      leave: [] as string[],
      click: [] as string[],
    };
    (window as typeof window & { __dataEvents?: typeof events }).__dataEvents =
      events;
    basemap.setFeatureInteractionEnabled(true);
    basemap.setProjectionMode("screen");
    basemap.on("datafeatureenter", ({ feature }) =>
      events.enter.push(feature.layerId),
    );
    basemap.on("datafeatureleave", ({ feature }) =>
      events.leave.push(feature.layerId),
    );
    basemap.on("datafeatureclick", ({ feature }) =>
      events.click.push(feature.layerId),
    );
    const center = map.getCenter();
    basemap.setDataLayer({
      id: "overlap-point",
      type: "geojson",
      data: { type: "Point", coordinates: [center.lng, center.lat] },
      point: { radius: 16, color: [71, 184, 151] },
      order: 1,
    });
    basemap.setDataLayer({
      id: "overlap-marker",
      type: "waypoint",
      data: [{ position: [center.lng, center.lat] }],
      order: 2,
    });
    return diagnostics.dataRenderEvents;
  });
  await expect
    .poll(async () => (await diagnostics(page)).dataRenderEvents)
    .toBeGreaterThan(generation);

  const findMarker = () =>
    page.evaluate(() => {
      const { map, basemap } = (
        window as typeof window & {
          __badMapDemo: {
            map: {
              getCenter(): { lng: number; lat: number };
              project(point: { lng: number; lat: number }): {
                x: number;
                y: number;
              };
            };
            basemap: {
              queryDataFeatures(point: [number, number]): { layerId: string }[];
            };
          };
        }
      ).__badMapDemo;
      const projected = map.project(map.getCenter());
      for (let y = projected.y - 24; y <= projected.y + 24; y += 2)
        for (let x = projected.x - 24; x <= projected.x + 24; x += 2)
          if (
            basemap.queryDataFeatures([x, y])[0]?.layerId === "overlap-marker"
          )
            return { x, y };
      return null;
    });
  await expect.poll(findMarker).not.toBeNull();
  const hit = await findMarker();
  await page.mouse.move(hit!.x, hit!.y);
  await page.mouse.click(hit!.x, hit!.y);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as typeof window & { __dataEvents?: { enter: string[] } }
        ).__dataEvents?.enter.at(-1),
      ),
    )
    .toBe("overlap-marker");
  expect(
    await page.evaluate(() =>
      (
        window as typeof window & { __dataEvents?: { click: string[] } }
      ).__dataEvents?.click.at(-1),
    ),
  ).toBe("overlap-marker");

  const removalGeneration = (await diagnostics(page)).dataRenderEvents;
  await page.evaluate(() =>
    (
      window as typeof window & {
        __badMapDemo: { basemap: { removeDataLayer(id: string): void } };
      }
    ).__badMapDemo.basemap.removeDataLayer("overlap-marker"),
  );
  await expect
    .poll(async () => (await diagnostics(page)).dataRenderEvents)
    .toBeGreaterThan(removalGeneration);
  await page.mouse.move(8, 8);
  await page.mouse.move(hit!.x, hit!.y);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as typeof window & { __dataEvents?: { enter: string[] } }
        ).__dataEvents?.enter.at(-1),
      ),
    )
    .toBe("overlap-point");
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
  const toolbarBackgrounds = await page
    .locator("header, #feature-query-toggle, #place-search-toggle")
    .evaluateAll((elements) =>
      elements.map((element) => getComputedStyle(element).backgroundColor),
    );
  expect(new Set(toolbarBackgrounds)).toHaveProperty("size", 1);
  expect(toolbarBackgrounds[0]).not.toBe("rgba(0, 0, 0, 0)");
  await toggle.click();
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();
  const [expandedSearchBox, inputBox, expandedHeaderBox] = await Promise.all([
    page.locator("#place-search").boundingBox(),
    input.boundingBox(),
    page.locator("header").boundingBox(),
  ]);
  expect(expandedSearchBox).not.toBeNull();
  expect(inputBox).not.toBeNull();
  expect(expandedHeaderBox).not.toBeNull();
  expect(inputBox!.x).toBe(expandedSearchBox!.x);
  expect(inputBox!.x + inputBox!.width).toBe(
    expandedSearchBox!.x + expandedSearchBox!.width,
  );
  expect(inputBox!.y).toBe(expandedSearchBox!.y);
  expect(inputBox!.y).toBe(expandedHeaderBox!.y);
  expect(inputBox!.height).toBe(expandedHeaderBox!.height);
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
  await expect(page.locator(".maplibregl-marker")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const { basemap } = (
          window as typeof window & {
            __badMapDemo: {
              basemap: { getDataLayers(): { id: string; type: string }[] };
            };
          }
        ).__badMapDemo;
        return basemap
          .getDataLayers()
          .some(
            (layer) =>
              layer.id === "demo-search-waypoint" && layer.type === "waypoint",
          );
      }),
    )
    .toBe(true);
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

  await page.locator("#tab-data").click();
  await expect(
    page.locator("#panel-data section").first().locator("h2"),
  ).toHaveText("Waypoint");
  await expect(page.locator("#waypoint-style")).toHaveValue("locator");
  await expect(page.locator("#waypoint-size")).toHaveValue("24");
  await page.locator("#waypoint-style").selectOption("caret");
  await page.locator("#waypoint-size").fill("48");
  await expect(page.locator("#waypoint-size-value")).toHaveText("48");
  await expect(page.locator("#waypoint-status")).toContainText(
    "Amsterdam · down caret",
  );
  await expect(page.locator(".maplibregl-marker")).toHaveCount(0);

  await toggle.click();
  await page.locator("#place-search-clear").click();
  await expect(input).toBeHidden();
  await expect(page.locator(".maplibregl-marker")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const { basemap } = (
          window as typeof window & {
            __badMapDemo: {
              basemap: { getDataLayers(): { id: string }[] };
            };
          }
        ).__badMapDemo;
        return basemap
          .getDataLayers()
          .some((layer) => layer.id === "demo-search-waypoint");
      }),
    )
    .toBe(false);
});

test("keeps mouse feature queries off until cursor mode is enabled", async ({
  page,
}) => {
  const toggle = page.locator("#feature-query-toggle");
  const readout = page.locator("#readout");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(readout).toBeHidden();
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
  await expect(readout).toBeVisible();
  await expect(readout).toHaveText("Move over the map to inspect a feature.");
  const [readoutBox, toggleBox] = await Promise.all([
    readout.boundingBox(),
    toggle.boundingBox(),
  ]);
  expect(readoutBox).not.toBeNull();
  expect(toggleBox).not.toBeNull();
  expect(readoutBox!.height).toBe(toggleBox!.height);
  await page.mouse.move(point!.x + 20, point!.y + 20);
  await page.mouse.move(point!.x, point!.y);
  await expect
    .poll(async () => (await diagnostics(page)).featureEnterEvents)
    .toBeGreaterThan(0);

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(readout).toBeHidden();
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

test("configures fog from the side pane without worker rasterization", async ({
  page,
}) => {
  const mode = page.locator("#fog-mode");
  const color = page.locator("#fog-color");
  const themeColor = page.locator("#fog-theme-color");
  await expect(page.locator("#fog-toggle")).toHaveCount(0);
  await expect(mode).toHaveValue("dithered");
  await expect(page.locator("#fog-status")).toContainText("dithered");
  await expect(themeColor).toBeChecked();
  await expect(color).toHaveValue("#0f0f0f");

  const before = await diagnostics(page);
  await mode.selectOption("regular");
  await mode.selectOption("dithered");
  await page.locator("#fog-start").fill("0.35");
  await page.locator("#fog-end").fill("0.82");
  await color.fill("#5c6f91");
  await expect(themeColor).not.toBeChecked();
  await expect(page.locator("#fog-status")).toContainText(
    "dithered · 35–82% viewport depth · #5c6f91",
  );
  await page.waitForTimeout(100);
  const after = await diagnostics(page);
  expect(after.renderEvents).toBe(before.renderEvents);
  expect(after.lastGeneration).toBe(before.lastGeneration);
  expect(
    await page.evaluate(() =>
      (
        window as typeof window & {
          __badMapDemo: {
            basemap: {
              getFogOptions(): {
                visible: boolean;
                mode: string;
                color?: readonly number[];
              };
            };
          };
        }
      ).__badMapDemo.basemap.getFogOptions(),
    ),
  ).toMatchObject({
    visible: true,
    mode: "dithered",
    color: [92, 111, 145],
  });

  await themeColor.check();
  await expect(page.locator("#fog-status")).toContainText("theme color");
  expect(
    await page.evaluate(
      () =>
        (
          window as typeof window & {
            __badMapDemo: {
              basemap: { getFogOptions(): { color?: readonly number[] } };
            };
          }
        ).__badMapDemo.basemap.getFogOptions().color,
    ),
  ).toBeUndefined();

  await mode.selectOption("disabled");
  await expect(page.locator("#fog-status")).toHaveText("fog disabled");
  await mode.selectOption("regular");
  await expect(page.locator("#fog-status")).toContainText("regular");

  await page.locator("#projection").selectOption("screen");
  await expect(mode).toHaveValue("regular");
  await expect(page.locator("#fog-status")).toHaveText(
    "available in 3D surface mode",
  );
  await page.locator("#projection").selectOption("surface");
  await expect(mode).toHaveValue("regular");
  await expect(page.locator("#fog-status")).toContainText("regular");
});

test("configures the demo-only dithered screen vignette", async ({ page }) => {
  const canvas = page.locator("#screen-vignette");
  const enabled = page.locator("#vignette-enabled");
  const color = page.locator("#vignette-color");
  const themeColor = page.locator("#vignette-theme-color");
  await expect(enabled).toBeChecked();
  await expect(page.locator("#vignette-reach")).toHaveValue("0.32");
  await expect(page.locator("#vignette-falloff")).toHaveValue("linear");
  await expect(page.locator("#vignette-circularity")).toHaveValue("0.35");
  await expect(page.locator("#vignette-opacity")).toHaveValue("1");
  await expect(page.locator("#vignette-opacity-value")).toHaveText("100%");
  await expect(color).toHaveValue("#0f0f0f");
  await expect(themeColor).toBeChecked();
  await expect(page.locator("#vignette-status")).toHaveText(
    "gradual · 8×8 CSS-pixel dither · theme color · demo-only",
  );

  await expect
    .poll(() =>
      canvas.evaluate((element: HTMLCanvasElement) => {
        const context = element.getContext("2d")!;
        const corner = context.getImageData(0, 0, 1, 1).data[3]!;
        const center = context.getImageData(
          Math.floor(element.width / 2),
          Math.floor(element.height / 2),
          1,
          1,
        ).data[3]!;
        return { corner, center, width: element.width, height: element.height };
      }),
    )
    .toMatchObject({ corner: 255, center: 0, width: 960, height: 640 });

  const before = await diagnostics(page);
  await page.locator("#vignette-reach").fill("0.34");
  await page.locator("#vignette-falloff").selectOption("edge");
  await page.locator("#vignette-circularity").fill("0.8");
  await page.locator("#vignette-opacity").fill("0.6");
  await color.fill("#5c6f91");
  await expect(themeColor).not.toBeChecked();
  await expect(page.locator("#vignette-reach-value")).toHaveText("34%");
  await expect(page.locator("#vignette-circularity-value")).toHaveText("80%");
  await expect(page.locator("#vignette-opacity-value")).toHaveText("60%");
  await expect(page.locator("#vignette-status")).toContainText("edge weighted");
  await expect(page.locator("#vignette-status")).toContainText("#5c6f91");
  await expect
    .poll(() =>
      canvas.evaluate(
        (element: HTMLCanvasElement) =>
          element.getContext("2d")!.getImageData(0, 0, 1, 1).data[3],
      ),
    )
    .toBe(153);
  const customPixel = await canvas.evaluate((element: HTMLCanvasElement) =>
    Array.from(element.getContext("2d")!.getImageData(0, 0, 1, 1).data),
  );
  expect(Math.abs(customPixel[0]! - 92)).toBeLessThanOrEqual(1);
  expect(Math.abs(customPixel[1]! - 111)).toBeLessThanOrEqual(1);
  expect(Math.abs(customPixel[2]! - 145)).toBeLessThanOrEqual(1);
  await page.waitForTimeout(100);
  const after = await diagnostics(page);
  expect(after.renderEvents).toBe(before.renderEvents);
  expect(after.lastGeneration).toBe(before.lastGeneration);

  await page.locator("#theme").selectOption("light");
  await expect(color).toHaveValue("#5c6f91");
  await themeColor.check();
  await expect(color).not.toHaveValue("#5c6f91");
  await expect(page.locator("#vignette-status")).toContainText("theme color");

  await enabled.uncheck();
  await expect(canvas).toBeHidden();
  await expect(page.locator("#vignette-status")).toHaveText(
    "demo overlay disabled",
  );
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
    fog: "bad-map-fog",
    interaction: "bad-map-interaction",
  });
  expect(slots.packs).toEqual(
    expect.arrayContaining(["streets", "transit", "topographic"]),
  );
  expect(slots.packs).not.toContain("weather");
  expect(slots.labelsBillboard).toBe(true);
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
  await page.locator("#buildings-3d").check();
  await expect(page.locator("#projection")).toHaveValue("surface");
  const enabled = await page.evaluate(() => {
    const { map, basemap } = (
      window as typeof window & {
        __badMapDemo: {
          map: {
            getBearing(): number;
            getLayersOrder(): string[];
            getLayoutProperty(id: string, property: string): unknown;
            getPaintProperty(id: string, property: string): unknown;
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
      camera: { bearing: map.getBearing(), pitch: map.getPitch() },
    };
  });
  expect(enabled.requested).toBe(true);
  expect(enabled.visibility).toBe("visible");
  expect(enabled.color).toMatch(/^rgb/);
  expect(enabled.baseIndex).toBeLessThan(enabled.buildingIndex);
  expect(enabled.buildingIndex).toBeLessThan(enabled.dataIndex);
  expect(enabled.camera).toEqual(cameraBefore);

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
    .poll(async () => (await diagnostics(page)).dataRenderEvents)
    .toBeGreaterThan(before.dataRenderEvents);
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
    .poll(async () => (await diagnostics(page)).dataRenderEvents)
    .toBeGreaterThan(afterMode.dataRenderEvents);
  expect((await diagnostics(page)).heatmapEvents).toBeGreaterThan(
    before.heatmapEvents,
  );
});

test("lazy-loads and restyles the pixelated highway safety layer", async ({
  page,
}) => {
  const requestedBeforeActivation = await page.evaluate(
    ([roads, accidents]) =>
      performance
        .getEntriesByType("resource")
        .some((entry) => entry.name === roads || entry.name === accidents),
    [HIGHWAY_ROADS_URL, HIGHWAY_ACCIDENTS_URL],
  );
  expect(requestedBeforeActivation).toBe(false);

  let roadRequests = 0;
  let accidentRequests = 0;
  await page.route(HIGHWAY_ROADS_URL, (route) => {
    roadRequests += 1;
    return route.fulfill({ json: highwayFixture });
  });
  await page.route(HIGHWAY_ACCIDENTS_URL, (route) => {
    accidentRequests += 1;
    return route.fulfill({
      body: accidentFixture,
      contentType: "text/csv",
    });
  });

  await page.locator("#tab-data").click();
  const before = await diagnostics(page);
  await page.locator("#highway-mode").selectOption("lowres");
  await expect(page.locator("#highway-status")).toContainText("2 roads · 2015");
  expect(roadRequests).toBe(1);
  expect(accidentRequests).toBe(1);
  await expect
    .poll(async () => (await diagnostics(page)).dataRenderEvents)
    .toBeGreaterThan(before.dataRenderEvents);

  const layer = await page.evaluate(() =>
    (
      window as typeof window & {
        __badMapDemo: {
          basemap: {
            getDataLayers(): {
              id: string;
              type: string;
              featureCount: number;
            }[];
          };
        };
      }
    ).__badMapDemo.basemap
      .getDataLayers()
      .find((candidate) => candidate.id === "demo-highway-safety"),
  );
  expect(layer).toMatchObject({ type: "geojson", featureCount: 2 });

  const restyleGeneration = (await diagnostics(page)).dataRenderEvents;
  await page.locator("#highway-year").selectOption("2010");
  await page.locator("#highway-color").selectOption("incidents");
  await page.locator("#highway-width").selectOption("fatalities");
  await page.locator("#highway-opacity").fill("0.55");
  await expect(page.locator("#highway-status")).toContainText("2 roads · 2010");
  await expect
    .poll(async () => (await diagnostics(page)).dataRenderEvents)
    .toBeGreaterThan(restyleGeneration);

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
    .toBeCloseTo(-100, 1);
  const settledGeneration = (await diagnostics(page)).dataRenderEvents;
  await page.evaluate(() =>
    (
      window as typeof window & {
        __badMapDemo: { basemap: { refresh(): void } };
      }
    ).__badMapDemo.basemap.refresh(),
  );
  await expect
    .poll(async () => (await diagnostics(page)).dataRenderEvents)
    .toBeGreaterThan(settledGeneration);

  const hit = await page.evaluate(() => {
    const { basemap } = (
      window as typeof window & {
        __badMapDemo: {
          basemap: {
            queryDataFeatures(point: [number, number]): {
              properties: Record<string, unknown>;
            }[];
          };
        };
      }
    ).__badMapDemo;
    for (let y = 80; y < innerHeight - 40; y += 4)
      for (let x = 40; x < innerWidth - 360; x += 4) {
        const feature = basemap.queryDataFeatures([x, y])[0];
        if (feature?.properties.name)
          return { x, y, properties: feature.properties };
      }
    return null;
  });
  expect(hit?.properties).toMatchObject({
    state: "KS",
    incidents: expect.any(Number),
    fatalities: expect.any(Number),
  });
  await page.mouse.move(hit!.x, hit!.y);
  await expect(page.locator("#readout")).toContainText(/KS/);
  await expect(page.locator("#readout")).toContainText(/crashes/);
  await expect(page.locator("#readout")).toContainText(/fatalities/);
});

test("loads animated trips by default, then pauses, seeks, and restyles them", async ({
  page,
}) => {
  await page.locator("#tab-data").click();
  await expect(page.locator("#trips-mode")).toHaveValue("lowres");
  await expect(page.locator("#trips-status")).toContainText("2 animated trips");
  await expect(page.locator("#trips-opacity")).toHaveValue("1");
  await expect(page.locator("#trips-opacity-value")).toHaveText("1.00");
  expect(
    await page.evaluate(
      (url) =>
        performance
          .getEntriesByType("resource")
          .filter((entry) => entry.name === url).length,
      TRIPS_DATA_URL,
    ),
  ).toBe(1);

  const playback = () =>
    page.evaluate(() =>
      (
        window as typeof window & {
          __badMapDemo: {
            basemap: {
              getTripsPlayback(id: string): {
                playing: boolean;
                currentTime: number;
                speed: number;
                trailLength: number;
                loopLength: number;
              };
            };
          };
        }
      ).__badMapDemo.basemap.getTripsPlayback("demo-nyc-trips"),
    );
  const started = await playback();
  expect(started).toMatchObject({
    playing: true,
    speed: 1,
    trailLength: 180,
    loopLength: 1800,
  });
  await expect(page.locator("#trips-play")).toHaveAttribute(
    "aria-label",
    "Pause trips",
  );
  await expect(page.locator("#trips-play")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator("#trips-time-value")).toContainText("/ 1800");
  const sliderStarted = Number(await page.locator("#trips-time").inputValue());
  await expect
    .poll(async () => (await playback()).currentTime)
    .toBeGreaterThan(started.currentTime);
  await expect
    .poll(async () => Number(await page.locator("#trips-time").inputValue()))
    .toBeGreaterThan(sliderStarted);

  const latencyStatus = await page.locator("#status").textContent();
  const dataRenders = (await diagnostics(page)).dataRenderEvents;
  await page.evaluate(() =>
    (
      window as typeof window & {
        __badMapDemo: {
          basemap: { setDataLayer(layer: unknown): void };
        };
      }
    ).__badMapDemo.basemap.setDataLayer({
      id: "malformed-trip-check",
      type: "trips",
      data: [{ path: [[-74, 40.7]], timestamps: [] }],
      playing: false,
    }),
  );
  await expect
    .poll(async () => (await diagnostics(page)).dataRenderEvents)
    .toBeGreaterThan(dataRenders);
  await expect(page.locator("#status")).toHaveText(latencyStatus!);

  await page.locator("#trips-play").click();
  const paused = await playback();
  expect(paused.playing).toBe(false);
  await expect(page.locator("#trips-play")).toHaveAttribute(
    "aria-label",
    "Play trips",
  );
  await page.waitForTimeout(180);
  expect((await playback()).currentTime).toBeCloseTo(paused.currentTime, 5);

  await page.locator("#trips-time").fill("900");
  await page.locator("#trips-step-forward").click();
  expect(await playback()).toMatchObject({ playing: false, currentTime: 915 });
  await expect(page.locator("#trips-time-value")).toHaveText("915 / 1800");
  await page.locator("#trips-step-back").click();
  expect((await playback()).currentTime).toBe(900);
  await page.locator("#trips-time").focus();
  await page.keyboard.press("Shift+ArrowRight");
  expect((await playback()).currentTime).toBe(960);
  await page.keyboard.press("Home");
  expect((await playback()).currentTime).toBe(0);
  await page.keyboard.press("End");
  expect((await playback()).currentTime).toBe(1800);

  // A drag temporarily pauses playback and restores only a previously playing
  // timeline, matching video transport behavior.
  await page.locator("#trips-time").fill("900");
  await page.locator("#trips-play").click();
  await page.locator("#trips-time").dispatchEvent("pointerdown");
  expect((await playback()).playing).toBe(false);
  await page.locator("#trips-time").fill("720");
  await page.evaluate(() =>
    window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true })),
  );
  await expect.poll(async () => (await playback()).playing).toBe(true);
  await page.locator("#trips-play").click();
  await page.locator("#trips-time").dispatchEvent("pointerdown");
  await page.locator("#trips-time").fill("600");
  await page.evaluate(() =>
    window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true })),
  );
  expect(await playback()).toMatchObject({
    playing: false,
    currentTime: 600,
  });

  await page.locator("#trips-time").fill("900");
  await page.locator("#trips-speed").fill("2");
  await page.locator("#trips-trail").fill("240");
  await page.locator("#trips-width").fill("3");
  await page.locator("#trips-opacity").fill("0.45");
  expect(await playback()).toMatchObject({
    playing: false,
    currentTime: 900,
    speed: 2,
    trailLength: 240,
  });

  const beforeCamera = (await diagnostics(page)).dataRenderEvents;
  await page.evaluate(() => {
    const { map } = (
      window as typeof window & {
        __badMapDemo: {
          map: {
            jumpTo(options: unknown): void;
            resize(): void;
          };
        };
      }
    ).__badMapDemo;
    map.jumpTo({ bearing: 28, pitch: 40, zoom: 13.2 });
    map.resize();
  });
  await expect
    .poll(async () => (await diagnostics(page)).dataRenderEvents)
    .toBeGreaterThan(beforeCamera);
  await page.locator("#trips-play").click();
  await expect
    .poll(async () => (await playback()).currentTime)
    .toBeGreaterThan(900);
});

test("collapses the settings panel without hiding hover information", async ({
  page,
}) => {
  const readout = page.locator("#readout");
  const settings = page.locator("#settings");
  const header = page.locator("header");

  await expect(settings.locator("#readout")).toHaveCount(0);
  await page.locator("#feature-query-toggle").click();
  await expect(readout).toBeVisible();
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

  const [collapsedSettingsBox, settingsToggleBox] = await Promise.all([
    settings.boundingBox(),
    page.locator("#settings-toggle").boundingBox(),
  ]);
  expect(collapsedSettingsBox).not.toBeNull();
  expect(settingsToggleBox).not.toBeNull();
  expect(collapsedSettingsBox).toEqual(settingsToggleBox);

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
  await expect(page.locator("#labels")).not.toBeChecked();
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
