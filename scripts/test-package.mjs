import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
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
    `import { LowResBasemap, streets, type LowResDataLayer } from "bad-map";

const layer: LowResDataLayer = {
  id: "point",
  type: "waypoint",
  data: [{ position: [0, 0], style: "caret" }],
};

new LowResBasemap({ layers: [streets()], dataLayers: [layer] });
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
<script>
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
</script>
<script type="module" src="/main.js"></script>`,
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
window.__packageSmoke = { ready: false, errors: [] };
basemap.on("error", ({ error }) => window.__packageSmoke.errors.push(error));
basemap.on("render", () => { window.__packageSmoke.ready = true; });
await basemap.addTo(map);
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
      fs: { allow: [applicationRoot, repository] },
    },
    plugins: [
      {
        name: "bad-map-package-fixtures",
        configureServer(viteServer) {
          viteServer.middlewares.use((request, response, next) => {
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

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
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
  await page.goto(`http://127.0.0.1:${address.port}`);
  try {
    await page.waitForFunction(
      () => window.__packageSmoke?.ready === true,
      null,
      {
        timeout: 15_000,
      },
    );
  } catch (cause) {
    throw new Error(
      `Consumer did not render: ${JSON.stringify({ consoleErrors, failedRequests, pageErrors })}`,
      { cause },
    );
  }
  const errors = await page.evaluate(() => window.__packageSmoke.errors);
  const workers = await page.evaluate(() => window.__workerConstructions);
  if (errors.some((error) => error.fatal))
    throw new Error(
      `Consumer emitted a fatal error: ${JSON.stringify(errors)}`,
    );
  if (failedRequests.length)
    throw new Error(`Consumer request failure: ${failedRequests.join("\n")}`);
  const packageWorkers = workers.filter(({ name }) =>
    name.startsWith("bad-map-"),
  );
  const workerNames = packageWorkers.map(({ name }) => name).sort();
  if (
    packageWorkers.length !== 2 ||
    packageWorkers.some(({ url }) => !url.startsWith("blob:")) ||
    workerNames.join(",") !== "bad-map-data-raster,bad-map-raster"
  )
    throw new Error(
      `Expected two embedded package workers: ${JSON.stringify(packageWorkers)}`,
    );

  console.log(
    "Packed npm artifact passed contents, type, worker, and render checks.",
  );
} finally {
  await browser?.close();
  await server?.close();
  rmSync(temporaryRoot, { force: true, recursive: true });
}
