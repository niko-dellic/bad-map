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
  type Diagnostics,
} from "./demo-fixture";

setupDemoTests();

test("meets cached render and interaction baselines @performance", async ({
  page,
}) => {
  const cold = await diagnostics(page);
  await page.evaluate(() =>
    (
      window as typeof window & {
        __badMapDemo: { basemap: { refresh(): void } };
      }
    ).__badMapDemo.basemap.refresh(),
  );
  await expect
    .poll(async () => (await diagnostics(page)).lastGeneration)
    .toBeGreaterThan(cold.lastGeneration);

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
