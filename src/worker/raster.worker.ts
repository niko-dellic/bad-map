/// <reference lib="webworker" />

import { visibleTiles } from "../geometry";
import { rasterizeView } from "../rasterize";
import { bandFor, effectiveStyleZoom, sourceZoom } from "../style";
import { TileLoader } from "../tile";
import type { WorkerRequest, WorkerResponse } from "./protocol";
import { frameTransferables } from "./protocol";

let loader: TileLoader | undefined;
let controller: AbortController | undefined;
let disposed = false;

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (message.type === "configure") {
    controller?.abort();
    loader = new TileLoader(message.source, message.maxCachedTiles);
    post({ type: "ready" });
    return;
  }
  if (message.type === "refresh") {
    controller?.abort();
    return;
  }
  if (message.type === "dispose") {
    disposed = true;
    controller?.abort();
    self.close();
    return;
  }
  if (message.type === "render") void render(message.generation, message.state);
};

async function render(
  generation: number,
  state: Extract<WorkerRequest, { type: "render" }>["state"],
): Promise<void> {
  if (!loader || disposed) return;
  controller?.abort();
  controller = new AbortController();
  try {
    const metadata = await loader.metadata(controller.signal);
    const zEff = effectiveStyleZoom(state.zoom, state.cell.height / 4);
    const band = bandFor(zEff);
    const requestedZoom = sourceZoom(zEff, band, metadata.maxzoom ?? 14);
    const selection = visibleTiles(state, requestedZoom, 16);
    const { features, warnings } = await loader.load(
      selection.tiles,
      controller.signal,
    );
    if (controller.signal.aborted || disposed) return;
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
