// dist/index.d.ts
export { LowResBasemap } from "./low-res-basemap";
export { DARK_THEME, LIGHT_THEME } from "./theme";
export { composeTheme, greyscaleColor, relativeLuminance } from "./theme";
export { FillClass, LabelInk, LineClass, bandFor, effectiveStyleZoom, sourceZoom, } from "./style";
export type { BuiltinThemeName, CellGeometry, LowResBasemapLike, LowResBasemapOptions, LowResColorMode, LowResError, LowResEventMap, LowResFeature, LowResFeatureKind, LowResSource, LowResTheme, RGB, } from "./types";

// dist/low-res-basemap.d.ts
import { type Map as MapLibreMap, type PointLike } from "maplibre-gl";
import type { CellGeometry, LowResBasemapOptions, LowResColorMode, LowResEventMap, LowResFeature, LowResSource } from "./types";
type Listener<K extends keyof LowResEventMap> = (event: LowResEventMap[K]) => void;
export declare class LowResBasemap {
    #private;
    readonly layerIds: {
        readonly base: "bad-map-base";
        readonly labels: "bad-map-labels";
    };
    constructor(options?: LowResBasemapOptions);
    addTo(map: MapLibreMap): Promise<this>;
    remove(): void;
    setTheme(theme: LowResBasemapOptions["theme"]): this;
    setColorMode(colorMode: LowResColorMode): this;
    setCell(cell: Partial<CellGeometry>): this;
    setLocale(locale: string): this;
    setLabelsVisible(visible: boolean): this;
    setSource(source: LowResSource): this;
    refresh(): this;
    queryFeatures(point: PointLike): LowResFeature[];
    on<K extends keyof LowResEventMap>(type: K, listener: Listener<K>): this;
    off<K extends keyof LowResEventMap>(type: K, listener: Listener<K>): this;
}
export {};
