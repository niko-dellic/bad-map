# bad-map

A semantic low-resolution cartography toolkit for MapLibre GL JS.

`bad-map` renders vector-tile meaning instead of pixelating an existing map.
Coarse area fills, ranked square-dot lines, scalar data, and labels are composed
independently, which leaves ordinary MapLibre and deck.gl layers crisp and
interactive. Greyscale is the default; full color remains one method call away.

## See it in motion

### Animated trips

[![Animated trips moving across a low-resolution map](https://raw.githubusercontent.com/niko-dellic/bad-map/main/docs/media/animated.webp)](https://github.com/niko-dellic/bad-map/blob/main/docs/media/animated.mp4)

### Pixelated heatmap

[![A pixelated heatmap rendered over a low-resolution map](https://raw.githubusercontent.com/niko-dellic/bad-map/main/docs/media/heatmap.webp)](https://github.com/niko-dellic/bad-map/blob/main/docs/media/heatmap.mp4)

Select either preview to open the original MP4 recording.

## Install

```sh
npm install bad-map
```

MapLibre GL JS is a required peer dependency and is installed automatically by
npm 7 and newer. Package managers that do not install peer dependencies should
install `maplibre-gl@^6` explicitly. The default keyless source is OpenFreeMap.

`bad-map` is a browser library, not a server-side map renderer. Creating a map
requires the DOM, a canvas, WebGL 2, and Web Workers. In SSR frameworks, import
and initialize it from a client-only component after the map container mounts.
Server-rendering the map itself is intentionally out of scope.

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

## Options and defaults

| Option                   | Default                                    | Purpose                                            |
| ------------------------ | ------------------------------------------ | -------------------------------------------------- |
| `source`                 | OpenFreeMap                                | Shorthand for the named `base` MVT source          |
| `sources`                | `{ base: source }`                         | Named OpenMapTiles-compatible TileJSON sources     |
| `layers`                 | `[streets()]`                              | Serializable semantic pack descriptors             |
| `theme`                  | `"dark"`                                   | Built-in theme name or complete custom theme       |
| `colorMode`              | `"greyscale"`                              | Basemap and label color composition                |
| `projectionMode`         | `"surface"`                                | Geographic surface or fixed screen lattice         |
| `camera`                 | Surface rotation and pitch, `maxPitch: 60` | Map interaction policy                             |
| `buildings3D`            | `false`                                    | Native OpenMapTiles building extrusions            |
| `fog`                    | Dithered and visible                       | Surface-edge atmosphere                            |
| `heatmap` / `dataLayers` | Empty and hidden                           | Package-owned visualization layers                 |
| `cell`                   | `8 × 16`, `dotSize: 2`                     | CSS-pixel character and dot geometry               |
| `locale`                 | `"en"`                                     | Preferred label language                           |
| `labels`                 | Visible and billboarded                    | Label visibility and surface alignment             |
| `attribution`            | `true`                                     | Install deduplicated source attribution            |
| `featureInteraction`     | `true`                                     | Hover and click ownership queries                  |
| `enforceNorthUp`         | `false`                                    | Disable host-map rotation and pitch while attached |
| `maxCachedTiles`         | `96`                                       | Shared fallback tile-cache budget                  |
| `renderThrottleMs`       | `70`                                       | Worker refresh cadence during movement             |
| `workerFactory`          | Bundled semantic worker                    | Advanced replacement semantic worker hook          |

## Layer ordering

Seven stable IDs divide the render stack:

```ts
basemap.layerIds.base; // fills and low-resolution linework
basemap.layerIds.buildings; // optional native 3D building extrusions
basemap.layerIds.data; // low-resolution data compositor
basemap.layerIds.markers; // marker boundary
basemap.layerIds.labels; // package labels
basemap.layerIds.fog; // atmospheric fog over all map content
basemap.layerIds.interaction; // top interaction boundary
```

Insert a native visualization immediately below the marker boundary to keep it
above the cartography and below labels:

```ts
map.addLayer(dataLayer, basemap.layerIds.markers);
```

Color modes only affect basemap cartography and labels. Native visualization
layers and the package data compositor keep their own palettes.

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

`LowResSource.request` supplies serializable `headers`, `credentials`, `mode`,
and `referrerPolicy` values to TileJSON and tile requests made by the semantic
worker. Native MapLibre layers, including optional 3D buildings, use MapLibre's
own source and request configuration instead.

## Pixelated data layers

The demo compares two renderers using 100,000 weighted NYC Uber pickup
locations from the public
[deck.gl screen-grid dataset](https://raw.githubusercontent.com/visgl/deck.gl-data/master/examples/screen-grid/uber-pickup-locations.json).

A standard MapLibre heatmap can be inserted below the marker boundary. It stays
smooth and remains outside package theme and greyscale changes:

```ts
map.addLayer(nativeHeatmapLayer, basemap.layerIds.markers);
```

Package-owned visualizations use an ID-based registry and a dedicated data
worker. Heatmaps, GeoJSON, and animated trips render through `bad-map-data`;
waypoints render through `bad-map-markers`. Both passes sit below labels and
retain their palettes when the basemap switches to greyscale.

The heatmap accepts compact
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
domain from changing while panning. Custom palettes remain unchanged when the
basemap switches between color and greyscale. Use `setHeatmapData()`,
`setHeatmapVisible()`, or
`clearHeatmap()` for runtime updates. These compatibility methods operate
through the same registry.

New applications can create multiple data layers directly:

```ts
basemap.setDataLayer({
  id: "route",
  type: "geojson",
  data: routeGeoJSON,
  order: 20,
  pickable: true,
  line: {
    color: (feature) =>
      feature.properties?.closed ? [230, 76, 91] : [87, 173, 133],
    width: 3,
  },
  fill: { color: [87, 173, 133], opacity: 0.35 },
});

basemap.setDataLayer({
  id: "destination",
  type: "waypoint",
  order: 100,
  style: "caret",
  size: 32,
  data: [{ id: "office", position: [-74.006, 40.7128] }],
});
```

Waypoint layers support `locator` targets and downward `caret` glyphs. Set
`style` and CSS-pixel `size` on the layer, or override either value on an
individual waypoint. Both shapes stay aligned to the square-dot lattice and
retain a contrasting halo.

GeoJSON supports points, lines, polygons, their multi-geometry variants, and
GeometryCollection data. Point, line, fill, and outline styles may be constants
or accessors. Accessors run once on the main thread; only normalized geometry
and style values cross the worker boundary. Invalid individual records are
skipped with typed, nonfatal `data` errors that include the layer ID.

Trips use paths with matching per-vertex timestamps:

```ts
basemap.setDataLayer({
  id: "vehicles",
  type: "trips",
  data: trips,
  playing: true,
  currentTime: 0,
  loopLength: 1800,
  trailLength: 180,
  speed: 1,
  width: 2,
});

basemap.setTripsPlayback("vehicles", { playing: false, currentTime: 900 });
basemap.seekTripsPlayback("vehicles", 720, { playing: false });
basemap.stepTripsPlayback("vehicles", 15);

basemap.updateDataLayer("vehicles", {
  type: "trips",
  width: 3,
  opacity: 0.8,
});
```

`seekTripsPlayback` and `stepTripsPlayback` support video-style timelines
without rebuilding or resending trip geometry. Seeking clamps to the loop by
default; pass `{ wrap: true }` for circular stepping. The optional `playing`
flag lets a control pause while dragging and restore its previous playback
state on release.

Use `setDataLayer`, `updateDataLayer`, `removeDataLayer`,
`setDataLayerVisible`, `getDataLayers`, and `clearDataLayers` to manage the
registry. Common visibility, opacity, ordering, and picking updates use compact
worker patches instead of resending geometry. Static layer rasters are reused
while trips update at a 30 fps worker cadence; the latest texture continues to
reproject at display refresh rate. `queryDataFeatures` and the
`datafeatureenter`, `datafeatureleave`, and `datafeatureclick` events expose the
winning dot owner independently from basemap feature queries. Input URLs remain
the application's responsibility; the package accepts parsed data and has no
deck.gl runtime dependency.

Data picking is independent from basemap feature picking:

```ts
basemap.on("datafeatureclick", ({ feature }) => {
  console.log(feature.layerId, feature.featureId, feature.properties);
});

const features = basemap.queryDataFeatures({ x: 320, y: 180 });
```

## Camera modes

`surface` is the default low-resolution 3D mode. It starts top-down at the
host map's current pitch; enabling buildings does not change that camera. The
semantic frame is placed on a flat Web Mercator plane and transformed with
MapLibre's public custom-layer camera matrix, so dots foreshorten during pitch
and orbiting while labels billboard to the viewport by default. Its worker
frame is fitted to the complete camera ground footprint. A second bounded
full-zoom frame covers the near and central ground, so changing pitch does not
change the semantic zoom or lattice density; only the compressed far field
uses the coarser coverage frame.
Pitch can be disabled independently with `camera: { pitch: false }`.

```ts
const basemap = new LowResBasemap({
  camera: { rotation: true, pitch: true, maxPitch: 70 },
});

// Restore map-aligned, foreshortened labels when that is the desired style.
basemap.setLabelsBillboard(false);
```

The same choice can be made at construction with
`labels: { visible: true, billboard: false }`. The boolean `labels` shorthand
continues to control visibility.

Optional atmospheric fog hides the finite surface edge as the map approaches
the horizon. Regular fog uses a smooth blend; dithered fog uses a 4×4 ordered
pattern anchored to CSS pixels, so its visual scale is stable on retina
displays. Fog is inactive in screen mode and eases in over the first 20 degrees
of pitch. Fog defaults to enabled in the dithered style. Set `fog: false` or
select disabled in the demo to turn it off. In the demo, fog is controlled
exclusively from Display → Atmosphere in the side pane.

The demo also adds its own dithered screen-space vignette above the map. This
overlay is not exported by the package. Its dedicated FX-tab controls adjust
how far the fade reaches into the viewport, choose a screen-rectangle or
aspect-ratio oval base, morph either base toward a true circle, select linear,
smooth, or edge-weighted falloff, and tune opacity. At zero circularity, the
rectangle base uses equal-distance contours from all four edges and corners. The default
linear falloff uses a 64-level 8×8 ordered pattern. The falloff controls only
pixel coverage; selected dither pixels use the configured opacity. Keeping
coverage and pixel alpha independent avoids accidentally squaring the gradient
and makes the optical fade span the full configured reach. It reaches 100%
opacity at the viewport edge. Its dither color follows the composed theme
ground by default, or can be replaced with an explicit color that remains
unchanged across theme and greyscale updates.

The FX tab also includes an optional demo-only fisheye pass. It applies the
same aspect-corrected radial polynomial used by draaimolen's post-processing
effect to the completed map canvas while leaving HTML controls untouched.
Broad curvature (`k1`) controls the `r²` bend that begins nearer the center,
while edge curvature (`k2`) independently controls the edge-concentrated `r⁴`
bend. Overall strength scales both coefficients together without changing
their relationship, and radius controls where those terms reach their
configured values. The fisheye is enabled by default, and changing it only
repaints the map; it does not request a new worker rasterization. The settings
panel starts collapsed so the map remains the initial focus.

```ts
const basemap = new LowResBasemap({
  fog: {
    visible: true,
    mode: "dithered",
    start: 0.55,
    end: 0.95,
    opacity: 1,
  },
});

basemap.setFog({ mode: "regular", color: [20, 24, 30] });
basemap.setFogVisible(false);
```

`start` and `end` are screen-space depth positions from the bottom/near edge
(`0`) to the top/far edge (`1`). They are independent of MapLibre's camera clip
planes. Ground-ray intersection is used only to make exposed frame boundaries
fully fogged. Without an explicit color, fog follows the active theme's
composed ground color, including greyscale changes. Fog is rendered after
package labels and the documented data slots, while controls outside the
WebGL canvas remain clear.

`screen` keeps dots square and locked to the viewport while pan, zoom, and
bearing changes reproject the most recent worker frame. It can be selected
explicitly when pitch is not required:

```ts
const basemap = new LowResBasemap({ projectionMode: "screen" });
```

OpenMapTiles building heights can optionally be rendered as native MapLibre
extrusions above the semantic surface and below application data:

```ts
const basemap = new LowResBasemap({
  buildings3D: { visible: true, minZoom: 14, opacity: 0.82 },
});

basemap.setBuildings3DVisible(false);
```

Changing building visibility never changes projection, bearing, or pitch.

The building source defaults to the named `base` source and expects an
OpenMapTiles `building` layer with `render_height`, `render_min_height`, and
`hide_3d` properties. Extrusions use the active theme and greyscale mode. They
are smooth native geometry by design; the semantic ground map retains its
square-dot treatment. Configure authorization for the semantic worker through
`LowResSource.request`; configure authorization for the native building source
through the host MapLibre map. Terrain elevation is not yet part of surface
mode.

## Runtime API

`LowResBasemap` provides:

- `addTo(map)` and `remove()`
- `setTheme(theme)` and `setColorMode("color" | "greyscale")`
- `setCell(...)`, `setLocale(...)`, `setLabelsVisible(...)`,
  `setLabelsBillboard(...)`, and `getLabelsBillboard()`
- `setSource(...)`, `setSources(...)`, and `setSourceTime(...)`
- `setLayers(...)`, `getLayers()`, and `setLayerVisible(...)`
- `setProjectionMode(...)` and `setCamera(...)`
- `setBuildings3DVisible(...)` and `getBuildings3DVisible()`
- `setFog(...)`, `setFogVisible(...)`, and `getFogOptions()`
- `setHeatmap(...)`, `setHeatmapData(...)`, `setHeatmapVisible(...)`,
  `getHeatmapOptions()`, and `clearHeatmap()`
- `setDataLayer(...)`, `updateDataLayer(...)`, `removeDataLayer(...)`,
  `setDataLayerVisible(...)`, `getDataLayers()`, and `clearDataLayers()`
- `setTripsPlayback(...)`, `seekTripsPlayback(...)`,
  `stepTripsPlayback(...)`, `getTripsPlayback(...)`, and
  `queryDataFeatures(...)`
- `setFeatureInteractionEnabled(...)`, `getFeatureInteractionEnabled()`,
  `setSelectedFeature(...)`, `queryFeatures(...)`, and `refresh()`
- typed `on(...)` and `off(...)` event subscriptions
- typed load, render, error, basemap-feature, data-feature, selection, style,
  layer, time, projection, 3D-building, fog, and heatmap events

Hover and persistent selection use the transferable owner texture. Query
results include `sourceId` and `packId`, and `featureMatches` provides a helper
for filtering those results.

## Rendering pipeline

1. A worker discovers named TileJSON sources, bounds concurrency, retries
   failures, and maintains per-source decoded LRUs.
2. Enabled packs normalize and deterministically order semantic features.
3. Polygons become categorical or scalar dot grids; water derives coastlines.
4. A separate data worker rasterizes density, GeoJSON, trips, and locators into
   dot-resolution color and owner buffers.
5. Integer line paths compete by semantic rank inside each character cell.
6. Compact typed buffers are transferred to WebGL 2 cartography, data, and
   marker compositors.
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

## Troubleshooting

- **Blank or zero-sized map:** give the map container an explicit width and
  height before constructing MapLibre.
- **Server-rendering errors:** import and initialize both MapLibre and
  `bad-map` in a client-only component after mount.
- **Worker or CSP failures:** allow workers created from the application bundle
  and include the corresponding `worker-src` policy.
- **TileJSON or tile failures:** confirm browser CORS access and place
  serializable authorization values in `LowResSource.request`.
- **Unsupported rendering:** `bad-map` requires WebGL 2 and Web Mercator; it
  does not currently provide a canvas, WebGL 1, globe, or server renderer.

## Development

The repository is organized by internal domain while publishing one npm
package. See [ARCHITECTURE.md](./docs/ARCHITECTURE.md) for module boundaries and
the expected extension path for new data-layer types.

```sh
npm ci
npm run verify
npm run test:e2e:functional
npm run test:e2e
npm run dev
```

`npm run verify` checks formatting, types, unit tests, declarations, the
production build, and an isolated packed-package consumer. The full Playwright
suite includes platform-specific visual baselines; the functional subset is
used in CI.

Before submitting a change, read the
[contribution guide](https://github.com/niko-dellic/bad-map/blob/main/CONTRIBUTING.md).
Security issues should follow the
[security policy](https://github.com/niko-dellic/bad-map/blob/main/SECURITY.md),
not a public issue. The
[release checklist](https://github.com/niko-dellic/bad-map/blob/main/docs/RELEASING.md)
documents the maintainer workflow.

Useful individual commands:

```sh
npm test
npm run typecheck
npm run build
npm run api:check
npm run test:package
npm run test:e2e
```

See the
[project roadmap](https://github.com/niko-dellic/bad-map/blob/main/docs/NEXT_STEPS.md)
for implementation status and remaining production-depth work around terrain,
animated fields, and dense picking.
