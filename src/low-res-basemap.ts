import {
  AttributionControl,
  type Map as MapLibreMap,
  type PointLike,
} from "maplibre-gl";
import { BaseLayer, LabelsLayer } from "./render";
import { reprojectPoint, reprojectionTransform } from "./geometry";
import { composeTheme, resolveTheme } from "./theme";
import type {
  CellGeometry,
  LowResBasemapOptions,
  LowResColorMode,
  LowResError,
  LowResEventMap,
  LowResFeature,
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
    labels: "bad-map-labels",
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
  #source: LowResSource;
  #cell: CellGeometry;
  #baseTheme: LowResTheme;
  #theme: LowResTheme;
  #colorMode: LowResColorMode;
  #styleRevision = 0;
  #map: MapLibreMap | undefined;
  #worker: Worker | undefined;
  #frame: RasterFrame | undefined;
  #generation = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #lastRenderRequest = 0;
  #attribution: AttributionControl | undefined;
  #baseLayer: BaseLayer | undefined;
  #labelsLayer: LabelsLayer | undefined;
  #hovered: LowResFeature | undefined;
  #listeners = new Map<keyof LowResEventMap, Set<(event: never) => void>>();
  #rotationState: { drag: boolean; touch: boolean } | undefined;

  constructor(options: LowResBasemapOptions = {}) {
    this.#source = options.source ?? DEFAULT_SOURCE;
    this.#cell = { ...DEFAULT_CELL, ...options.cell };
    validateCell(this.#cell);
    this.#baseTheme = resolveTheme(options.theme);
    this.#colorMode = validateColorMode(options.colorMode ?? "color");
    this.#theme = composeTheme(this.#baseTheme, this.#colorMode);
    this.#options = {
      locale: options.locale ?? "en",
      labels: options.labels ?? true,
      attribution: options.attribution ?? true,
      enforceNorthUp: options.enforceNorthUp ?? true,
      maxCachedTiles: options.maxCachedTiles ?? 96,
      renderThrottleMs: options.renderThrottleMs ?? 70,
    };
  }

  async addTo(map: MapLibreMap): Promise<this> {
    if (this.#map) throw new Error("This LowResBasemap is already attached");
    this.#map = map;
    if (!map.isStyleLoaded())
      await new Promise<void>((resolve) =>
        map.once("style.load", () => resolve()),
      );
    if (this.#options.enforceNorthUp) this.#lockNorthUp(map);
    else if (map.getPitch() !== 0 || map.getBearing() !== 0) {
      this.#emitError({
        code: "unsupported-camera",
        message: "bad-map v1 supports only bearing 0 and pitch 0",
        fatal: true,
      });
      this.#map = undefined;
      throw new Error("bad-map v1 supports only bearing 0 and pitch 0");
    }

    this.#worker = new Worker(
      new URL("./worker/raster.worker.ts", import.meta.url),
      { type: "module", name: "bad-map-raster" },
    );
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
      source: this.#source,
      maxCachedTiles: this.#options.maxCachedTiles,
    });

    const provider = {
      frame: () => this.#frame,
      viewState: () => this.#currentViewState(),
      theme: () => this.#theme,
      labelsVisible: () => this.#options.labels,
      styleRevision: () => this.#styleRevision,
    };
    this.#baseLayer = new BaseLayer(this.layerIds.base, provider);
    this.#labelsLayer = new LabelsLayer(this.layerIds.labels, provider);
    map.addLayer(this.#baseLayer);
    map.addLayer(this.#labelsLayer);

    if (this.#options.attribution) {
      this.#attribution = new AttributionControl({
        compact: true,
        customAttribution:
          this.#source.attribution ??
          "OpenFreeMap © OpenMapTiles · Data © OpenStreetMap contributors",
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
    if (map.getLayer(this.layerIds.labels))
      map.removeLayer(this.layerIds.labels);
    if (map.getLayer(this.layerIds.base)) map.removeLayer(this.layerIds.base);
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

  setSource(source: LowResSource): this {
    this.#source = source;
    this.#post({
      type: "configure",
      source,
      maxCachedTiles: this.#options.maxCachedTiles,
    });
    this.refresh();
    return this;
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
    const framePoint = reprojectPoint(
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
    const lngLat = map.unproject([screen.x, screen.y]);
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
    if (next) this.#emit("featureenter", { target: this, feature: next });
  };
  readonly #onClick = (event: { point: PointLike }): void => {
    const feature = this.queryFeatures(event.point)[0];
    if (feature) this.#emit("featureclick", { target: this, feature });
  };

  #requestRender(immediate: boolean): void {
    if (!this.#map || !this.#worker) return;
    const send = () => {
      this.#timer = undefined;
      if (!this.#map) return;
      this.#lastRenderRequest = performance.now();
      const state = this.#currentViewState();
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
      width: canvas.clientWidth,
      height: canvas.clientHeight,
      pixelRatio: canvas.width / Math.max(1, canvas.clientWidth),
      cell: this.#cell,
      locale: this.#options.locale,
    };
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

  #lockNorthUp(map: MapLibreMap): void {
    this.#rotationState = {
      drag: map.dragRotate.isEnabled(),
      touch: map.touchZoomRotate.isEnabled(),
    };
    map.setBearing(0);
    map.setPitch(0);
    map.dragRotate.disable();
    map.touchZoomRotate.disableRotation();
  }

  #restoreNorthUp(map: MapLibreMap): void {
    if (!this.#rotationState) return;
    if (this.#rotationState.drag) map.dragRotate.enable();
    if (this.#rotationState.touch) map.touchZoomRotate.enable();
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
