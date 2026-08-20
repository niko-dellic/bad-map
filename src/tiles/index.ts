import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import type { TileKey } from "../core/geometry.js";
import type {
  LowResError,
  LowResLayerPackDescriptor,
  LowResSource,
} from "../types.js";

export type GeometryPoint = readonly [number, number];

export interface DecodedFeature {
  tile: TileKey;
  extent: number;
  sourceLayer: string;
  type: 1 | 2 | 3;
  properties: Record<string, string | number | boolean | null>;
  geometry: GeometryPoint[][];
  sourceId?: string;
  packId?: string;
  adapter?: string;
  numeric?: LowResLayerPackDescriptor["numeric"];
}

export interface TileJSON {
  tiles: string[];
  maxzoom?: number;
  attribution?: string;
}

const INCLUDED_LAYERS = new Set([
  "water",
  "park",
  "landcover",
  "landuse",
  "building",
  "transportation",
  "waterway",
  "aeroway",
  "boundary",
  "place",
  "water_name",
  "transportation_name",
  "poi",
  "mountain_peak",
  "aerodrome_label",
]);

export function decodeMvt(
  data: ArrayBuffer,
  tile: TileKey,
  includedLayers: ReadonlySet<string> = INCLUDED_LAYERS,
): DecodedFeature[] {
  const decoded = new VectorTile(new PbfReader(new Uint8Array(data)));
  const output: DecodedFeature[] = [];
  for (const [sourceLayer, layer] of Object.entries(decoded.layers)) {
    if (!includedLayers.has(sourceLayer)) continue;
    for (let index = 0; index < layer.length; index += 1) {
      const feature = layer.feature(index);
      if (feature.type !== 1 && feature.type !== 2 && feature.type !== 3)
        continue;
      const geometry = feature
        .loadGeometry()
        .map((part) => part.map((point) => [point.x, point.y] as const));
      output.push({
        tile,
        extent: feature.extent || 4096,
        sourceLayer,
        type: feature.type,
        properties: sanitizeProperties(feature.properties),
        geometry,
      });
    }
  }
  return output;
}

function sanitizeProperties(
  input: Record<string, unknown>,
): Record<string, string | number | boolean | null> {
  const output: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(input)) {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      output[key] = value;
    }
  }
  return output;
}

class Lru<K, V> {
  readonly #values = new Map<K, V>();
  constructor(private maxSize: number) {}

  get(key: K): V | undefined {
    const value = this.#values.get(key);
    if (value === undefined) return undefined;
    this.#values.delete(key);
    this.#values.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    this.#values.delete(key);
    this.#values.set(key, value);
    while (this.#values.size > this.maxSize) {
      const oldest = this.#values.keys().next().value as K | undefined;
      if (oldest === undefined) break;
      this.#values.delete(oldest);
    }
  }

  clear(): void {
    this.#values.clear();
  }
}

export class TileLoader {
  #source: LowResSource;
  #tileJSON: TileJSON | undefined;
  #raw: Lru<string, ArrayBuffer>;
  #decoded: Lru<string, DecodedFeature[]>;
  #includedLayers: ReadonlySet<string>;

  constructor(
    source: LowResSource,
    maxCachedTiles = 96,
    includedLayers: ReadonlySet<string> = INCLUDED_LAYERS,
  ) {
    this.#source = source;
    this.#raw = new Lru(maxCachedTiles);
    this.#decoded = new Lru(maxCachedTiles);
    this.#includedLayers = includedLayers;
  }

  setSource(source: LowResSource): void {
    this.#source = source;
    this.#tileJSON = undefined;
    this.#raw.clear();
    this.#decoded.clear();
  }

  setTimeKey(timeKey: string | number): void {
    this.#source = { ...this.#source, timeKey };
  }

  async metadata(signal?: AbortSignal): Promise<TileJSON> {
    if (this.#tileJSON) return this.#tileJSON;
    const response = await fetch(this.#source.tileJSON, {
      ...this.#source.request,
      ...(signal ? { signal } : {}),
    });
    if (!response.ok)
      throw new Error(`TileJSON request failed with ${response.status}`);
    const json = (await response.json()) as Partial<TileJSON>;
    if (!Array.isArray(json.tiles) || json.tiles.length === 0)
      throw new Error("TileJSON contains no tile templates");
    this.#tileJSON = {
      tiles: json.tiles,
      ...(typeof json.maxzoom === "number" ? { maxzoom: json.maxzoom } : {}),
      ...(typeof json.attribution === "string"
        ? { attribution: json.attribution }
        : {}),
    };
    return this.#tileJSON;
  }

  async load(
    keys: TileKey[],
    signal?: AbortSignal,
  ): Promise<{ features: DecodedFeature[]; warnings: LowResError[] }> {
    const metadata = await this.metadata(signal);
    const warningSlots: Array<LowResError | undefined> = new Array(keys.length);
    const batches = await mapConcurrent(
      keys,
      this.#source.maxConcurrentRequests ?? 6,
      async (key, keyIndex): Promise<DecodedFeature[]> => {
        const tilePath = `${key.z}/${key.x}/${key.y}`;
        const cacheKey =
          this.#source.timeKey === undefined
            ? tilePath
            : `${String(this.#source.timeKey)}:${tilePath}`;
        const cached = this.#decoded.get(cacheKey);
        if (cached) return cached;
        const raw = this.#raw.get(cacheKey);
        if (raw) {
          const decoded = decodeMvt(raw, key, this.#includedLayers);
          this.#decoded.set(cacheKey, decoded);
          return decoded;
        }
        const template =
          metadata.tiles[Math.abs(key.x + key.y) % metadata.tiles.length]!;
        const url = template
          .replace("{z}", String(key.z))
          .replace("{x}", String(key.x))
          .replace("{y}", String(key.y))
          .replace(
            "{time}",
            encodeURIComponent(String(this.#source.timeKey ?? "")),
          );
        let lastCause: unknown;
        for (
          let attempt = 0;
          attempt <= Math.max(0, this.#source.retryCount ?? 1);
          attempt += 1
        ) {
          try {
            const response = await fetch(url, {
              ...this.#source.request,
              ...(signal ? { signal } : {}),
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.arrayBuffer();
            const decoded = data.byteLength
              ? decodeMvt(data, key, this.#includedLayers)
              : [];
            this.#raw.set(cacheKey, data);
            this.#decoded.set(cacheKey, decoded);
            return decoded;
          } catch (cause) {
            if (signal?.aborted) throw cause;
            lastCause = cause;
          }
        }
        warningSlots[keyIndex] = {
          code: "tile",
          message: `Unable to read vector tile ${tilePath}`,
          fatal: false,
          cause: lastCause,
        };
        return [];
      },
    );
    return {
      features: batches.flat(),
      warnings: warningSlots.filter(
        (warning): warning is LowResError => warning !== undefined,
      ),
    };
  }
}

async function mapConcurrent<T, U>(
  values: readonly T[],
  limit: number,
  transform: (value: T, index: number) => Promise<U>,
): Promise<U[]> {
  const output = new Array<U>(values.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(values.length, Math.max(1, Math.floor(limit))) },
    async () => {
      while (cursor < values.length) {
        const index = cursor;
        cursor += 1;
        output[index] = await transform(values[index]!, index);
      }
    },
  );
  await Promise.all(workers);
  return output;
}
