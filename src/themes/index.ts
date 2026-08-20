import type {
  BuiltinThemeName,
  LowResColorMode,
  LowResTheme,
  RGB,
} from "../types.js";

export const DARK_THEME: LowResTheme = {
  name: "dark",
  fills: {
    ground: [14, 15, 18],
    urban: [24, 25, 30],
    park: [22, 34, 26],
    water: [30, 44, 62],
    building: [34, 36, 42],
  },
  lines: {
    waterway: [78, 124, 160],
    ferry: [78, 124, 160],
    borderState: [74, 76, 94],
    borderCountry: [108, 110, 130],
    coast: [104, 142, 176],
    path: [88, 92, 104],
    transit: [92, 88, 118],
    rail: [100, 96, 126],
    aeroway: [120, 118, 132],
    service: [108, 112, 124],
    minor: [132, 136, 150],
    secondary: [158, 163, 177],
    ramp: [178, 138, 60],
    primary: [188, 193, 206],
    trunk: [216, 221, 232],
    motorway: [245, 185, 70],
    route: [120, 210, 255],
  },
  labels: {
    city: [228, 231, 240],
    town: [196, 200, 212],
    village: [150, 155, 170],
    area: [134, 140, 154],
    road: [168, 172, 184],
    roadMinor: [118, 122, 134],
    shield: [232, 178, 96],
    water: [112, 140, 168],
    park: [104, 146, 116],
    poi: [122, 127, 140],
    medical: [208, 124, 124],
  },
  marker: [255, 240, 120],
  hover: [255, 255, 255],
};

export const LIGHT_THEME: LowResTheme = {
  name: "light",
  fills: {
    ground: [250, 250, 248],
    urban: [242, 241, 238],
    park: [223, 234, 222],
    water: [206, 216, 222],
    building: [214, 214, 212],
  },
  lines: {
    waterway: [108, 146, 178],
    ferry: [108, 146, 178],
    borderState: [216, 186, 190],
    borderCountry: [196, 158, 162],
    coast: [86, 124, 158],
    path: [172, 172, 176],
    transit: [150, 146, 166],
    rail: [126, 122, 144],
    aeroway: [186, 186, 192],
    service: [150, 150, 156],
    minor: [126, 128, 136],
    secondary: [102, 104, 114],
    ramp: [196, 146, 64],
    primary: [76, 78, 90],
    trunk: [52, 54, 66],
    motorway: [176, 116, 20],
    route: [0, 132, 196],
  },
  labels: {
    city: [38, 42, 52],
    town: [66, 70, 82],
    village: [104, 110, 124],
    area: [120, 126, 140],
    road: [96, 100, 112],
    roadMinor: [140, 144, 156],
    shield: [150, 96, 12],
    water: [78, 116, 150],
    park: [70, 118, 84],
    poi: [130, 136, 148],
    medical: [172, 66, 66],
  },
  marker: [160, 112, 0],
  hover: [0, 0, 0],
};

export function resolveTheme(
  theme: BuiltinThemeName | LowResTheme | undefined,
): LowResTheme {
  if (!theme || theme === "dark") return DARK_THEME;
  if (theme === "light") return LIGHT_THEME;
  return theme;
}

export function relativeLuminance(color: RGB): number {
  const [red, green, blue] = color.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
}

function linearToSrgb(value: number): number {
  const channel =
    value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
  return Math.round(Math.max(0, Math.min(1, channel)) * 255);
}

export function greyscaleColor(
  color: RGB,
  groundLuminance: number,
  contrast = 1.18,
): RGB {
  const luminance = Math.max(
    0,
    Math.min(
      1,
      groundLuminance + (relativeLuminance(color) - groundLuminance) * contrast,
    ),
  );
  const channel = linearToSrgb(luminance);
  return [channel, channel, channel];
}

export function composeTheme(
  theme: LowResTheme,
  colorMode: LowResColorMode,
): LowResTheme {
  if (colorMode === "color") return theme;
  const ground = relativeLuminance(theme.fills.ground);
  const convert = (color: RGB): RGB => greyscaleColor(color, ground);
  const mapColors = <T extends Record<string, RGB>>(colors: T): T =>
    Object.fromEntries(
      Object.entries(colors).map(([key, color]) => [key, convert(color)]),
    ) as T;
  const fills = mapColors(theme.fills);
  const lines = mapColors(theme.lines);
  const groundChannel = fills.ground[0];
  const emphasize = (color: RGB, minimumDistance: number): RGB => {
    const current = color[0];
    const channel =
      groundChannel < 128
        ? Math.max(current, Math.min(255, groundChannel + minimumDistance))
        : Math.min(current, Math.max(0, groundChannel - minimumDistance));
    return [channel, channel, channel];
  };
  // Color carries road hierarchy in the source themes. Re-establish that
  // hierarchy explicitly after chroma is removed.
  lines.service = emphasize(lines.service, 70);
  lines.minor = emphasize(lines.minor, 90);
  lines.secondary = emphasize(lines.secondary, 110);
  lines.ramp = emphasize(lines.ramp, 130);
  lines.primary = emphasize(lines.primary, 140);
  lines.trunk = emphasize(lines.trunk, 160);
  lines.motorway = emphasize(lines.motorway, 180);
  return {
    name: `${theme.name}-greyscale`,
    fills,
    lines,
    labels: mapColors(theme.labels),
    marker: convert(theme.marker),
    hover: convert(theme.hover),
  };
}
