import { expect, test } from "@playwright/test";

const UBER_DATA_URL =
  "https://raw.githubusercontent.com/visgl/deck.gl-data/master/examples/screen-grid/uber-pickup-locations.json";
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

test("matches settled city, theme, and greyscale baselines", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#status")).toContainText("rendered in");
  await page.evaluate(() => {
    for (const element of document.querySelectorAll<HTMLElement>(
      "header, aside, #readout, nav, .maplibregl-control-container",
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
  await page.goto("/");
  await expect(page.locator("#status")).toContainText("rendered in");
  await page.evaluate(() => {
    for (const element of document.querySelectorAll<HTMLElement>(
      "header, aside, #readout, nav, .maplibregl-control-container",
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
  await page.goto("/");
  await expect(page.locator("#status")).toContainText("rendered in");
  const generation = await page.evaluate(() => {
    for (const element of document.querySelectorAll<HTMLElement>(
      "header, aside, #readout, nav, .maplibregl-control-container",
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
});

test("matches the low-resolution pickup heatmap baseline", async ({ page }) => {
  await page.route(UBER_DATA_URL, (route) =>
    route.fulfill({ json: pickupFixture }),
  );
  await page.goto("/");
  await expect(page.locator("#status")).toContainText("rendered in");
  const generation = await page.evaluate(() => {
    const demo = (
      window as typeof window & {
        __badMapDemo: { diagnostics: { lastGeneration: number } };
      }
    ).__badMapDemo;
    return demo.diagnostics.lastGeneration;
  });
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
              __badMapDemo: { diagnostics: { lastGeneration: number } };
            }
          ).__badMapDemo.diagnostics.lastGeneration,
      ),
    )
    .toBeGreaterThan(generation);
  await page.evaluate(() => {
    for (const element of document.querySelectorAll<HTMLElement>(
      "header, aside, #readout, nav, .maplibregl-control-container",
    ))
      element.style.display = "none";
  });
  await expect(page).toHaveScreenshot("nyc-lowres-heatmap.png", {
    animations: "disabled",
  });
});
