# Architecture

`bad-map` is published as one package. Source folders describe internal domains;
they are not separate npm packages or public import paths. Consumers should use
the root `bad-map` export.

## Source domains

- `src/basemap/` owns the MapLibre lifecycle, camera integration, validation,
  and orchestration of render workers.
- `src/core/` contains projection and feature-model primitives shared by the
  semantic basemap and data overlays.
- `src/data-layers/` contains the complete pixelated overlay pipeline:
  serialization, validation, heatmaps, geometry rasterization, compositing,
  and ownership buffers.
- `src/semantic/` contains source adapters, cartographic ranks, labels, and the
  semantic basemap rasterizer.
- `src/tiles/` owns MVT decoding, requests, and tile caching.
- `src/render/` contains WebGL layers, shaders, and projection/fog math.
- `src/themes/` contains built-in themes and theme composition.
- `src/workers/` contains worker entrypoints and transferable protocols.

`src/index.ts` is the only importable library API entrypoint. The executable
`bad-map/workers/raster` and `bad-map/workers/data-raster` subpaths exist only
so strict-CSP consumers can emit or self-host the package workers. Internal
moves must preserve the root exports and pass the declaration fixture in
`test/fixtures/public-api.d.ts`.

## Dependency direction

Core projection and feature primitives must not import basemap, renderer, demo,
or worker orchestration. Semantic and data rasterizers may depend on core
primitives, while workers adapt those rasterizers to transferable protocols.
The basemap owns lifecycle and coordinates workers and render layers; render
layers must consume provider interfaces rather than the basemap implementation.
Demo modules may import the public package surface and demo-only helpers, but
reusable behavior belongs under `src/`.

## Public API policy

Only symbols exported by `src/index.ts` are supported consumer API. Worker
protocols, raster frames, semantic buffer enums, render providers, and source
module paths are implementation details even when declaration generation emits
their files. The worker asset subpaths are executable build artifacts, not
JavaScript APIs. Public changes require an intentional declaration snapshot
update and a changelog migration note. Before `1.0`, removals use a minor
version bump; after `1.0`, semantic versioning governs compatibility.

`LowResBasemapLike` is intentionally public as the event-target interface.
Theme composition helpers are also public so applications can derive colors
that follow the active basemap mode.

## Data-layer boundary

Reusable layer behavior belongs in `src/data-layers/`. Sample datasets and
network loaders do not: they live in `demo/data-sources/` and are loaded only
when their demo is enabled.

Adding a layer type normally requires:

1. A public discriminant and options in the public data-layer union.
2. Main-thread serialization and accessor evaluation.
3. Worker-side rasterization and ownership output.
4. Composition into either the data or marker texture.
5. Unit tests under `test/data-layers/` and browser coverage under `e2e/`.

## Tests

Unit tests mirror source domains. Browser tests are divided into deterministic
functional coverage and an explicit local performance benchmark:

```bash
npm run test:e2e:functional
npm run test:e2e:performance
```

The performance benchmark keeps the 200 ms cached-render acceptance target but
is not used as a hard gate on variable shared CI hardware.

Browser suites are grouped by data overlays, camera/rendering, demo UI, and
lifecycle/performance behavior. Shared page helpers belong in one support
module rather than being copied between specs.

The packed-consumer suite additionally verifies root imports during SSR,
Bundler and NodeNext declarations, inline and same-origin workers, strict CSP,
and rendering in Chromium, Firefox, and WebKit. A map without visible package
data layers must not start the data worker.

## Package boundaries

Keep the library as one npm package while basemap and data-layer workers share
projection, typed buffers, and WebGL composition. Consider another package only
for an independently useful adapter with its own dependencies or release cycle,
such as a framework integration or optional dataset bundle.
