import { expect, test } from "@playwright/test";

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
    demo.map.jumpTo({ center: [-122.6765, 45.5231], zoom: 13.8 });
    return demo.diagnostics.lastGeneration;
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
          };
          diagnostics: { lastGeneration: number };
        };
      }
    ).__badMapDemo;
    demo.basemap
      .setProjectionMode("surface")
      .setCamera({ rotation: true, pitch: true, maxPitch: 70 });
    demo.map.jumpTo({ bearing: 18, pitch: 45 });
    return demo.diagnostics.lastGeneration;
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
  await expect(page).toHaveScreenshot("nyc-surface.png", {
    animations: "disabled",
  });
});
