import {
  BRAILLE_BITS,
  bresenham,
  dilate,
  erode,
  gridSize,
  projectTilePoint,
  type Point,
} from "./geometry";
import { buildLabels } from "./labels";
import { localizedName, type ProjectedFeature } from "./model";
import {
  FillClass,
  LINE_STYLES,
  LineClass,
  bandFor,
  effectiveStyleZoom,
  fillClassFor,
  styleForLine,
  type StyleKey,
} from "./style";
import type { DecodedFeature } from "./tile";
import type {
  FeatureRecord,
  LowResError,
  RasterFrame,
  RasterViewState,
} from "./types";

interface ProjectedFill {
  feature: ProjectedFeature;
  fillClass: FillClass;
}

interface ProjectedLine {
  feature: ProjectedFeature;
  styleKey: StyleKey;
}

function featureKind(layer: string): FeatureRecord["kind"] {
  if (layer === "weather_point") return "poi";
  if (layer === "weather_line" || layer === "contour") return "line";
  if (layer === "weather") return "fill";
  if (["water", "water_name"].includes(layer)) return "water";
  if (["park", "landcover", "landuse"].includes(layer)) return "park";
  if (layer === "place") return "place";
  if (["poi", "mountain_peak", "aerodrome_label"].includes(layer)) return "poi";
  if (
    [
      "transportation",
      "waterway",
      "aeroway",
      "boundary",
      "transportation_name",
    ].includes(layer)
  )
    return "line";
  return "fill";
}

function projectFeatures(
  decoded: readonly DecodedFeature[],
  state: RasterViewState,
): { projected: ProjectedFeature[]; records: FeatureRecord[] } {
  const projected: ProjectedFeature[] = [];
  const records: FeatureRecord[] = [];
  for (const feature of decoded) {
    const record: FeatureRecord = {
      id: records.length + 1,
      kind: featureKind(feature.sourceLayer),
      class: String(
        feature.properties.class ?? feature.properties.subclass ?? "",
      ),
      name: localizedName(feature.properties, state.locale),
      sourceLayer: feature.sourceLayer,
      sourceId: feature.sourceId ?? "base",
      packId: feature.packId ?? "streets",
      properties: feature.properties,
    };
    const parts = feature.geometry.map((part) =>
      part.map(([x, y]) =>
        projectTilePoint(
          state,
          feature.tile.z,
          feature.tile.x,
          feature.tile.y,
          feature.extent,
          x,
          y,
        ),
      ),
    );
    records.push(record);
    projected.push({
      record,
      sourceLayer: feature.sourceLayer,
      type: feature.type,
      properties: feature.properties,
      parts,
    });
  }
  return { projected, records };
}

function fillRings(
  classes: Uint8Array,
  owners: Uint32Array,
  rings: readonly Point[][],
  value: number,
  owner: number,
  width: number,
  height: number,
): void {
  const ys = rings.flatMap((ring) => ring.map((point) => point[1]));
  if (!ys.length) return;
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const y1 = Math.min(height - 1, Math.ceil(Math.max(...ys)));
  for (let y = y0; y <= y1; y += 1) {
    const scanY = y + 0.5;
    const intersections: number[] = [];
    for (const ring of rings) {
      if (ring.length < 3) continue;
      for (let i = 0; i < ring.length; i += 1) {
        const a = ring[i]!;
        const b = ring[(i + 1) % ring.length]!;
        if (
          (a[1] <= scanY && scanY < b[1]) ||
          (b[1] <= scanY && scanY < a[1])
        ) {
          intersections.push(
            a[0] + ((scanY - a[1]) / (b[1] - a[1])) * (b[0] - a[0]),
          );
        }
      }
    }
    intersections.sort((a, b) => a - b);
    for (let i = 0; i + 1 < intersections.length; i += 2) {
      const x0 = Math.max(0, Math.floor(intersections[i]! + 0.5));
      const x1 = Math.min(width, Math.floor(intersections[i + 1]! + 0.5));
      for (let x = x0; x < x1; x += 1) {
        const index = y * width + x;
        classes[index] = value;
        owners[index] = owner;
      }
    }
  }
}

function buildingLargeEnough(parts: readonly Point[][]): boolean {
  const exterior = parts[0];
  if (!exterior?.length) return false;
  const xs = exterior.map((point) => point[0]);
  const ys = exterior.map((point) => point[1]);
  return (
    (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys)) >=
    4
  );
}

interface LineBuffers {
  mask: Uint8Array;
  lineClass: Uint8Array;
  tone: Uint8Array;
  rank: Int16Array;
  owner: Uint32Array;
  ribbon: Uint8Array;
}

function reduceScalar(
  dots: Uint8Array,
  columns: number,
  rows: number,
): Uint8Array {
  const output = new Uint8Array(columns * rows);
  const dotWidth = columns * 2;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      let sum = 0;
      let count = 0;
      for (let dy = 0; dy < 4; dy += 1) {
        for (let dx = 0; dx < 2; dx += 1) {
          const value = dots[(row * 4 + dy) * dotWidth + column * 2 + dx]!;
          if (value) {
            sum += value;
            count += 1;
          }
        }
      }
      output[row * columns + column] = count ? Math.round(sum / count) : 0;
    }
  }
  return output;
}

function reduceOwners(
  dots: Uint32Array,
  columns: number,
  rows: number,
): Uint32Array {
  const output = new Uint32Array(columns * rows);
  const dotWidth = columns * 2;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const counts = new Map<number, number>();
      for (let dy = 0; dy < 4; dy += 1) {
        for (let dx = 0; dx < 2; dx += 1) {
          const owner = dots[(row * 4 + dy) * dotWidth + column * 2 + dx]!;
          if (owner) counts.set(owner, (counts.get(owner) ?? 0) + 1);
        }
      }
      let winner = 0;
      let count = 0;
      for (const [owner, candidateCount] of counts) {
        if (candidateCount > count) {
          winner = owner;
          count = candidateCount;
        }
      }
      output[row * columns + column] = winner;
    }
  }
  return output;
}

function setDot(
  buffers: LineBuffers,
  dx: number,
  dy: number,
  columns: number,
  rows: number,
  lineClass: LineClass,
  rank: number,
  owner: number,
  tone: number,
): void {
  if (dx < 0 || dx >= columns * 2 || dy < 0 || dy >= rows * 4) return;
  const cellX = Math.floor(dx / 2);
  const cellY = Math.floor(dy / 4);
  const index = cellY * columns + cellX;
  buffers.mask[index]! |= BRAILLE_BITS[dx % 2]![dy % 4]!;
  if (rank >= buffers.rank[index]!) {
    buffers.rank[index] = rank;
    buffers.lineClass[index] = lineClass;
    buffers.tone[index] = tone;
    buffers.owner[index] = owner;
  }
}

function stroke(
  buffers: LineBuffers,
  points: readonly Point[],
  columns: number,
  rows: number,
  styleKey: StyleKey,
  band: number,
  owner: number,
  tunnel: boolean,
  hide?: Uint8Array,
  mark?: Uint8Array,
): void {
  const style = LINE_STYLES[styleKey];
  const weight = style.weights[band] ?? 0;
  if (!weight) return;
  const dots: Point[] = [];
  for (const [x, y] of points) {
    const dot: Point = [Math.round(x), Math.round(y)];
    const previous = dots.at(-1);
    if (!previous || previous[0] !== dot[0] || previous[1] !== dot[1])
      dots.push(dot);
  }
  if (dots.length < 2) return;
  const period = style.dash ? style.dash[0] + style.dash[1] : 0;
  let pathIndex = 0;
  for (let segment = 0; segment < dots.length - 1; segment += 1) {
    const a = dots[segment]!;
    const b = dots[segment + 1]!;
    const offset: Point =
      Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]) ? [0, 1] : [1, 0];
    let first = true;
    for (const [x, y] of bresenham(a[0], a[1], b[0], b[1])) {
      if (segment > 0 && first) {
        first = false;
        continue;
      }
      first = false;
      const dotIndex = y * (columns * 2) + x;
      if (mark && x >= 0 && x < columns * 2 && y >= 0 && y < rows * 4)
        mark[dotIndex] = 1;
      const hidden =
        hide &&
        x >= 0 &&
        x < columns * 2 &&
        y >= 0 &&
        y < rows * 4 &&
        hide[dotIndex];
      const dashedOff =
        period && style.dash && pathIndex % period >= style.dash[0];
      if (!hidden && !dashedOff) {
        setDot(
          buffers,
          x,
          y,
          columns,
          rows,
          style.lineClass,
          style.rank,
          owner,
          tunnel ? 1 : 0,
        );
        if (weight >= 2)
          setDot(
            buffers,
            x + offset[0],
            y + offset[1],
            columns,
            rows,
            style.lineClass,
            style.rank,
            owner,
            tunnel ? 1 : 0,
          );
        if (styleKey === "rail" && pathIndex % 8 === 0) {
          setDot(
            buffers,
            x - offset[0],
            y - offset[1],
            columns,
            rows,
            style.lineClass,
            style.rank,
            owner,
            tunnel ? 1 : 0,
          );
        }
        if (weight >= 3) {
          const cx = Math.floor(x / 2);
          const cy = Math.floor(y / 4);
          if (cx >= 0 && cx < columns && cy >= 0 && cy < rows)
            buffers.ribbon[cy * columns + cx] = 1;
        }
      }
      pathIndex += 1;
    }
  }
}

function addCoast(
  water: Uint8Array,
  buffers: LineBuffers,
  columns: number,
  rows: number,
  waterOwners: Uint32Array,
): void {
  const width = columns * 2;
  const height = rows * 4;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (water[index]) continue;
      let neighborOwner = 0;
      for (const [dx, dy] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ] as const) {
        const xx = x + dx;
        const yy = y + dy;
        if (
          xx >= 0 &&
          xx < width &&
          yy >= 0 &&
          yy < height &&
          water[yy * width + xx]
        ) {
          neighborOwner = waterOwners[yy * width + xx] ?? 0;
          break;
        }
      }
      if (
        neighborOwner ||
        (
          [
            [-1, 0],
            [1, 0],
            [0, -1],
            [0, 1],
          ] as const
        ).some(([dx, dy]) => {
          const xx = x + dx;
          const yy = y + dy;
          return (
            xx >= 0 &&
            xx < width &&
            yy >= 0 &&
            yy < height &&
            water[yy * width + xx]
          );
        })
      ) {
        setDot(
          buffers,
          x,
          y,
          columns,
          rows,
          LineClass.Coast,
          LINE_STYLES.coast.rank,
          neighborOwner,
          0,
        );
      }
    }
  }
}

function reduceFills(
  dotClasses: Uint8Array,
  dotOwners: Uint32Array,
  columns: number,
  rows: number,
): { fill: Uint8Array; owner: Uint32Array } {
  const dotWidth = columns * 2;
  const fill = new Uint8Array(columns * rows * 2);
  const owner = new Uint32Array(columns * rows);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const ownerCounts = new Map<number, number>();
      for (let half = 0; half < 2; half += 1) {
        const classCounts = [0, 0, 0, 0, 0];
        for (let dy = 0; dy < 2; dy += 1) {
          for (let dx = 0; dx < 2; dx += 1) {
            const dotY = row * 4 + half * 2 + dy;
            const dotX = column * 2 + dx;
            const index = dotY * dotWidth + dotX;
            classCounts[dotClasses[index]!]! += 1;
            const dotOwner = dotOwners[index]!;
            if (dotOwner)
              ownerCounts.set(dotOwner, (ownerCounts.get(dotOwner) ?? 0) + 1);
          }
        }
        let selected = FillClass.Ground;
        for (let cls = FillClass.Building; cls >= FillClass.Urban; cls -= 1) {
          if (classCounts[cls]! >= 2) {
            selected = cls;
            break;
          }
        }
        fill[(row * 2 + half) * columns + column] = selected;
      }
      let bestOwner = 0;
      let bestCount = 0;
      for (const [candidate, count] of ownerCounts) {
        if (count > bestCount) {
          bestOwner = candidate;
          bestCount = count;
        }
      }
      owner[row * columns + column] = bestOwner;
    }
  }
  return { fill, owner };
}

export function rasterizeView(
  decoded: readonly DecodedFeature[],
  state: RasterViewState,
  generation = 0,
  warnings: LowResError[] = [],
): RasterFrame {
  const started = performance.now();
  const { columns, rows } = gridSize(state.width, state.height, state.cell);
  const dotWidth = columns * 2;
  const dotHeight = rows * 4;
  const effectiveZoom = effectiveStyleZoom(state.zoom, state.cell.height / 4);
  const band = bandFor(effectiveZoom);
  const { projected, records } = projectFeatures(decoded, state);

  const dotClasses = new Uint8Array(dotWidth * dotHeight);
  const dotOwners = new Uint32Array(dotWidth * dotHeight);
  const fills: ProjectedFill[] = [];
  const lines: ProjectedLine[] = [];
  const scalarDots = new Uint8Array(dotWidth * dotHeight);
  const scalarOwners = new Uint32Array(dotWidth * dotHeight);
  for (const feature of projected) {
    const decodedFeature = decoded[feature.record.id - 1];
    const numeric = decodedFeature?.numeric;
    const numericValue = numeric
      ? Number(feature.properties[numeric.property])
      : Number.NaN;
    if (
      feature.type === 3 &&
      numeric &&
      Number.isFinite(numericValue) &&
      numeric.max > numeric.min
    ) {
      const value =
        1 +
        Math.round(
          Math.max(
            0,
            Math.min(
              1,
              (numericValue - numeric.min) / (numeric.max - numeric.min),
            ),
          ) * 254,
        );
      fillRings(
        scalarDots,
        scalarOwners,
        feature.parts,
        value,
        feature.record.id,
        dotWidth,
        dotHeight,
      );
    }
    if (feature.type === 3) {
      const fillClass = fillClassFor(
        feature.sourceLayer,
        feature.properties,
        band,
      );
      if (
        fillClass !== null &&
        (fillClass !== FillClass.Building || buildingLargeEnough(feature.parts))
      )
        fills.push({ feature, fillClass });
    }
    if (feature.type === 2) {
      const adapter = decoded[feature.record.id - 1]?.adapter;
      const styleKey =
        adapter === "weather" && feature.sourceLayer === "weather_line"
          ? "route"
          : adapter === "topographic" && feature.sourceLayer === "contour"
            ? "path"
            : adapter === "transit" && feature.sourceLayer === "transportation"
              ? "route"
              : styleForLine(feature.sourceLayer, feature.properties);
      if (styleKey && LINE_STYLES[styleKey].weights[band])
        lines.push({ feature, styleKey });
    }
  }
  fills.sort(
    (a, b) =>
      a.fillClass - b.fillClass || a.feature.record.id - b.feature.record.id,
  );
  for (const item of fills) {
    if (item.fillClass !== FillClass.Building) {
      fillRings(
        dotClasses,
        dotOwners,
        item.feature.parts,
        item.fillClass,
        item.feature.record.id,
        dotWidth,
        dotHeight,
      );
    }
  }

  const water = new Uint8Array(dotClasses.length);
  const waterOwners = new Uint32Array(dotClasses.length);
  for (let i = 0; i < dotClasses.length; i += 1) {
    if (dotClasses[i] === FillClass.Water) {
      water[i] = 1;
      waterOwners[i] = dotOwners[i]!;
    }
  }
  for (const item of fills) {
    if (item.fillClass === FillClass.Building) {
      fillRings(
        dotClasses,
        dotOwners,
        item.feature.parts,
        item.fillClass,
        item.feature.record.id,
        dotWidth,
        dotHeight,
      );
    }
  }

  const lineBuffers: LineBuffers = {
    mask: new Uint8Array(columns * rows),
    lineClass: new Uint8Array(columns * rows),
    tone: new Uint8Array(columns * rows),
    rank: new Int16Array(columns * rows).fill(-1),
    owner: new Uint32Array(columns * rows),
    ribbon: new Uint8Array(columns * rows),
  };
  addCoast(water, lineBuffers, columns, rows, waterOwners);

  const roadDots = new Uint8Array(dotClasses.length);
  const openWater = erode(water, dotWidth, dotHeight, 3);
  const paths: ProjectedLine[] = [];
  for (const line of lines.sort(
    (a, b) => a.feature.record.id - b.feature.record.id,
  )) {
    if (line.styleKey === "path") {
      paths.push(line);
      continue;
    }
    const isRoad = [
      "motorway",
      "trunk",
      "primary",
      "secondary",
      "ramp",
      "minor",
      "service",
    ].includes(line.styleKey);
    const hide =
      line.styleKey === "waterwayMajor" || line.styleKey === "waterwayMinor"
        ? openWater
        : undefined;
    for (const part of line.feature.parts) {
      stroke(
        lineBuffers,
        part,
        columns,
        rows,
        line.styleKey,
        band,
        line.feature.record.id,
        line.feature.properties.brunnel === "tunnel",
        hide,
        isRoad ? roadDots : undefined,
      );
    }
  }
  const metresPerCssPixel =
    (40_075_016.686 * Math.cos((state.center.lat * Math.PI) / 180)) /
    (512 * 2 ** state.zoom);
  const metresPerDot = metresPerCssPixel * (state.cell.height / 4);
  const pathShadow = dilate(
    roadDots,
    dotWidth,
    dotHeight,
    Math.max(2, Math.min(16, Math.round(12 / Math.max(0.01, metresPerDot)))),
  );
  for (const line of paths) {
    for (const part of line.feature.parts) {
      stroke(
        lineBuffers,
        part,
        columns,
        rows,
        "path",
        band,
        line.feature.record.id,
        line.feature.properties.brunnel === "tunnel",
        pathShadow,
      );
    }
  }

  const reduced = reduceFills(dotClasses, dotOwners, columns, rows);
  const scalarOwner = reduceOwners(scalarOwners, columns, rows);
  for (let i = 0; i < reduced.owner.length; i += 1)
    if (scalarOwner[i]) reduced.owner[i] = scalarOwner[i]!;
  for (let i = 0; i < reduced.owner.length; i += 1)
    if (lineBuffers.owner[i]) reduced.owner[i] = lineBuffers.owner[i]!;
  const labels = buildLabels(
    projected,
    columns,
    rows,
    band,
    state.locale,
    reduced.owner,
  );

  return {
    generation,
    durationMs: performance.now() - started,
    state,
    columns,
    rows,
    fill: reduced.fill,
    lineMask: lineBuffers.mask,
    lineClass: lineBuffers.lineClass,
    lineTone: lineBuffers.tone,
    owner: reduced.owner,
    ribbon: lineBuffers.ribbon,
    scalar: reduceScalar(scalarDots, columns, rows),
    heatmap: new Uint8Array(columns * rows),
    labels,
    features: records,
    warnings,
  };
}
