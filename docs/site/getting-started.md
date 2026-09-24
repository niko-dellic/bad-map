# Installation and first map

## Install

```sh
npm install bad-map
```

MapLibre GL JS is a required peer dependency and is installed automatically by
npm 7 and newer. Package managers that do not install peer dependencies should
install `maplibre-gl@^6` explicitly. The default keyless source is OpenFreeMap.

`bad-map` is safe to import during server rendering, but it is a browser
renderer rather than a server-side map renderer. Construct the MapLibre map and
call `addTo()` from client-side code after the map container mounts; those
operations require the DOM, a canvas, WebGL 2, and Web Workers.

MapLibre GL JS 6 uses a separate ESM worker. Vite applications must configure
its bundled URL once before creating a map:

```ts
import { setWorkerUrl } from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

setWorkerUrl(maplibreWorkerUrl);
```

Other bundlers should follow MapLibre's
[ESM worker setup](https://maplibre.org/maplibre-gl-js/docs/).

## Quick start

Give the MapLibre container an explicit size:

```html
<div id="map"></div>
<style>
  html,
  body,
  #map {
    width: 100%;
    height: 100%;
    margin: 0;
  }
</style>
```

```ts
import { Map } from "maplibre-gl";
import { LowResBasemap, streets, transit } from "bad-map";
import "maplibre-gl/dist/maplibre-gl.css";

const map = new Map({
  container: "map",
  center: [-74.006, 40.7128],
  zoom: 14,
  style: { version: 8, sources: {}, layers: [] },
});

const basemap = new LowResBasemap({
  source: { tileJSON: "https://tiles.openfreemap.org/planet" },
  layers: [streets(), transit({ enabled: false, priority: 20 })],
  colorMode: "greyscale",
  cell: { width: 8, height: 16, dotSize: 2 },
});

await basemap.addTo(map);
basemap.setLayerVisible("transit", true);
```

## API reference

See the [complete API reference](/api/) for signatures, options, methods, and types.
