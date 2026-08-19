import type { LowResSource, RasterFrame, RasterViewState } from "../types";

export type WorkerRequest =
  | { type: "configure"; source: LowResSource; maxCachedTiles: number }
  | { type: "render"; generation: number; state: RasterViewState }
  | { type: "refresh" }
  | { type: "dispose" };

export type WorkerResponse =
  | { type: "ready" }
  | { type: "frame"; frame: RasterFrame }
  | { type: "error"; generation: number; message: string; cause?: string };

export function frameTransferables(frame: RasterFrame): Transferable[] {
  return [
    frame.fill.buffer,
    frame.lineMask.buffer,
    frame.lineClass.buffer,
    frame.lineTone.buffer,
    frame.owner.buffer,
    frame.ribbon.buffer,
  ];
}
