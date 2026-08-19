import type { Map as MapLibreMap, PointLike } from "maplibre-gl";

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
  theme?: BuiltinThemeName | LowResTheme;
  /** Palette composition mode. It only affects layers owned by this package. */
  colorMode?: LowResColorMode;
  cell?: Partial<CellGeometry>;
  locale?: string;
  labels?: boolean;
  attribution?: boolean;
  enforceNorthUp?: boolean;
  maxCachedTiles?: number;
  renderThrottleMs?: number;
}

export type LowResFeatureKind =
  "fill" | "line" | "place" | "water" | "park" | "poi";

export interface LowResFeature {
  id: number;
  kind: LowResFeatureKind;
  class: string;
  name: string;
  sourceLayer: string;
  properties: Record<string, string | number | boolean | null>;
  cell: { column: number; row: number };
  lngLat: { lng: number; lat: number };
}

export interface LowResError {
  code: "source" | "tile" | "decode" | "render" | "unsupported-camera";
  message: string;
  fatal: boolean;
  cause?: unknown;
}

export interface LowResEventMap {
  load: { target: LowResBasemapLike };
  render: { target: LowResBasemapLike; durationMs: number; generation: number };
  error: { target: LowResBasemapLike; error: LowResError };
  featureenter: { target: LowResBasemapLike; feature: LowResFeature };
  featureleave: { target: LowResBasemapLike; feature: LowResFeature };
  featureclick: { target: LowResBasemapLike; feature: LowResFeature };
  stylechange: {
    target: LowResBasemapLike;
    theme: LowResTheme;
    colorMode: LowResColorMode;
  };
}

export interface LowResBasemapLike {
  readonly layerIds: { readonly base: string; readonly labels: string };
  queryFeatures(point: PointLike): LowResFeature[];
}

export interface RasterViewState {
  center: { lng: number; lat: number };
  zoom: number;
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
  labels: LabelPlacement[];
  features: FeatureRecord[];
  warnings: LowResError[];
}

export interface LowResMapBinding {
  map: MapLibreMap;
}
