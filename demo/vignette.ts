export type ScreenVignetteFalloff = "linear" | "smooth" | "edge";
export type ScreenVignetteColor = readonly [number, number, number];

export interface ScreenVignetteOptions {
  enabled: boolean;
  /** Fraction of each radial axis occupied by the fade. */
  reach: number;
  /** Zero follows the viewport aspect ratio; one is a true circle. */
  circularity: number;
  opacity: number;
  falloff: ScreenVignetteFalloff;
  color: ScreenVignetteColor;
}

export const DEFAULT_SCREEN_VIGNETTE: ScreenVignetteOptions = {
  enabled: true,
  reach: 0.32,
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
): number {
  if (width <= 0 || height <= 0) return 0;
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const radius = Math.min(halfWidth, halfHeight);
  const shape = clamp(circularity, 0, 1);
  const axisX = halfWidth + (radius - halfWidth) * shape;
  const axisY = halfHeight + (radius - halfHeight) * shape;
  const normalizedX = (x - halfWidth) / Math.max(1, axisX);
  const normalizedY = (y - halfHeight) / Math.max(1, axisY);
  const radialDistance = Math.hypot(normalizedX, normalizedY);
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
  const xTerms = new Float32Array(width);
  const yTerms = new Float32Array(height);
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const radius = Math.min(halfWidth, halfHeight);
  const shape = clamp(options.circularity, 0, 1);
  const axisX = Math.max(1, halfWidth + (radius - halfWidth) * shape);
  const axisY = Math.max(1, halfHeight + (radius - halfHeight) * shape);
  for (let x = 0; x < width; x += 1)
    xTerms[x] = ((x + 0.5 - halfWidth) / axisX) ** 2;
  for (let y = 0; y < height; y += 1)
    yTerms[y] = ((y + 0.5 - halfHeight) / axisY) ** 2;

  const fadeWidth = clamp(options.reach, 0.01, 0.99);
  const fadeStart = 1 - fadeWidth;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const radialDistance = Math.sqrt(xTerms[x]! + yTerms[y]!);
      const progress = clamp((radialDistance - fadeStart) / fadeWidth, 0, 1);
      const amount = screenVignetteFalloff(progress, options.falloff);
      if (amount < screenVignetteBayerThreshold(x, y)) continue;
      const offset = (y * width + x) * 4;
      image.data[offset] = red!;
      image.data[offset + 1] = green!;
      image.data[offset + 2] = blue!;
      image.data[offset + 3] = Math.round(maximumAlpha * (0.2 + amount * 0.8));
    }
  }
  context.putImageData(image, 0, 0);
}
