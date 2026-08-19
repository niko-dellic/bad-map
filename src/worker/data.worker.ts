/// <reference lib="webworker" />

import {
  compositeDataFrames,
  rasterizeDataLayers,
  type SerializedDataLayer,
} from "../data.js";
import type { DataRasterFrame, RasterViewState } from "../types.js";
import type { DataWorkerRequest, DataWorkerResponse } from "./data-protocol.js";
import { dataFrameTransferables } from "./data-protocol.js";

let layers: SerializedDataLayer[] = [];
let disposed = false;
let latestGeneration = -1;
let pending: Extract<DataWorkerRequest, { type: "render" }> | undefined;
let scheduled = false;
const staticFrames = new Map<
  string,
  { stateKey: string; frame: DataRasterFrame }
>();

self.onmessage = (event: MessageEvent<DataWorkerRequest>) => {
  const message = event.data;
  if (message.type === "set-layers") {
    layers = message.layers;
    staticFrames.clear();
    post({ type: "ready" });
    return;
  }
  if (message.type === "upsert-layer") {
    const index = layers.findIndex((layer) => layer.id === message.layer.id);
    if (index < 0) layers.push(message.layer);
    else layers[index] = message.layer;
    staticFrames.delete(message.layer.id);
    return;
  }
  if (message.type === "patch-layer") {
    const layer = layers.find((candidate) => candidate.id === message.id);
    if (layer) Object.assign(layer, message.patch);
    staticFrames.delete(message.id);
    return;
  }
  if (message.type === "remove-layer") {
    layers = layers.filter((layer) => layer.id !== message.id);
    staticFrames.delete(message.id);
    return;
  }
  if (message.type === "playback") {
    const layer = layers.find(
      (
        candidate,
      ): candidate is Extract<SerializedDataLayer, { type: "trips" }> =>
        candidate.id === message.id && candidate.type === "trips",
    );
    if (layer) {
      layer.currentTime = message.currentTime;
      layer.playing = message.playing;
      layer.speed = message.speed;
      layer.trailLength = message.trailLength;
    }
    return;
  }
  if (message.type === "dispose") {
    disposed = true;
    pending = undefined;
    self.close();
    return;
  }
  latestGeneration = Math.max(latestGeneration, message.generation);
  pending = message;
  schedule();
};

function schedule(): void {
  if (scheduled || disposed) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    const message = pending;
    pending = undefined;
    if (!message || disposed || message.generation < latestGeneration) return;
    try {
      const stateKey = rasterStateKey(message.state);
      const ordered = layers
        .map((layer, index) => ({ layer, index }))
        .filter(({ layer }) => layer.visible && layer.opacity > 0)
        .sort((a, b) => a.layer.order - b.layer.order || a.index - b.index);
      const parts = ordered.map(({ layer }) => {
        if (layer.type === "trips")
          return rasterizeDataLayers(
            [layer],
            message.state,
            message.generation,
          );
        const cached = staticFrames.get(layer.id);
        if (cached?.stateKey === stateKey) return cached.frame;
        const frame = rasterizeDataLayers(
          [layer],
          message.state,
          message.generation,
        );
        staticFrames.set(layer.id, { stateKey, frame });
        return frame;
      });
      const frame = compositeDataFrames(
        parts,
        message.state,
        message.generation,
      );
      if (!disposed && message.generation >= latestGeneration)
        post({ type: "frame", frame }, dataFrameTransferables(frame));
    } catch (cause) {
      const error: DataWorkerResponse = {
        type: "error",
        generation: message.generation,
        message:
          cause instanceof Error ? cause.message : "Unknown data worker error",
        ...(cause instanceof Error && cause.stack
          ? { cause: cause.stack }
          : { cause: String(cause) }),
      };
      post(error);
    }
    if (pending) schedule();
  }, 0);
}

function post(
  message: DataWorkerResponse,
  transfer: Transferable[] = [],
): void {
  self.postMessage(message, { transfer });
}

function rasterStateKey(state: RasterViewState): string {
  return [
    state.center.lng,
    state.center.lat,
    state.zoom,
    state.bearing,
    state.pitch,
    state.width,
    state.height,
    state.pixelRatio,
    state.cell.width,
    state.cell.height,
    state.cell.dotSize,
  ].join(":");
}
