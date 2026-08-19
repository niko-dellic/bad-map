import type { SerializedDataLayer } from "../data.js";
import type { DataRasterFrame, RasterViewState } from "../types.js";

export type DataWorkerRequest =
  | { type: "set-layers"; layers: SerializedDataLayer[] }
  | { type: "upsert-layer"; layer: SerializedDataLayer }
  | {
      type: "patch-layer";
      id: string;
      patch: Partial<
        Pick<
          SerializedDataLayer,
          "visible" | "opacity" | "order" | "pickable"
        > & {
          width: number;
          trailLength: number;
          speed: number;
        }
      >;
    }
  | { type: "remove-layer"; id: string }
  | { type: "render"; generation: number; state: RasterViewState }
  | {
      type: "playback";
      id: string;
      currentTime: number;
      playing: boolean;
      speed: number;
      trailLength: number;
    }
  | { type: "dispose" };

export type DataWorkerResponse =
  | { type: "ready" }
  | { type: "frame"; frame: DataRasterFrame }
  | {
      type: "error";
      generation: number;
      message: string;
      cause?: string;
      layerId?: string;
    };

export function dataFrameTransferables(frame: DataRasterFrame): Transferable[] {
  return [
    frame.data.buffer,
    frame.markers.buffer,
    frame.dataOwner.buffer,
    frame.markerOwner.buffer,
  ];
}
