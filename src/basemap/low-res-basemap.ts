import {
  AttributionControl,
  type FillExtrusionLayerSpecification,
  type Map as MapLibreMap,
  type PointLike,
} from "maplibre-gl";
import DataRasterWorker from "../workers/data.worker.ts?worker&inline";
import RasterWorker from "../workers/raster.worker.ts?worker&inline";
import {
  BaseLayer,
  BuildingsLayer,
  DataLayer,
  FogLayer,
  LabelsLayer,
  MarkerLayer,
  SlotLayer,
} from "../render/index.js";
import {
  dataLayerState,
  serializeDataLayer,
  type SerializedDataLayer,
} from "../data-layers/index.js";
import {
  fitSurfaceViewState,
  lngLatToWorld,
  reprojectPoint,
  reprojectionTransform,
  surfaceDetailViewState,
} from "../core/geometry.js";
import { streets } from "../semantic/packs.js";
import { composeTheme, resolveTheme } from "../themes/index.js";
import type {
  CellGeometry,
  BuildingMeshFrame,
  DataRasterFrame,
  LowResBasemapOptions,
  LowResBuildings3DOptions,
  LowResColorMode,
  LowResDataFeature,
  LowResDataLayer,
  LowResDataLayerState,
  LowResDataLayerUpdate,
  LowResError,
  LowResEventMap,
  LowResFeature,
  LowResFogMode,
  LowResFogOptions,
  LowResHeatmapOptions,
  LowResHeatmapPoint,
  LowResLayerPackDescriptor,
  LowResProjectionMode,
  LowResSource,
  LowResTheme,
  LowResTripsPlayback,
  LowResTripsSeekOptions,
  RGB,
  RasterFrame,
  RasterViewState,
} from "../types.js";
import type { WorkerRequest, WorkerResponse } from "../workers/protocol.js";
import type {
  DataWorkerRequest,
  DataWorkerResponse,
} from "../workers/data-protocol.js";
import {
  fogStateEquals,
  normalizeCamera,
  normalizeBuildings3D,
  normalizeFog,
  normalizeHeatmap,
  normalizeHeatmapData,
  validateCell,
  validateColorMode,
  validateFog,
  validateHeatmap,
  validateProjectionMode,
  type FogState,
  type HeatmapState,
} from "./options.js";
import {
  featureKey,
  geographicFramePoint,
  normalizeLayers,
  pointLike,
  rgbCss,
} from "./utilities.js";

const DEFAULT_SOURCE: LowResSource = {
  tileJSON: "https://tiles.openfreemap.org/planet",
  attribution: "OpenFreeMap © OpenMapTiles · Data © OpenStreetMap contributors",
};

const DEFAULT_CELL: CellGeometry = { width: 8, height: 16, dotSize: 2 };
const BUILDINGS_SOURCE_ID = "bad-map-buildings-source";
const DEFAULT_HEATMAP_LAYER_ID = "bad-map-default-heatmap";
const DEFAULT_HEATMAP_PALETTE = [
  [40, 109, 155],
  [87, 173, 133],
  [239, 178, 75],
  [226, 76, 91],
] as const satisfies readonly [RGB, RGB, RGB, RGB];

type Listener<K extends keyof LowResEventMap> = (
  event: LowResEventMap[K],
) => void;

export class LowResBasemap {
  readonly layerIds = {
    base: "bad-map-base",
    buildings: "bad-map-buildings-3d",
    data: "bad-map-data",
    markers: "bad-map-markers",
    labels: "bad-map-labels",
    fog: "bad-map-fog",
    interaction: "bad-map-interaction",
  } as const;

  #options: Required<
    Pick<
      LowResBasemapOptions,
      | "locale"
      | "attribution"
      | "enforceNorthUp"
      | "maxCachedTiles"
      | "renderThrottleMs"
    >
  > & { labels: boolean };
  #sources: Record<string, LowResSource>;
  #layers: LowResLayerPackDescriptor[];
  #cell: CellGeometry;
  #labelsBillboard: boolean;
  #baseTheme: LowResTheme;
  #theme: LowResTheme;
  #colorMode: LowResColorMode;
  #projectionMode: LowResProjectionMode;
  #buildings3D: Required<LowResBuildings3DOptions>;
  #fog: FogState;
  #heatmap: HeatmapState;
  #dataLayers = new Map<
    string,
    { source: LowResDataLayer; serialized: SerializedDataLayer }
  >();
  #camera: { rotation: boolean; pitch: boolean; maxPitch: number };
  #styleRevision = 0;
  #map: MapLibreMap | undefined;
  #worker: Worker | undefined;
  #dataWorker: Worker | undefined;
  #workerFactory: () => Worker;
  #dataWorkerFactory: () => Worker;
  #frame: RasterFrame | undefined;
  #detailFrame: RasterFrame | undefined;
  #buildingMesh: BuildingMeshFrame | undefined;
  #dataFrame: DataRasterFrame | undefined;
  #generation = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #lastRenderRequest = 0;
  #attribution: AttributionControl | undefined;
  #baseLayer: BaseLayer | undefined;
  #buildingsLayer: BuildingsLayer | undefined;
  #dataLayer: DataLayer | undefined;
  #markerLayer: MarkerLayer | undefined;
  #labelsLayer: LabelsLayer | undefined;
  #fogLayer: FogLayer | undefined;
  #featureInteractionEnabled: boolean;
  #hovered: LowResFeature | undefined;
  #hoveredData: LowResDataFeature | undefined;
  #animationFrame: number | undefined;
  #animationTime = 0;
  #lastAnimationRaster = 0;
  #selectedKey: string | undefined;
  #listeners = new Map<keyof LowResEventMap, Set<(event: never) => void>>();
  #rotationState:
    | {
        drag: boolean;
        touch: boolean;
        bearing: number;
        pitch: number;
        maxPitch: number;
      }
    | undefined;

  constructor(options: LowResBasemapOptions = {}) {
    this.#sources = {
      ...(options.sources ?? {}),
      ...(!options.sources?.base || options.source
        ? { base: options.source ?? DEFAULT_SOURCE }
        : {}),
    };
    this.#layers = normalizeLayers(options.layers ?? [streets()]);
    this.#cell = { ...DEFAULT_CELL, ...options.cell };
    this.#labelsBillboard =
      typeof options.labels === "object"
        ? (options.labels.billboard ?? true)
        : true;
    validateCell(this.#cell);
    this.#baseTheme = resolveTheme(options.theme);
    this.#colorMode = validateColorMode(options.colorMode ?? "greyscale");
    this.#projectionMode = validateProjectionMode(
      options.projectionMode ?? "surface",
    );
    this.#buildings3D = normalizeBuildings3D(options.buildings3D);
    this.#fog = normalizeFog(options.fog);
    this.#heatmap = normalizeHeatmap(options.heatmap);
    for (const layer of options.dataLayers ?? []) this.#storeDataLayer(layer);
    this.#storeDataLayer(this.#defaultHeatmapLayer());
    this.#featureInteractionEnabled = options.featureInteraction ?? true;
    const surface = this.#projectionMode === "surface";
    this.#camera = normalizeCamera(options.camera, {
      rotation: surface,
      pitch: surface,
      maxPitch: 60,
    });
    this.#theme = composeTheme(this.#baseTheme, this.#colorMode);
    this.#options = {
      locale: options.locale ?? "en",
      labels:
        typeof options.labels === "object"
          ? (options.labels.visible ?? true)
          : (options.labels ?? true),
      attribution: options.attribution ?? true,
      enforceNorthUp: options.enforceNorthUp ?? false,
      maxCachedTiles: options.maxCachedTiles ?? 96,
      renderThrottleMs: options.renderThrottleMs ?? 70,
    };
    this.#workerFactory =
      options.workers?.raster ??
      options.workerFactory ??
      (() => new RasterWorker({ name: "bad-map-raster" }));
    this.#dataWorkerFactory =
      options.workers?.data ??
      (() => new DataRasterWorker({ name: "bad-map-data-raster" }));
  }

  async addTo(map: MapLibreMap): Promise<this> {
    if (this.#map) throw new Error("This LowResBasemap is already attached");
    this.#map = map;
    if (!map.isStyleLoaded())
      await new Promise<void>((resolve) =>
        map.once("style.load", () => resolve()),
      );
    this.#configureCamera(map);

    this.#worker = this.#workerFactory();
    this.#worker.onmessage = (event: MessageEvent<WorkerResponse>) =>
      this.#onWorkerMessage(event.data);
    this.#worker.onerror = (event) =>
      this.#emitError({
        code: "render",
        message: event.message,
        fatal: false,
        cause: event.error,
      });
    this.#ensureDataWorkerForVisibleLayers();
    this.#post({
      type: "configure",
      sources: this.#sources,
      layers: this.#layers,
      maxCachedTiles: this.#options.maxCachedTiles,
      buildings: this.#workerBuildingsOptions(),
    });
    const provider = {
      frame: () => this.#frame,
      detailFrame: () => this.#detailFrame,
      buildingMesh: () => this.#buildingMesh,
      dataFrame: () => this.#dataFrame,
      viewState: () => this.#currentViewState(),
      theme: () => this.#theme,
      labelsVisible: () => this.#options.labels,
      labelsBillboard: () => this.#labelsBillboard,
      styleRevision: () => this.#styleRevision,
      hoveredOwner: (frame?: RasterFrame) =>
        this.#featureOwner(frame, this.#hovered),
      selectedOwner: (frame?: RasterFrame) => this.#selectedOwner(frame),
      projectionMode: () => this.#projectionMode,
      scalarPalette: () =>
        [
          this.#baseTheme.lines.waterway,
          this.#baseTheme.labels.park,
          this.#baseTheme.lines.motorway,
          this.#baseTheme.labels.medical,
        ] as const,
      fog: () => ({
        ...this.#fog,
        color: this.#fog.color ?? this.#theme.fills.ground,
      }),
      buildings: () => ({
        visible: this.#buildings3D.visible,
        minZoom: this.#buildings3D.minZoom,
        opacity: this.#buildings3D.opacity,
        heightScale: this.#buildings3D.heightScale,
        fill: this.#buildings3D.fill,
        dots: this.#buildings3D.dots,
        edges: this.#buildings3D.edges,
        edgeStrength: this.#buildings3D.edgeStrength,
      }),
    };
    this.#baseLayer = new BaseLayer(this.layerIds.base, provider);
    this.#buildingsLayer =
      this.#buildings3D.style === "dotted"
        ? new BuildingsLayer(this.layerIds.buildings, provider)
        : undefined;
    this.#dataLayer = new DataLayer(this.layerIds.data, provider);
    this.#markerLayer = new MarkerLayer(this.layerIds.markers, provider);
    this.#labelsLayer = new LabelsLayer(this.layerIds.labels, provider);
    this.#fogLayer = new FogLayer(this.layerIds.fog, provider);
    map.addLayer(this.#baseLayer);
    if (this.#buildingsLayer) map.addLayer(this.#buildingsLayer);
    else this.#ensureBuildings3DLayer();
    map.addLayer(this.#dataLayer);
    map.addLayer(this.#markerLayer);
    map.addLayer(this.#labelsLayer);
    map.addLayer(this.#fogLayer);
    map.addLayer(new SlotLayer(this.layerIds.interaction));

    if (this.#options.attribution) {
      this.#attribution = new AttributionControl({
        compact: true,
        customAttribution: this.#sourceAttribution(),
      });
      map.addControl(this.#attribution, "bottom-right");
    }

    map.on("move", this.#onMove);
    map.on("moveend", this.#onMoveEnd);
    map.on("resize", this.#onMoveEnd);
    if (this.#featureInteractionEnabled) {
      map.on("mousemove", this.#onMouseMove);
      map.on("click", this.#onClick);
    }
    this.#requestRender(true);
    this.#scheduleAnimation();
    return this;
  }

  remove(): void {
    const map = this.#map;
    if (!map) return;
    if (this.#timer) clearTimeout(this.#timer);
    if (this.#animationFrame !== undefined)
      cancelAnimationFrame(this.#animationFrame);
    map.off("move", this.#onMove);
    map.off("moveend", this.#onMoveEnd);
    map.off("resize", this.#onMoveEnd);
    map.off("mousemove", this.#onMouseMove);
    map.off("click", this.#onClick);
    for (const id of [
      this.layerIds.interaction,
      this.layerIds.fog,
      this.layerIds.labels,
      this.layerIds.markers,
      this.layerIds.data,
      this.layerIds.buildings,
      this.layerIds.base,
    ])
      if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(BUILDINGS_SOURCE_ID))
      map.removeSource(BUILDINGS_SOURCE_ID);
    if (this.#attribution) map.removeControl(this.#attribution);
    this.#restoreNorthUp(map);
    this.#post({ type: "dispose" });
    this.#postData({ type: "dispose" });
    this.#worker?.terminate();
    this.#dataWorker?.terminate();
    this.#worker = undefined;
    this.#dataWorker = undefined;
    this.#map = undefined;
    this.#frame = undefined;
    this.#detailFrame = undefined;
    this.#buildingMesh = undefined;
    this.#dataFrame = undefined;
    this.#baseLayer = undefined;
    this.#buildingsLayer = undefined;
    this.#dataLayer = undefined;
    this.#markerLayer = undefined;
    this.#labelsLayer = undefined;
    this.#fogLayer = undefined;
    this.#hovered = undefined;
    this.#hoveredData = undefined;
    this.#animationFrame = undefined;
  }

  setTheme(theme: LowResBasemapOptions["theme"]): this {
    this.#baseTheme = resolveTheme(theme);
    this.#applyStyle();
    return this;
  }

  setColorMode(colorMode: LowResColorMode): this {
    validateColorMode(colorMode);
    if (colorMode === this.#colorMode) return this;
    this.#colorMode = colorMode;
    this.#applyStyle();
    return this;
  }

  setCell(cell: Partial<CellGeometry>): this {
    const next = { ...this.#cell, ...cell };
    validateCell(next);
    this.#cell = next;
    this.refresh();
    return this;
  }

  setLocale(locale: string): this {
    this.#options.locale = locale;
    this.refresh();
    return this;
  }

  setLabelsVisible(visible: boolean): this {
    if (visible === this.#options.labels) return this;
    this.#options.labels = visible;
    this.#styleRevision += 1;
    this.#map?.triggerRepaint();
    return this;
  }

  setLabelsBillboard(billboard: boolean): this {
    if (billboard === this.#labelsBillboard) return this;
    this.#labelsBillboard = billboard;
    this.#map?.triggerRepaint();
    return this;
  }

  getLabelsBillboard(): boolean {
    return this.#labelsBillboard;
  }

  setProjectionMode(mode: LowResProjectionMode): this {
    validateProjectionMode(mode);
    if (mode === this.#projectionMode) return this;
    this.#projectionMode = mode;
    if (this.#map) this.#configureCamera(this.#map, true);
    this.#syncBuildings3DVisibility();
    this.#post({
      type: "set-buildings-visible",
      visible: this.#dottedBuildingsVisible(),
    });
    this.refresh();
    this.#emit("projectionchange", { target: this, mode });
    return this;
  }

  setCamera(options: LowResBasemapOptions["camera"]): this {
    if (!options) return this;
    const next = normalizeCamera(options, this.#camera);
    this.#camera = next;
    if (this.#map) this.#configureCamera(this.#map, true);
    return this;
  }

  setBuildings3DVisible(visible: boolean): this {
    if (visible === this.#buildings3D.visible) return this;
    this.#buildings3D.visible = visible;
    this.#ensureBuildings3DLayer();
    this.#syncBuildings3DVisibility();
    this.#post({
      type: "set-buildings-visible",
      visible: this.#dottedBuildingsVisible(),
    });
    if (visible) this.refresh();
    this.#emit("buildingschange", { target: this, visible });
    return this;
  }

  getBuildings3DVisible(): boolean {
    return this.#buildings3D.visible;
  }

  setBuildings3DAppearance(
    options: Pick<
      LowResBuildings3DOptions,
      "fill" | "dots" | "edges" | "edgeStrength" | "heightScale"
    >,
  ): this {
    const next = normalizeBuildings3D({ ...this.#buildings3D, ...options });
    this.#buildings3D.fill = next.fill;
    this.#buildings3D.dots = next.dots;
    this.#buildings3D.edges = next.edges;
    this.#buildings3D.edgeStrength = next.edgeStrength;
    this.#buildings3D.heightScale = next.heightScale;
    this.#applyBuildings3DStyle();
    return this;
  }

  getBuildings3DAppearance(): Required<
    Pick<
      LowResBuildings3DOptions,
      "fill" | "dots" | "edges" | "edgeStrength" | "heightScale"
    >
  > {
    return {
      fill: this.#buildings3D.fill,
      dots: this.#buildings3D.dots,
      edges: this.#buildings3D.edges,
      edgeStrength: this.#buildings3D.edgeStrength,
      heightScale: this.#buildings3D.heightScale,
    };
  }

  setFog(options: LowResFogOptions): this {
    const next: FogState = {
      ...this.#fog,
      ...(options.visible === undefined ? {} : { visible: options.visible }),
      ...(options.mode === undefined ? {} : { mode: options.mode }),
      ...(options.start === undefined ? {} : { start: options.start }),
      ...(options.end === undefined ? {} : { end: options.end }),
      ...(options.opacity === undefined ? {} : { opacity: options.opacity }),
    };
    if ("color" in options) {
      if (options.color) next.color = [...options.color] as RGB;
      else delete next.color;
    }
    validateFog(next);
    if (fogStateEquals(next, this.#fog)) return this;
    this.#fog = next;
    this.#map?.triggerRepaint();
    this.#emitFogChange();
    return this;
  }

  setFogVisible(visible: boolean): this {
    return this.setFog({ visible });
  }

  getFogOptions(): Required<Omit<LowResFogOptions, "color">> & {
    color?: RGB;
  } {
    return {
      visible: this.#fog.visible,
      mode: this.#fog.mode,
      start: this.#fog.start,
      end: this.#fog.end,
      opacity: this.#fog.opacity,
      ...(this.#fog.color ? { color: [...this.#fog.color] as RGB } : {}),
    };
  }

  setHeatmap(options: LowResHeatmapOptions): this {
    const previous = this.#heatmap;
    const next: HeatmapState = {
      ...previous,
      ...(options.visible === undefined ? {} : { visible: options.visible }),
      ...(options.radius === undefined ? {} : { radius: options.radius }),
      ...(options.intensity === undefined
        ? {}
        : { intensity: options.intensity }),
      ...(options.maxDensity === undefined
        ? {}
        : { maxDensity: options.maxDensity }),
      ...(options.opacity === undefined ? {} : { opacity: options.opacity }),
      ...("palette" in options ? { palette: options.palette } : {}),
      ...(options.data === undefined
        ? {}
        : { points: normalizeHeatmapData(options.data) }),
    };
    validateHeatmap(next);
    this.#heatmap = next;
    this.#storeDataLayer(this.#defaultHeatmapLayer());
    this.#ensureDataWorkerForVisibleLayers();
    this.#sendDataLayer(DEFAULT_HEATMAP_LAYER_ID);
    this.#requestDataRender();
    this.#emitHeatmapChange();
    return this;
  }

  setHeatmapData(data: readonly LowResHeatmapPoint[] | Float32Array): this {
    return this.setHeatmap({ data });
  }

  setHeatmapVisible(visible: boolean): this {
    return this.setHeatmap({ visible });
  }

  clearHeatmap(): this {
    return this.setHeatmap({ data: new Float32Array(), visible: false });
  }

  getHeatmapOptions(): Omit<LowResHeatmapOptions, "data"> & {
    pointCount: number;
  } {
    return {
      visible: this.#heatmap.visible,
      radius: this.#heatmap.radius,
      intensity: this.#heatmap.intensity,
      maxDensity: this.#heatmap.maxDensity,
      opacity: this.#heatmap.opacity,
      palette: this.#heatmapPalette(),
      pointCount: this.#heatmap.points.length / 3,
    };
  }

  setDataLayer(layer: LowResDataLayer): this {
    if (layer.id === DEFAULT_HEATMAP_LAYER_ID)
      throw new RangeError(`${DEFAULT_HEATMAP_LAYER_ID} is reserved`);
    this.#storeDataLayer(layer);
    this.#ensureDataWorkerForVisibleLayers();
    this.#sendDataLayer(layer.id);
    this.#requestDataRender();
    this.#emitDataLayerChange(layer.id);
    this.#scheduleAnimation();
    return this;
  }

  updateDataLayer(id: string, update: LowResDataLayerUpdate): this {
    const current = this.#dataLayers.get(id)?.source;
    if (!current || id === DEFAULT_HEATMAP_LAYER_ID)
      throw new RangeError(`Unknown data layer: ${id}`);
    if (update.type !== current.type)
      throw new TypeError(
        `Data layer ${id} is ${current.type}, not ${update.type}`,
      );
    const { type: _type, ...patch } = update;
    const source = {
      ...current,
      ...patch,
      id,
      type: current.type,
    } as LowResDataLayer;
    const serialized = serializeDataLayer(source);
    this.#dataLayers.set(id, { source, serialized });
    this.#ensureDataWorkerForVisibleLayers();
    const patchable = Object.keys(patch).every((key) =>
      ["visible", "opacity", "order", "pickable"].includes(key),
    );
    if (patchable)
      this.#postData({
        type: "patch-layer",
        id,
        patch: {
          visible: serialized.visible,
          opacity: serialized.opacity,
          order: serialized.order,
          pickable: serialized.pickable,
        },
      });
    else this.#sendDataLayer(id);
    this.#requestDataRender();
    this.#emitDataLayerChange(id);
    this.#scheduleAnimation();
    return this;
  }

  removeDataLayer(id: string): this {
    if (id === DEFAULT_HEATMAP_LAYER_ID)
      throw new RangeError("Use clearHeatmap() for the default heatmap");
    if (!this.#dataLayers.delete(id)) return this;
    this.#postData({ type: "remove-layer", id });
    this.#requestDataRender();
    this.#emit("datalayerchange", {
      target: this,
      id,
      action: "remove",
    });
    this.#scheduleAnimation();
    return this;
  }

  setDataLayerVisible(id: string, visible: boolean): this {
    const layer = this.#dataLayers.get(id)?.source;
    if (!layer || id === DEFAULT_HEATMAP_LAYER_ID)
      throw new RangeError(`Unknown data layer: ${id}`);
    return this.updateDataLayer(id, {
      type: layer.type,
      visible,
    } as LowResDataLayerUpdate);
  }

  getDataLayers(): LowResDataLayerState[] {
    return [...this.#dataLayers.values()]
      .filter(({ source }) => source.id !== DEFAULT_HEATMAP_LAYER_ID)
      .map(({ serialized }) => dataLayerState(serialized));
  }

  clearDataLayers(): this {
    for (const id of [...this.#dataLayers.keys()])
      if (id !== DEFAULT_HEATMAP_LAYER_ID) {
        this.#dataLayers.delete(id);
        this.#postData({ type: "remove-layer", id });
      }
    this.#requestDataRender();
    this.#emit("datalayerchange", {
      target: this,
      id: "*",
      action: "clear",
    });
    this.#scheduleAnimation();
    return this;
  }

  setTripsPlayback(id: string, playback: LowResTripsPlayback): this {
    const entry = this.#dataLayers.get(id);
    if (
      !entry ||
      entry.source.type !== "trips" ||
      entry.serialized.type !== "trips"
    )
      throw new RangeError(`Unknown trips layer: ${id}`);
    const source = {
      ...entry.source,
      ...(playback.playing === undefined ? {} : { playing: playback.playing }),
      ...(playback.currentTime === undefined
        ? {}
        : { currentTime: playback.currentTime }),
      ...(playback.speed === undefined ? {} : { speed: playback.speed }),
      ...(playback.trailLength === undefined
        ? {}
        : { trailLength: playback.trailLength }),
    };
    const serialized = serializeDataLayer(source);
    if (serialized.type !== "trips")
      throw new TypeError(`Data layer ${id} is not a trips layer`);
    this.#dataLayers.set(id, { source, serialized });
    this.#ensureDataWorkerForVisibleLayers();
    this.#postData({
      type: "playback",
      id,
      currentTime: serialized.currentTime,
      playing: serialized.playing,
      speed: serialized.speed,
      trailLength: serialized.trailLength,
    });
    this.#requestDataRender();
    this.#emitDataLayerChange(id);
    this.#scheduleAnimation();
    return this;
  }

  seekTripsPlayback(
    id: string,
    currentTime: number,
    options: LowResTripsSeekOptions = {},
  ): this {
    if (!Number.isFinite(currentTime))
      throw new TypeError("Trip playback time must be finite");
    const playback = this.getTripsPlayback(id);
    const time = options.wrap
      ? ((currentTime % playback.loopLength) + playback.loopLength) %
        playback.loopLength
      : Math.min(playback.loopLength, Math.max(0, currentTime));
    return this.setTripsPlayback(id, {
      currentTime: time,
      ...(options.playing === undefined ? {} : { playing: options.playing }),
    });
  }

  stepTripsPlayback(
    id: string,
    delta: number,
    options: LowResTripsSeekOptions = {},
  ): this {
    if (!Number.isFinite(delta))
      throw new TypeError("Trip playback step must be finite");
    return this.seekTripsPlayback(
      id,
      this.getTripsPlayback(id).currentTime + delta,
      options,
    );
  }

  getTripsPlayback(
    id: string,
  ): Required<LowResTripsPlayback> & { loopLength: number } {
    const layer = this.#dataLayers.get(id)?.serialized;
    if (!layer || layer.type !== "trips")
      throw new RangeError(`Unknown trips layer: ${id}`);
    return {
      playing: layer.playing,
      currentTime: layer.currentTime,
      speed: layer.speed,
      trailLength: layer.trailLength,
      loopLength: layer.loopLength,
    };
  }

  setSource(source: LowResSource): this {
    return this.setSources({ ...this.#sources, base: source });
  }

  setSources(sources: Record<string, LowResSource>): this {
    if (!Object.keys(sources).length)
      throw new TypeError("At least one named source is required");
    this.#sources = { ...sources };
    this.#rebuildBuildings3DLayer();
    this.#post({
      type: "configure",
      sources: this.#sources,
      layers: this.#layers,
      maxCachedTiles: this.#options.maxCachedTiles,
      buildings: this.#workerBuildingsOptions(),
    });
    this.#refreshAttribution();
    this.refresh();
    return this;
  }

  setLayers(layers: LowResLayerPackDescriptor[]): this {
    this.#layers = normalizeLayers(layers);
    this.#reconfigure();
    this.#emit("layerchange", { target: this, layers: this.getLayers() });
    return this;
  }

  setSourceTime(sourceId: string, timeKey: string | number): this {
    const source = this.#sources[sourceId];
    if (!source) throw new RangeError(`Unknown source: ${sourceId}`);
    this.#sources[sourceId] = { ...source, timeKey };
    this.#post({ type: "set-time", sourceId, timeKey });
    this.refresh();
    this.#emit("timechange", { target: this, sourceId, timeKey });
    return this;
  }

  setLayerVisible(id: string, visible: boolean): this {
    const index = this.#layers.findIndex((layer) => layer.id === id);
    if (index < 0) throw new RangeError(`Unknown layer pack: ${id}`);
    const current = this.#layers[index]!;
    if ((current.enabled !== false) === visible) return this;
    this.#layers[index] = { ...current, enabled: visible };
    this.#reconfigure();
    this.#emit("layerchange", { target: this, layers: this.getLayers() });
    return this;
  }

  getLayers(): LowResLayerPackDescriptor[] {
    return this.#layers.map((layer) => ({
      ...layer,
      sourceLayers: [...layer.sourceLayers],
    }));
  }

  refresh(): this {
    this.#requestRender(true);
    return this;
  }

  queryFeatures(point: PointLike): LowResFeature[] {
    const map = this.#map;
    if (!this.#frame || !map) return [];
    const screen = pointLike(point);
    const current = this.#currentViewState();
    if (!current) return [];
    const lngLat = map.unproject([screen.x, screen.y]);
    for (const frame of [this.#detailFrame, this.#frame]) {
      if (!frame) continue;
      const framePoint =
        this.#projectionMode === "surface"
          ? geographicFramePoint(frame.state, lngLat.lng, lngLat.lat)
          : reprojectPoint(
              [screen.x, screen.y],
              reprojectionTransform(frame.state, current),
            );
      const frameColumn = Math.floor(framePoint[0] / frame.state.cell.width);
      const frameRow = Math.floor(framePoint[1] / frame.state.cell.height);
      if (
        frameColumn < 0 ||
        frameColumn >= frame.columns ||
        frameRow < 0 ||
        frameRow >= frame.rows
      )
        continue;
      const owner = frame.owner[frameRow * frame.columns + frameColumn] ?? 0;
      if (!owner) return [];
      const record = frame.features[owner - 1];
      if (!record) return [];
      return [
        {
          ...record,
          cell: {
            column: Math.floor(screen.x / current.cell.width),
            row: Math.floor(screen.y / current.cell.height),
          },
          lngLat: { lng: lngLat.lng, lat: lngLat.lat },
        },
      ];
    }
    return [];
  }

  queryDataFeatures(point: PointLike): LowResDataFeature[] {
    const frame = this.#dataFrame;
    const map = this.#map;
    if (!frame || !map) return [];
    const screen = pointLike(point);
    const current = this.#currentViewState();
    if (!current) return [];
    const lngLat = map.unproject([screen.x, screen.y]);
    const framePoint =
      this.#projectionMode === "surface"
        ? geographicFramePoint(frame.state, lngLat.lng, lngLat.lat)
        : reprojectPoint(
            [screen.x, screen.y],
            reprojectionTransform(frame.state, current),
          );
    const dotColumn = Math.floor(framePoint[0] / (frame.state.cell.width / 2));
    const dotRow = Math.floor(framePoint[1] / (frame.state.cell.height / 4));
    if (
      dotColumn < 0 ||
      dotRow < 0 ||
      dotColumn >= frame.dotColumns ||
      dotRow >= frame.dotRows
    )
      return [];
    const offset = dotRow * frame.dotColumns + dotColumn;
    const owners = [
      frame.markerOwner[offset] ?? 0,
      frame.dataOwner[offset] ?? 0,
    ];
    const results: LowResDataFeature[] = [];
    for (const owner of owners) {
      if (!owner || results.some((feature) => feature.owner === owner))
        continue;
      const record = frame.features[owner - 1];
      if (!record) continue;
      results.push({
        ...record,
        cell: {
          column: Math.floor(screen.x / current.cell.width),
          row: Math.floor(screen.y / current.cell.height),
        },
        lngLat: { lng: lngLat.lng, lat: lngLat.lat },
      });
    }
    return results;
  }

  setFeatureInteractionEnabled(enabled: boolean): this {
    if (enabled === this.#featureInteractionEnabled) return this;
    this.#featureInteractionEnabled = enabled;
    const map = this.#map;
    if (map) {
      if (enabled) {
        map.on("mousemove", this.#onMouseMove);
        map.on("click", this.#onClick);
      } else {
        map.off("mousemove", this.#onMouseMove);
        map.off("click", this.#onClick);
      }
    }
    if (!enabled) {
      if (this.#hoveredData)
        this.#emit("datafeatureleave", {
          target: this,
          feature: this.#hoveredData,
        });
      this.#hoveredData = undefined;
      if (this.#hovered)
        this.#emit("featureleave", { target: this, feature: this.#hovered });
      this.#hovered = undefined;
      if (this.#selectedKey) {
        this.#selectedKey = undefined;
        this.#emit("selectionchange", { target: this });
      }
      map?.triggerRepaint();
    }
    return this;
  }

  getFeatureInteractionEnabled(): boolean {
    return this.#featureInteractionEnabled;
  }

  setSelectedFeature(feature?: LowResFeature): this {
    this.#selectedKey = feature ? featureKey(feature) : undefined;
    this.#map?.triggerRepaint();
    this.#emit("selectionchange", {
      target: this,
      ...(feature ? { feature } : {}),
    });
    return this;
  }

  on<K extends keyof LowResEventMap>(type: K, listener: Listener<K>): this {
    const listeners = this.#listeners.get(type) ?? new Set();
    listeners.add(listener as (event: never) => void);
    this.#listeners.set(type, listeners);
    return this;
  }

  off<K extends keyof LowResEventMap>(type: K, listener: Listener<K>): this {
    this.#listeners.get(type)?.delete(listener as (event: never) => void);
    return this;
  }

  readonly #onMove = (): void => {
    this.#requestRender(false);
  };
  readonly #onMoveEnd = (): void => {
    this.#requestRender(true);
  };
  readonly #onMouseMove = (event: { point: PointLike }): void => {
    const nextData = this.queryDataFeatures(event.point)[0];
    if (
      nextData?.owner !== this.#hoveredData?.owner ||
      nextData?.layerId !== this.#hoveredData?.layerId
    ) {
      if (this.#hoveredData)
        this.#emit("datafeatureleave", {
          target: this,
          feature: this.#hoveredData,
        });
      this.#hoveredData = nextData;
      if (nextData)
        this.#emit("datafeatureenter", { target: this, feature: nextData });
    }
    if (nextData) {
      if (this.#hovered)
        this.#emit("featureleave", { target: this, feature: this.#hovered });
      this.#hovered = undefined;
      return;
    }
    const next = this.queryFeatures(event.point)[0];
    if (next?.id === this.#hovered?.id) return;
    if (this.#hovered)
      this.#emit("featureleave", { target: this, feature: this.#hovered });
    this.#hovered = next;
    this.#map?.triggerRepaint();
    if (next) this.#emit("featureenter", { target: this, feature: next });
  };
  readonly #onClick = (event: { point: PointLike }): void => {
    const dataFeature = this.queryDataFeatures(event.point)[0];
    if (dataFeature) {
      this.#emit("datafeatureclick", { target: this, feature: dataFeature });
      return;
    }
    const feature = this.queryFeatures(event.point)[0];
    if (feature) {
      this.setSelectedFeature(feature);
      this.#emit("featureclick", { target: this, feature });
    }
  };

  #requestRender(immediate: boolean): void {
    if (!this.#map || !this.#worker) return;
    const send = () => {
      this.#timer = undefined;
      if (!this.#map) return;
      this.#lastRenderRequest = performance.now();
      const plan = this.#renderViewStates();
      if (!plan) return;
      this.#generation += 1;
      this.#post({
        type: "render",
        generation: this.#generation,
        state: plan.coverage,
        ...(plan.detail ? { detailState: plan.detail } : {}),
      });
      this.#postData({
        type: "render",
        generation: this.#generation,
        state: plan.detail ?? plan.coverage,
      });
    };
    if (immediate) {
      if (this.#timer) clearTimeout(this.#timer);
      send();
      return;
    }
    if (this.#timer) return;
    const elapsed = performance.now() - this.#lastRenderRequest;
    this.#timer = setTimeout(
      send,
      Math.max(0, this.#options.renderThrottleMs - elapsed),
    );
  }

  #onWorkerMessage(message: WorkerResponse): void {
    if (message.type === "ready") {
      this.#emit("load", { target: this });
      return;
    }
    if (message.type === "error") {
      this.#emitError({
        code: "render",
        message: message.message,
        fatal: false,
        cause: message.cause,
      });
      return;
    }
    if (message.frame.generation < (this.#frame?.generation ?? -1)) return;
    this.#frame = message.frame;
    this.#detailFrame = message.detailFrame;
    this.#buildingMesh = message.buildingMesh;
    for (const warning of message.frame.warnings) this.#emitError(warning);
    this.#map?.triggerRepaint();
    this.#emit("render", {
      target: this,
      durationMs: message.frame.durationMs,
      generation: message.frame.generation,
    });
  }

  #onDataWorkerMessage(message: DataWorkerResponse): void {
    if (message.type === "ready") return;
    if (message.type === "error") {
      this.#emitError({
        code: "data",
        message: message.message,
        fatal: false,
        cause: message.cause,
        ...(message.layerId ? { layerId: message.layerId } : {}),
      });
      return;
    }
    if (message.frame.generation < (this.#dataFrame?.generation ?? -1)) return;
    this.#dataFrame = message.frame;
    for (const warning of message.frame.warnings) this.#emitError(warning);
    this.#map?.triggerRepaint();
    this.#emit("datarender", {
      target: this,
      durationMs: message.frame.durationMs,
      generation: message.frame.generation,
    });
  }

  #post(message: WorkerRequest, transfer: Transferable[] = []): void {
    this.#worker?.postMessage(message, { transfer });
  }

  #postData(message: DataWorkerRequest): void {
    this.#dataWorker?.postMessage(message);
  }

  #ensureDataWorkerForVisibleLayers(): void {
    if (
      ![...this.#dataLayers.values()].some(
        ({ serialized }) => serialized.visible,
      )
    )
      return;
    this.#ensureDataWorker();
  }

  #ensureDataWorker(): void {
    if (this.#dataWorker || !this.#map) return;
    this.#dataWorker = this.#dataWorkerFactory();
    this.#dataWorker.onmessage = (event: MessageEvent<DataWorkerResponse>) =>
      this.#onDataWorkerMessage(event.data);
    this.#dataWorker.onerror = (event) =>
      this.#emitError({
        code: "data",
        message: event.message,
        fatal: false,
        cause: event.error,
      });
    this.#sendDataLayers();
  }

  #heatmapPalette(): readonly [RGB, RGB, RGB, RGB] {
    return this.#heatmap.palette ?? DEFAULT_HEATMAP_PALETTE;
  }

  #emitFogChange(): void {
    this.#emit("fogchange", {
      target: this,
      visible: this.#fog.visible,
      mode: this.#fog.mode,
      start: this.#fog.start,
      end: this.#fog.end,
      opacity: this.#fog.opacity,
      color: this.#fog.color ?? this.#theme.fills.ground,
    });
  }

  #emitHeatmapChange(): void {
    this.#emit("heatmapchange", {
      target: this,
      visible: this.#heatmap.visible,
      pointCount: this.#heatmap.points.length / 3,
    });
  }

  #storeDataLayer(layer: LowResDataLayer): void {
    this.#dataLayers.set(layer.id, {
      source: layer,
      serialized: serializeDataLayer(layer),
    });
  }

  #defaultHeatmapLayer(): LowResDataLayer {
    return {
      id: DEFAULT_HEATMAP_LAYER_ID,
      type: "heatmap",
      data: this.#heatmap.points,
      visible: this.#heatmap.visible,
      radius: this.#heatmap.radius,
      intensity: this.#heatmap.intensity,
      maxDensity: this.#heatmap.maxDensity,
      opacity: this.#heatmap.opacity,
      palette: this.#heatmapPalette(),
      order: -1000,
      pickable: false,
    };
  }

  #sendDataLayers(): void {
    if (!this.#dataWorker) return;
    this.#postData({
      type: "set-layers",
      layers: [...this.#dataLayers.values()].map(
        ({ serialized }) => serialized,
      ),
    });
  }

  #sendDataLayer(id: string): void {
    const layer = this.#dataLayers.get(id)?.serialized;
    if (layer) this.#postData({ type: "upsert-layer", layer });
  }

  #requestDataRender(): void {
    const plan = this.#renderViewStates();
    const state = plan?.detail ?? plan?.coverage;
    if (!state || !this.#dataWorker) return;
    this.#generation += 1;
    this.#postData({ type: "render", generation: this.#generation, state });
  }

  #emitDataLayerChange(id: string): void {
    const layer = this.#dataLayers.get(id)?.serialized;
    if (layer)
      this.#emit("datalayerchange", {
        target: this,
        id,
        action: "upsert",
        layer: dataLayerState(layer),
      });
  }

  #scheduleAnimation(): void {
    if (!this.#map || this.#animationFrame !== undefined) return;
    const playing = [...this.#dataLayers.values()].some(
      ({ serialized }) =>
        serialized.type === "trips" && serialized.visible && serialized.playing,
    );
    if (!playing) return;
    this.#animationTime = performance.now();
    this.#animationFrame = requestAnimationFrame(this.#animate);
  }

  readonly #animate = (now: number): void => {
    this.#animationFrame = undefined;
    if (!this.#map) return;
    const elapsed = Math.min(
      0.1,
      Math.max(0, (now - this.#animationTime) / 1000),
    );
    this.#animationTime = now;
    let playing = false;
    for (const [id, entry] of this.#dataLayers) {
      if (
        entry.source.type !== "trips" ||
        entry.serialized.type !== "trips" ||
        !entry.serialized.visible ||
        !entry.serialized.playing
      )
        continue;
      playing = true;
      if (!document.hidden) {
        const currentTime =
          (((entry.serialized.currentTime +
            elapsed * entry.serialized.speed * 60) %
            entry.serialized.loopLength) +
            entry.serialized.loopLength) %
          entry.serialized.loopLength;
        entry.serialized.currentTime = currentTime;
        entry.source = { ...entry.source, currentTime };
        this.#postData({
          type: "playback",
          id,
          currentTime,
          playing: true,
          speed: entry.serialized.speed,
          trailLength: entry.serialized.trailLength,
        });
      }
    }
    if (
      playing &&
      !document.hidden &&
      now - this.#lastAnimationRaster >= 1000 / 30
    ) {
      this.#lastAnimationRaster = now;
      this.#requestDataRender();
    }
    if (playing) this.#animationFrame = requestAnimationFrame(this.#animate);
  };

  #currentViewState(): RasterViewState | undefined {
    if (!this.#map) return undefined;
    const canvas = this.#map.getCanvas();
    const center = this.#map.getCenter();
    return {
      center: { lng: center.lng, lat: center.lat },
      zoom: this.#map.getZoom(),
      bearing: this.#map.getBearing(),
      pitch: this.#map.getPitch(),
      width: canvas.clientWidth,
      height: canvas.clientHeight,
      pixelRatio: canvas.width / Math.max(1, canvas.clientWidth),
      cell: this.#cell,
      locale: this.#options.locale,
    };
  }

  #renderViewStates():
    { coverage: RasterViewState; detail?: RasterViewState } | undefined {
    const state = this.#currentViewState();
    if (!state) return undefined;
    if (this.#projectionMode === "screen") return { coverage: state };
    if (!this.#map) return { coverage: { ...state, bearing: 0, pitch: 0 } };
    const corners = [
      this.#map.unproject([0, 0]),
      this.#map.unproject([state.width, 0]),
      this.#map.unproject([state.width, state.height]),
      this.#map.unproject([0, state.height]),
    ];
    const coverage = fitSurfaceViewState(state, corners, {
      maxDimension: Math.min(
        4096,
        Math.max(2048, Math.max(state.width, state.height) * 4),
      ),
    });
    const detail = surfaceDetailViewState(state, coverage, {
      maxDimension: 4096,
    });
    return { coverage, ...(detail ? { detail } : {}) };
  }

  #applyStyle(): void {
    this.#theme = composeTheme(this.#baseTheme, this.#colorMode);
    this.#styleRevision += 1;
    this.#applyBuildings3DStyle();
    this.#map?.triggerRepaint();
    this.#emit("stylechange", {
      target: this,
      theme: this.#theme,
      colorMode: this.#colorMode,
    });
  }

  #selectedOwner(frame = this.#detailFrame ?? this.#frame): number {
    if (!this.#selectedKey || !frame) return 0;
    const record = frame.features.find(
      (candidate) => featureKey(candidate) === this.#selectedKey,
    );
    return record?.id ?? 0;
  }

  #featureOwner(
    frame: RasterFrame | undefined,
    feature?: LowResFeature,
  ): number {
    if (!frame || !feature) return 0;
    return (
      frame.features.find(
        (candidate) => featureKey(candidate) === featureKey(feature),
      )?.id ?? 0
    );
  }

  #reconfigure(): void {
    this.#post({
      type: "configure",
      sources: this.#sources,
      layers: this.#layers,
      maxCachedTiles: this.#options.maxCachedTiles,
      buildings: this.#workerBuildingsOptions(),
    });
    this.refresh();
  }

  #sourceAttribution(): string {
    const values = Object.values(this.#sources)
      .map((source) => source.attribution)
      .filter((value): value is string => Boolean(value));
    return (
      [...new Set(values)].join(" · ") ||
      "OpenFreeMap © OpenMapTiles · Data © OpenStreetMap contributors"
    );
  }

  #refreshAttribution(): void {
    if (!this.#map || !this.#options.attribution) return;
    if (this.#attribution) this.#map.removeControl(this.#attribution);
    this.#attribution = new AttributionControl({
      compact: true,
      customAttribution: this.#sourceAttribution(),
    });
    this.#map.addControl(this.#attribution, "bottom-right");
  }

  #ensureBuildings3DLayer(): void {
    const map = this.#map;
    if (this.#buildings3D.style === "dotted") {
      if (!this.#sources[this.#buildings3D.sourceId])
        this.#emitError({
          code: "source",
          message: `Unknown 3D building source: ${this.#buildings3D.sourceId}`,
          fatal: false,
          sourceId: this.#buildings3D.sourceId,
        });
      return;
    }
    if (!map || map.getLayer(this.layerIds.buildings)) return;
    const source = this.#sources[this.#buildings3D.sourceId];
    if (!source) {
      this.#emitError({
        code: "source",
        message: `Unknown 3D building source: ${this.#buildings3D.sourceId}`,
        fatal: false,
        sourceId: this.#buildings3D.sourceId,
      });
      return;
    }
    try {
      if (!map.getSource(BUILDINGS_SOURCE_ID))
        map.addSource(BUILDINGS_SOURCE_ID, {
          type: "vector",
          url: source.tileJSON,
        });
      const layer: FillExtrusionLayerSpecification = {
        id: this.layerIds.buildings,
        type: "fill-extrusion",
        source: BUILDINGS_SOURCE_ID,
        "source-layer": "building",
        minzoom: this.#buildings3D.minZoom,
        filter: ["!=", ["get", "hide_3d"], true],
        layout: {
          visibility:
            this.#projectionMode === "surface" && this.#buildings3D.visible
              ? "visible"
              : "none",
        },
        paint: this.#buildings3DPaint(),
      };
      map.addLayer(
        layer,
        map.getLayer(this.layerIds.data) ? this.layerIds.data : undefined,
      );
    } catch (cause) {
      this.#emitError({
        code: "source",
        message: "Could not create the 3D building layer",
        fatal: false,
        cause,
        sourceId: this.#buildings3D.sourceId,
      });
    }
  }

  #rebuildBuildings3DLayer(): void {
    const map = this.#map;
    if (!map) return;
    if (this.#buildings3D.style === "dotted") {
      this.#ensureBuildings3DLayer();
      return;
    }
    if (map.getLayer(this.layerIds.buildings))
      map.removeLayer(this.layerIds.buildings);
    if (map.getSource(BUILDINGS_SOURCE_ID))
      map.removeSource(BUILDINGS_SOURCE_ID);
    this.#ensureBuildings3DLayer();
  }

  #syncBuildings3DVisibility(): void {
    const map = this.#map;
    if (!map) return;
    if (this.#buildings3D.style === "dotted") {
      map.triggerRepaint();
      return;
    }
    this.#ensureBuildings3DLayer();
    if (!map.getLayer(this.layerIds.buildings)) return;
    map.setLayoutProperty(
      this.layerIds.buildings,
      "visibility",
      this.#projectionMode === "surface" && this.#buildings3D.visible
        ? "visible"
        : "none",
    );
  }

  #applyBuildings3DStyle(): void {
    const map = this.#map;
    if (this.#buildings3D.style === "dotted") {
      map?.triggerRepaint();
      return;
    }
    if (!map?.getLayer(this.layerIds.buildings)) return;
    const paint = this.#buildings3DPaint();
    map.setPaintProperty(
      this.layerIds.buildings,
      "fill-extrusion-color",
      paint["fill-extrusion-color"],
    );
    map.setPaintProperty(
      this.layerIds.buildings,
      "fill-extrusion-height",
      paint["fill-extrusion-height"],
    );
    map.setPaintProperty(
      this.layerIds.buildings,
      "fill-extrusion-base",
      paint["fill-extrusion-base"],
    );
    map.setPaintProperty(
      this.layerIds.buildings,
      "fill-extrusion-opacity",
      paint["fill-extrusion-opacity"],
    );
    map.setPaintProperty(
      this.layerIds.buildings,
      "fill-extrusion-vertical-gradient",
      paint["fill-extrusion-vertical-gradient"],
    );
  }

  #buildings3DPaint(): NonNullable<FillExtrusionLayerSpecification["paint"]> {
    const scale = this.#buildings3D.heightScale;
    const height: ["*", ["coalesce", ["get", string], number], number] = [
      "*",
      ["coalesce", ["get", "render_height"], 6],
      scale,
    ];
    const base: ["*", ["coalesce", ["get", string], number], number] = [
      "*",
      ["coalesce", ["get", "render_min_height"], 0],
      scale,
    ];
    const minZoom = this.#buildings3D.minZoom;
    return {
      "fill-extrusion-color": rgbCss(this.#theme.fills.building),
      "fill-extrusion-height": [
        "interpolate",
        ["linear"],
        ["zoom"],
        minZoom,
        0,
        minZoom + 1,
        height,
      ],
      "fill-extrusion-base": [
        "interpolate",
        ["linear"],
        ["zoom"],
        minZoom,
        0,
        minZoom + 1,
        base,
      ],
      "fill-extrusion-opacity": this.#buildings3D.opacity,
      "fill-extrusion-vertical-gradient": true,
    };
  }

  #dottedBuildingsVisible(): boolean {
    return (
      this.#buildings3D.style === "dotted" &&
      this.#projectionMode === "surface" &&
      this.#buildings3D.visible
    );
  }

  #workerBuildingsOptions(): Extract<
    WorkerRequest,
    { type: "configure" }
  >["buildings"] {
    return {
      visible: this.#dottedBuildingsVisible(),
      style: this.#buildings3D.style,
      sourceId: this.#buildings3D.sourceId,
      minZoom: this.#buildings3D.minZoom,
    };
  }

  #configureCamera(map: MapLibreMap, preserveOriginal = false): void {
    if (!this.#rotationState || !preserveOriginal)
      this.#rotationState = {
        drag: map.dragRotate.isEnabled(),
        touch: map.touchZoomRotate.isEnabled(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
        maxPitch: map.getMaxPitch(),
      };
    const northUp = this.#options.enforceNorthUp;
    const rotation = !northUp && this.#camera.rotation;
    const pitch =
      !northUp && this.#projectionMode === "surface" && this.#camera.pitch;
    if (!rotation) map.setBearing(0);
    if (!pitch) map.setPitch(0);
    map.setMaxPitch(pitch ? this.#camera.maxPitch : 0);
    if (rotation || pitch) map.dragRotate.enable();
    else map.dragRotate.disable();
    if (rotation) map.touchZoomRotate.enableRotation();
    else map.touchZoomRotate.disableRotation();
  }

  #restoreNorthUp(map: MapLibreMap): void {
    if (!this.#rotationState) return;
    map.setMaxPitch(this.#rotationState.maxPitch);
    map.jumpTo({
      bearing: this.#rotationState.bearing,
      pitch: this.#rotationState.pitch,
    });
    if (this.#rotationState.drag) map.dragRotate.enable();
    else map.dragRotate.disable();
    if (this.#rotationState.touch) map.touchZoomRotate.enable();
    else map.touchZoomRotate.disable();
    this.#rotationState = undefined;
  }

  #emitError(error: LowResError): void {
    this.#emit("error", { target: this, error });
  }

  #emit<K extends keyof LowResEventMap>(
    type: K,
    event: LowResEventMap[K],
  ): void {
    for (const listener of this.#listeners.get(type) ?? [])
      listener(event as never);
  }
}
