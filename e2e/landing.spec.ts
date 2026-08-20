import { expect, test } from "@playwright/test";

const expectDemoBoundedByWindow = async (
  page: import("@playwright/test").Page,
) => {
  const bounds = await page.evaluate(() => {
    const windowElement = document.querySelector<HTMLElement>(".demo-window")!;
    const app = document.querySelector<HTMLElement>(".demo-window #app")!;
    const canvas = app.querySelector<HTMLCanvasElement>(
      ".maplibregl-canvas-container canvas",
    )!;
    const windowRect = windowElement.getBoundingClientRect();
    const appRect = app.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    return {
      app: appRect.toJSON(),
      canvas: canvasRect.toJSON(),
      pageScrolls: document.documentElement.scrollHeight > window.innerHeight,
      window: windowRect.toJSON(),
    };
  });

  expect(bounds.pageScrolls).toBe(true);
  expect(bounds.app.top).toBeGreaterThanOrEqual(bounds.window.top);
  expect(bounds.app.bottom).toBeLessThanOrEqual(bounds.window.bottom + 1);
  expect(bounds.canvas.left).toBeGreaterThanOrEqual(bounds.app.left - 1);
  expect(bounds.canvas.right).toBeLessThanOrEqual(bounds.app.right + 1);
  expect(bounds.canvas.top).toBeGreaterThanOrEqual(bounds.app.top - 1);
  expect(bounds.canvas.bottom).toBeLessThanOrEqual(bounds.app.bottom + 1);
};

test("promotes the package and embeds the interactive demo", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Make your map worse." }),
  ).toBeVisible();
  await expect(page.getByText("npm install bad-map").first()).toBeVisible();
  await expect(
    page.getByRole("link", { name: "install anyway ↗" }),
  ).toHaveAttribute("href", "https://www.npmjs.com/package/bad-map");
  await expect(
    page.getByRole("link", { name: "source on github ↗" }),
  ).toHaveAttribute("href", "https://github.com/niko-dellic/bad-map");
  await expect(page.locator("#status")).toContainText("rendered in");
  await expect(page.locator("#hero-map")).toHaveAttribute("data-ready", "true");
  await expect(page.locator("#hero-map .maplibregl-canvas")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Search places" }),
  ).toBeVisible();
  await expect(page.locator("#settings")).toBeHidden();
  await expectDemoBoundedByWindow(page);

  const initialBearing = Number(
    await page.locator("#hero-map").getAttribute("data-bearing"),
  );
  await page.waitForTimeout(250);
  const rotatedBearing = Number(
    await page.locator("#hero-map").getAttribute("data-bearing"),
  );
  expect(rotatedBearing).toBeGreaterThan(initialBearing);
});

test("keeps the embedded canvas bounded on a mobile viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator("#status")).toContainText("rendered in");
  await expectDemoBoundedByWindow(page);
});
