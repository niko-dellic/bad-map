export enum FillClass {
  Ground = 0,
  Urban = 1,
  Park = 2,
  Water = 3,
  Building = 4,
}

/** Values are stable texture indices and must stay synchronized with the renderer. */
export enum LineClass {
  None = 0,
  Waterway = 1,
  Ferry = 2,
  BorderState = 3,
  BorderCountry = 4,
  Coast = 5,
  Path = 6,
  Transit = 7,
  Rail = 8,
  Aeroway = 9,
  Service = 10,
  Minor = 11,
  Secondary = 12,
  Ramp = 13,
  Primary = 14,
  Trunk = 15,
  Motorway = 16,
  Route = 17,
}

export enum LabelInk {
  City = 0,
  Town = 1,
  Village = 2,
  Area = 3,
  Road = 4,
  RoadMinor = 5,
  Shield = 6,
  Water = 7,
  Park = 8,
  Poi = 9,
  Medical = 10,
}

export type StyleKey =
  | "waterwayMinor"
  | "waterwayMajor"
  | "ferry"
  | "borderState"
  | "borderCountry"
  | "coast"
  | "path"
  | "transit"
  | "rail"
  | "aerowayTaxi"
  | "aerowayRunway"
  | "service"
  | "minor"
  | "secondary"
  | "ramp"
  | "primary"
  | "trunk"
  | "motorway"
  | "route";

export interface LineStyle {
  lineClass: LineClass;
  weights: readonly number[];
  dash: readonly [number, number] | null;
  rank: number;
}

export const LINE_STYLES: Record<StyleKey, LineStyle> = {
  waterwayMinor: {
    lineClass: LineClass.Waterway,
    weights: [0, 0, 0, 0, 0, 0, 1, 1],
    dash: null,
    rank: 6,
  },
  waterwayMajor: {
    lineClass: LineClass.Waterway,
    weights: [0, 0, 0, 1, 1, 1, 1, 1],
    dash: null,
    rank: 7,
  },
  ferry: {
    lineClass: LineClass.Ferry,
    weights: [0, 0, 0, 0, 0, 1, 1, 1],
    dash: [2, 4],
    rank: 8,
  },
  borderState: {
    lineClass: LineClass.BorderState,
    weights: [0, 1, 1, 1, 1, 1, 1, 1],
    dash: [2, 4],
    rank: 10,
  },
  borderCountry: {
    lineClass: LineClass.BorderCountry,
    weights: [1, 1, 1, 1, 1, 1, 1, 1],
    dash: [3, 3],
    rank: 11,
  },
  coast: {
    lineClass: LineClass.Coast,
    weights: [1, 1, 1, 1, 1, 1, 1, 1],
    dash: null,
    rank: 14,
  },
  path: {
    lineClass: LineClass.Path,
    weights: [0, 0, 0, 0, 0, 0, 1, 1],
    dash: [1, 1],
    rank: 16,
  },
  transit: {
    lineClass: LineClass.Transit,
    weights: [0, 0, 0, 0, 0, 0, 1, 1],
    dash: [4, 4],
    rank: 20,
  },
  rail: {
    lineClass: LineClass.Rail,
    weights: [0, 0, 0, 0, 1, 1, 1, 1],
    dash: null,
    rank: 22,
  },
  aerowayTaxi: {
    lineClass: LineClass.Aeroway,
    weights: [0, 0, 0, 0, 0, 0, 1, 1],
    dash: null,
    rank: 24,
  },
  aerowayRunway: {
    lineClass: LineClass.Aeroway,
    weights: [0, 0, 0, 0, 2, 2, 2, 2],
    dash: null,
    rank: 26,
  },
  service: {
    lineClass: LineClass.Service,
    weights: [0, 0, 0, 0, 0, 0, 1, 1],
    dash: null,
    rank: 30,
  },
  minor: {
    lineClass: LineClass.Minor,
    weights: [0, 0, 0, 0, 0, 1, 1, 1],
    dash: null,
    rank: 34,
  },
  secondary: {
    lineClass: LineClass.Secondary,
    weights: [0, 0, 0, 0, 1, 1, 1, 2],
    dash: null,
    rank: 38,
  },
  ramp: {
    lineClass: LineClass.Ramp,
    weights: [0, 0, 0, 0, 0, 1, 1, 1],
    dash: null,
    rank: 40,
  },
  primary: {
    lineClass: LineClass.Primary,
    weights: [0, 0, 0, 1, 1, 2, 2, 2],
    dash: null,
    rank: 42,
  },
  trunk: {
    lineClass: LineClass.Trunk,
    weights: [0, 0, 1, 2, 2, 2, 2, 2],
    dash: null,
    rank: 46,
  },
  motorway: {
    lineClass: LineClass.Motorway,
    weights: [0, 1, 1, 2, 2, 2, 2, 3],
    dash: null,
    rank: 50,
  },
  route: {
    lineClass: LineClass.Route,
    weights: [2, 2, 2, 2, 2, 2, 2, 2],
    dash: null,
    rank: 90,
  },
};

export const BAND_EDGES = [4, 6, 8, 10.5, 11.5, 13, 14.5] as const;

export function bandFor(effectiveZoom: number): number {
  return BAND_EDGES.reduce(
    (band, edge) => band + Number(effectiveZoom >= edge),
    0,
  );
}

export function effectiveStyleZoom(
  mapZoom: number,
  dotPitchCssPx: number,
): number {
  // MapLibre's zoom model is based on a 512 px world tile while this style
  // model compares one dot with a conventional 256 px slippy tile.
  return mapZoom + 1 - Math.log2(Math.max(0.25, dotPitchCssPx));
}

export function sourceZoom(
  effectiveZoom: number,
  band: number,
  maxZoom = 14,
): number {
  if (band >= 6) return Math.min(14, maxZoom);
  return Math.min(
    14,
    maxZoom,
    Math.max(0, Math.floor(effectiveZoom + 0.5) + 2),
  );
}

export const ROAD_CLASS: Record<string, StyleKey> = {
  motorway: "motorway",
  trunk: "trunk",
  primary: "primary",
  secondary: "secondary",
  tertiary: "minor",
  minor: "minor",
  unclassified: "minor",
  residential: "minor",
  living_street: "minor",
  road: "minor",
  service: "service",
  busway: "service",
  bus_guideway: "service",
  path: "path",
  track: "path",
  footway: "path",
  pedestrian: "path",
  cycleway: "path",
  steps: "path",
  bridleway: "path",
  corridor: "path",
  rail: "rail",
  transit: "transit",
  ferry: "ferry",
};

export function styleForLine(
  layer: string,
  properties: Record<string, unknown>,
): StyleKey | null {
  if (layer === "transportation") {
    const cls = String(properties.class ?? "");
    const key = ROAD_CLASS[cls];
    if (!key) return null;
    if (
      (key === "motorway" || key === "trunk") &&
      (properties.ramp === 1 || properties.ramp === true)
    )
      return "ramp";
    return key;
  }
  if (layer === "waterway") {
    const cls = String(properties.class ?? "");
    if (cls === "river") return "waterwayMajor";
    if (["stream", "canal", "ditch", "drain"].includes(cls))
      return "waterwayMinor";
    return null;
  }
  if (layer === "aeroway") {
    if (properties.class === "runway") return "aerowayRunway";
    if (properties.class === "taxiway") return "aerowayTaxi";
    return null;
  }
  if (layer === "boundary") {
    if (properties.maritime === 1 || properties.maritime === true) return null;
    const level = Number(properties.admin_level);
    if (level <= 2) return "borderCountry";
    if (level === 3 || level === 4) return "borderState";
  }
  return null;
}

export function fillClassFor(
  layer: string,
  properties: Record<string, unknown>,
  band: number,
): FillClass | null {
  const cls = String(properties.class ?? "");
  if (layer === "water")
    return cls === "swimming_pool" ? null : FillClass.Water;
  if (layer === "park") return band >= 3 ? FillClass.Park : null;
  if (layer === "landcover")
    return band >= 5 && properties.subclass === "park" ? FillClass.Park : null;
  if (layer === "landuse") {
    if (band < 5) return null;
    if (cls === "cemetery") return FillClass.Park;
    if (["residential", "commercial", "industrial", "retail"].includes(cls))
      return FillClass.Urban;
  }
  if (layer === "building") return band >= 7 ? FillClass.Building : null;
  return null;
}
