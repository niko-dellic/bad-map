import { expect, test } from "@playwright/test";

interface Diagnostics {
  renderEvents: number;
  styleEvents: number;
  lastGeneration: number;
  lastDurationMs: number;
  generations: number[];
}

async function diagnostics(page: import("@playwright/test").Page) {
  return page.evaluate<Diagnostics>(() =>
    structuredClone(
      (window as typeof window & { __badMapDemo: { diagnostics: Diagnostics } })
        .__badMapDemo.diagnostics,
    ),
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#status")).toContainText("rendered in");
});

test("orders native visualization data between base and labels", async ({
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
          basemap: { layerIds: { base: string; labels: string } };
        };
      }
    ).__badMapDemo;
    const ids = map.getLayersOrder();
    return {
      ids,
      base: basemap.layerIds.base,
      labels: basemap.layerIds.labels,
      hasBase: Boolean(map.getLayer(basemap.layerIds.base)),
      hasLabels: Boolean(map.getLayer(basemap.layerIds.labels)),
    };
  });
  expect(result.hasBase).toBe(true);
  expect(result.hasLabels).toBe(true);
  expect(result.ids.indexOf(result.base)).toBeLessThan(
    result.ids.indexOf("demo-points"),
  );
  expect(result.ids.indexOf("demo-points")).toBeLessThan(
    result.ids.indexOf(result.labels),
  );
});

test("toggles greyscale without worker rasterization or overlay recoloring", async ({
  page,
}) => {
  const before = await diagnostics(page);
  await page.locator("#color-mode").click();
  await expect(page.locator("#color-mode")).toHaveText("greyscale");
  await page.waitForTimeout(150);
  const after = await diagnostics(page);
  expect(after.styleEvents).toBe(before.styleEvents + 1);
  expect(after.renderEvents).toBe(before.renderEvents);
  expect(after.lastGeneration).toBe(before.lastGeneration);
  const overlayColor = await page.evaluate(() =>
    (
      window as typeof window & {
        __badMapDemo: {
          map: { getPaintProperty(id: string, property: string): unknown };
        };
      }
    ).__badMapDemo.map.getPaintProperty("demo-points", "circle-color"),
  );
  expect(overlayColor).toBe("#ff6688");
});

test("exposes stable slots and switches between bearing and surface cameras", async ({
  page,
}) => {
  const slots = await page.evaluate(() => {
    const { map, basemap } = (
      window as typeof window & {
        __badMapDemo: {
          map: { getLayer(id: string): unknown };
          basemap: {
            layerIds: Record<string, string>;
            getLayers(): { id: string }[];
          };
        };
      }
    ).__badMapDemo;
    return {
      ids: basemap.layerIds,
      present: Object.values(basemap.layerIds).every((id) => map.getLayer(id)),
      packs: basemap.getLayers().map((pack) => pack.id),
    };
  });
  expect(slots.present).toBe(true);
  expect(slots.ids).toMatchObject({
    data: "bad-map-data",
    markers: "bad-map-markers",
    interaction: "bad-map-interaction",
  });
  expect(slots.packs).toEqual(
    expect.arrayContaining(["streets", "transit", "weather"]),
  );

  await page.locator("#rotation").check();
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
  await expect(readout).toBeVisible();

  await page.locator("#settings-toggle").click();
  await expect(settings).not.toHaveClass(/is-collapsed/);
  await expect(settings.locator("section").first()).toBeVisible();
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
