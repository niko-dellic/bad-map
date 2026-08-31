import type {
  BuildingMeshFrame,
  LowResBuildings3DStyle,
  LowResLayerPackDescriptor,
  LowResSource,
  RasterFrame,
  RasterViewState,
} from "../types.js";
import type { HeatmapRasterOptions } from "../data-layers/heatmap.js";

export type WorkerRequest =
  | {
      type: "configure";
      sources: Record<string, LowResSource>;
      layers: LowResLayerPackDescriptor[];
      maxCachedTiles: number;
      buildings: {
        visible: boolean;
        style: LowResBuildings3DStyle;
        sourceId: string;
        minZoom: number;
      };
    }
  | {
      type: "render";
      generation: number;
      state: RasterViewState;
      detailState?: RasterViewState;
    }
  | { type: "set-buildings-visible"; visible: boolean }
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
  | {
      type: "frame";
      frame: RasterFrame;
      detailFrame?: RasterFrame;
      buildingMesh?: BuildingMeshFrame;
    }
  | { type: "error"; generation: number; message: string; cause?: string };

export function frameTransferables(
  frame: RasterFrame,
  detailFrame?: RasterFrame,
  buildingMesh?: BuildingMeshFrame,
): Transferable[] {
  const buffers = [
    frame.fill.buffer,
    frame.lineMask.buffer,
    frame.lineClass.buffer,
    frame.lineTone.buffer,
    frame.owner.buffer,
    frame.ribbon.buffer,
    frame.scalar.buffer,
    frame.heatmap.buffer,
  ];
  if (detailFrame)
    buffers.push(
      detailFrame.fill.buffer,
      detailFrame.lineMask.buffer,
      detailFrame.lineClass.buffer,
      detailFrame.lineTone.buffer,
      detailFrame.owner.buffer,
      detailFrame.ribbon.buffer,
      detailFrame.scalar.buffer,
      detailFrame.heatmap.buffer,
    );
  if (buildingMesh)
    for (const tile of buildingMesh.tiles)
      buffers.push(
        tile.vertices.buffer,
        tile.indices.buffer,
        tile.edgeVertices.buffer,
      );
  return buffers;
}
