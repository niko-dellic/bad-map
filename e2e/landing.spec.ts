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
      window: windowRect.toJSON(),
    };
  });

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

  await expect(page.getByRole("heading", { name: "bad-map" })).toBeVisible();
  await expect(page.getByText("Make your map worse.")).toBeVisible();
  await expect(page.locator('link[href="/demo/landing.css"]')).toHaveCount(1);
  await expect(page.locator('link[href="/demo/landing-font.css"]')).toHaveCount(
    0,
  );
  const editableStyles = await page.request.get("/demo/landing.css");
  expect(editableStyles.ok()).toBe(true);
  const editableStylesText = await editableStyles.text();
  expect(editableStylesText).toContain("Intentionally almost unstyled");
  expect(editableStylesText).toContain("--demo-width: 55vw");
  expect(editableStylesText).not.toContain("base64");
  await expect(page.getByRole("link", { name: "demo", exact: true })).toHaveCSS(
    "color",
    "rgb(142, 197, 255)",
  );
  await expect(page.getByText("npm install bad-map").first()).toBeVisible();
  await expect(
    page.getByRole("link", { name: "install anyway ↗" }),
  ).toHaveAttribute("href", "https://www.npmjs.com/package/bad-map");
  await expect(
    page.getByRole("link", { name: "source on github ↗" }),
  ).toHaveAttribute("href", "https://github.com/niko-dellic/bad-map");
  await expect(page.locator("#status")).toContainText("rendered in");
  await expect(page.locator(".demo-window #app")).toHaveCSS(
    "visibility",
    "visible",
  );
  await expect(
    page.getByRole("button", { name: "Search places" }),
  ).toBeVisible();
  await expect(page.locator("#settings")).toBeHidden();
  await expectDemoBoundedByWindow(page);

  const viewport = page.viewportSize()!;
  const demoBox = await page.locator(".demo-window").boundingBox();
  expect(demoBox).not.toBeNull();
  expect(demoBox!.x + demoBox!.width).toBeCloseTo(viewport.width, 0);
  expect(demoBox!.width).toBeCloseTo(viewport.width * 0.55, 0);
});

test("keeps the embedded canvas bounded on a mobile viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator("#status")).toContainText("rendered in");
  await expectDemoBoundedByWindow(page);
});

test("uses the same plain font in the full-screen demo", async ({ page }) => {
  await page.goto("/demo/");
  await expect(page.locator("#status")).toContainText("rendered in");

  const typography = await page.evaluate(() => ({
    body: getComputedStyle(document.body).fontFamily,
    label: getComputedStyle(document.querySelector("#app header strong")!)
      .fontFamily,
    labelWeight: getComputedStyle(document.querySelector("#app header strong")!)
      .fontWeight,
    status: getComputedStyle(document.querySelector("#status")!).fontFamily,
  }));

  expect(typography.label).toBe(typography.body);
  expect(typography.status).toBe(typography.body);
  expect(typography.labelWeight).toBe("400");
});
