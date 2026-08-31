import type {
  CellGeometry,
  LowResBasemapOptions,
  LowResBuildings3DOptions,
  LowResCameraOptions,
  LowResColorMode,
  LowResFogMode,
  LowResFogOptions,
  LowResHeatmapOptions,
  LowResHeatmapPoint,
  LowResProjectionMode,
  RGB,
} from "../types.js";

const DEFAULT_FOG = {
  visible: true,
  mode: "dithered",
  start: 0.55,
  end: 0.95,
  opacity: 1,
} as const satisfies Required<Omit<LowResFogOptions, "color">>;

export interface HeatmapState {
  points: Float32Array;
  visible: boolean;
  radius: number;
  intensity: number;
  maxDensity: number;
  opacity: number;
  palette?: readonly [RGB, RGB, RGB, RGB];
}

export interface FogState {
  visible: boolean;
  mode: LowResFogMode;
  start: number;
  end: number;
  opacity: number;
  color?: RGB;
}

export interface CameraState {
  rotation: boolean;
  pitch: boolean;
  maxPitch: number;
}

export function validateCell(cell: CellGeometry): void {
  if (
    ![cell.width, cell.height, cell.dotSize].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  )
    throw new TypeError("Cell dimensions must be positive numbers");
  if (cell.dotSize > Math.min(cell.width / 2, cell.height / 4))
    throw new RangeError("dotSize cannot exceed the Braille-dot pitch");
}

export function validateColorMode(colorMode: LowResColorMode): LowResColorMode {
  if (colorMode !== "color" && colorMode !== "greyscale")
    throw new TypeError(`Unsupported color mode: ${String(colorMode)}`);
  return colorMode;
}

export function validateProjectionMode(
  mode: LowResProjectionMode,
): LowResProjectionMode {
  if (mode !== "screen" && mode !== "surface")
    throw new TypeError(`Unsupported projection mode: ${String(mode)}`);
  return mode;
}

export function normalizeCamera(
  options: LowResCameraOptions | undefined,
  defaults: CameraState,
): CameraState {
  const state = { ...defaults, ...options };
  if (
    !Number.isFinite(state.maxPitch) ||
    state.maxPitch < 0 ||
    state.maxPitch > 180
  )
    throw new RangeError("maxPitch must be between zero and 180 degrees");
  return state;
}

export function normalizeBuildings3D(
  options: LowResBasemapOptions["buildings3D"],
): Required<LowResBuildings3DOptions> {
  const configured = typeof options === "object" ? options : {};
  const result = {
    visible:
      typeof options === "boolean" ? options : (configured.visible ?? true),
    style: configured.style ?? "dotted",
    sourceId: configured.sourceId ?? "base",
    minZoom: configured.minZoom ?? 14,
    opacity: configured.opacity ?? 0.82,
    heightScale: configured.heightScale ?? 1,
    fill: configured.fill ?? true,
    dots: configured.dots ?? false,
    edges: configured.edges ?? true,
    edgeStrength: configured.edgeStrength ?? 1,
  };
  if (!result.sourceId.trim())
    throw new TypeError("buildings3D.sourceId cannot be empty");
  if (result.style !== "dotted" && result.style !== "native")
    throw new TypeError(
      `Unsupported buildings3D style: ${String(result.style)}`,
    );
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
  if (
    !Number.isFinite(result.edgeStrength) ||
    result.edgeStrength < 0 ||
    result.edgeStrength > 4
  )
    throw new RangeError(
      "buildings3D.edgeStrength must be between zero and four",
    );
  return result;
}

export function normalizeFog(options: LowResBasemapOptions["fog"]): FogState {
  const configured = typeof options === "object" ? options : {};
  const state: FogState = {
    visible:
      typeof options === "boolean"
        ? options
        : (configured.visible ?? DEFAULT_FOG.visible),
    mode: configured.mode ?? DEFAULT_FOG.mode,
    start: configured.start ?? DEFAULT_FOG.start,
    end: configured.end ?? DEFAULT_FOG.end,
    opacity: configured.opacity ?? DEFAULT_FOG.opacity,
    ...(configured.color ? { color: [...configured.color] as RGB } : {}),
  };
  validateFog(state);
  return state;
}

export function validateFog(state: FogState): void {
  if (state.mode !== "regular" && state.mode !== "dithered")
    throw new TypeError(`Unsupported fog mode: ${String(state.mode)}`);
  if (
    ![state.start, state.end].every(
      (value) => Number.isFinite(value) && value >= 0 && value <= 1,
    ) ||
    state.start >= state.end
  )
    throw new RangeError(
      "Fog start and end must be between zero and one, with start before end",
    );
  if (!Number.isFinite(state.opacity) || state.opacity < 0 || state.opacity > 1)
    throw new RangeError("Fog opacity must be between zero and one");
  if (state.color) validateRgb(state.color, "Fog color");
}

function validateRgb(color: RGB, label: string): void {
  if (
    color.length !== 3 ||
    color.some(
      (channel) => !Number.isFinite(channel) || channel < 0 || channel > 255,
    )
  )
    throw new RangeError(`${label} channels must be between 0 and 255`);
}

export function fogStateEquals(left: FogState, right: FogState): boolean {
  return (
    left.visible === right.visible &&
    left.mode === right.mode &&
    left.start === right.start &&
    left.end === right.end &&
    left.opacity === right.opacity &&
    ((!left.color && !right.color) ||
      Boolean(
        left.color &&
        right.color &&
        left.color.every((channel, index) => channel === right.color![index]),
      ))
  );
}

export function normalizeHeatmap(
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

export function normalizeHeatmapData(
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

export function validateHeatmap(state: HeatmapState): void {
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
