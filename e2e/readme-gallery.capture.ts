import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const galleryDirectory = resolve("docs/media/gallery");

interface CameraOptions {
  center: [number, number];
  zoom: number;
  bearing?: number;
  pitch?: number;
}

interface ScenarioOptions {
  camera: CameraOptions;
  theme?: "dark" | "light";
  colorMode?: "greyscale" | "color";
  labels?: boolean;
  cell?: { width: number; height: number; dotSize: number };
  packs?: readonly string[];
  buildings?: boolean;
}

interface DemoHandles {
  map: {
    areTilesLoaded(): boolean;
    jumpTo(options: CameraOptions): void;
    stop(): void;
  };
  basemap: {
    clearDataLayers(): unknown;
    clearHeatmap(): unknown;
    getLayers(): { id: string; enabled?: boolean }[];
    refresh(): unknown;
    setBuildings3DVisible(visible: boolean): unknown;
    setCamera(options: unknown): unknown;
    setCell(options: unknown): unknown;
    setColorMode(mode: string): unknown;
    setDataLayer(layer: unknown): unknown;
    setFogVisible(visible: boolean): unknown;
    setLabelsVisible(visible: boolean): unknown;
    setLayerVisible(id: string, visible: boolean): unknown;
    setProjectionMode(mode: string): unknown;
    setTheme(theme: string): unknown;
    setTripsPlayback(id: string, playback: unknown): unknown;
  };
  fisheye: { setOptions(options: unknown): void };
  diagnostics: {
    lastGeneration: number;
    dataRenderEvents: number;
  };
}

const waitForSemanticFrame = async (page: Page, generation: number) => {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __badMapDemo: DemoHandles }).__badMapDemo
            .diagnostics.lastGeneration,
      ),
    )
    .toBeGreaterThan(generation);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as { __badMapDemo: DemoHandles }
        ).__badMapDemo.map.areTilesLoaded(),
      ),
    )
    .toBe(true);
  await page.evaluate(
    () =>
      new Promise<void>((resolveFrame) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => resolveFrame()),
        ),
      ),
  );
  await page.waitForTimeout(250);
};

const waitForDataFrame = async (page: Page, dataRenderEvents: number) => {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __badMapDemo: DemoHandles }).__badMapDemo
            .diagnostics.dataRenderEvents,
      ),
    )
    .toBeGreaterThan(dataRenderEvents);
  await page.evaluate(
    () =>
      new Promise<void>((resolveFrame) =>
        requestAnimationFrame(() => resolveFrame()),
      ),
  );
};

const selectHiddenOption = async (
  page: Page,
  selector: string,
  value: string,
) => {
  await page.locator(selector).evaluate((element, nextValue) => {
    const select = element as HTMLSelectElement;
    select.value = nextValue;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
};

const resetScenario = async (page: Page, options: ScenarioOptions) => {
  return page.evaluate((scenario) => {
    const handles = (window as unknown as { __badMapDemo: DemoHandles })
      .__badMapDemo;
    const { map, basemap } = handles;
    const visiblePacks = new Set(scenario.packs ?? ["streets"]);

    basemap.clearDataLayers();
    basemap.clearHeatmap();
    basemap.setFogVisible(false);
    basemap.setBuildings3DVisible(false);
    basemap.setProjectionMode("surface");
    basemap.setCamera({ rotation: true, pitch: true, maxPitch: 70 });
    basemap.setTheme(scenario.theme ?? "dark");
    basemap.setColorMode(scenario.colorMode ?? "greyscale");
    basemap.setLabelsVisible(scenario.labels ?? false);
    basemap.setCell(scenario.cell ?? { width: 8, height: 16, dotSize: 2 });
    for (const layer of basemap.getLayers())
      basemap.setLayerVisible(layer.id, visiblePacks.has(layer.id));
    basemap.setBuildings3DVisible(scenario.buildings ?? false);

    for (const id of ["heatmap-mode", "highway-mode", "trips-mode"]) {
      const select = document.querySelector<HTMLSelectElement>(`#${id}`);
      if (select) select.value = "off";
    }

    handles.fisheye.setOptions({ enabled: false });
    const vignette = document.querySelector<HTMLElement>("#screen-vignette");
    if (vignette) vignette.style.display = "none";

    map.stop();
    map.jumpTo({
      ...scenario.camera,
      bearing: scenario.camera.bearing ?? 0,
      pitch: scenario.camera.pitch ?? 0,
    });
    const generation = handles.diagnostics.lastGeneration;
    basemap.refresh();
    return generation;
  }, options);
};

const configure = async (page: Page, options: ScenarioOptions) => {
  const generation = await resetScenario(page, options);
  await waitForSemanticFrame(page, generation);
};

const capture = async (page: Page, filename: string) => {
  await page.evaluate(() => {
    const attribution = document.querySelector(".maplibregl-ctrl-attrib");
    attribution?.classList.add("maplibregl-compact-show");
    const attributionText = attribution?.querySelector(
      ".maplibregl-ctrl-attrib-inner",
    );
    if (attributionText)
      attributionText.textContent =
        "OpenFreeMap © OpenMapTiles · Data © OpenStreetMap contributors";
  });
  await page.screenshot({
    path: resolve(galleryDirectory, filename),
    animations: "disabled",
  });
};

test("captures the README feature gallery", async ({ page }) => {
  test.setTimeout(10 * 60_000);
  await mkdir(galleryDirectory, { recursive: true });
  await page.goto("/demo/");
  await expect(page.locator("#status")).toContainText("rendered in");
  await expect(page.locator("#trips-status")).toContainText("animated trips");
  await page.addStyleTag({
    content: `
      #top-bar,
      #settings,
      #readout,
      #screen-vignette,
      .maplibregl-ctrl:not(.maplibregl-ctrl-attrib) {
        display: none !important;
      }
      .maplibregl-ctrl-attrib {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
    `,
  });

  const manhattan: CameraOptions = {
    center: [-74.006, 40.7128],
    zoom: 13.8,
  };
  const themeScenarios = [
    ["theme-dark-greyscale.png", "dark", "greyscale"],
    ["theme-dark-color.png", "dark", "color"],
    ["theme-light-greyscale.png", "light", "greyscale"],
    ["theme-light-color.png", "light", "color"],
  ] as const;
  for (const [filename, theme, colorMode] of themeScenarios) {
    await configure(page, {
      camera: manhattan,
      theme,
      colorMode,
      labels: true,
    });
    await capture(page, filename);
  }

  await configure(page, {
    camera: { center: [-98.5, 39.5], zoom: 3.8 },
    theme: "light",
    colorMode: "greyscale",
    labels: true,
    packs: ["streets", "political"],
  });
  await capture(page, "regional-political.png");

  await configure(page, {
    camera: { center: [-74.03, 40.68], zoom: 10.5 },
    theme: "light",
    colorMode: "color",
    labels: true,
    cell: { width: 12, height: 24, dotSize: 3 },
    packs: ["streets", "marine", "landuse"],
  });
  await capture(page, "coastal-semantic-packs.png");

  await configure(page, {
    camera: { center: [-73.9855, 40.755], zoom: 14.5 },
    theme: "dark",
    colorMode: "color",
    labels: true,
    packs: ["streets", "transit"],
  });
  await capture(page, "urban-transit.png");

  await configure(page, {
    camera: {
      center: [-74.009, 40.706],
      zoom: 15.5,
      pitch: 60,
      bearing: -25,
    },
    theme: "dark",
    colorMode: "greyscale",
    buildings: true,
  });
  await capture(page, "buildings-3d.png");

  await configure(page, {
    camera: { center: [-74, 40.72], zoom: 12.2 },
    theme: "dark",
    colorMode: "greyscale",
  });
  let dataRenderEvents = await page.evaluate(
    () =>
      (window as unknown as { __badMapDemo: DemoHandles }).__badMapDemo
        .diagnostics.dataRenderEvents,
  );
  await selectHiddenOption(page, "#heatmap-mode", "lowres");
  await expect(page.locator("#heatmap-status")).toContainText(
    "weighted pickups · lowres",
  );
  await waitForDataFrame(page, dataRenderEvents);
  await capture(page, "data-heatmap.png");

  await configure(page, {
    camera: { center: [-74, 40.72], zoom: 13 },
    theme: "dark",
    colorMode: "greyscale",
  });
  dataRenderEvents = await page.evaluate(
    () =>
      (window as unknown as { __badMapDemo: DemoHandles }).__badMapDemo
        .diagnostics.dataRenderEvents,
  );
  await selectHiddenOption(page, "#trips-mode", "lowres");
  await expect(page.locator("#trips-status")).toContainText("animated trips");
  await page.evaluate(() => {
    const { basemap } = (window as unknown as { __badMapDemo: DemoHandles })
      .__badMapDemo;
    basemap.setTripsPlayback("demo-nyc-trips", {
      playing: false,
      currentTime: 900,
      speed: 1,
      trailLength: 180,
    });
  });
  await waitForDataFrame(page, dataRenderEvents);
  await capture(page, "data-trips.png");

  await configure(page, {
    camera: { center: [-100, 38], zoom: 4 },
    theme: "light",
    colorMode: "greyscale",
    packs: ["streets", "political"],
  });
  dataRenderEvents = await page.evaluate(
    () =>
      (window as unknown as { __badMapDemo: DemoHandles }).__badMapDemo
        .diagnostics.dataRenderEvents,
  );
  await selectHiddenOption(page, "#highway-mode", "lowres");
  await expect(page.locator("#highway-status")).toContainText("roads · 2015");
  await page.evaluate(() => {
    const { map, basemap } = (
      window as unknown as { __badMapDemo: DemoHandles }
    ).__badMapDemo;
    map.stop();
    map.jumpTo({ center: [-100, 38], zoom: 4, pitch: 0, bearing: 0 });
    basemap.refresh();
  });
  await waitForDataFrame(page, dataRenderEvents);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as { __badMapDemo: DemoHandles }
        ).__badMapDemo.map.areTilesLoaded(),
      ),
    )
    .toBe(true);
  await capture(page, "data-highways.png");

  await configure(page, {
    camera: { center: [-74.006, 40.7128], zoom: 14 },
    theme: "dark",
    colorMode: "greyscale",
  });
  dataRenderEvents = await page.evaluate(
    () =>
      (window as unknown as { __badMapDemo: DemoHandles }).__badMapDemo
        .diagnostics.dataRenderEvents,
  );
  await page.evaluate(() => {
    const { basemap } = (window as unknown as { __badMapDemo: DemoHandles })
      .__badMapDemo;
    basemap.setDataLayer({
      id: "gallery-polygon",
      type: "geojson",
      order: 10,
      data: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            id: "district",
            properties: { name: "Gallery district" },
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [-74.016, 40.706],
                  [-74, 40.706],
                  [-74, 40.719],
                  [-74.016, 40.719],
                  [-74.016, 40.706],
                ],
                [
                  [-74.0105, 40.7105],
                  [-74.005, 40.7105],
                  [-74.005, 40.715],
                  [-74.0105, 40.715],
                  [-74.0105, 40.7105],
                ],
              ],
            },
          },
        ],
      },
      fill: {
        color: [44, 176, 140],
        opacity: 0.36,
        outlineColor: [116, 255, 211],
        outlineWidth: 2,
      },
    });
    basemap.setDataLayer({
      id: "gallery-route-a",
      type: "geojson",
      order: 20,
      data: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { name: "Primary route" },
            geometry: {
              type: "LineString",
              coordinates: [
                [-74.021, 40.706],
                [-74.012, 40.716],
                [-74.001, 40.707],
                [-73.992, 40.718],
              ],
            },
          },
        ],
      },
      line: { color: [255, 177, 66], width: 4 },
    });
    basemap.setDataLayer({
      id: "gallery-route-b",
      type: "geojson",
      order: 21,
      data: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { name: "Dashed route" },
            geometry: {
              type: "LineString",
              coordinates: [
                [-74.017, 40.72],
                [-74.008, 40.711],
                [-73.996, 40.72],
              ],
            },
          },
          {
            type: "Feature",
            properties: { name: "Stops" },
            geometry: {
              type: "MultiPoint",
              coordinates: [
                [-74.014, 40.717],
                [-74.008, 40.711],
                [-74, 40.717],
              ],
            },
          },
        ],
      },
      point: { color: [112, 182, 255], radius: 5 },
      line: { color: [112, 182, 255], width: 3, dash: [3, 2] },
    });
    basemap.setDataLayer({
      id: "gallery-waypoints",
      type: "waypoint",
      order: 30,
      data: [
        {
          id: "locator",
          position: [-74.013, 40.711],
          style: "locator",
          size: 56,
          color: [255, 91, 132],
          haloColor: [255, 235, 241],
        },
        {
          id: "caret",
          position: [-74.02, 40.718],
          style: "caret",
          size: 56,
          color: [255, 214, 76],
          haloColor: [45, 28, 2],
        },
      ],
    });
  });
  await waitForDataFrame(page, dataRenderEvents);
  await capture(page, "data-geometry-waypoints.png");
});
