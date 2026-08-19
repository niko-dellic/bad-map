# Changelog

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
