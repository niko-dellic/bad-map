/// <reference lib="webworker" />

import { visibleTiles } from "../geometry";
import { featureBelongsToPack } from "../packs";
import { rasterizeView } from "../rasterize";
import { bandFor, effectiveStyleZoom, sourceZoom } from "../style";
import { TileLoader } from "../tile";
import type { DecodedFeature } from "../tile";
import type { LowResError, LowResLayerPackDescriptor } from "../types";
import type { WorkerRequest, WorkerResponse } from "./protocol";
import { frameTransferables } from "./protocol";

let loaders = new Map<string, TileLoader>();
let layers: LowResLayerPackDescriptor[] = [];
let controller: AbortController | undefined;
let disposed = false;
let pendingRender: Extract<WorkerRequest, { type: "render" }> | undefined;
let pumpScheduled = false;
let rendering = false;
let latestGeneration = -1;

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
    loaders = new Map();
    for (const [sourceId, source] of Object.entries(message.sources)) {
      const included = new Set(
        layers
          .filter((layer) => layer.source === sourceId)
          .flatMap((layer) => layer.sourceLayers),
      );
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
  if (message.type === "set-time") {
    loaders.get(message.sourceId)?.setTimeKey(message.timeKey);
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
      await render(next.generation, next.state);
    }
  } finally {
    rendering = false;
    if (pendingRender) schedulePump();
  }
}

async function render(
  generation: number,
  state: Extract<WorkerRequest, { type: "render" }>["state"],
): Promise<void> {
  if (disposed) return;
  controller?.abort();
  controller = new AbortController();
  try {
    const zEff = effectiveStyleZoom(state.zoom, state.cell.height / 4);
    const band = bandFor(zEff);
    const bySource = new Map<string, DecodedFeature[]>();
    const warningsBySource = new Map<string, LowResError[]>();
    await Promise.all(
      [...loaders.entries()].map(async ([sourceId, sourceLoader]) => {
        try {
          const metadata = await sourceLoader.metadata(controller?.signal);
          const requestedZoom = sourceZoom(zEff, band, metadata.maxzoom ?? 14);
          const selection = visibleTiles(state, requestedZoom, 16);
          const result = await sourceLoader.load(
            selection.tiles,
            controller?.signal,
          );
          bySource.set(sourceId, result.features);
          warningsBySource.set(
            sourceId,
            result.warnings.map((warning) => ({ ...warning, sourceId })),
          );
        } catch (cause) {
          if (controller?.signal.aborted) throw cause;
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
    if (controller.signal.aborted || disposed || generation < latestGeneration)
      return;
    const frame = rasterizeView(features, state, generation, warnings);
    post({ type: "frame", frame }, frameTransferables(frame));
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

function post(message: WorkerResponse, transfer: Transferable[] = []): void {
  self.postMessage(message, { transfer });
}
