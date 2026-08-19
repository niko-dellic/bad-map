import {
  AttributionControl,
  type FillExtrusionLayerSpecification,
  type Map as MapLibreMap,
  type PointLike,
} from "maplibre-gl";
import { BaseLayer, DataLayer, LabelsLayer, SlotLayer } from "./render";
import {
  fitSurfaceViewState,
  lngLatToWorld,
  reprojectPoint,
  reprojectionTransform,
} from "./geometry";
import { streets } from "./packs";
import { composeTheme, resolveTheme } from "./theme";
import type {
  CellGeometry,
  LowResBasemapOptions,
  LowResBuildings3DOptions,
  LowResColorMode,
  LowResError,
  LowResEventMap,
  LowResFeature,
  LowResHeatmapOptions,
  LowResHeatmapPoint,
  LowResLayerPackDescriptor,
  LowResProjectionMode,
  LowResSource,
  LowResTheme,
  RGB,
  RasterFrame,
  RasterViewState,
} from "./types";
import type { WorkerRequest, WorkerResponse } from "./worker/protocol";

const DEFAULT_SOURCE: LowResSource = {
  tileJSON: "https://tiles.openfreemap.org/planet",
  attribution: "OpenFreeMap © OpenMapTiles · Data © OpenStreetMap contributors",
};

const DEFAULT_CELL: CellGeometry = { width: 8, height: 16, dotSize: 2 };
const BUILDINGS_SOURCE_ID = "bad-map-buildings-source";
const DEFAULT_HEATMAP_PALETTE = [
  [40, 109, 155],
  [87, 173, 133],
  [239, 178, 75],
  [226, 76, 91],
] as const satisfies readonly [RGB, RGB, RGB, RGB];

type Listener<K extends keyof LowResEventMap> = (
  event: LowResEventMap[K],
) => void;

interface HeatmapState {
  points: Float32Array;
  visible: boolean;
  radius: number;
  intensity: number;
  maxDensity: number;
  opacity: number;
  palette?: readonly [RGB, RGB, RGB, RGB];
}

export class LowResBasemap {
  readonly layerIds = {
    base: "bad-map-base",
    buildings: "bad-map-buildings-3d",
    data: "bad-map-data",
    markers: "bad-map-markers",
    labels: "bad-map-labels",
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
  #heatmap: HeatmapState;
  #camera: { rotation: boolean; pitch: boolean; maxPitch: number };
  #styleRevision = 0;
  #map: MapLibreMap | undefined;
  #worker: Worker | undefined;
  #workerFactory: () => Worker;
  #frame: RasterFrame | undefined;
  #generation = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #lastRenderRequest = 0;
  #attribution: AttributionControl | undefined;
  #baseLayer: BaseLayer | undefined;
  #dataLayer: DataLayer | undefined;
  #labelsLayer: LabelsLayer | undefined;
  #hovered: LowResFeature | undefined;
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
    this.#projectionMode = options.projectionMode ?? "screen";
    this.#buildings3D = normalizeBuildings3D(options.buildings3D);
    this.#heatmap = normalizeHeatmap(options.heatmap);
    const surface = this.#projectionMode === "surface";
    this.#camera = {
      rotation: options.camera?.rotation ?? surface,
      pitch: options.camera?.pitch ?? surface,
      maxPitch: options.camera?.maxPitch ?? 60,
    };
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
      options.workerFactory ??
      (() =>
        new Worker(new URL("./worker/raster.worker.ts", import.meta.url), {
          type: "module",
          name: "bad-map-raster",
        }));
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
    this.#post({
      type: "configure",
      sources: this.#sources,
      layers: this.#layers,
      maxCachedTiles: this.#options.maxCachedTiles,
    });
    this.#sendHeatmap(true);

    const provider = {
      frame: () => this.#frame,
      viewState: () => this.#currentViewState(),
      theme: () => this.#theme,
      labelsVisible: () => this.#options.labels,
      labelsBillboard: () => this.#labelsBillboard,
      styleRevision: () => this.#styleRevision,
      hoveredOwner: () => this.#hovered?.id ?? 0,
      selectedOwner: () => this.#selectedOwner(),
      projectionMode: () => this.#projectionMode,
      scalarPalette: () =>
        [
          this.#baseTheme.lines.waterway,
          this.#baseTheme.labels.park,
          this.#baseTheme.lines.motorway,
          this.#baseTheme.labels.medical,
        ] as const,
      heatmapPalette: () => this.#heatmapPalette(),
      heatmapOpacity: () => this.#heatmap.opacity,
    };
    this.#baseLayer = new BaseLayer(this.layerIds.base, provider);
    this.#dataLayer = new DataLayer(this.layerIds.data, provider);
    this.#labelsLayer = new LabelsLayer(this.layerIds.labels, provider);
    map.addLayer(this.#baseLayer);
    this.#ensureBuildings3DLayer();
    map.addLayer(this.#dataLayer);
    map.addLayer(new SlotLayer(this.layerIds.markers));
    map.addLayer(this.#labelsLayer);
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
    map.on("mousemove", this.#onMouseMove);
    map.on("click", this.#onClick);
    this.#requestRender(true);
    return this;
  }

  remove(): void {
    const map = this.#map;
    if (!map) return;
    if (this.#timer) clearTimeout(this.#timer);
    map.off("move", this.#onMove);
    map.off("moveend", this.#onMoveEnd);
    map.off("resize", this.#onMoveEnd);
    map.off("mousemove", this.#onMouseMove);
    map.off("click", this.#onClick);
    for (const id of [
      this.layerIds.interaction,
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
    this.#worker?.terminate();
    this.#worker = undefined;
    this.#map = undefined;
    this.#frame = undefined;
    this.#baseLayer = undefined;
    this.#dataLayer = undefined;
    this.#labelsLayer = undefined;
    this.#hovered = undefined;
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
    if (mode !== "screen" && mode !== "surface")
      throw new TypeError(`Unsupported projection mode: ${String(mode)}`);
    if (mode === this.#projectionMode) return this;
    this.#projectionMode = mode;
    if (this.#map) this.#configureCamera(this.#map, true);
    this.#syncBuildings3DVisibility();
    this.refresh();
    this.#emit("projectionchange", { target: this, mode });
    return this;
  }

  setCamera(options: LowResBasemapOptions["camera"]): this {
    if (!options) return this;
    this.#camera = { ...this.#camera, ...options };
    if (!Number.isFinite(this.#camera.maxPitch) || this.#camera.maxPitch < 0)
      throw new RangeError("maxPitch must be a non-negative number");
    if (this.#map) this.#configureCamera(this.#map, true);
    return this;
  }

  setBuildings3DVisible(visible: boolean): this {
    if (visible === this.#buildings3D.visible) return this;
    this.#buildings3D.visible = visible;
    this.#ensureBuildings3DLayer();
    this.#syncBuildings3DVisibility();
    this.#emit("buildingschange", { target: this, visible });
    return this;
  }

  getBuildings3DVisible(): boolean {
    return this.#buildings3D.visible;
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
    const dataChanged = next.points !== previous.points;
    const rasterChanged =
      dataChanged ||
      next.visible !== previous.visible ||
      next.radius !== previous.radius ||
      next.intensity !== previous.intensity ||
      next.maxDensity !== previous.maxDensity;
    const paintChanged =
      next.opacity !== previous.opacity || next.palette !== previous.palette;
    this.#heatmap = next;
    if (rasterChanged) {
      this.#sendHeatmap(dataChanged);
      this.refresh();
    }
    if (paintChanged) {
      this.#styleRevision += 1;
      this.#map?.triggerRepaint();
    }
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
    const frame = this.#frame;
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
    const frameColumn = Math.floor(framePoint[0] / frame.state.cell.width);
    const frameRow = Math.floor(framePoint[1] / frame.state.cell.height);
    if (
      frameColumn < 0 ||
      frameColumn >= frame.columns ||
      frameRow < 0 ||
      frameRow >= frame.rows
    )
      return [];
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
    const next = this.queryFeatures(event.point)[0];
    if (next?.id === this.#hovered?.id) return;
    if (this.#hovered)
      this.#emit("featureleave", { target: this, feature: this.#hovered });
    this.#hovered = next;
    this.#map?.triggerRepaint();
    if (next) this.#emit("featureenter", { target: this, feature: next });
  };
  readonly #onClick = (event: { point: PointLike }): void => {
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
      const state = this.#renderViewState();
      if (!state) return;
      this.#generation += 1;
      this.#post({ type: "render", generation: this.#generation, state });
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
    for (const warning of message.frame.warnings) this.#emitError(warning);
    this.#map?.triggerRepaint();
    this.#emit("render", {
      target: this,
      durationMs: message.frame.durationMs,
      generation: message.frame.generation,
    });
  }

  #post(message: WorkerRequest, transfer: Transferable[] = []): void {
    this.#worker?.postMessage(message, { transfer });
  }

  #sendHeatmap(includeData: boolean): void {
    if (!this.#worker) return;
    const points = includeData ? this.#heatmap.points.slice() : undefined;
    this.#post(
      {
        type: "set-heatmap",
        options: {
          visible: this.#heatmap.visible,
          radius: this.#heatmap.radius,
          intensity: this.#heatmap.intensity,
          maxDensity: this.#heatmap.maxDensity,
        },
        ...(points ? { points } : {}),
      },
      points ? [points.buffer] : [],
    );
  }

  #heatmapPalette(): readonly [RGB, RGB, RGB, RGB] {
    return this.#heatmap.palette ?? DEFAULT_HEATMAP_PALETTE;
  }

  #emitHeatmapChange(): void {
    this.#emit("heatmapchange", {
      target: this,
      visible: this.#heatmap.visible,
      pointCount: this.#heatmap.points.length / 3,
    });
  }

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

  #renderViewState(): RasterViewState | undefined {
    const state = this.#currentViewState();
    if (!state || this.#projectionMode === "screen") return state;
    if (!this.#map) return { ...state, bearing: 0, pitch: 0 };
    const corners = [
      this.#map.unproject([0, 0]),
      this.#map.unproject([state.width, 0]),
      this.#map.unproject([state.width, state.height]),
      this.#map.unproject([0, state.height]),
    ];
    return fitSurfaceViewState(state, corners, {
      maxDimension: Math.min(
        4096,
        Math.max(2048, Math.max(state.width, state.height) * 4),
      ),
    });
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

  #selectedOwner(): number {
    if (!this.#selectedKey || !this.#frame) return 0;
    const record = this.#frame.features.find(
      (candidate) => featureKey(candidate) === this.#selectedKey,
    );
    return record?.id ?? 0;
  }

  #reconfigure(): void {
    this.#post({
      type: "configure",
      sources: this.#sources,
      layers: this.#layers,
      maxCachedTiles: this.#options.maxCachedTiles,
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
    if (map.getLayer(this.layerIds.buildings))
      map.removeLayer(this.layerIds.buildings);
    if (map.getSource(BUILDINGS_SOURCE_ID))
      map.removeSource(BUILDINGS_SOURCE_ID);
    this.#ensureBuildings3DLayer();
  }

  #syncBuildings3DVisibility(): void {
    const map = this.#map;
    if (!map) return;
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
    if (!map?.getLayer(this.layerIds.buildings)) return;
    const paint = this.#buildings3DPaint();
    for (const [property, value] of Object.entries(paint))
      map.setPaintProperty(this.layerIds.buildings, property, value);
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

function validateCell(cell: CellGeometry): void {
  if (
    ![cell.width, cell.height, cell.dotSize].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  )
    throw new TypeError("Cell dimensions must be positive numbers");
  if (cell.dotSize > Math.min(cell.width / 2, cell.height / 4))
    throw new RangeError("dotSize cannot exceed the Braille-dot pitch");
}

function validateColorMode(colorMode: LowResColorMode): LowResColorMode {
  if (colorMode !== "color" && colorMode !== "greyscale")
    throw new TypeError(`Unsupported color mode: ${String(colorMode)}`);
  return colorMode;
}

function normalizeBuildings3D(
  options: LowResBasemapOptions["buildings3D"],
): Required<LowResBuildings3DOptions> {
  const configured = typeof options === "object" ? options : {};
  const result = {
    visible:
      typeof options === "boolean" ? options : (configured.visible ?? false),
    sourceId: configured.sourceId ?? "base",
    minZoom: configured.minZoom ?? 14,
    opacity: configured.opacity ?? 0.82,
    heightScale: configured.heightScale ?? 1,
  };
  if (!result.sourceId.trim())
    throw new TypeError("buildings3D.sourceId cannot be empty");
  if (!Number.isFinite(result.minZoom) || result.minZoom < 0)
    throw new RangeError("buildings3D.minZoom must be non-negative");
  if (
    !Number.isFinite(result.opacity) ||
    result.opacity < 0 ||
    result.opacity > 1
  )
    throw new RangeError("buildings3D.opacity must be between zero and one");
  if (!Number.isFinite(result.heightScale) || result.heightScale < 0)
    throw new RangeError("buildings3D.heightScale must be non-negative");
  return result;
}

function normalizeHeatmap(
  options: LowResHeatmapOptions | undefined,
): HeatmapState {
  const state: HeatmapState = {
    points: normalizeHeatmapData(options?.data ?? new Float32Array()),
    visible: options?.visible ?? false,
    radius: options?.radius ?? 36,
    intensity: options?.intensity ?? 1,
    maxDensity: options?.maxDensity ?? 0,
    opacity: options?.opacity ?? 0.76,
    ...(options?.palette ? { palette: options.palette } : {}),
  };
  validateHeatmap(state);
  return state;
}

function normalizeHeatmapData(
  data: readonly LowResHeatmapPoint[] | Float32Array,
): Float32Array {
  if (data instanceof Float32Array) {
    if (data.length % 3 !== 0)
      throw new RangeError("Heatmap Float32Array data must contain triplets");
    const points = data.slice();
    validateHeatmapPoints(points);
    return points;
  }
  const points = new Float32Array(data.length * 3);
  data.forEach((point, index) => {
    points[index * 3] = Number(point[0]);
    points[index * 3 + 1] = Number(point[1]);
    points[index * 3 + 2] = Number(point[2] ?? 1);
  });
  validateHeatmapPoints(points);
  return points;
}

function validateHeatmap(state: HeatmapState): void {
  if (
    ![state.radius, state.intensity, state.maxDensity].every(
      (value) => Number.isFinite(value) && value >= 0,
    )
  )
    throw new RangeError(
      "Heatmap radius, intensity, and maxDensity must be non-negative",
    );
  if (!Number.isFinite(state.opacity) || state.opacity < 0 || state.opacity > 1)
    throw new RangeError("Heatmap opacity must be between zero and one");
  if (state.palette)
    for (const color of state.palette)
      if (
        color.length !== 3 ||
        color.some(
          (channel) =>
            !Number.isFinite(channel) || channel < 0 || channel > 255,
        )
      )
        throw new RangeError(
          "Heatmap palette channels must be between 0 and 255",
        );
}

function validateHeatmapPoints(points: Float32Array): void {
  for (let index = 0; index < points.length; index += 3) {
    const lng = points[index]!;
    const lat = points[index + 1]!;
    const weight = points[index + 2]!;
    if (
      !Number.isFinite(lng) ||
      !Number.isFinite(lat) ||
      !Number.isFinite(weight) ||
      lat < -90 ||
      lat > 90 ||
      weight < 0
    )
      throw new TypeError(`Invalid heatmap point at index ${index / 3}`);
  }
}

function rgbCss(color: readonly [number, number, number]): string {
  return `rgb(${color[0]} ${color[1]} ${color[2]})`;
}

function pointLike(point: PointLike): { x: number; y: number } {
  if (Array.isArray(point)) return { x: Number(point[0]), y: Number(point[1]) };
  return { x: point.x, y: point.y };
}

function normalizeLayers(
  layers: readonly LowResLayerPackDescriptor[],
): LowResLayerPackDescriptor[] {
  const ids = new Set<string>();
  return layers.map((layer) => {
    if (!layer.id.trim()) throw new TypeError("Layer pack IDs cannot be empty");
    if (ids.has(layer.id))
      throw new TypeError(`Duplicate layer pack ID: ${layer.id}`);
    ids.add(layer.id);
    return {
      ...layer,
      sourceLayers: [...layer.sourceLayers],
      enabled: layer.enabled ?? true,
      priority: layer.priority ?? 0,
    };
  });
}

function featureKey(
  feature: Pick<
    LowResFeature,
    "sourceId" | "packId" | "sourceLayer" | "class" | "name" | "properties"
  >,
): string {
  return [
    feature.sourceId,
    feature.packId,
    feature.sourceLayer,
    feature.class,
    feature.name,
    String(
      feature.properties.id ??
        feature.properties.osm_id ??
        feature.properties.ref ??
        "",
    ),
  ].join("\u0000");
}

function geographicFramePoint(
  frame: RasterViewState,
  lng: number,
  lat: number,
): readonly [number, number] {
  const [centerX, centerY] = lngLatToWorld(frame.center.lng, frame.center.lat);
  let [x, y] = lngLatToWorld(lng, lat);
  while (x - centerX > 0.5) x -= 1;
  while (x - centerX < -0.5) x += 1;
  const worldSize = 512 * 2 ** frame.zoom;
  return [
    (x - centerX) * worldSize + frame.width / 2,
    (y - centerY) * worldSize + frame.height / 2,
  ];
}
