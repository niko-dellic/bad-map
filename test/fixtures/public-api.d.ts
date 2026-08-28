// dist/index.d.ts
export { LowResBasemap } from "./basemap/low-res-basemap.js";
export { DARK_THEME, LIGHT_THEME } from "./themes/index.js";
export { composeTheme, greyscaleColor, relativeLuminance, } from "./themes/index.js";
export { featureMatches, landuse, marine, political, streets, topographic, transit, weather, } from "./semantic/packs.js";
export type { BuiltinThemeName, BuiltinLayerAdapter, CellGeometry, LowResBasemapLike, LowResBasemapOptions, LowResColorMode, LowResDataAccessor, LowResDataFeature, LowResDataLayer, LowResDataLayerBase, LowResDataLayerState, LowResDataLayerUpdate, LowResCameraOptions, LowResBuildings3DOptions, LowResError, LowResEventMap, LowResFeature, LowResFeatureKind, LowResFogMode, LowResFogOptions, LowResHeatmapOptions, LowResHeatmapDataLayer, LowResHeatmapPoint, LowResLayerPackDescriptor, LowResLabelsOptions, LowResProjectionMode, LowResGeoJSONDataLayer, LowResGeoJSONFillStyle, LowResGeoJSONLineStyle, LowResGeoJSONPointStyle, LowResSource, LowResTheme, LowResTrip, LowResTripsDataLayer, LowResTripsPlayback, LowResTripsSeekOptions, LowResWaypoint, LowResWaypointDataLayer, LowResWaypointStyle, LowResWorkerFactories, RGB, } from "./types.js";

// dist/basemap/low-res-basemap.d.ts
import { type Map as MapLibreMap, type PointLike } from "maplibre-gl";
import type { CellGeometry, LowResBasemapOptions, LowResColorMode, LowResDataFeature, LowResDataLayer, LowResDataLayerState, LowResDataLayerUpdate, LowResEventMap, LowResFeature, LowResFogOptions, LowResHeatmapOptions, LowResHeatmapPoint, LowResLayerPackDescriptor, LowResProjectionMode, LowResSource, LowResTripsPlayback, LowResTripsSeekOptions, RGB } from "../types.js";
type Listener<K extends keyof LowResEventMap> = (event: LowResEventMap[K]) => void;
export declare class LowResBasemap {
    #private;
    readonly layerIds: {
        readonly base: "bad-map-base";
        readonly buildings: "bad-map-buildings-3d";
        readonly data: "bad-map-data";
        readonly markers: "bad-map-markers";
        readonly labels: "bad-map-labels";
        readonly fog: "bad-map-fog";
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
    setLabelsBillboard(billboard: boolean): this;
    getLabelsBillboard(): boolean;
    setProjectionMode(mode: LowResProjectionMode): this;
    setCamera(options: LowResBasemapOptions["camera"]): this;
    setBuildings3DVisible(visible: boolean): this;
    getBuildings3DVisible(): boolean;
    setFog(options: LowResFogOptions): this;
    setFogVisible(visible: boolean): this;
    getFogOptions(): Required<Omit<LowResFogOptions, "color">> & {
        color?: RGB;
    };
    setHeatmap(options: LowResHeatmapOptions): this;
    setHeatmapData(data: readonly LowResHeatmapPoint[] | Float32Array): this;
    setHeatmapVisible(visible: boolean): this;
    clearHeatmap(): this;
    getHeatmapOptions(): Omit<LowResHeatmapOptions, "data"> & {
        pointCount: number;
    };
    setDataLayer(layer: LowResDataLayer): this;
    updateDataLayer(id: string, update: LowResDataLayerUpdate): this;
    removeDataLayer(id: string): this;
    setDataLayerVisible(id: string, visible: boolean): this;
    getDataLayers(): LowResDataLayerState[];
    clearDataLayers(): this;
    setTripsPlayback(id: string, playback: LowResTripsPlayback): this;
    seekTripsPlayback(id: string, currentTime: number, options?: LowResTripsSeekOptions): this;
    stepTripsPlayback(id: string, delta: number, options?: LowResTripsSeekOptions): this;
    getTripsPlayback(id: string): Required<LowResTripsPlayback> & {
        loopLength: number;
    };
    setSource(source: LowResSource): this;
    setSources(sources: Record<string, LowResSource>): this;
    setLayers(layers: LowResLayerPackDescriptor[]): this;
    setSourceTime(sourceId: string, timeKey: string | number): this;
    setLayerVisible(id: string, visible: boolean): this;
    getLayers(): LowResLayerPackDescriptor[];
    refresh(): this;
    queryFeatures(point: PointLike): LowResFeature[];
    queryDataFeatures(point: PointLike): LowResDataFeature[];
    setFeatureInteractionEnabled(enabled: boolean): this;
    getFeatureInteractionEnabled(): boolean;
    setSelectedFeature(feature?: LowResFeature): this;
    on<K extends keyof LowResEventMap>(type: K, listener: Listener<K>): this;
    off<K extends keyof LowResEventMap>(type: K, listener: Listener<K>): this;
}
export {};
