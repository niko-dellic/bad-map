import type { Map as MapLibreMap, PointLike } from "maplibre-gl";
import type { Feature, GeoJsonProperties, GeoJSON } from "geojson";

export type RGB = readonly [number, number, number];

export interface LowResSource {
  /** TileJSON endpoint for an OpenMapTiles-compatible vector source. */
  tileJSON: string;
  /** Serializable fetch options; functions intentionally cannot cross the worker boundary. */
  request?: Pick<
    RequestInit,
    "credentials" | "headers" | "mode" | "referrerPolicy"
  >;
  attribution?: string;
  /** Optional value substituted into `{time}` in tile templates. */
  timeKey?: string | number;
  /** Per-source decoded/raw tile cache budget. */
  maxCachedTiles?: number;
  maxConcurrentRequests?: number;
  retryCount?: number;
}

export type BuiltinLayerAdapter =
  | "streets"
  | "transit"
  | "topographic"
  | "weather"
  | "political"
  | "marine"
  | "landuse";

export interface LowResLayerPackDescriptor {
  id: string;
  source: string;
  adapter: BuiltinLayerAdapter;
  sourceLayers: string[];
  enabled?: boolean;
  /** Higher-priority packs win ownership when features overlap. */
  priority?: number;
  /** Optional scalar property quantized into the pack's numeric texture. */
  numeric?: {
    property: string;
    min: number;
    max: number;
  };
}

export type LowResProjectionMode = "screen" | "surface";

export interface LowResCameraOptions {
  rotation?: boolean;
  pitch?: boolean;
  maxPitch?: number;
}

export interface LowResLabelsOptions {
  /** Whether labels are shown. */
  visible?: boolean;
  /** Keep labels aligned to the viewport in surface mode. Defaults to true. */
  billboard?: boolean;
}

export interface LowResBuildings3DOptions {
  /** Whether extruded buildings are shown. They are only visible in surface mode. */
  visible?: boolean;
  /** Named vector source containing the OpenMapTiles `building` layer. */
  sourceId?: string;
  /** Map zoom at which extrusions begin to appear. */
  minZoom?: number;
  /** Extrusion opacity from zero to one. */
  opacity?: number;
  /** Multiplier applied to `render_height` and `render_min_height`. */
  heightScale?: number;
}

export type LowResFogMode = "regular" | "dithered";

export interface LowResFogOptions {
  /** Whether fog is shown in the 3D surface projection. */
  visible?: boolean;
  /** Smooth alpha blending or viewport-anchored ordered dithering. */
  mode?: LowResFogMode;
  /** Screen-space depth at which fog begins: zero is bottom, one is top. */
  start?: number;
  /** Screen-space depth at which fog reaches full strength. */
  end?: number;
  /** Maximum fog opacity from zero to one. */
  opacity?: number;
  /** Optional fixed fog color. The active theme ground color is used by default. */
  color?: RGB | undefined;
}

export type LowResHeatmapPoint = readonly [
  longitude: number,
  latitude: number,
  weight?: number,
];

export interface LowResHeatmapOptions {
  /** Compact longitude, latitude, optional-weight triplets. */
  data?: readonly LowResHeatmapPoint[] | Float32Array;
  visible?: boolean;
  /** Kernel radius in CSS pixels. */
  radius?: number;
  /** Density multiplier applied before quantization. */
  intensity?: number;
  /** Stable upper density bound. Zero selects the current view maximum. */
  maxDensity?: number;
  opacity?: number;
  /** Four colors sampled from low to high density. Basemap greyscale does not modify them. */
  palette?: readonly [RGB, RGB, RGB, RGB];
}

export type LowResDataAccessor<T> =
  T | ((feature: Feature, index: number) => T);

export interface LowResDataLayerBase {
  /** Stable ID used to update, order, and remove this layer. */
  id: string;
  visible?: boolean;
  opacity?: number;
  /** Higher values draw later. Equal values retain insertion order. */
  order?: number;
  pickable?: boolean;
}

export interface LowResHeatmapDataLayer extends LowResDataLayerBase {
  type: "heatmap";
  data: readonly LowResHeatmapPoint[] | Float32Array;
  radius?: number;
  intensity?: number;
  maxDensity?: number;
  palette?: readonly [RGB, RGB, RGB, RGB];
}

export interface LowResWaypoint {
  id?: string | number;
  position: readonly [longitude: number, latitude: number];
  properties?: GeoJsonProperties;
  color?: RGB;
  haloColor?: RGB;
  size?: number;
}

export interface LowResWaypointDataLayer extends LowResDataLayerBase {
  type: "waypoint";
  data: readonly LowResWaypoint[];
  color?: RGB;
  haloColor?: RGB;
  /** Glyph size in CSS pixels. */
  size?: number;
}

export interface LowResGeoJSONPointStyle {
  color?: LowResDataAccessor<RGB>;
  radius?: LowResDataAccessor<number>;
}

export interface LowResGeoJSONLineStyle {
  color?: LowResDataAccessor<RGB>;
  width?: LowResDataAccessor<number>;
  dash?: readonly [on: number, off: number];
}

export interface LowResGeoJSONFillStyle {
  color?: LowResDataAccessor<RGB>;
  opacity?: LowResDataAccessor<number>;
  outlineColor?: LowResDataAccessor<RGB>;
  outlineWidth?: LowResDataAccessor<number>;
}

export interface LowResGeoJSONDataLayer extends LowResDataLayerBase {
  type: "geojson";
  data: GeoJSON;
  point?: LowResGeoJSONPointStyle;
  line?: LowResGeoJSONLineStyle;
  fill?: LowResGeoJSONFillStyle;
}

export interface LowResTrip {
  id?: string | number;
  path: readonly (readonly [longitude: number, latitude: number])[];
  timestamps: readonly number[];
  color?: RGB;
  properties?: GeoJsonProperties;
}

export interface LowResTripsDataLayer extends LowResDataLayerBase {
  type: "trips";
  data: readonly LowResTrip[];
  color?: RGB;
  width?: number;
  trailLength?: number;
  currentTime?: number;
  loopLength?: number;
  speed?: number;
  playing?: boolean;
}

export type LowResDataLayer =
  | LowResHeatmapDataLayer
  | LowResWaypointDataLayer
  | LowResGeoJSONDataLayer
  | LowResTripsDataLayer;

export type LowResDataLayerUpdate = Partial<
  Omit<LowResDataLayerBase, "id"> & {
    data: unknown;
    radius: number;
    intensity: number;
    maxDensity: number;
    palette: readonly [RGB, RGB, RGB, RGB];
    color: RGB;
    haloColor: RGB;
    size: number;
    point: LowResGeoJSONPointStyle;
    line: LowResGeoJSONLineStyle;
    fill: LowResGeoJSONFillStyle;
    width: number;
    trailLength: number;
    currentTime: number;
    loopLength: number;
    speed: number;
    playing: boolean;
  }
>;

export interface LowResDataLayerState {
  id: string;
  type: LowResDataLayer["type"];
  visible: boolean;
  opacity: number;
  order: number;
  pickable: boolean;
  featureCount: number;
}

export interface LowResTripsPlayback {
  playing?: boolean;
  currentTime?: number;
  speed?: number;
  trailLength?: number;
}

export interface LowResTripsSeekOptions {
  /** Override playback after seeking. Omit to preserve the current state. */
  playing?: boolean;
  /** Wrap through the loop boundary instead of clamping to its endpoints. */
  wrap?: boolean;
}

export interface CellGeometry {
  /** Character-cell width in CSS pixels. */
  width: number;
  /** Character-cell height in CSS pixels. */
  height: number;
  /** Square Braille-dot side length in CSS pixels. */
  dotSize: number;
}

export interface LowResTheme {
  name: string;
  fills: {
    ground: RGB;
    urban: RGB;
    park: RGB;
    water: RGB;
    building: RGB;
  };
  lines: {
    waterway: RGB;
    ferry: RGB;
    borderState: RGB;
    borderCountry: RGB;
    coast: RGB;
    path: RGB;
    transit: RGB;
    rail: RGB;
    aeroway: RGB;
    service: RGB;
    minor: RGB;
    secondary: RGB;
    ramp: RGB;
    primary: RGB;
    trunk: RGB;
    motorway: RGB;
    route: RGB;
  };
  labels: {
    city: RGB;
    town: RGB;
    village: RGB;
    area: RGB;
    road: RGB;
    roadMinor: RGB;
    shield: RGB;
    water: RGB;
    park: RGB;
    poi: RGB;
    medical: RGB;
  };
  marker: RGB;
  hover: RGB;
}

export type BuiltinThemeName = "dark" | "light";
export type LowResColorMode = "color" | "greyscale";

export interface LowResBasemapOptions {
  source?: LowResSource;
  /** Named sources. The singular source option remains shorthand for base. */
  sources?: Record<string, LowResSource>;
  layers?: LowResLayerPackDescriptor[];
  theme?: BuiltinThemeName | LowResTheme;
  /** Basemap cartography mode. Visualization and data palettes remain unchanged. */
  colorMode?: LowResColorMode;
  /** Ground compositor projection. Defaults to the geographic surface. */
  projectionMode?: LowResProjectionMode;
  camera?: LowResCameraOptions;
  /** Native MapLibre building extrusions for the surface projection. */
  buildings3D?: boolean | LowResBuildings3DOptions;
  /** Atmospheric fog for the 3D surface projection. */
  fog?: boolean | LowResFogOptions;
  /** Optional worker-rendered point-density layer. */
  heatmap?: LowResHeatmapOptions;
  /** Package-owned visualization layers rendered outside basemap greyscale. */
  dataLayers?: readonly LowResDataLayer[];
  cell?: Partial<CellGeometry>;
  locale?: string;
  /** Label visibility shorthand, or detailed label rendering options. */
  labels?: boolean | LowResLabelsOptions;
  attribution?: boolean;
  /** Enables pointer hover/click feature queries. Defaults to true. */
  featureInteraction?: boolean;
  enforceNorthUp?: boolean;
  maxCachedTiles?: number;
  renderThrottleMs?: number;
  /** Advanced hook for bundling additional worker-side adapters. */
  workerFactory?: () => Worker;
}

export type LowResFeatureKind =
  "fill" | "line" | "place" | "water" | "park" | "poi";

export interface LowResFeature {
  id: number;
  kind: LowResFeatureKind;
  class: string;
  name: string;
  sourceLayer: string;
  sourceId: string;
  packId: string;
  properties: Record<string, string | number | boolean | null>;
  cell: { column: number; row: number };
  lngLat: { lng: number; lat: number };
}

export interface LowResDataFeature {
  owner: number;
  layerId: string;
  layerType: LowResDataLayer["type"];
  featureId?: string | number;
  properties: GeoJsonProperties;
  cell: { column: number; row: number };
  lngLat: { lng: number; lat: number };
}

export interface LowResError {
  code: "source" | "tile" | "decode" | "render" | "data" | "unsupported-camera";
  message: string;
  fatal: boolean;
  cause?: unknown;
  sourceId?: string;
  packId?: string;
  layerId?: string;
}

export interface LowResEventMap {
  load: { target: LowResBasemapLike };
  render: { target: LowResBasemapLike; durationMs: number; generation: number };
  datarender: {
    target: LowResBasemapLike;
    durationMs: number;
    generation: number;
  };
  error: { target: LowResBasemapLike; error: LowResError };
  featureenter: { target: LowResBasemapLike; feature: LowResFeature };
  featureleave: { target: LowResBasemapLike; feature: LowResFeature };
  featureclick: { target: LowResBasemapLike; feature: LowResFeature };
  selectionchange: {
    target: LowResBasemapLike;
    feature?: LowResFeature;
  };
  stylechange: {
    target: LowResBasemapLike;
    theme: LowResTheme;
    colorMode: LowResColorMode;
  };
  layerchange: {
    target: LowResBasemapLike;
    layers: LowResLayerPackDescriptor[];
  };
  projectionchange: {
    target: LowResBasemapLike;
    mode: LowResProjectionMode;
  };
  buildingschange: {
    target: LowResBasemapLike;
    visible: boolean;
  };
  fogchange: {
    target: LowResBasemapLike;
    visible: boolean;
    mode: LowResFogMode;
    start: number;
    end: number;
    opacity: number;
    color: RGB;
  };
  heatmapchange: {
    target: LowResBasemapLike;
    visible: boolean;
    pointCount: number;
  };
  datalayerchange: {
    target: LowResBasemapLike;
    id: string;
    action: "upsert" | "remove" | "clear";
    layer?: LowResDataLayerState;
  };
  datafeatureenter: {
    target: LowResBasemapLike;
    feature: LowResDataFeature;
  };
  datafeatureleave: {
    target: LowResBasemapLike;
    feature: LowResDataFeature;
  };
  datafeatureclick: {
    target: LowResBasemapLike;
    feature: LowResDataFeature;
  };
  timechange: {
    target: LowResBasemapLike;
    sourceId: string;
    timeKey: string | number;
  };
}

export interface LowResBasemapLike {
  readonly layerIds: {
    readonly base: string;
    readonly buildings: string;
    readonly data: string;
    readonly markers: string;
    readonly labels: string;
    readonly fog: string;
    readonly interaction: string;
  };
  queryFeatures(point: PointLike): LowResFeature[];
  setFeatureInteractionEnabled(enabled: boolean): this;
  getFeatureInteractionEnabled(): boolean;
}

export interface RasterViewState {
  center: { lng: number; lat: number };
  zoom: number;
  bearing: number;
  pitch: number;
  width: number;
  height: number;
  pixelRatio: number;
  cell: CellGeometry;
  locale: string;
}

export interface FeatureRecord {
  id: number;
  kind: LowResFeatureKind;
  class: string;
  name: string;
  sourceLayer: string;
  sourceId: string;
  packId: string;
  properties: Record<string, string | number | boolean | null>;
}

export interface LabelPlacement {
  column: number;
  row: number;
  text: string;
  ink: number;
  bold: boolean;
  owner: number;
}

export interface RasterFrame {
  generation: number;
  durationMs: number;
  state: RasterViewState;
  columns: number;
  rows: number;
  fill: Uint8Array;
  lineMask: Uint8Array;
  lineClass: Uint8Array;
  lineTone: Uint8Array;
  owner: Uint32Array;
  ribbon: Uint8Array;
  /** Quantized scalar values: 0 is missing and 1…255 span the configured range. */
  scalar: Uint8Array;
  /** Quantized point density for the optional low-resolution heatmap. */
  heatmap: Uint8Array;
  labels: LabelPlacement[];
  features: FeatureRecord[];
  warnings: LowResError[];
}

export interface LowResDataFeatureRecord {
  owner: number;
  layerId: string;
  layerType: LowResDataLayer["type"];
  featureId?: string | number;
  properties: GeoJsonProperties;
}

export interface DataRasterFrame {
  generation: number;
  durationMs: number;
  state: RasterViewState;
  dotColumns: number;
  dotRows: number;
  data: Uint8Array;
  markers: Uint8Array;
  dataOwner: Uint32Array;
  markerOwner: Uint32Array;
  features: LowResDataFeatureRecord[];
  warnings: LowResError[];
}

export interface LowResMapBinding {
  map: MapLibreMap;
}
