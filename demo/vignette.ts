export type ScreenVignetteFalloff = "linear" | "smooth" | "edge";
export type ScreenVignetteColor = readonly [number, number, number];
export type ScreenVignetteBase = "rectangle" | "oval";

export interface ScreenVignetteOptions {
  enabled: boolean;
  /** Fraction of each radial axis occupied by the fade. */
  reach: number;
  /** Shape used when circularity is zero. */
  base: ScreenVignetteBase;
  /** Zero preserves the base shape; one is a true circle. */
  circularity: number;
  opacity: number;
  falloff: ScreenVignetteFalloff;
  color: ScreenVignetteColor;
}

export const DEFAULT_SCREEN_VIGNETTE: ScreenVignetteOptions = {
  enabled: true,
  reach: 0.32,
  base: "rectangle",
  circularity: 0.35,
  opacity: 1,
  falloff: "linear",
  color: [15, 15, 15],
};

const BAYER_8X8 = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36,
  14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41,
  51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23,
  61, 29, 53, 21,
] as const;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

export function screenVignetteBayerThreshold(x: number, y: number): number {
  const column = ((Math.floor(x) % 8) + 8) % 8;
  const row = ((Math.floor(y) % 8) + 8) % 8;
  return (BAYER_8X8[row * 8 + column]! + 0.5) / 64;
}

export function screenVignetteFalloff(
  progress: number,
  falloff: ScreenVignetteFalloff,
): number {
  const value = clamp(progress, 0, 1);
  if (falloff === "smooth") return value * value * (3 - 2 * value);
  if (falloff === "edge") return value * value;
  return value;
}

export function screenVignetteAmount(
  x: number,
  y: number,
  width: number,
  height: number,
  reach: number,
  circularity: number,
  falloff: ScreenVignetteFalloff = "linear",
  base: ScreenVignetteBase = "rectangle",
): number {
  if (width <= 0 || height <= 0) return 0;
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const radius = Math.min(halfWidth, halfHeight);
  const offsetX = x - halfWidth;
  const offsetY = y - halfHeight;
  const normalizedX = Math.abs(offsetX / Math.max(1, halfWidth));
  const normalizedY = Math.abs(offsetY / Math.max(1, halfHeight));
  const baseDistance =
    base === "rectangle"
      ? Math.max(normalizedX, normalizedY)
      : Math.hypot(normalizedX, normalizedY);
  const circleDistance = Math.hypot(offsetX / radius, offsetY / radius);
  const shape = clamp(circularity, 0, 1);
  const radialDistance = baseDistance + (circleDistance - baseDistance) * shape;
  const fadeWidth = clamp(reach, 0.01, 0.99);
  const progress = clamp((radialDistance - (1 - fadeWidth)) / fadeWidth, 0, 1);
  return screenVignetteFalloff(progress, falloff);
}

export function drawScreenVignette(
  canvas: HTMLCanvasElement,
  options: ScreenVignetteOptions,
): void {
  canvas.hidden = !options.enabled;
  if (!options.enabled) return;

  const width = Math.max(1, Math.round(canvas.clientWidth));
  const height = Math.max(1, Math.round(canvas.clientHeight));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return;

  const image = context.createImageData(width, height);
  const maximumAlpha = Math.round(clamp(options.opacity, 0, 1) * 255);
  const [red, green, blue] = options.color.map((channel) =>
    Math.round(clamp(channel, 0, 255)),
  );
  const xDistances = new Float32Array(width);
  const yDistances = new Float32Array(height);
  const circleXTerms = new Float32Array(width);
  const circleYTerms = new Float32Array(height);
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const radius = Math.min(halfWidth, halfHeight);
  const circularity = clamp(options.circularity, 0, 1);
  for (let x = 0; x < width; x += 1) {
    const offset = x + 0.5 - halfWidth;
    xDistances[x] = Math.abs(offset / Math.max(1, halfWidth));
    circleXTerms[x] = (offset / radius) ** 2;
  }
  for (let y = 0; y < height; y += 1) {
    const offset = y + 0.5 - halfHeight;
    yDistances[y] = Math.abs(offset / Math.max(1, halfHeight));
    circleYTerms[y] = (offset / radius) ** 2;
  }

  const fadeWidth = clamp(options.reach, 0.01, 0.99);
  const fadeStart = 1 - fadeWidth;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const baseDistance =
        options.base === "rectangle"
          ? Math.max(xDistances[x]!, yDistances[y]!)
          : Math.hypot(xDistances[x]!, yDistances[y]!);
      const circleDistance = Math.sqrt(circleXTerms[x]! + circleYTerms[y]!);
      const radialDistance =
        baseDistance + (circleDistance - baseDistance) * circularity;
      const progress = clamp((radialDistance - fadeStart) / fadeWidth, 0, 1);
      const amount = screenVignetteFalloff(progress, options.falloff);
      if (amount < screenVignetteBayerThreshold(x, y)) continue;
      const offset = (y * width + x) * 4;
      image.data[offset] = red!;
      image.data[offset + 1] = green!;
      image.data[offset + 2] = blue!;
      image.data[offset + 3] = maximumAlpha;
    }
  }
  context.putImageData(image, 0, 0);
}
