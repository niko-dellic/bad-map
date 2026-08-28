import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, firefox, webkit } from "playwright";
import { createServer } from "vite";

const repository = process.cwd();
const temporaryRoot = mkdtempSync(join(tmpdir(), "bad-map-package-"));
const applicationRoot = join(temporaryRoot, "consumer");
const maplibreMajor = Number(
  JSON.parse(
    readFileSync(
      resolve(repository, "node_modules/maplibre-gl/package.json"),
      "utf8",
    ),
  ).version.split(".")[0],
);
mkdirSync(applicationRoot, { recursive: true });

let browser;
let server;

const run = (command, arguments_, cwd = repository) =>
  execFileSync(command, arguments_, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_cache: join(temporaryRoot, ".npm-cache"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

try {
  const packResult = JSON.parse(
    run("npm", [
      "pack",
      "--ignore-scripts",
      "--json",
      "--pack-destination",
      temporaryRoot,
    ]),
  );
  const tarball = join(temporaryRoot, packResult[0].filename);

  writeFileSync(
    join(applicationRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "bad-map-package-consumer",
        private: true,
        type: "module",
      },
      null,
      2,
    )}\n`,
  );
  const nodeModules = join(applicationRoot, "node_modules");
  const installedPackage = join(nodeModules, "bad-map");
  mkdirSync(installedPackage, { recursive: true });
  run(
    "tar",
    ["-xzf", tarball, "--strip-components=1", "-C", installedPackage],
    applicationRoot,
  );
  symlinkSync(
    resolve(repository, "node_modules/maplibre-gl"),
    join(nodeModules, "maplibre-gl"),
    "junction",
  );
  const typesDirectory = join(nodeModules, "@types");
  mkdirSync(typesDirectory, { recursive: true });
  symlinkSync(
    resolve(repository, "node_modules/@types/geojson"),
    join(typesDirectory, "geojson"),
    "junction",
  );
  const bundle = readFileSync(
    join(installedPackage, "dist/bad-map.js"),
    "utf8",
  );
  if (bundle.includes('"/assets/'))
    throw new Error("Packed worker URLs must not be root-relative");
  if (bundle.includes('new URL("assets/'))
    throw new Error("Packed workers must not depend on adjacent asset files");
  if (!bundle.includes("new Blob("))
    throw new Error(
      "Packed workers are not embedded in the distributable bundle",
    );
  for (const unwanted of ["favicon.ico", "site.webmanifest"])
    try {
      readFileSync(join(installedPackage, "dist", unwanted));
      throw new Error(`Packed demo asset should be excluded: ${unwanted}`);
    } catch (error) {
      if (error instanceof Error && !error.message.includes("ENOENT"))
        throw error;
    }
  readFileSync(join(installedPackage, "THIRD_PARTY_NOTICES.md"));
  for (const worker of ["raster", "data-raster"])
    readFileSync(join(installedPackage, "dist", "workers", `${worker}.js`));
  run(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      'await import("bad-map"); console.log("SSR import passed");',
    ],
    applicationRoot,
  );
  const declarationFiles = (directory) =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory()
        ? declarationFiles(path)
        : entry.name.endsWith(".d.ts")
          ? [path]
          : [];
    });
  for (const declaration of declarationFiles(join(installedPackage, "dist"))) {
    const source = readFileSync(declaration, "utf8");
    for (const match of source.matchAll(/from\s+["'](\.{1,2}\/[^"']+)["']/g))
      if (!match[1].endsWith(".js"))
        throw new Error(
          `Extensionless declaration import in ${declaration}: ${match[1]}`,
        );
  }

  writeFileSync(
    join(applicationRoot, "consumer.ts"),
    `import { LowResBasemap, streets, type LowResDataLayer, type LowResWorkerFactories } from "bad-map";

const layer: LowResDataLayer = {
  id: "point",
  type: "waypoint",
  data: [{ position: [0, 0], style: "caret" }],
};

const workers: LowResWorkerFactories = {
  raster: () => new Worker("/raster.js", { type: "module" }),
  data: () => new Worker("/data-raster.js", { type: "module" }),
};

new LowResBasemap({ layers: [streets()], dataLayers: [layer], workers });
`,
  );
  const tsc = resolve(repository, "node_modules/typescript/bin/tsc");
  const typecheck = (module, moduleResolution, skipLibCheck) =>
    run(
      process.execPath,
      [
        tsc,
        "--noEmit",
        "--target",
        "ES2022",
        "--module",
        module,
        "--moduleResolution",
        moduleResolution,
        "--lib",
        "ES2022,DOM",
        "--strict",
        "--skipLibCheck",
        String(skipLibCheck),
        "consumer.ts",
      ],
      applicationRoot,
    );
  typecheck("ESNext", "Bundler", false);
  // MapLibre 5's own transitive declarations are not NodeNext-clean, so this
  // verifies package resolution while the explicit scan above owns our paths.
  typecheck("NodeNext", "NodeNext", true);

  writeFileSync(
    join(applicationRoot, "index.html"),
    `<main id="map"></main>
<script type="module" src="/main.js"></script>`,
  );
  writeFileSync(
    join(applicationRoot, "strict.html"),
    `<main id="map"></main>
<script type="module" src="/main-strict.js"></script>`,
  );
  writeFileSync(
    join(applicationRoot, "main.js"),
    `import { Map } from "maplibre-gl";
import { LowResBasemap } from "bad-map";

const map = new Map({
  container: "map",
  center: [0, 0],
  zoom: 0,
  style: { version: 8, sources: {}, layers: [] },
  attributionControl: false,
});
const basemap = new LowResBasemap({
  source: { tileJSON: new URL("/tilejson.json", location.href).href },
  attribution: false,
  labels: false,
});
window.__packageSmoke = { ready: false, dataReady: false, errors: [] };
basemap.on("error", ({ error }) => window.__packageSmoke.errors.push(error));
basemap.on("render", () => { window.__packageSmoke.ready = true; });
basemap.on("datarender", () => { window.__packageSmoke.dataReady = true; });
await basemap.addTo(map);
window.__packageSmoke.workersBeforeData = window.__workerConstructions.filter(
  ({ name }) => name.startsWith("bad-map-"),
).length;
basemap.setDataLayer({
  id: "package-point",
  type: "waypoint",
  data: [{ position: [0, 0] }],
});
`,
  );
  writeFileSync(
    join(applicationRoot, "main-strict.js"),
    `import { Map } from "maplibre-gl";
import { LowResBasemap } from "bad-map";
import rasterWorkerUrl from "bad-map/workers/raster?url";
import dataRasterWorkerUrl from "bad-map/workers/data-raster?url";

const map = new Map({
  container: "map",
  center: [0, 0],
  zoom: 0,
  style: { version: 8, sources: {}, layers: [] },
  attributionControl: false,
});
const basemap = new LowResBasemap({
  source: { tileJSON: new URL("/tilejson.json", location.href).href },
  attribution: false,
  labels: false,
  workers: {
    raster: () =>
      new Worker(rasterWorkerUrl, {
        type: "module",
        name: "bad-map-raster",
      }),
    data: () =>
      new Worker(dataRasterWorkerUrl, {
        type: "module",
        name: "bad-map-data-raster",
      }),
  },
});
window.__packageSmoke = { ready: false, dataReady: false, errors: [] };
basemap.on("error", ({ error }) => window.__packageSmoke.errors.push(error));
basemap.on("render", () => { window.__packageSmoke.ready = true; });
basemap.on("datarender", () => { window.__packageSmoke.dataReady = true; });
await basemap.addTo(map);
window.__packageSmoke.workersBeforeData = window.__workerConstructions.filter(
  ({ name }) => name.startsWith("bad-map-"),
).length;
basemap.setDataLayer({
  id: "package-point",
  type: "waypoint",
  data: [{ position: [0, 0] }],
});
`,
  );

  server = await createServer({
    root: applicationRoot,
    logLevel: "error",
    // MapLibre 5 needs its UMD bundle optimized for ESM consumers. MapLibre 6
    // ships ESM, but its worker entry is sensitive to this symlink-only test
    // install. In either case, bad-map remains a real optimized dependency.
    optimizeDeps: maplibreMajor >= 6 ? { exclude: ["maplibre-gl"] } : undefined,
    server: {
      host: "127.0.0.1",
      port: 0,
      fs: {
        allow: [
          applicationRoot,
          realpathSync(applicationRoot),
          repository,
          realpathSync(repository),
        ],
      },
    },
    plugins: [
      {
        name: "bad-map-package-fixtures",
        configureServer(viteServer) {
          viteServer.middlewares.use((request, response, next) => {
            if (request.url === "/strict.html")
              response.setHeader(
                "content-security-policy",
                "default-src 'self'; script-src 'self'; worker-src 'self'; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'",
              );
            if (request.url === "/tilejson.json") {
              response.setHeader("content-type", "application/json");
              response.end(
                JSON.stringify({
                  tilejson: "3.0.0",
                  minzoom: 0,
                  maxzoom: 0,
                  tiles: [
                    `http://${request.headers.host}/tiles/{z}/{x}/{y}.pbf`,
                  ],
                }),
              );
              return;
            }
            if (request.url?.startsWith("/tiles/")) {
              response.setHeader("content-type", "application/x-protobuf");
              response.end(Buffer.alloc(0));
              return;
            }
            next();
          });
        },
      },
    ],
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string")
    throw new Error("Could not resolve consumer test server address");

  const checkConsumer = async (browserType, name, strict = false) => {
    browser = await browserType.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: 640, height: 480 },
    });
    await page.addInitScript(() => {
      window.__workerConstructions = [];
      window.Worker = new Proxy(window.Worker, {
        construct(Target, args) {
          const [url, options] = args;
          window.__workerConstructions.push({
            url: String(url),
            name: options?.name ?? "",
          });
          return Reflect.construct(Target, args);
        },
      });
    });
    const failedRequests = [];
    const pageErrors = [];
    const consoleErrors = [];
    page.on("requestfailed", (request) =>
      failedRequests.push(
        `${request.url()}: ${request.failure()?.errorText ?? "failed"}`,
      ),
    );
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await page.goto(
      `http://127.0.0.1:${address.port}/${strict ? "strict.html" : ""}`,
    );
    try {
      await page.waitForFunction(
        () =>
          window.__packageSmoke?.ready === true &&
          window.__packageSmoke?.dataReady === true,
        null,
        { timeout: 15_000 },
      );
    } catch (cause) {
      throw new Error(
        `${name} consumer did not render: ${JSON.stringify({ consoleErrors, failedRequests, pageErrors })}`,
        { cause },
      );
    }
    const errors = await page.evaluate(() => window.__packageSmoke.errors);
    const workersBeforeData = await page.evaluate(
      () => window.__packageSmoke.workersBeforeData,
    );
    const workers = await page.evaluate(() => window.__workerConstructions);
    if (errors.some((error) => error.fatal))
      throw new Error(
        `${name} consumer emitted a fatal error: ${JSON.stringify(errors)}`,
      );
    if (failedRequests.length)
      throw new Error(
        `${name} consumer request failure: ${failedRequests.join("\n")}`,
      );
    if (workersBeforeData !== 1)
      throw new Error(
        `${name} started ${workersBeforeData} package workers before adding data; expected one`,
      );
    const packageWorkers = workers.filter(({ name: workerName }) =>
      workerName.startsWith("bad-map-"),
    );
    const workerNames = packageWorkers
      .map(({ name: workerName }) => workerName)
      .sort();
    const workerUrlAllowed = ({ url }) =>
      strict
        ? !url.startsWith("blob:") &&
          new URL(url, `http://127.0.0.1:${address.port}`).origin ===
            `http://127.0.0.1:${address.port}`
        : url.startsWith("blob:");
    if (
      packageWorkers.length !== 2 ||
      packageWorkers.some((worker) => !workerUrlAllowed(worker)) ||
      workerNames.join(",") !== "bad-map-data-raster,bad-map-raster"
    )
      throw new Error(
        `Expected two ${strict ? "external" : "embedded"} package workers in ${name}: ${JSON.stringify(packageWorkers)}`,
      );
    await browser.close();
    browser = undefined;
  };

  await checkConsumer(chromium, "Chromium");
  await checkConsumer(firefox, "Firefox");
  await checkConsumer(webkit, "WebKit");
  await checkConsumer(chromium, "strict-CSP Chromium", true);

  console.log(
    "Packed npm artifact passed contents, SSR import, types, CSP, cross-browser worker, and render checks.",
  );
} finally {
  await browser?.close();
  await server?.close();
  rmSync(temporaryRoot, { force: true, recursive: true });
}
