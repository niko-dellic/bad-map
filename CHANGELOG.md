# Changelog

## Unreleased

## 0.11.0

### Added

- Same-origin semantic and data worker package exports plus additive worker
  factory overrides for applications with strict content security policies.
- Packed-artifact smoke coverage for Node imports, strict CSP, Firefox, and
  WebKit in addition to Chromium.

### Changed

- Deferred data-worker construction until a visible package data layer needs
  it.
- Clarified that package imports are SSR-safe while map construction remains
  client-only, and documented default network, browser, and CSP behavior.

## 0.10.2

### Added

- A twelve-image README gallery covering dark and light themes, greyscale and
  full-color rendering, semantic packs, multiple zoom levels, 3D buildings,
  heatmaps, trips, highway paths, GeoJSON geometry, and waypoint glyphs.
- A reproducible Playwright gallery capture command and validation check for
  image dimensions, README references, and asset size budgets.

### Changed

- Documented the gallery maintenance workflow while keeping generated media
  outside the published npm tarball.

## 0.10.1

### Added

- Demo presentation controls for automatic rotation, fullscreen display, and
  interface visibility, including keyboard shortcuts.
- Deterministic browser coverage for packed-package consumers using both
  MapLibre GL JS 5 and 6.

### Changed

- Updated the development toolchain to MapLibre GL JS 6.4, Vitest 4, Vite 8,
  and the latest major GitHub checkout and Node setup actions.
- Documented MapLibre GL JS 6 ESM worker setup and added animated trips and
  pixelated heatmap previews to the README.
- Improved demo startup so the landing interface appears only after the first
  map render.

## 0.10.0

### Added

- Atomic constructor and runtime validation for projection and camera options.
- Node 20 compatibility coverage, superseded-run cancellation, and monthly
  dependency automation.
- A canonical README options reference, picking example, and troubleshooting
  guide.

### Changed

- Made data-layer patches discriminated by layer type. Calls to
  `updateDataLayer` must now include the stored layer type, for example
  `updateDataLayer("vehicles", { type: "trips", width: 3 })`.
- Split demo controllers and browser tests by responsibility without changing
  their behavior.
- Replaced the duplicate documentation page with a redirect to the canonical
  README and refreshed contributor, architecture, roadmap, and release guides.

### Removed

- Removed implementation-only semantic buffer enums and zoom helpers from the
  package root: `FillClass`, `LabelInk`, `LineClass`, `bandFor`,
  `effectiveStyleZoom`, and `sourceZoom`.
- Removed the internal `DataRasterFrame` type from the package root.

## 0.9.1

### Changed

- Simplified the primary installation command to `npm install bad-map`, since
  npm 7 and newer install the required MapLibre peer dependency automatically.
- Clarified the explicit MapLibre fallback for package managers that do not
  install peer dependencies.
- Moved maintainer and architecture guides into the conventional `docs/`
  directory and updated repository and package links.
- Made the release workflow's pan, zoom, and resize test use MapLibre's public
  zoom API instead of assuming an optional navigation control exists.

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
  aspect-corrected radial polynomial shader with independent broad (`k1`) and
  edge (`k2`) curvature, shared strength, and viewport-radius controls. It is
  enabled by default, with the demo settings panel initially collapsed.
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
