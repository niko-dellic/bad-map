# Changelog

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
