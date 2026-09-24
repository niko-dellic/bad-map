import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, stat, readdir } from "node:fs/promises";
import { extname, resolve, join } from "node:path";
import assert from "node:assert/strict";

const root = resolve("site-dist");
async function fileFor(pathname) {
  let file = resolve(root, "." + decodeURIComponent(pathname));
  assert(file.startsWith(root + "/") || file === root);
  try {
    if ((await stat(file)).isDirectory()) file += "/index.html";
  } catch {
    if (!extname(file)) file += ".html";
  }
  return file;
}
const server = createServer(async (req, res) => {
  try {
    const file = await fileFor(new URL(req.url, "http://local").pathname);
    res.setHeader(
      "Content-Type",
      {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".png": "image/png",
        ".svg": "image/svg+xml",
        ".woff2": "font/woff2",
      }[extname(file)] ?? "application/octet-stream",
    );
    res.end(await readFile(file));
  } catch {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin =
  process.env.SITE_URL ?? `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
try {
  // Check every generated internal page link and anchor, including the API.
  const htmlFiles = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (file.endsWith(".html")) htmlFiles.push(file);
    }
  }
  await walk(join(root, "docs"));
  for (const file of htmlFiles) {
    const html = await readFile(file, "utf8");
    for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
      const url = new URL(
        href.replaceAll("&amp;", "&"),
        "http://local/" + file.slice(root.length + 1),
      );
      if (url.origin !== "http://local" || !url.pathname.startsWith("/docs/"))
        continue;
      const target = await fileFor(url.pathname);
      assert((await stat(target)).isFile(), `Missing link ${href} in ${file}`);
      if (url.hash && target.endsWith(".html")) {
        const targetHtml = await readFile(target, "utf8");
        assert(
          targetHtml.includes(`id="${decodeURIComponent(url.hash.slice(1))}"`),
          `Missing anchor ${href} in ${file}`,
        );
      }
    }
  }
  for (const colorScheme of ["light", "dark"]) {
    const context = await browser.newContext({ colorScheme });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    for (const width of [390, 960, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(origin + "/docs/");
      await page.evaluate(
        (mode) => localStorage.setItem("vitepress-theme-appearance", mode),
        colorScheme,
      );
      let titleX;
      for (const route of [
        "/docs/",
        "/docs/getting-started",
        "/docs/api/classes/LowResBasemap",
      ]) {
        const response = await page.goto(origin + route);
        assert(response.ok());
        await page.waitForFunction(
          () => document.querySelector("#app")?.__vue_app__,
        );
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
        assert.equal(
          await page
            .locator("html")
            .evaluate((el) => el.classList.contains("dark")),
          colorScheme === "dark",
        );
        await page.waitForFunction(() =>
          [...document.images].every(
            (image) => image.complete && image.naturalWidth > 0,
          ),
        );
        const box = await page.locator(".VPNavBarTitle").boundingBox();
        if (titleX === undefined) titleX = box.x;
        else assert(Math.abs(titleX - box.x) < 1);
        if (width >= 960)
          assert((await page.locator(".VPSidebar").boundingBox()).y >= 64);
        if (width === 1440 && route === "/docs/")
          await page.screenshot({
            path: `/tmp/bad-map-docs-${colorScheme}.png`,
          });
      }
      if (width === 390) {
        await page.getByRole("button", { name: /mobile navigation/i }).click();
        await page.locator(".VPNavScreen [role=switch]").click();
        await page.getByRole("button", { name: /mobile navigation/i }).click();
        await page.getByRole("button", { name: "Menu", exact: true }).click();
        assert(await page.locator(".VPSidebar.open").count());
        await page.keyboard.press("Escape");
      }
      if (width === 1440) {
        const before = await page.locator("html").getAttribute("class");
        await page.locator(".VPNavBar [role=switch]:visible").click();
        assert.notEqual(
          await page.locator("html").getAttribute("class"),
          before,
        );
        await page
          .getByRole("button", { name: /Search/ })
          .first()
          .click();
        await page.locator("#localsearch-input").fill("setDataLayer");
        await page.locator(".VPLocalSearchBox .result").first().waitFor();
      }
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(
    `Documentation passed: ${htmlFiles.length} pages, links/anchors, search, desktop/mobile navigation, and themes.`,
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
