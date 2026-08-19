# bad-map

A semantic low-resolution cartography toolkit for MapLibre GL JS.

`bad-map` renders vector-tile meaning instead of pixelating an existing map.
Coarse area fills, ranked square-dot lines, scalar data, and labels are composed
independently, which leaves ordinary MapLibre and deck.gl layers crisp and
interactive. Greyscale is the default; full color remains one method call away.

## Install

```sh
npm install bad-map maplibre-gl
```

MapLibre GL JS is a peer dependency. The default keyless source is OpenFreeMap.

## Quick start

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

## Layer ordering

Six stable IDs divide the render stack:

```ts
basemap.layerIds.base; // fills and low-resolution linework
basemap.layerIds.buildings; // optional native 3D building extrusions
basemap.layerIds.data; // application data boundary
basemap.layerIds.markers; // marker boundary
basemap.layerIds.labels; // package labels
basemap.layerIds.interaction; // top interaction boundary
```

Insert a native visualization immediately below the marker boundary to keep it
above the cartography and below labels:

```ts
map.addLayer(dataLayer, basemap.layerIds.markers);
```

Color modes only affect package-owned layers.

## Semantic packs and sources

Built-in serializable descriptors are available for `streets`, `transit`,
`topographic`, `weather`, `political`, `marine`, and `landuse`. Each descriptor
selects source layers and a worker-side adapter; no callbacks cross the worker
boundary.

```ts
import { LowResBasemap, streets, topographic, weather } from "bad-map";

const basemap = new LowResBasemap({
  sources: {
    base: { tileJSON: "/tiles/base.json", maxCachedTiles: 96 },
    terrain: { tileJSON: "/tiles/terrain.json" },
    forecast: {
      tileJSON: "/tiles/weather.json",
      timeKey: "2026-08-19T12:00Z",
      maxConcurrentRequests: 4,
      retryCount: 2,
    },
  },
  layers: [
    streets(),
    topographic({ source: "terrain", priority: 10 }),
    weather({ source: "forecast", priority: 30 }),
  ],
});

basemap.setSourceTime("forecast", "2026-08-19T13:00Z");
```

Tile templates may contain `{time}`. Numeric polygon properties declared by a
pack are quantized into a compact scalar texture; the built-in weather and
topographic factories provide defaults that can be overridden through their
`numeric` option. Sources currently need MVT data, with OpenMapTiles property
conventions for the built-in adapters.

## Heatmaps

The demo compares two renderers using 100,000 weighted NYC Uber pickup
locations from the public
[deck.gl screen-grid dataset](https://raw.githubusercontent.com/visgl/deck.gl-data/master/examples/screen-grid/uber-pickup-locations.json).

A standard MapLibre heatmap can be inserted below the marker boundary. It stays
smooth and remains outside package theme and greyscale changes:

```ts
map.addLayer(nativeHeatmapLayer, basemap.layerIds.markers);
```

The built-in low-resolution heatmap accepts compact
`[longitude, latitude, weight]` triplets. Density is accumulated in the worker,
quantized to one byte per cell, and expressed through ordered square-dot
dithering:

```ts
basemap.setHeatmap({
  data: pickupLocations,
  visible: true,
  radius: 36,
  intensity: 1,
  maxDensity: 192,
  opacity: 0.76,
  palette: [
    [40, 109, 155],
    [87, 173, 133],
    [239, 178, 75],
    [226, 76, 91],
  ],
});
```

`maxDensity: 0` normalizes against the current view. A fixed positive maximum
is preferable for comparisons and animated data because it prevents the color
domain from changing while panning. Custom palettes participate in the active
greyscale mode. Use `setHeatmapData()`, `setHeatmapVisible()`, or
`clearHeatmap()` for runtime updates.

## Camera modes

`screen` is the default. Dots stay square and locked to the viewport while pan,
zoom, and bearing changes reproject the most recent worker frame. Pitch remains
zero.

```ts
const basemap = new LowResBasemap({ camera: { rotation: true } });
```

`surface` is an experimental low-resolution 3D mode. The semantic frame is
placed on a flat Web Mercator plane and transformed with MapLibre's public
custom-layer camera matrix, so dots and labels foreshorten during pitch and
orbiting. Its worker frame is fitted to the complete camera ground footprint,
including the wider area visible toward the horizon, with bounded resolution
at extreme pitch.

```ts
basemap
  .setProjectionMode("surface")
  .setCamera({ rotation: true, pitch: true, maxPitch: 70 });
```

OpenMapTiles building heights can optionally be rendered as native MapLibre
extrusions above the semantic surface and below application data:

```ts
const basemap = new LowResBasemap({
  projectionMode: "surface",
  buildings3D: { visible: true, minZoom: 14, opacity: 0.82 },
});

basemap.setBuildings3DVisible(false);
```

The building source defaults to the named `base` source and expects an
OpenMapTiles `building` layer with `render_height`, `render_min_height`, and
`hide_3d` properties. Extrusions use the active theme and greyscale mode. They
are smooth native geometry by design; the semantic ground map retains its
square-dot treatment. Sources requiring custom authorization should configure
those requests through the host MapLibre map. Terrain elevation and billboard
labels are not yet part of surface mode.

## Runtime API

`LowResBasemap` provides:

- `addTo(map)` and `remove()`
- `setTheme(theme)` and `setColorMode("color" | "greyscale")`
- `setCell(...)`, `setLocale(...)`, and `setLabelsVisible(...)`
- `setSource(...)`, `setSources(...)`, and `setSourceTime(...)`
- `setLayers(...)`, `getLayers()`, and `setLayerVisible(...)`
- `setProjectionMode(...)` and `setCamera(...)`
- `setBuildings3DVisible(...)` and `getBuildings3DVisible()`
- `setHeatmap(...)`, `setHeatmapData(...)`, `setHeatmapVisible(...)`,
  `getHeatmapOptions()`, and `clearHeatmap()`
- `setSelectedFeature(...)`, `queryFeatures(...)`, and `refresh()`
- typed load, render, error, feature, selection, style, layer, time,
  projection, 3D-building, and heatmap events

Hover and persistent selection use the transferable owner texture. Query
results include `sourceId` and `packId`, and `featureMatches` provides a helper
for filtering those results.

## Rendering pipeline

1. A worker discovers named TileJSON sources, bounds concurrency, retries
   failures, and maintains per-source decoded LRUs.
2. Enabled packs normalize and deterministically order semantic features.
3. Polygons become categorical or scalar dot grids; water derives coastlines.
4. Point weights accumulate into a bounded, quantized density grid.
5. Integer line paths compete by semantic rank inside each character cell.
6. Compact typed buffers are transferred to a WebGL 2 compositor.
7. Labels are independently budgeted and rendered above consumer data.

During interaction, the latest buffers are reprojected while the worker
coalesces obsolete requests. `moveend` always requests an exact frame.

## Constraints

- WebGL 2 and Web Mercator
- MVT sources for built-in packs
- Screen mode supports bearing but not pitch
- Surface mode is a flat-plane experimental renderer, without terrain
- Numeric data is categorical/quantized rather than a general raster engine

## Attribution

Attribution from named sources is deduplicated into MapLibre's attribution
control. Do not disable it unless equivalent visible attribution is supplied by
the host application.

## Development

```sh
npm install
npm test
npm run typecheck
npm run build
npm run api:check
npm run test:e2e
npm run dev
```

See [NEXT_STEPS.md](./NEXT_STEPS.md) for implementation status and remaining
production-depth work around terrain, animated fields, and dense picking.
