import { cellPath, type Point } from "./geometry";
import { localizedName, type ProjectedFeature } from "./model";
import { LabelInk, LINE_STYLES, ROAD_CLASS } from "./style";
import type { LabelPlacement } from "./types";

class Occupancy {
  readonly grid: Uint8Array;
  constructor(
    readonly columns: number,
    readonly rows: number,
  ) {
    this.grid = new Uint8Array(columns * rows);
  }

  free(row: number, column: number, length: number): boolean {
    if (
      row < 0 ||
      row >= this.rows ||
      column < 0 ||
      column + length > this.columns
    )
      return false;
    const lo = Math.max(0, column - 1);
    const hi = Math.min(this.columns, column + length + 1);
    for (let x = lo; x < hi; x += 1)
      if (this.grid[row * this.columns + x]) return false;
    return true;
  }

  claim(row: number, column: number, length: number): void {
    for (
      let x = Math.max(0, column - 1);
      x < Math.min(this.columns, column + length + 1);
      x += 1
    ) {
      this.grid[row * this.columns + x] = 1;
    }
  }
}

interface Candidate {
  priority: readonly (string | number)[];
  kind: "place" | "area" | "road" | "shield" | "poi";
  text: string;
  ink: LabelInk;
  bold: boolean;
  owner: number;
  anchor?: Point;
  path?: Point[];
  repeat?: number;
}

const PLACE_RANK: Record<string, number> = {
  country: -2,
  state: -1,
  city: 0,
  town: 1,
  village: 2,
  island: 3,
  suburb: 3,
  neighbourhood: 3,
  hamlet: 4,
};

const ROAD_ANCHORS = [0.5, 0.25, 0.75, 0.12, 0.62, 0.38, 0.88] as const;

function centroid(parts: readonly Point[][]): Point {
  const points = parts.flat();
  if (!points.length) return [0, 0];
  return [
    points.reduce((sum, p) => sum + p[0], 0) / points.length,
    points.reduce((sum, p) => sum + p[1], 0) / points.length,
  ];
}

function cellFor(point: Point): Point {
  return [Math.floor(point[0] / 2), Math.floor(point[1] / 4)];
}

function spaced(value: string): string {
  return Array.from(value.toUpperCase()).join(" ");
}

function comparePriority(a: Candidate, b: Candidate): number {
  const count = Math.max(a.priority.length, b.priority.length);
  for (let i = 0; i < count; i += 1) {
    const av = a.priority[i] ?? "";
    const bv = b.priority[i] ?? "";
    if (av === bv) continue;
    if (typeof av === "number" && typeof bv === "number") return av - bv;
    return String(av).localeCompare(String(bv));
  }
  return 0;
}

function candidates(
  features: readonly ProjectedFeature[],
  columns: number,
  rows: number,
  band: number,
  locale: string,
): Candidate[] {
  const output: Candidate[] = [];
  const roads = new Map<
    string,
    { rank: number; paths: Point[][]; owner: number; ref: string; cls: string }
  >();

  for (const feature of features) {
    const name = localizedName(feature.properties, locale);
    const cls = String(
      feature.properties.class ?? feature.properties.subclass ?? "",
    );

    if (feature.sourceLayer === "place" && name) {
      const rank = PLACE_RANK[cls];
      if (rank === undefined) continue;
      if (
        (cls === "country" && band > 2) ||
        (cls === "state" && (band < 1 || band > 3))
      )
        continue;
      if ((cls === "suburb" || cls === "neighbourhood") && band < 5) continue;
      const anchor = cellFor(centroid(feature.parts));
      const settlement = ["city", "town", "village", "hamlet"].includes(cls);
      const ink =
        cls === "city"
          ? LabelInk.City
          : cls === "town"
            ? LabelInk.Town
            : settlement
              ? LabelInk.Village
              : LabelInk.Area;
      const text = settlement
        ? `•${name}`
        : cls === "island"
          ? name
          : spaced(name);
      output.push({
        priority: [0, rank, name],
        kind: "place",
        text,
        ink,
        bold: cls === "city",
        owner: feature.record.id,
        anchor,
      });
      continue;
    }

    if (
      (feature.sourceLayer === "water_name" ||
        feature.sourceLayer === "park") &&
      name
    ) {
      const anchor = cellFor(centroid(feature.parts));
      const isWater = feature.sourceLayer === "water_name";
      output.push({
        priority: [
          1,
          isWater ? 0 : 1,
          Number(feature.properties.rank ?? 99),
          name,
        ],
        kind: "area",
        text: spaced(name),
        ink: isWater ? LabelInk.Water : LabelInk.Park,
        bold: false,
        owner: feature.record.id,
        anchor,
      });
      continue;
    }

    if (feature.sourceLayer === "transportation_name") {
      const styleKey = ROAD_CLASS[cls];
      if (!styleKey || !LINE_STYLES[styleKey].weights[band]) continue;
      const ref = String(feature.properties.ref ?? "")
        .trim()
        .replaceAll(" ", "-")
        .toUpperCase();
      if (!name && !ref) continue;
      const key = name || ref;
      const entry = roads.get(key) ?? {
        rank: LINE_STYLES[styleKey].rank,
        paths: [],
        owner: feature.record.id,
        ref,
        cls,
      };
      entry.rank = Math.max(entry.rank, LINE_STYLES[styleKey].rank);
      entry.paths.push(
        ...feature.parts.map((part) => cellPath(part, columns, rows)),
      );
      roads.set(key, entry);
      continue;
    }

    if (
      ["poi", "mountain_peak", "aerodrome_label"].includes(
        feature.sourceLayer,
      ) &&
      band >= 6
    ) {
      const anchor = cellFor(centroid(feature.parts));
      const glyph =
        feature.sourceLayer === "mountain_peak"
          ? "▲"
          : feature.sourceLayer === "aerodrome_label"
            ? "✈"
            : poiGlyph(cls);
      const medical = ["hospital", "clinic", "pharmacy", "doctors"].includes(
        cls,
      );
      const text =
        band >= 7 && name
          ? `${glyph}${name.slice(0, 14)}${name.length > 14 ? "…" : ""}`
          : glyph;
      output.push({
        priority: [4, Number(feature.properties.rank ?? 99), name],
        kind: "poi",
        text,
        ink: medical ? LabelInk.Medical : LabelInk.Poi,
        bold: false,
        owner: feature.record.id,
        anchor,
      });
    }
  }

  for (const [name, road] of roads) {
    const path = road.paths.sort((a, b) => b.length - a.length)[0];
    if (!path?.length) continue;
    const shield = Boolean(
      road.ref &&
      ["motorway", "trunk"].includes(road.cls) &&
      road.ref.length <= 6,
    );
    output.push({
      priority: [shield ? 2 : 3, -road.rank, name],
      kind: shield ? "shield" : "road",
      text: shield ? road.ref : name,
      ink: shield
        ? LabelInk.Shield
        : road.rank >= 38
          ? LabelInk.Road
          : LabelInk.RoadMinor,
      bold: shield,
      owner: road.owner,
      path,
      repeat: shield ? 30 : 40,
    });
  }
  return output.sort(comparePriority);
}

function poiGlyph(cls: string): string {
  if (["railway", "station", "subway"].includes(cls)) return "◉";
  if (["hospital", "clinic", "pharmacy", "doctors"].includes(cls)) return "✚";
  if (["town_hall", "police", "fire_station", "courthouse"].includes(cls))
    return "⚑";
  if (["hotel", "motel", "hostel"].includes(cls)) return "⌂";
  if (["place_of_worship", "church"].includes(cls)) return "†";
  if (cls === "ferry") return "◆";
  return "✦";
}

export function buildLabels(
  features: readonly ProjectedFeature[],
  columns: number,
  rows: number,
  band: number,
  locale: string,
  ownerGrid: Uint32Array,
): LabelPlacement[] {
  const occupancy = new Occupancy(columns, rows);
  const total = Math.max(5, Math.min(24, Math.floor((columns * rows) / 110)));
  const ceilings = {
    place: Math.max(2, Math.floor((total * 6) / 10)),
    area: Math.min(3, total),
    shield: 4,
    road: Math.max(2, Math.floor((total * 4) / 10)),
    poi: Math.max(4, Math.min(16, Math.floor((columns * rows) / 140))),
  };
  const used = { place: 0, area: 0, shield: 0, road: 0, poi: 0 };
  const placed: LabelPlacement[] = [];

  for (const candidate of candidates(features, columns, rows, band, locale)) {
    const bucket =
      candidate.kind === "place"
        ? "place"
        : candidate.kind === "area"
          ? "area"
          : candidate.kind;
    if (
      used[bucket] >= ceilings[bucket] ||
      placed.length >= total + ceilings.poi
    )
      continue;
    if (candidate.path) {
      let count = 0;
      const positions: Point[] = [];
      for (const fraction of ROAD_ANCHORS) {
        const point =
          candidate.path[
            Math.min(
              candidate.path.length - 1,
              Math.floor(candidate.path.length * fraction),
            )
          ];
        if (!point) continue;
        const column = point[0] - Math.floor(candidate.text.length / 2);
        const row = point[1];
        if (
          positions.some(
            ([x, y]) =>
              Math.abs(column - x) + 2 * Math.abs(row - y) <
              (candidate.repeat ?? 40),
          )
        )
          continue;
        if (!occupancy.free(row, column, candidate.text.length)) continue;
        occupancy.claim(row, column, candidate.text.length);
        placed.push({
          column,
          row,
          text: candidate.text,
          ink: candidate.ink,
          bold: candidate.bold,
          owner: candidate.owner,
        });
        for (let x = column; x < column + candidate.text.length; x += 1)
          ownerGrid[row * columns + x] = candidate.owner;
        positions.push([column, row]);
        count += 1;
        if (
          count >= 1 + Math.floor((columns * rows) / 40) ||
          used[bucket] + count >= ceilings[bucket]
        )
          break;
      }
      used[bucket] += count;
      continue;
    }

    if (!candidate.anchor) continue;
    const column = candidate.anchor[0] - Math.floor(candidate.text.length / 2);
    const row = candidate.anchor[1];
    if (!occupancy.free(row, column, candidate.text.length)) continue;
    occupancy.claim(row, column, candidate.text.length);
    placed.push({
      column,
      row,
      text: candidate.text,
      ink: candidate.ink,
      bold: candidate.bold,
      owner: candidate.owner,
    });
    for (let x = column; x < column + candidate.text.length; x += 1)
      ownerGrid[row * columns + x] = candidate.owner;
    used[bucket] += 1;
  }
  return placed;
}

export { Occupancy };
