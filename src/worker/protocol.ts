import type {
  LowResLayerPackDescriptor,
  LowResSource,
  RasterFrame,
  RasterViewState,
} from "../types";
import type { HeatmapRasterOptions } from "../heatmap";

export type WorkerRequest =
  | {
      type: "configure";
      sources: Record<string, LowResSource>;
      layers: LowResLayerPackDescriptor[];
      maxCachedTiles: number;
    }
  | { type: "render"; generation: number; state: RasterViewState }
  | { type: "set-time"; sourceId: string; timeKey: string | number }
  | {
      type: "set-heatmap";
      options: HeatmapRasterOptions;
      points?: Float32Array;
    }
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
    frame.scalar.buffer,
    frame.heatmap.buffer,
  ];
}
