import { expect, test } from "@playwright/test";
import { semanticFixtureTile } from "../test/fixtures/mvt";

export { expect, test };

export interface Diagnostics {
  renderEvents: number;
  styleEvents: number;
  lastGeneration: number;
  lastDurationMs: number;
  generations: number[];
  heatmapEvents: number;
  dataRenderEvents: number;
  featureEnterEvents: number;
}

export const UBER_DATA_URL =
  "https://raw.githubusercontent.com/visgl/deck.gl-data/master/examples/screen-grid/uber-pickup-locations.json";
export const HIGHWAY_ROADS_URL =
  "https://raw.githubusercontent.com/visgl/deck.gl-data/master/examples/highway/roads.json";
export const HIGHWAY_ACCIDENTS_URL =
  "https://raw.githubusercontent.com/visgl/deck.gl-data/master/examples/highway/accidents.csv";
export const TRIPS_DATA_URL =
  "https://raw.githubusercontent.com/visgl/deck.gl-data/master/examples/trips/trips-v7.json";
export const PHOTON_SEARCH_URL = "https://photon.komoot.io/api/**";
export const pickupFixture = Array.from({ length: 625 }, (_, index) => {
  const x = index % 25;
  const y = Math.floor(index / 25);
  return [-74.025 + x * 0.0015, 40.695 + y * 0.0015, 1 + ((x + y) % 8)];
});
export const highwayFixture = {
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
export const accidentFixture = [
  "state,type,id,year,incidents,fatalities",
  "KS,I,70,2015,24,9",
  "KS,US,83,2015,40,14",
  "KS,I,70,2010,18,6",
  "KS,US,83,2010,30,11",
].join("\n");
export const tripsFixture = [
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
  {
    vendor: 1,
    path: [
      [-73.99, 40.71],
      [-73.98, 40.72],
    ],
    timestamps: [900, 900],
  },
];

export async function diagnostics(page: import("@playwright/test").Page) {
  return page.evaluate<Diagnostics>(() =>
    structuredClone(
      (window as typeof window & { __badMapDemo: { diagnostics: Diagnostics } })
        .__badMapDemo.diagnostics,
    ),
  );
}

export function setupDemoTests(options: { fixtureTiles?: boolean } = {}): void {
  test.beforeEach(async ({ baseURL, page }) => {
    if (options.fixtureTiles) {
      const tileRoot = new URL("/e2e/tiles", baseURL).toString();
      await page.route("https://tiles.openfreemap.org/planet", (route) =>
        route.fulfill({
          json: {
            tilejson: "3.0.0",
            tiles: [`${tileRoot}/{z}/{x}/{y}.pbf`],
            minzoom: 0,
            maxzoom: 14,
            vector_layers: [
              {
                id: "building",
                fields: {
                  render_height: "Number",
                  render_min_height: "Number",
                },
                minzoom: 0,
                maxzoom: 14,
              },
            ],
          },
        }),
      );
      await page.route(`${tileRoot}/**`, (route) =>
        route.fulfill({
          body: Buffer.from(semanticFixtureTile()),
          contentType: "application/vnd.mapbox-vector-tile",
        }),
      );
    }
    await page.route(UBER_DATA_URL, (route) =>
      route.fulfill({ json: pickupFixture }),
    );
    await page.route(TRIPS_DATA_URL, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      await route.fulfill({ json: tripsFixture });
    });
    await page.goto("/demo/");
    await expect
      .poll(() =>
        page.evaluate(() =>
          Boolean(
            (window as typeof window & { __badMapDemo?: unknown }).__badMapDemo,
          ),
        ),
      )
      .toBe(true);
    await expect(page.locator("#status")).toContainText("rendered in");
    const settings = page.locator("#settings");
    const settingsToggle = page.locator("#settings-toggle");
    await expect(settings).toHaveClass(/is-collapsed/);
    await expect(settingsToggle).toHaveAttribute("aria-expanded", "false");
    await expect(settingsToggle).toHaveAttribute(
      "aria-label",
      "Expand settings panel",
    );
    await settingsToggle.click();
  });
}
