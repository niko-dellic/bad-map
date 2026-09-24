# Troubleshooting

## Troubleshooting

- **Blank or zero-sized map:** give the map container an explicit width and
  height before constructing MapLibre.
- **Server-rendering errors:** defer MapLibre map construction and `addTo()`
  until after the client-side map container mounts. Importing `bad-map` alone
  does not require browser globals.
- **Worker or CSP failures:** allow `blob:` workers for the default setup, or
  configure both same-origin worker factories as shown above. MapLibre's own
  worker policy is separate.
- **TileJSON or tile failures:** confirm browser CORS access and place
  serializable authorization values in `LowResSource.request`.
- **Unsupported rendering:** `bad-map` requires WebGL 2 and Web Mercator; it
  does not currently provide a canvas, WebGL 1, globe, or server renderer.

## API reference

See the [complete API reference](/api/) for signatures, options, methods, and types.
