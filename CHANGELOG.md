# Changelog

## 0.9.0

### Added

- An ID-based data-layer registry for low-resolution heatmaps, waypoints,
  complete GeoJSON geometry, and timestamped animated trips.
- A dedicated data-raster worker, dot-resolution RGBA/owner buffers, package
  marker rendering, data feature queries, and typed data interaction events.
- Lazy US highway safety and NYC animated-trips examples with data-driven
  styling, picking, playback, and style controls.
- A video-style trips transport with play/pause, drag scrubbing, keyboard
  seeking, fixed-step controls, and reusable seek/step package methods.
- Layer- and point-level waypoint glyph selection, including locator and down
  caret styles, plus live waypoint style and size controls in the demo.
- Optional regular and ordered-dithered atmospheric fog for pitched surface
  maps, with disabled/regular/dithered demo controls, screen-space start/end
  tuning, custom or theme-derived color, side-pane controls, runtime controls,
  theme-aware defaults, and dithered fog enabled by default.
- A dedicated FX tab for demo-only screen-space effects, currently containing a
  CSS-pixel-dithered screen vignette with configurable edge reach,
  circularity, opacity, visibility, and optical falloff curves. Its default
  8×8 linear pattern reduces visible density banding, reaches full opacity,
  supports rectangle or oval base shapes, and supports theme-following or
  custom dither colors. Coverage and selected-pixel alpha are independent so
  the optical gradient is not unintentionally squared near the edge.
- A demo-only fisheye post-process in the FX tab, adapted from draaimolen's
  aspect-corrected radial polynomial shader with configurable primary and
  higher-order curvature, strength, and viewport radius. It is enabled by
  default, with the demo settings panel initially collapsed.
- A self-contained browser distribution with embedded workers, NodeNext-safe
  declarations, package metadata, third-party notices, and an isolated packed
  consumer test.
- Open-source contribution, security, release, issue, pull-request, CI, and npm
  trusted-publishing documentation and automation.

### Changed

- Preserved semantic zoom and near-field lattice density through the full
  supported pitch range with a feathered full-resolution surface detail frame.
- Enabled the animated NYC trips example and hid cartographic labels in the
  initial demo view so colored movement is immediately legible.
- Raised the initial trips opacity to full strength and kept nonfatal data
  warnings from replacing the primary map render-latency readout.
- Replaced the demo's DOM place pin with a lattice-aligned locator target.
- Moved heatmap processing into the extensible data worker while preserving
  the existing heatmap methods and visual grammar.
- Cached static data rasters during trip playback and added incremental worker
  patches for visibility, opacity, ordering, and picking changes.
- Activated `bad-map-markers` as the waypoint compositor and kept every data
  palette independent from basemap greyscale.
- Excluded demo assets and implementation-only worker artifacts from the npm
  tarball while keeping production source maps for the public bundle.
- Organized library code and tests by basemap, core, data-layer, render,
  semantic, theme, tile, and worker domains without changing the root package
  API.

## 0.8.0

### Added

- Native MapLibre and worker-rendered low-resolution heatmap examples using
  weighted NYC pickup data.
- Compact point-density input, bounded worker kernels, stable density domains,
  four-stop palettes, square-dot dithering, and runtime
  heatmap controls.
- Screen-aligned surface labels by default, with constructor and runtime APIs
  for selecting map-aligned labels instead.

### Changed

- Moved scalar and density textures into the transparent `bad-map-data`
  compositor, establishing one extension point for low-resolution data layers.
- Kept visualization palettes independent from basemap theme and greyscale
  composition.
- Reorganized the demo into a resizable, collapsible tabbed sidebar with
  Phosphor icons and a dedicated data tab.
- Enabled demo rotation by default and removed the demo-only weather source
  and time controls.
- Made the geographic 3D surface the default projection and decoupled the demo
  building toggle from projection and camera changes.

## 0.7.0

### Added

- Named MVT sources with per-source caches, concurrency, retries, attribution,
  typed errors, and temporal `{time}` keys.
- Serializable street, transit, topographic, weather, political, marine, and
  land-use packs with deterministic priority composition.
- Quantized numeric textures for weather and elevation-style polygon data.
- Stable application-data, marker, and interaction insertion slots.
- Pack-aware feature queries, GPU hover highlighting, and persistent selection.
- Bearing-aware screen projection and an experimental pitched flat-surface mode.
- Camera-footprint fitting for complete surface coverage at pitch, with bounded
  worker resolution.
- Optional theme-aware native 3D buildings from OpenMapTiles height fields.
- A side-panel demo for appearance, cell, camera, pack, and source options.

### Changed

- Greyscale is now the default color mode.
- Feature results and source errors include source and pack provenance.

## 0.2.0

### Added

- Orthogonal `colorMode: "color" | "greyscale"` option.
- Runtime `setColorMode` method and typed `stylechange` event.
- Linear-light greyscale conversion with semantic road-rank contrast.
- Screen-lattice-preserving reprojection during north-up pan and zoom.
- Translated stale labels with zoom fading and exact settled replacement.
- Motion-aware feature hit testing.
- Coalescing worker render queue for obsolete interaction frames.
- Greyscale control and runtime diagnostics in the demonstration app.
- Deterministic MVT fixtures, public API snapshot, Playwright interactions,
  performance checks, and standard/retina visual regression baselines.

### Changed

- Theme and label-visibility changes now repaint without rerunning semantic
  rasterization.
- Package version advanced to `0.2.0`.
