# Data layers and interaction

## Layer ordering

Seven stable IDs divide the render stack:

```ts
basemap.layerIds.base; // fills and low-resolution linework
basemap.layerIds.buildings; // optional dotted or native 3D buildings
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

## Runtime API

`LowResBasemap` provides:

- `addTo(map)` and `remove()`
- `setTheme(theme)` and `setColorMode("color" | "greyscale")`
- `setCell(...)`, `setLocale(...)`, `setLabelsVisible(...)`,
  `setLabelsBillboard(...)`, and `getLabelsBillboard()`
- `setSource(...)`, `setSources(...)`, and `setSourceTime(...)`
- `setLayers(...)`, `getLayers()`, and `setLayerVisible(...)`
- `setProjectionMode(...)` and `setCamera(...)`
- `setBuildings3DVisible(...)`, `getBuildings3DVisible()`,
  `setBuildings3DAppearance(...)`, and `getBuildings3DAppearance()`
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

## API reference

See the [complete API reference](/api/) for signatures, options, methods, and types.
