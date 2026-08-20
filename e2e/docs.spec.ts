import { expect, test } from "@playwright/test";

test("documents package capabilities, integrations, and limitations", async ({
  page,
}) => {
  await page.goto("/docs/");

  await expect(page).toHaveTitle(/bad-map docs/);
  await expect(
    page.getByRole("heading", { level: 1, name: "bad-map docs" }),
  ).toBeVisible();
  await expect(page.getByText("npm install bad-map maplibre-gl")).toBeVisible();
  await expect(
    page.getByText("new LowResBasemap", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "What it plays with" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Demo versus package" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Limitations" }),
  ).toBeVisible();
  await expect(
    page.getByText("WebGL 2", { exact: false }).last(),
  ).toBeVisible();
  await expect(page.getByText("They are demo-only effects.")).toBeVisible();

  await expect(page.getByRole("link", { name: "bad-map" })).toHaveAttribute(
    "href",
    "/",
  );
  await expect(
    page.getByRole("link", { name: "demo", exact: true }),
  ).toHaveAttribute("href", "/demo/");
  await expect(page.getByRole("link", { name: "npm" })).toHaveAttribute(
    "href",
    "https://www.npmjs.com/package/bad-map",
  );
  await expect(page.getByRole("link", { name: "github" })).toHaveAttribute(
    "href",
    "https://github.com/niko-dellic/bad-map",
  );
});
