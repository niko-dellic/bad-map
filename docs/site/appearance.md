# Appearance and rendering

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
| `buildings3D`            | Visible fill + edges, dots off             | Low-resolution OpenMapTiles building extrusions    |
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
| `workers`                | Bundled workers                            | Raster and data worker factory overrides           |
| `workerFactory`          | Bundled semantic worker                    | Deprecated alias for `workers.raster`              |

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

OpenMapTiles building heights render by default as low-resolution extrusions
above the semantic surface and below application data. Interior dots default
to off, leaving the three-band fill and silhouette edges:

```ts
const basemap = new LowResBasemap({
  buildings3D: { visible: true, minZoom: 14, opacity: 0.82, dots: false },
});

basemap.setBuildings3DVisible(false);
basemap.setBuildings3DAppearance({
  fill: false,
  dots: false,
  edges: true,
  edgeStrength: 1.25,
  heightScale: 1,
});
```

| Option         | Default    | Purpose                                   |
| -------------- | ---------- | ----------------------------------------- |
| `visible`      | `true`     | Show buildings in surface mode            |
| `style`        | `"dotted"` | Low-resolution mesh or native MapLibre    |
| `sourceId`     | `"base"`   | Named OpenMapTiles-compatible source      |
| `minZoom`      | `14`       | First zoom at which buildings appear      |
| `opacity`      | `0.82`     | Surface and edge opacity                  |
| `heightScale`  | `1`        | Height and minimum-height multiplier      |
| `fill`         | `true`     | Draw three-band surfaces in dotted mode   |
| `dots`         | `false`    | Draw interior surface dots in dotted mode |
| `edges`        | `true`     | Draw roof and corner ink in dotted mode   |
| `edgeStrength` | `1`        | CSS-pixel edge-weight multiplier          |

When upgrading from 0.11.x, set `buildings3D: false` to retain the previous
no-buildings default. The original smooth extrusion appearance remains
available with `buildings3D: { visible: true, style: "native" }`.

Changing building visibility never changes projection, bearing, or pitch.

The building source defaults to the named `base` source and expects an
OpenMapTiles `building` layer with `render_height`, `render_min_height`, and
`hide_3d` properties. The default `dotted` style triangulates roofs and walls
in the semantic worker, colors them from the active theme, and wraps the same
2×4 square-dot lattice around their surfaces. Dots rotate and foreshorten with
the buildings. Three flat lighting tones separate planes, restrained dots add
surface texture, and cell-aligned roof perimeters and vertical corners restore
the building silhouettes without introducing smooth vector outlines. Fill,
dots, and edges can be enabled independently; edge-only mode retains a hidden
depth prepass so rear geometry does not show through the buildings.

The original MapLibre extrusion remains available when native rendering or
host-map request handling is preferable:

```ts
const basemap = new LowResBasemap({
  buildings3D: { visible: true, style: "native" },
});
```

Dotted buildings use `LowResSource.request`; configure authorization for
native buildings through the host MapLibre map. Terrain elevation and shaped
roofs are not yet part of surface mode.

## API reference

See the [complete API reference](/api/) for signatures, options, methods, and types.
