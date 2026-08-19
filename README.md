# bad-map

A semantic low-resolution street basemap for MapLibre GL JS.

`bad-map` brings a semantic terminal-map grammar to the browser: solid coarse
fills, roads rasterized onto a fixed 2×4 Braille-dot lattice, one ranked ink
per character cell, and sparse deterministic labels. It operates on vector
tile semantics, not on a screenshot of another basemap.

## Install

```sh
npm install bad-map maplibre-gl
```

MapLibre GL JS is a peer dependency. The default source is the public,
keyless OpenFreeMap planet tiles.

## Usage

```ts
import { Map } from "maplibre-gl";
import { LowResBasemap } from "bad-map";
import "maplibre-gl/dist/maplibre-gl.css";

const map = new Map({
  container: "map",
  center: [-74.006, 40.7128],
  zoom: 14,
  bearing: 0,
  pitch: 0,
  style: { version: 8, sources: {}, layers: [] },
});

const basemap = new LowResBasemap({
  source: { tileJSON: "https://tiles.openfreemap.org/planet" },
  theme: "dark",
  cell: { width: 8, height: 16, dotSize: 2 },
  locale: "en",
});

await basemap.addTo(map);
```

The package adds two stable custom layers:

```ts
basemap.layerIds.base; // "bad-map-base"
basemap.layerIds.labels; // "bad-map-labels"
```

Put ordinary MapLibre or interleaved deck.gl visualizations before the label
layer to retain paper-map ordering:

```ts
map.addLayer(dataLayer, basemap.layerIds.labels);
```

## API

`LowResBasemap` is framework-agnostic and attaches to an existing MapLibre
map. It provides:

- `addTo(map)` and `remove()`
- `setTheme(theme)`
- `setCell({ width, height, dotSize })`
- `setLocale(locale)`
- `setLabelsVisible(visible)`
- `setSource(source)` and `refresh()`
- `queryFeatures(point)`
- typed `load`, `render`, `error`, `featureenter`, `featureleave`, and
  `featureclick` events

The built-in themes are `dark` and `light`. Custom themes use the exported
`LowResTheme` interface.

The source must use the OpenMapTiles layer schema. Serializable request
headers and credential options can be passed through `source.request`.

## How rendering works

1. A dedicated worker discovers TileJSON, selects at most 16 visible MVT
   tiles, fetches them, and maintains a decoded LRU.
2. Polygons become a categorical 2×4-dot grid. Water is snapshotted before
   buildings, and its exact mask produces the coastline.
3. Bresenham strokes compete by semantic rank inside each character cell.
4. The worker transfers compact fill, Braille mask, line class, tunnel tone,
   owner, and ribbon buffers.
5. A WebGL 2 fragment shader composes square dots and solid fills directly.
   It never samples MapLibre's completed framebuffer.
6. Labels are independently budgeted and rendered in a transparent custom
   layer, allowing application data to sit between cartography and type.

## V1 constraints

- Street mode only
- North-up, unpitched Web Mercator
- OpenMapTiles-compatible sources
- WebGL 2

By default `addTo` sets pitch and bearing to zero, disables rotation, and
restores the previous rotation-handler state on removal.

## Attribution

The default setup adds the required OpenFreeMap, OpenMapTiles, and
OpenStreetMap attribution control. Do not disable it unless the application
provides equivalent visible attribution elsewhere.

## Development

```sh
npm install
npm test
npm run typecheck
npm run build
npm run dev
```

See [NEXT_STEPS.md](./NEXT_STEPS.md) for the proposed motion, 3D/orbiting,
multi-source, and non-street layer roadmap.
