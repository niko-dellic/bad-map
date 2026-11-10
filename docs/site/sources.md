# Sources and semantic packs

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
worker. Dotted buildings share that worker request configuration. Native
MapLibre building layers use MapLibre's own source and request configuration.

## Network behavior

Calling `addTo()` fetches the configured TileJSON and visible MVT tiles. With no
source option, requests go to `https://tiles.openfreemap.org/planet`; the
package itself contains no analytics. [OpenFreeMap's public
service](https://openfreemap.org/) is keyless and permits commercial use, but
does not provide an SLA. Production hosts can replace it with any compatible
OpenMapTiles source or a self-hosted endpoint. Keep attribution enabled, or
provide equivalent visible attribution yourself.

## Attribution

Attribution from named sources is deduplicated into MapLibre's attribution
control. Do not disable it unless equivalent visible attribution is supplied by
the host application.

## API reference

See the [complete API reference](/api/) for signatures, options, methods, and types.
