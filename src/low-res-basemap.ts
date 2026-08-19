import {
  AttributionControl,
  type Map as MapLibreMap,
  type PointLike,
} from "maplibre-gl";
import { BaseLayer, LabelsLayer, SlotLayer } from "./render";
import {
  lngLatToWorld,
  reprojectPoint,
  reprojectionTransform,
} from "./geometry";
import { streets } from "./packs";
import { composeTheme, resolveTheme } from "./theme";
import type {
  CellGeometry,
  LowResBasemapOptions,
  LowResColorMode,
  LowResError,
  LowResEventMap,
  LowResFeature,
  LowResLayerPackDescriptor,
  LowResProjectionMode,
  LowResSource,
  LowResTheme,
  RasterFrame,
  RasterViewState,
} from "./types";
import type { WorkerRequest, WorkerResponse } from "./worker/protocol";

const DEFAULT_SOURCE: LowResSource = {
  tileJSON: "https://tiles.openfreemap.org/planet",
  attribution: "OpenFreeMap © OpenMapTiles · Data © OpenStreetMap contributors",
};

const DEFAULT_CELL: CellGeometry = { width: 8, height: 16, dotSize: 2 };

type Listener<K extends keyof LowResEventMap> = (
  event: LowResEventMap[K],
) => void;

export class LowResBasemap {
  readonly layerIds = {
    base: "bad-map-base",
    data: "bad-map-data",
    markers: "bad-map-markers",
    labels: "bad-map-labels",
    interaction: "bad-map-interaction",
  } as const;

  #options: Required<
    Pick<
      LowResBasemapOptions,
      | "locale"
      | "labels"
      | "attribution"
      | "enforceNorthUp"
      | "maxCachedTiles"
      | "renderThrottleMs"
    >
  >;
  #sources: Record<string, LowResSource>;
  #layers: LowResLayerPackDescriptor[];
  #cell: CellGeometry;
  #baseTheme: LowResTheme;
  #theme: LowResTheme;
  #colorMode: LowResColorMode;
  #projectionMode: LowResProjectionMode;
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
    validateCell(this.#cell);
    this.#baseTheme = resolveTheme(options.theme);
    this.#colorMode = validateColorMode(options.colorMode ?? "greyscale");
    this.#projectionMode = options.projectionMode ?? "screen";
    const surface = this.#projectionMode === "surface";
    this.#camera = {
      rotation: options.camera?.rotation ?? surface,
      pitch: options.camera?.pitch ?? surface,
      maxPitch: options.camera?.maxPitch ?? 60,
    };
    this.#theme = composeTheme(this.#baseTheme, this.#colorMode);
    this.#options = {
      locale: options.locale ?? "en",
      labels: options.labels ?? true,
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

    const provider = {
      frame: () => this.#frame,
      viewState: () => this.#currentViewState(),
      theme: () => this.#theme,
      labelsVisible: () => this.#options.labels,
      styleRevision: () => this.#styleRevision,
      hoveredOwner: () => this.#hovered?.id ?? 0,
      selectedOwner: () => this.#selectedOwner(),
      projectionMode: () => this.#projectionMode,
    };
    this.#baseLayer = new BaseLayer(this.layerIds.base, provider);
    this.#labelsLayer = new LabelsLayer(this.layerIds.labels, provider);
    map.addLayer(this.#baseLayer);
    map.addLayer(new SlotLayer(this.layerIds.data));
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
      this.layerIds.base,
    ])
      if (map.getLayer(id)) map.removeLayer(id);
    if (this.#attribution) map.removeControl(this.#attribution);
    this.#restoreNorthUp(map);
    this.#post({ type: "dispose" });
    this.#worker?.terminate();
    this.#worker = undefined;
    this.#map = undefined;
    this.#frame = undefined;
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

  setProjectionMode(mode: LowResProjectionMode): this {
    if (mode !== "screen" && mode !== "surface")
      throw new TypeError(`Unsupported projection mode: ${String(mode)}`);
    if (mode === this.#projectionMode) return this;
    this.#projectionMode = mode;
    if (this.#map) this.#configureCamera(this.#map, true);
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

  setSource(source: LowResSource): this {
    return this.setSources({ ...this.#sources, base: source });
  }

  setSources(sources: Record<string, LowResSource>): this {
    if (!Object.keys(sources).length)
      throw new TypeError("At least one named source is required");
    this.#sources = { ...sources };
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

  #post(message: WorkerRequest): void {
    this.#worker?.postMessage(message);
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
    return { ...state, bearing: 0, pitch: 0 };
  }

  #applyStyle(): void {
    this.#theme = composeTheme(this.#baseTheme, this.#colorMode);
    this.#styleRevision += 1;
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
