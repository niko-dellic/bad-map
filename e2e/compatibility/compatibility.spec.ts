import { expect, test } from "@playwright/test";
import { semanticFixtureTile } from "../../test/fixtures/mvt";

test("mounts, renders, and removes the package with the installed MapLibre version", async ({
  page,
}) => {
  await page.route("https://tiles.compatibility.test/source", (route) =>
    route.fulfill({
      json: {
        tilejson: "3.0.0",
        tiles: ["https://tiles.compatibility.test/{z}/{x}/{y}.pbf"],
        minzoom: 0,
        maxzoom: 14,
        vector_layers: [],
      },
    }),
  );
  await page.route("https://tiles.compatibility.test/**/*.pbf", (route) =>
    route.fulfill({
      body: Buffer.from(semanticFixtureTile()),
      contentType: "application/vnd.mapbox-vector-tile",
    }),
  );

  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-rendered", "true");
  await expect(page.locator("html")).not.toHaveAttribute("data-error");

  const state = await page.evaluate(() => {
    const { map, basemap } = window.__badMapCompatibility;
    const mounted = Boolean(map.getLayer(basemap.layerIds.base));
    basemap.remove();
    return {
      mounted,
      removed: map.getLayer(basemap.layerIds.base) === undefined,
    };
  });

  expect(state).toEqual({ mounted: true, removed: true });
});
