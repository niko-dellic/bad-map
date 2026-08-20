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

  await input.evaluate((element) => {
    const input = element as HTMLInputElement;
    input.value = "Am";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.value = "Amsterdam";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
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
