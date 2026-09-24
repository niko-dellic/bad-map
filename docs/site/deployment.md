# Deployment and browser support

## Workers and content security policy

The default distribution embeds the semantic worker in the main bundle and
creates the data worker only when a visible package data layer needs it. This
zero-asset setup requires `blob:` in `worker-src`:

```text
worker-src 'self' blob:;
connect-src 'self' https://tiles.openfreemap.org;
img-src 'self' data: blob:;
```

Applications with a strict `worker-src 'self'` policy can use the package's
self-contained worker entry points instead. Vite emits them as same-origin
assets with `?url`:

```ts
import rasterWorkerUrl from "bad-map/workers/raster?url";
import dataRasterWorkerUrl from "bad-map/workers/data-raster?url";

const basemap = new LowResBasemap({
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
```

For other bundlers, emit or copy the `bad-map/workers/raster` and
`bad-map/workers/data-raster` package exports to same-origin URLs, then return
module workers for those URLs from the two factories. MapLibre's own worker is
configured separately using its documented setup.

## Browser support

The supported baseline is an evergreen browser with WebGL 2, module workers,
and Web Mercator support. Chromium runs the full packed-package rendering,
deferred data-worker, and strict-CSP checks. Firefox and WebKit execute the
packed module and both worker runtimes without relying on headless WebGL.
Rendering remains client-only even though importing the package during SSR is
supported.

## Constraints

- WebGL 2 and Web Mercator
- MVT sources for built-in packs
- Screen mode supports bearing but not pitch
- Surface mode is a flat-plane experimental renderer, without terrain
- Numeric data is categorical/quantized rather than a general raster engine

## API reference

See the [complete API reference](/api/) for signatures, options, methods, and types.
