# bad-map documentation

Make your map worse. Keep your integration predictable.

`bad-map` is a semantic low-resolution cartography library for MapLibre GL JS.
It reads vector-tile meaning and draws coarse fills, square-dot lines, labels,
and data layers. Your application retains control of the map and its data.

## Start here

1. [Install the library and render your first map](./getting-started).
2. [Choose sources and semantic packs](./sources).
3. [Adjust appearance, camera, buildings, and fog](./appearance).
4. [Add data and feature interactions](./data-layers).
5. [Configure workers and production hosting](./deployment).

[Browse the gallery](./gallery) · [Open the live demo](https://bad-map-sigma.vercel.app/demo/) · [Browse the API](./api/)

## Integration model

Create a MapLibre map in the browser, attach a `LowResBasemap`, then update its
configuration through the public methods. Rendering uses WebGL 2 and workers.
The package can be imported during server rendering; map construction must wait
until the client container is mounted.

Call `basemap.remove()` before `map.remove()` when your view unmounts. Keep source
attribution visible and handle the typed `error` event when loading remote data.

## Reference and support

The [API reference](./api/) is generated from the library's public TypeScript
entry point on every build. It includes `LowResBasemap`, semantic pack factories,
color helpers, events, and options. [Troubleshooting](./troubleshooting) covers
blank maps, worker policies, and source failures.
