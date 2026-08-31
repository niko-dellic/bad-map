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

setupDemoTests();

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
  await page.locator("#tab-fx").click();
  const canvas = page.locator("#screen-vignette");
  const enabled = page.locator("#vignette-enabled");
  const color = page.locator("#vignette-color");
  const themeColor = page.locator("#vignette-theme-color");
  await expect(enabled).toBeChecked();
  await expect(page.locator("#vignette-reach")).toHaveValue("0.32");
  await expect(page.locator("#vignette-falloff")).toHaveValue("linear");
  await expect(page.locator("#vignette-base")).toHaveValue("rectangle");
  await expect(page.locator("#vignette-circularity")).toHaveValue("0.35");
  await expect(page.locator("#vignette-opacity")).toHaveValue("1");
  await expect(page.locator("#vignette-opacity-value")).toHaveText("100%");
  await expect(color).toHaveValue("#0f0f0f");
  await expect(themeColor).toBeChecked();
  await expect(page.locator("#vignette-status")).toHaveText(
    "linear · rectangle base · 8×8 CSS-pixel dither · theme color",
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
  await page.locator("#vignette-reach").fill("0.5");
  await page.locator("#vignette-circularity").fill("0");
  await expect
    .poll(() =>
      canvas.evaluate(
        (element: HTMLCanvasElement) =>
          element.getContext("2d")!.getImageData(780, 320, 1, 1).data[3],
      ),
    )
    .toBe(255);
  await page.locator("#vignette-reach").fill("0.34");
  await page.locator("#vignette-falloff").selectOption("edge");
  await page.locator("#vignette-base").selectOption("oval");
  await page.locator("#vignette-circularity").fill("0.8");
  await page.locator("#vignette-opacity").fill("0.6");
  await color.fill("#5c6f91");
  await expect(themeColor).not.toBeChecked();
  await expect(page.locator("#vignette-reach-value")).toHaveText("34%");
  await expect(page.locator("#vignette-circularity-value")).toHaveText("80%");
  await expect(page.locator("#vignette-opacity-value")).toHaveText("60%");
  await expect(page.locator("#vignette-status")).toContainText("edge weighted");
  await expect(page.locator("#vignette-status")).toContainText("oval base");
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

  await page.locator("#tab-display").click();
  await page.locator("#theme").selectOption("light");
  await expect(color).toHaveValue("#5c6f91");
  await page.locator("#tab-fx").click();
  await themeColor.check();
  await expect(color).not.toHaveValue("#5c6f91");
  await expect(page.locator("#vignette-status")).toContainText("theme color");

  await enabled.uncheck();
  await expect(canvas).toBeHidden();
  await expect(page.locator("#vignette-status")).toHaveText("overlay disabled");
});

test("configures the demo-only fisheye screen pass", async ({ page }) => {
  await page.locator("#tab-fx").click();
  const enabled = page.locator("#fisheye-enabled");
  await expect(enabled).toBeChecked();
  await expect(page.locator("#fisheye-k1")).toHaveValue("-0.35");
  await expect(page.locator("#fisheye-k2")).toHaveValue("0");
  await expect(page.locator("#fisheye-strength")).toHaveValue("1.33");
  await expect(page.locator("#fisheye-radius")).toHaveValue("1");
  await expect(page.locator("#fisheye-status")).toHaveText(
    "broad -0.35 · edge 0.00 · strength 1.33",
  );

  const before = await diagnostics(page);
  await enabled.uncheck();
  await expect(page.locator("#fisheye-status")).toHaveText("effect disabled");
  await page.waitForTimeout(100);
  const undistorted = await page.screenshot({
    clip: { x: 100, y: 100, width: 400, height: 400 },
  });
  await enabled.check();
  await page.locator("#fisheye-k1").fill("-0.6");
  await page.locator("#fisheye-k2").fill("-0.25");
  await page.locator("#fisheye-strength").fill("1.4");
  await page.locator("#fisheye-radius").fill("1.25");
  await expect(page.locator("#fisheye-k1-value")).toHaveText("-0.60");
  await expect(page.locator("#fisheye-k2-value")).toHaveText("-0.25");
  await expect(page.locator("#fisheye-strength-value")).toHaveText("1.40");
  await expect(page.locator("#fisheye-radius-value")).toHaveText("125%");
  await expect(page.locator("#fisheye-status")).toHaveText(
    "broad -0.60 · edge -0.25 · strength 1.40",
  );
  expect(
    await page.evaluate(() => {
      const { map, basemap, fisheye } = (
        window as typeof window & {
          __badMapDemo: {
            map: { getLayer(id: string): unknown };
            basemap: { layerIds: { interaction: string } };
            fisheye: {
              id: string;
              getOptions(): Record<string, number | boolean>;
            };
          };
        }
      ).__badMapDemo;
      return {
        options: fisheye.getOptions(),
        layersPresent:
          Boolean(map.getLayer(fisheye.id)) &&
          Boolean(map.getLayer(basemap.layerIds.interaction)),
      };
    }),
  ).toEqual({
    options: {
      enabled: true,
      k1: -0.6,
      k2: -0.25,
      strength: 1.4,
      radius: 1.25,
    },
    layersPresent: true,
  });
  await page.waitForTimeout(100);
  const distorted = await page.screenshot({
    clip: { x: 100, y: 100, width: 400, height: 400 },
  });
  expect(distorted.equals(undistorted)).toBe(false);
  const after = await diagnostics(page);
  expect(after.renderEvents).toBe(before.renderEvents);
  expect(after.lastGeneration).toBe(before.lastGeneration);
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

test("auto-rotates from the camera control and Shift+R", async ({ page }) => {
  const toggle = page.locator("#auto-rotate");
  const bearing = page.locator("#bearing");

  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(toggle).toHaveAttribute("aria-keyshortcuts", "Shift+R");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(toggle).toHaveText("stop auto-rotate");
  await expect
    .poll(async () => Math.abs(Number(await bearing.inputValue())))
    .toBeGreaterThan(0);

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  const stoppedBearing = Number(await bearing.inputValue());
  await page.waitForTimeout(200);
  expect(Number(await bearing.inputValue())).toBeCloseTo(stoppedBearing, 5);

  await page.keyboard.press("Shift+R");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Shift+R");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
});

test("hides and restores every map UI overlay", async ({ page }) => {
  const app = page.locator("#app");
  const toggle = page.locator("#ui-visibility-toggle");
  const credits = page.locator(".maplibregl-ctrl-attrib");

  await page.locator("#feature-query-toggle").click();
  await expect(page.locator("#readout")).toBeVisible();
  await expect(credits).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-keyshortcuts", "Shift+H");

  await toggle.click();
  await expect(app).toHaveClass(/is-ui-hidden/);
  await expect(page.locator("#top-bar")).toBeHidden();
  await expect(page.locator("#readout")).toBeHidden();
  await expect(page.locator("#settings")).toBeHidden();
  await expect(credits).toBeHidden();

  await page.keyboard.press("Shift+H");
  await expect(app).not.toHaveClass(/is-ui-hidden/);
  await expect(page.locator("#top-bar")).toBeVisible();
  await expect(page.locator("#readout")).toBeVisible();
  await expect(page.locator("#settings")).toBeVisible();
  await expect(credits).toBeVisible();
});

test("toggles fullscreen with Shift+F", async ({ page }) => {
  await page.keyboard.press("Shift+F");
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement?.id))
    .toBe("app");

  await page.keyboard.press("Shift+F");
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement))
    .toBeNull();
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
    ["#tab-fx", "Screen effects"],
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
  await expect(page.locator("#panel-fx")).toBeHidden();
  await expect(page.locator("#panel-data")).toBeHidden();
  await page.locator("#tab-fx").click();
  await expect(page.locator("#panel-fx")).toBeVisible();
  await expect(page.locator("#vignette-enabled")).toBeVisible();
  await expect(
    page.locator("#vignette-enabled").locator("xpath=ancestor::section/h2"),
  ).toHaveText("Screen vignette");
  await page.locator("#tab-layers").click();
  await expect(page.locator("#panel-layers")).toBeVisible();
  await expect(page.locator("#labels")).not.toBeChecked();
  for (const control of ["#labels", "#buildings-3d"]) {
    await expect(
      page.locator(control).locator("xpath=ancestor::section/h2"),
    ).toHaveText("Map layers");
  }
  await expect(page.locator("#building-fill")).toBeChecked();
  await expect(page.locator("#building-dots")).not.toBeChecked();
  await expect(page.locator("#building-edges")).toBeChecked();
  await page.locator("#building-fill").uncheck();
  await page.locator("#building-edge-strength").fill("1.5");
  await page.locator("#building-height").fill("1.25");
  await expect(page.locator("#building-style-status")).toHaveText("edge ink");
  expect(
    await page.evaluate(() =>
      (
        window as typeof window & {
          __badMapDemo: {
            basemap: {
              getBuildings3DAppearance(): Record<string, number | boolean>;
            };
          };
        }
      ).__badMapDemo.basemap.getBuildings3DAppearance(),
    ),
  ).toEqual({
    fill: false,
    dots: false,
    edges: true,
    edgeStrength: 1.5,
    heightScale: 1.25,
  });
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
