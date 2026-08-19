import { expect, test } from "@playwright/test";

const UBER_DATA_URL =
  "https://raw.githubusercontent.com/visgl/deck.gl-data/master/examples/screen-grid/uber-pickup-locations.json";
const TRIPS_DATA_URL =
  "https://raw.githubusercontent.com/visgl/deck.gl-data/master/examples/trips/trips-v7.json";
const pickupFixture = Array.from({ length: 900 }, (_, index) => {
  const x = index % 30;
  const y = Math.floor(index / 30);
  const distance = Math.hypot(x - 15, y - 15);
  return [
    -74.025 + x * 0.00135,
    40.695 + y * 0.00135,
    Math.max(1, Math.round((12 - distance / 2) * 4)),
  ];
});
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
      [-74, 40.72],
      [-74.015, 40.735],
    ],
    timestamps: [0, 900, 1800],
  },
];

const prepareVisualPage = async (page: import("@playwright/test").Page) => {
  await page.route(TRIPS_DATA_URL, (route) =>
    route.fulfill({ json: tripsFixture }),
  );
  await page.goto("/");
  await expect(page.locator("#status")).toContainText("rendered in");
  await expect(page.locator("#trips-status")).toContainText("2 animated trips");
  await page.evaluate(() =>
    (
      window as typeof window & {
        __badMapDemo: {
          basemap: { setTripsPlayback(id: string, options: unknown): void };
        };
      }
    ).__badMapDemo.basemap.setTripsPlayback("demo-nyc-trips", {
      playing: false,
      currentTime: 900,
    }),
  );
};

test("matches settled city, theme, and greyscale baselines", async ({
  page,
}) => {
  await prepareVisualPage(page);
  await page.evaluate(() => {
    for (const element of document.querySelectorAll<HTMLElement>(
      "#top-bar, aside, #readout, nav, .maplibregl-control-container",
    ))
      element.style.display = "none";
    (
      window as typeof window & {
        __badMapDemo: { basemap: { setColorMode(mode: string): void } };
      }
    ).__badMapDemo.basemap.setColorMode("color");
  });

  await expect(page).toHaveScreenshot("nyc-dark.png", {
    animations: "disabled",
  });

  await page.evaluate(() => {
    const { basemap } = (
      window as typeof window & {
        __badMapDemo: { basemap: { setColorMode(mode: string): void } };
      }
    ).__badMapDemo;
    basemap.setColorMode("greyscale");
  });
  await expect(page).toHaveScreenshot("nyc-greyscale.png", {
    animations: "disabled",
  });

  await page.evaluate(() => {
    const { basemap } = (
      window as typeof window & {
        __badMapDemo: {
          basemap: {
            setColorMode(mode: string): void;
            setTheme(theme: string): void;
          };
        };
      }
    ).__badMapDemo;
    basemap.setColorMode("color");
    basemap.setTheme("light");
  });
  await expect(page).toHaveScreenshot("nyc-light.png", {
    animations: "disabled",
  });

  const generation = await page.evaluate(() => {
    const demo = (
      window as typeof window & {
        __badMapDemo: {
          map: { jumpTo(options: unknown): void };
          basemap: {
            setTheme(theme: string): void;
          };
          diagnostics: { lastGeneration: number };
        };
      }
    ).__badMapDemo;
    demo.basemap.setTheme("dark");
    const previousGeneration = demo.diagnostics.lastGeneration;
    demo.map.jumpTo({ center: [-122.6765, 45.5231], zoom: 13.8 });
    return previousGeneration;
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              __badMapDemo: { diagnostics: { lastGeneration: number } };
            }
          ).__badMapDemo.diagnostics.lastGeneration,
      ),
    )
    .toBeGreaterThan(generation);
  await expect(page).toHaveScreenshot("portland-dark.png", {
    animations: "disabled",
  });
});

test("matches retina dark and greyscale baselines", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 960, height: 640 },
    deviceScaleFactor: 2,
    colorScheme: "dark",
  });
  const page = await context.newPage();
  await prepareVisualPage(page);
  await page.evaluate(() => {
    for (const element of document.querySelectorAll<HTMLElement>(
      "#top-bar, aside, #readout, nav, .maplibregl-control-container",
    ))
      element.style.display = "none";
    (
      window as typeof window & {
        __badMapDemo: { basemap: { setColorMode(mode: string): void } };
      }
    ).__badMapDemo.basemap.setColorMode("color");
  });
  await expect(page).toHaveScreenshot("nyc-dark-retina.png", {
    animations: "disabled",
  });
  await page.evaluate(() =>
    (
      window as typeof window & {
        __badMapDemo: { basemap: { setColorMode(mode: string): void } };
      }
    ).__badMapDemo.basemap.setColorMode("greyscale"),
  );
  await expect(page).toHaveScreenshot("nyc-greyscale-retina.png", {
    animations: "disabled",
  });
  await context.close();
});

test("matches the experimental pitched surface baseline", async ({ page }) => {
  await prepareVisualPage(page);
  const generation = await page.evaluate(() => {
    for (const element of document.querySelectorAll<HTMLElement>(
      "#top-bar, aside, #readout, nav, .maplibregl-control-container",
    ))
      element.style.display = "none";
    const demo = (
      window as typeof window & {
        __badMapDemo: {
          map: { jumpTo(options: unknown): void };
          basemap: {
            setProjectionMode(mode: string): {
              setCamera(options: unknown): void;
            };
            setBuildings3DVisible(visible: boolean): void;
          };
          diagnostics: { lastGeneration: number };
        };
      }
    ).__badMapDemo;
    demo.basemap
      .setProjectionMode("surface")
      .setCamera({ rotation: true, pitch: true, maxPitch: 70 });
    demo.basemap.setBuildings3DVisible(true);
    const previousGeneration = demo.diagnostics.lastGeneration;
    demo.map.jumpTo({ bearing: 18, pitch: 45 });
    return previousGeneration;
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              __badMapDemo: { diagnostics: { lastGeneration: number } };
            }
          ).__badMapDemo.diagnostics.lastGeneration,
      ),
    )
    .toBeGreaterThan(generation);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as typeof window & {
            __badMapDemo: { map: { areTilesLoaded(): boolean } };
          }
        ).__badMapDemo.map.areTilesLoaded(),
      ),
    )
    .toBe(true);
  await expect(page).toHaveScreenshot("nyc-surface.png", {
    animations: "disabled",
  });

  const maxPitchGeneration = await page.evaluate(() => {
    const demo = (
      window as typeof window & {
        __badMapDemo: {
          map: { jumpTo(options: unknown): void };
          basemap: { setBuildings3DVisible(visible: boolean): void };
          diagnostics: { lastGeneration: number };
        };
      }
    ).__badMapDemo;
    demo.basemap.setBuildings3DVisible(false);
    const previousGeneration = demo.diagnostics.lastGeneration;
    demo.map.jumpTo({ pitch: 70 });
    return previousGeneration;
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              __badMapDemo: { diagnostics: { lastGeneration: number } };
            }
          ).__badMapDemo.diagnostics.lastGeneration,
      ),
    )
    .toBeGreaterThan(maxPitchGeneration);
  await expect(page).toHaveScreenshot("nyc-surface-max-pitch.png", {
    animations: "disabled",
  });
});

test("matches regular and dithered fog at maximum pitch", async ({ page }) => {
  await prepareVisualPage(page);
  const generation = await page.evaluate(() => {
    for (const element of document.querySelectorAll<HTMLElement>(
      "#top-bar, aside, #readout, nav, .maplibregl-control-container",
    ))
      element.style.display = "none";
    const demo = (
      window as typeof window & {
        __badMapDemo: {
          map: { jumpTo(options: unknown): void };
          basemap: {
            setFog(options: unknown): void;
          };
          diagnostics: { lastGeneration: number };
        };
      }
    ).__badMapDemo;
    demo.basemap.setFog({ visible: true, mode: "regular" });
    const previousGeneration = demo.diagnostics.lastGeneration;
    demo.map.jumpTo({ bearing: 18, pitch: 70 });
    return previousGeneration;
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              __badMapDemo: { diagnostics: { lastGeneration: number } };
            }
          ).__badMapDemo.diagnostics.lastGeneration,
      ),
    )
    .toBeGreaterThan(generation);
  await expect(page).toHaveScreenshot("nyc-fog-regular.png", {
    animations: "disabled",
  });

  await page.evaluate(() =>
    (
      window as typeof window & {
        __badMapDemo: { basemap: { setFog(options: unknown): void } };
      }
    ).__badMapDemo.basemap.setFog({ mode: "dithered" }),
  );
  await expect(page).toHaveScreenshot("nyc-fog-dithered.png", {
    animations: "disabled",
  });
});

test("keeps dithered fog stable on retina displays", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 960, height: 640 },
    deviceScaleFactor: 2,
    colorScheme: "dark",
  });
  const page = await context.newPage();
  await prepareVisualPage(page);
  const generation = await page.evaluate(() => {
    for (const element of document.querySelectorAll<HTMLElement>(
      "#top-bar, aside, #readout, nav, .maplibregl-control-container",
    ))
      element.style.display = "none";
    const demo = (
      window as typeof window & {
        __badMapDemo: {
          map: { jumpTo(options: unknown): void };
          basemap: { setFog(options: unknown): void };
          diagnostics: { lastGeneration: number };
        };
      }
    ).__badMapDemo;
    demo.basemap.setFog({ visible: true, mode: "dithered" });
    const previousGeneration = demo.diagnostics.lastGeneration;
    demo.map.jumpTo({ bearing: 18, pitch: 70 });
    return previousGeneration;
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              __badMapDemo: { diagnostics: { lastGeneration: number } };
            }
          ).__badMapDemo.diagnostics.lastGeneration,
      ),
    )
    .toBeGreaterThan(generation);
  await expect(page).toHaveScreenshot("nyc-fog-dithered-retina.png", {
    animations: "disabled",
  });
  await context.close();
});

test("matches the low-resolution pickup heatmap baseline", async ({ page }) => {
  await page.route(UBER_DATA_URL, (route) =>
    route.fulfill({ json: pickupFixture }),
  );
  await prepareVisualPage(page);
  const generation = await page.evaluate(() => {
    const demo = (
      window as typeof window & {
        __badMapDemo: { diagnostics: { dataRenderEvents: number } };
      }
    ).__badMapDemo;
    return demo.diagnostics.dataRenderEvents;
  });
  await page.locator("#tab-data").click();
  await page.locator("#heatmap-mode").selectOption("lowres");
  await expect(page.locator("#heatmap-status")).toContainText(
    "weighted pickups · lowres",
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              __badMapDemo: { diagnostics: { dataRenderEvents: number } };
            }
          ).__badMapDemo.diagnostics.dataRenderEvents,
      ),
    )
    .toBeGreaterThan(generation);
  await page.evaluate(() => {
    for (const element of document.querySelectorAll<HTMLElement>(
      "#top-bar, aside, #readout, nav, .maplibregl-control-container",
    ))
      element.style.display = "none";
  });
  await expect(page).toHaveScreenshot("nyc-lowres-heatmap.png", {
    animations: "disabled",
  });
});

test("matches waypoint, GeoJSON, and frozen trip data baselines", async ({
  page,
}) => {
  await prepareVisualPage(page);
  const generation = await page.evaluate(() => {
    const { map, basemap, diagnostics } = (
      window as typeof window & {
        __badMapDemo: {
          map: { jumpTo(options: unknown): void };
          diagnostics: { dataRenderEvents: number };
          basemap: {
            setProjectionMode(mode: "screen"): void;
            setDataLayer(layer: unknown): void;
          };
        };
      }
    ).__badMapDemo;
    basemap.setProjectionMode("screen");
    map.jumpTo({ center: [-74.006, 40.715], zoom: 13.5, pitch: 0, bearing: 0 });
    basemap.setDataLayer({
      id: "visual-geometry",
      type: "geojson",
      order: 10,
      data: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [-74.024, 40.706],
                  [-74.014, 40.706],
                  [-74.014, 40.716],
                  [-74.024, 40.716],
                  [-74.024, 40.706],
                ],
                [
                  [-74.021, 40.709],
                  [-74.017, 40.709],
                  [-74.017, 40.713],
                  [-74.021, 40.713],
                  [-74.021, 40.709],
                ],
              ],
            },
          },
          {
            type: "Feature",
            properties: {},
            geometry: { type: "Point", coordinates: [-73.99, 40.718] },
          },
          {
            type: "Feature",
            properties: {},
            geometry: {
              type: "LineString",
              coordinates: [
                [-74.022, 40.727],
                [-73.992, 40.704],
              ],
            },
          },
        ],
      },
      point: { color: [239, 178, 75], radius: 8 },
      line: { color: [133, 230, 202], width: 6 },
      fill: {
        color: [71, 184, 151],
        opacity: 0.55,
        outlineColor: [133, 230, 202],
        outlineWidth: 4,
      },
    });
    basemap.setDataLayer({
      id: "visual-trip",
      type: "trips",
      order: 20,
      playing: false,
      currentTime: 900,
      trailLength: 420,
      width: 4,
      data: [
        {
          path: [
            [-74.02, 40.7],
            [-74.005, 40.715],
            [-73.99, 40.73],
          ],
          timestamps: [0, 900, 1800],
          color: [253, 128, 93],
        },
      ],
    });
    basemap.setDataLayer({
      id: "visual-waypoint",
      type: "waypoint",
      order: 30,
      data: [
        { position: [-74.006, 40.715], style: "locator" },
        { position: [-73.99, 40.708], style: "caret", size: 32 },
      ],
      color: [255, 102, 136],
      haloColor: [15, 17, 20],
      size: 24,
    });
    return diagnostics.dataRenderEvents;
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              __badMapDemo: { diagnostics: { dataRenderEvents: number } };
            }
          ).__badMapDemo.diagnostics.dataRenderEvents,
      ),
    )
    .toBeGreaterThan(generation);
  await page.evaluate(() => {
    for (const element of document.querySelectorAll<HTMLElement>(
      "#top-bar, aside, #readout, nav, .maplibregl-control-container",
    ))
      element.style.display = "none";
  });
  await expect(page).toHaveScreenshot("nyc-pixelated-data.png", {
    animations: "disabled",
  });
});

test("matches the quantized highway path baseline", async ({ page }) => {
  await prepareVisualPage(page);
  const generation = await page.evaluate(() => {
    const { map, basemap, diagnostics } = (
      window as typeof window & {
        __badMapDemo: {
          map: { jumpTo(options: unknown): void };
          diagnostics: { dataRenderEvents: number };
          basemap: {
            setProjectionMode(mode: "screen"): void;
            setDataLayer(layer: unknown): void;
          };
        };
      }
    ).__badMapDemo;
    basemap.setProjectionMode("screen");
    map.jumpTo({ center: [-100, 38], zoom: 4, pitch: 0, bearing: 0 });
    basemap.setDataLayer({
      id: "visual-highways",
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: {
              type: "LineString",
              coordinates: [
                [-112, 34],
                [-104, 39],
                [-94, 40],
                [-86, 36],
              ],
            },
          },
          {
            type: "Feature",
            properties: {},
            geometry: {
              type: "LineString",
              coordinates: [
                [-107, 45],
                [-100, 38],
                [-96, 30],
              ],
            },
          },
        ],
      },
      opacity: 0.9,
      line: { color: [244, 109, 67], width: 12 },
    });
    return diagnostics.dataRenderEvents;
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              __badMapDemo: { diagnostics: { dataRenderEvents: number } };
            }
          ).__badMapDemo.diagnostics.dataRenderEvents,
      ),
    )
    .toBeGreaterThan(generation);
  await page.evaluate(() => {
    for (const element of document.querySelectorAll<HTMLElement>(
      "#top-bar, aside, #readout, nav, .maplibregl-control-container",
    ))
      element.style.display = "none";
  });
  await expect(page).toHaveScreenshot("us-highway-data.png", {
    animations: "disabled",
  });
});
