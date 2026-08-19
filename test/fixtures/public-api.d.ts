// dist/index.d.ts
export { LowResBasemap } from "./low-res-basemap";
export { DARK_THEME, LIGHT_THEME } from "./theme";
export { composeTheme, greyscaleColor, relativeLuminance } from "./theme";
export { featureMatches, landuse, marine, political, streets, topographic, transit, weather, } from "./packs";
export { FillClass, LabelInk, LineClass, bandFor, effectiveStyleZoom, sourceZoom, } from "./style";
export type { BuiltinThemeName, BuiltinLayerAdapter, CellGeometry, LowResBasemapLike, LowResBasemapOptions, LowResColorMode, LowResCameraOptions, LowResBuildings3DOptions, LowResError, LowResEventMap, LowResFeature, LowResFeatureKind, LowResHeatmapOptions, LowResHeatmapPoint, LowResLayerPackDescriptor, LowResProjectionMode, LowResSource, LowResTheme, RGB, } from "./types";

// dist/low-res-basemap.d.ts
import { type Map as MapLibreMap, type PointLike } from "maplibre-gl";
import type { CellGeometry, LowResBasemapOptions, LowResColorMode, LowResEventMap, LowResFeature, LowResHeatmapOptions, LowResHeatmapPoint, LowResLayerPackDescriptor, LowResProjectionMode, LowResSource } from "./types";
type Listener<K extends keyof LowResEventMap> = (event: LowResEventMap[K]) => void;
export declare class LowResBasemap {
    #private;
    readonly layerIds: {
        readonly base: "bad-map-base";
        readonly buildings: "bad-map-buildings-3d";
        readonly data: "bad-map-data";
        readonly markers: "bad-map-markers";
        readonly labels: "bad-map-labels";
        readonly interaction: "bad-map-interaction";
    };
    constructor(options?: LowResBasemapOptions);
    addTo(map: MapLibreMap): Promise<this>;
    remove(): void;
    setTheme(theme: LowResBasemapOptions["theme"]): this;
    setColorMode(colorMode: LowResColorMode): this;
    setCell(cell: Partial<CellGeometry>): this;
    setLocale(locale: string): this;
    setLabelsVisible(visible: boolean): this;
    setProjectionMode(mode: LowResProjectionMode): this;
    setCamera(options: LowResBasemapOptions["camera"]): this;
    setBuildings3DVisible(visible: boolean): this;
    getBuildings3DVisible(): boolean;
    setHeatmap(options: LowResHeatmapOptions): this;
    setHeatmapData(data: readonly LowResHeatmapPoint[] | Float32Array): this;
    setHeatmapVisible(visible: boolean): this;
    clearHeatmap(): this;
    getHeatmapOptions(): Omit<LowResHeatmapOptions, "data"> & {
        pointCount: number;
    };
    setSource(source: LowResSource): this;
    setSources(sources: Record<string, LowResSource>): this;
    setLayers(layers: LowResLayerPackDescriptor[]): this;
    setSourceTime(sourceId: string, timeKey: string | number): this;
    setLayerVisible(id: string, visible: boolean): this;
    getLayers(): LowResLayerPackDescriptor[];
    refresh(): this;
    queryFeatures(point: PointLike): LowResFeature[];
    setSelectedFeature(feature?: LowResFeature): this;
    on<K extends keyof LowResEventMap>(type: K, listener: Listener<K>): this;
    off<K extends keyof LowResEventMap>(type: K, listener: Listener<K>): this;
}
export {};
