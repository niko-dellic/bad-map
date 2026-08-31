/// <reference lib="webworker" />

import { visibleTiles } from "../core/geometry.js";
import {
  rasterizeHeatmap,
  type HeatmapRasterOptions,
} from "../data-layers/heatmap.js";
import { featureBelongsToPack } from "../semantic/packs.js";
import {
  buildBuildingMesh,
  selectBuildingTiles,
} from "../semantic/buildings.js";
import { rasterizeView } from "../semantic/rasterize.js";
import { bandFor, effectiveStyleZoom, sourceZoom } from "../semantic/style.js";
import { TileLoader } from "../tiles/index.js";
import type { DecodedFeature } from "../tiles/index.js";
import type {
  LowResError,
  LowResBuildings3DStyle,
  LowResLayerPackDescriptor,
  RasterViewState,
} from "../types.js";
import type { WorkerRequest, WorkerResponse } from "./protocol.js";
import { frameTransferables } from "./protocol.js";

let loaders = new Map<string, TileLoader>();
let layers: LowResLayerPackDescriptor[] = [];
let semanticSourceIds = new Set<string>();
let buildings: {
  visible: boolean;
  style: LowResBuildings3DStyle;
  sourceId: string;
  minZoom: number;
} = { visible: false, style: "dotted", sourceId: "base", minZoom: 14 };
let controller: AbortController | undefined;
let disposed = false;
let pendingRender: Extract<WorkerRequest, { type: "render" }> | undefined;
let pumpScheduled = false;
let rendering = false;
let latestGeneration = -1;
let heatmapPoints: Float32Array<ArrayBufferLike> = new Float32Array();
let heatmapOptions: HeatmapRasterOptions = {
  visible: false,
  radius: 36,
  intensity: 1,
  maxDensity: 0,
};

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (message.type === "configure") {
    controller?.abort();
    pendingRender = undefined;
    layers = message.layers
      .filter((layer) => layer.enabled !== false)
      .sort(
        (a, b) =>
          (a.priority ?? 0) - (b.priority ?? 0) || a.id.localeCompare(b.id),
      );
    buildings = { ...message.buildings };
    semanticSourceIds = new Set(layers.map((layer) => layer.source));
    loaders = new Map();
    for (const [sourceId, source] of Object.entries(message.sources)) {
      const included = new Set(
        layers
          .filter((layer) => layer.source === sourceId)
          .flatMap((layer) => layer.sourceLayers),
      );
      if (buildings.style === "dotted" && buildings.sourceId === sourceId)
        included.add("building");
      if (included.size)
        loaders.set(
          sourceId,
          new TileLoader(
            source,
            source.maxCachedTiles ?? message.maxCachedTiles,
            included,
          ),
        );
    }
    post({ type: "ready" });
    return;
  }
  if (message.type === "set-buildings-visible") {
    buildings.visible = message.visible;
    controller?.abort();
    return;
  }
  if (message.type === "set-time") {
    loaders.get(message.sourceId)?.setTimeKey(message.timeKey);
    controller?.abort();
    return;
  }
  if (message.type === "set-heatmap") {
    heatmapOptions = message.options;
    if (message.points) heatmapPoints = message.points;
    controller?.abort();
    return;
  }
  if (message.type === "refresh") {
    controller?.abort();
    return;
  }
  if (message.type === "dispose") {
    disposed = true;
    pendingRender = undefined;
    controller?.abort();
    self.close();
    return;
  }
  if (message.type === "render") {
    latestGeneration = Math.max(latestGeneration, message.generation);
    pendingRender = message;
    controller?.abort();
    schedulePump();
  }
};

function schedulePump(): void {
  if (pumpScheduled || disposed) return;
  pumpScheduled = true;
  setTimeout(() => void pump(), 0);
}

async function pump(): Promise<void> {
  pumpScheduled = false;
  if (rendering || disposed) return;
  rendering = true;
  try {
    while (pendingRender && !disposed) {
      const next = pendingRender;
      pendingRender = undefined;
      await render(next.generation, next.state, next.detailState);
    }
  } finally {
    rendering = false;
    if (pendingRender) schedulePump();
  }
}

async function render(
  generation: number,
  state: Extract<WorkerRequest, { type: "render" }>["state"],
  detailState?: RasterViewState,
): Promise<void> {
  if (disposed) return;
  controller?.abort();
  controller = new AbortController();
  try {
    const frame = await renderState(generation, state, controller.signal);
    if (controller.signal.aborted || disposed || generation < latestGeneration)
      return;
    const detailFrame = detailState
      ? await renderState(generation, detailState, controller.signal)
      : undefined;
    if (controller.signal.aborted || disposed || generation < latestGeneration)
      return;
    if (detailFrame) frame.durationMs += detailFrame.durationMs;
    const meshStarted = performance.now();
    const buildingResult = await renderBuildingMesh(
      generation,
      state,
      detailState,
      controller.signal,
    );
    if (controller.signal.aborted || disposed || generation < latestGeneration)
      return;
    const buildingMesh = buildingResult?.mesh;
    if (buildingResult?.warnings.length)
      frame.warnings.push(...buildingResult.warnings);
    frame.durationMs += performance.now() - meshStarted;
    post(
      {
        type: "frame",
        frame,
        ...(detailFrame ? { detailFrame } : {}),
        ...(buildingMesh ? { buildingMesh } : {}),
      },
      frameTransferables(frame, detailFrame, buildingMesh),
    );
  } catch (cause) {
    if (controller.signal.aborted || disposed) return;
    const error: WorkerResponse = {
      type: "error",
      generation,
      message: cause instanceof Error ? cause.message : "Unknown worker error",
      ...(cause instanceof Error && cause.stack
        ? { cause: cause.stack }
        : { cause: String(cause) }),
    };
    post(error);
  }
}

async function renderState(
  generation: number,
  state: RasterViewState,
  signal: AbortSignal,
): Promise<ReturnType<typeof rasterizeView>> {
  const zEff = effectiveStyleZoom(state.zoom, state.cell.height / 4);
  const band = bandFor(zEff);
  const bySource = new Map<string, DecodedFeature[]>();
  const warningsBySource = new Map<string, LowResError[]>();
  await Promise.all(
    [...semanticSourceIds].map(async (sourceId) => {
      const sourceLoader = loaders.get(sourceId);
      if (!sourceLoader) return;
      try {
        const metadata = await sourceLoader.metadata(signal);
        const requestedZoom = sourceZoom(zEff, band, metadata.maxzoom ?? 14);
        const selection = visibleTiles(state, requestedZoom, 16);
        const result = await sourceLoader.load(selection.tiles, signal);
        bySource.set(sourceId, result.features);
        warningsBySource.set(
          sourceId,
          result.warnings.map((warning) => ({ ...warning, sourceId })),
        );
      } catch (cause) {
        if (signal.aborted) throw cause;
        warningsBySource.set(sourceId, [
          {
            code: "source" as const,
            message: `Unable to load source ${sourceId}`,
            fatal: false,
            cause,
            sourceId,
          },
        ]);
      }
    }),
  );
  const warnings: LowResError[] = [...warningsBySource]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([, sourceWarnings]) => sourceWarnings);
  const features: DecodedFeature[] = [];
  for (const layer of layers) {
    const sourceFeatures = bySource.get(layer.source);
    if (!sourceFeatures) {
      if (!loaders.has(layer.source))
        warnings.push({
          code: "source",
          message: `Layer pack ${layer.id} references unknown source ${layer.source}`,
          fatal: false,
          sourceId: layer.source,
          packId: layer.id,
        });
      continue;
    }
    for (const feature of sourceFeatures) {
      if (!featureBelongsToPack(feature, layer)) continue;
      features.push({
        ...feature,
        sourceId: layer.source,
        packId: layer.id,
        adapter: layer.adapter,
        ...(layer.numeric ? { numeric: layer.numeric } : {}),
      });
    }
  }
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  const frame = rasterizeView(features, state, generation, warnings);
  const heatmapStarted = performance.now();
  frame.heatmap = rasterizeHeatmap(
    heatmapPoints,
    state,
    frame.columns,
    frame.rows,
    heatmapOptions,
  );
  frame.durationMs += performance.now() - heatmapStarted;
  return frame;
}

async function renderBuildingMesh(
  generation: number,
  coverageState: RasterViewState,
  detailState: RasterViewState | undefined,
  signal: AbortSignal,
) {
  const meshState = detailState ?? coverageState;
  if (
    !buildings.visible ||
    buildings.style !== "dotted" ||
    meshState.zoom < buildings.minZoom
  )
    return undefined;
  const loader = loaders.get(buildings.sourceId);
  if (!loader)
    return {
      warnings: [
        {
          code: "source" as const,
          message: `Unknown 3D building source: ${buildings.sourceId}`,
          fatal: false,
          sourceId: buildings.sourceId,
        },
      ],
    };
  try {
    const metadata = await loader.metadata(signal);
    const requestedZoom = Math.min(
      Math.floor(meshState.zoom),
      metadata.maxzoom ?? 14,
    );
    const selection = selectBuildingTiles(
      coverageState,
      meshState,
      requestedZoom,
      32,
    );
    const result = await loader.load(selection.tiles, signal);
    return {
      mesh: buildBuildingMesh(
        generation,
        result.features.filter((feature) => feature.sourceLayer === "building"),
        selection.tiles,
        meshState,
      ),
      warnings: result.warnings.map((warning) => ({
        ...warning,
        sourceId: buildings.sourceId,
      })),
    };
  } catch (cause) {
    if (signal.aborted) throw cause;
    return {
      warnings: [
        {
          code: "source" as const,
          message: `Unable to load 3D building source ${buildings.sourceId}`,
          fatal: false,
          cause,
          sourceId: buildings.sourceId,
        },
      ],
    };
  }
}

function post(message: WorkerResponse, transfer: Transferable[] = []): void {
  self.postMessage(message, { transfer });
}
