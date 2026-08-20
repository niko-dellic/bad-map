import { describe, expect, it } from "vitest";
import {
  DARK_THEME,
  LIGHT_THEME,
  LowResBasemap,
  composeTheme,
  greyscaleColor,
  relativeLuminance,
} from "../../src";
import type { LowResTheme, RGB } from "../../src";

function colors(theme: LowResTheme): RGB[] {
  return [
    ...Object.values(theme.fills),
    ...Object.values(theme.lines),
    ...Object.values(theme.labels),
    theme.marker,
    theme.hover,
  ];
}

describe("theme composition", () => {
  it("calculates relative luminance in linear light", () => {
    expect(relativeLuminance([0, 0, 0])).toBe(0);
    expect(relativeLuminance([255, 255, 255])).toBe(1);
    expect(relativeLuminance([255, 0, 0])).toBeCloseTo(0.2126, 4);
  });

  it("emits equal channels for every greyscale token", () => {
    for (const theme of [DARK_THEME, LIGHT_THEME]) {
      const result = composeTheme(theme, "greyscale");
      expect(
        colors(result).every(
          ([red, green, blue]) => red === green && green === blue,
        ),
      ).toBe(true);
    }
  });

  it("preserves background polarity and semantic road contrast", () => {
    for (const theme of [DARK_THEME, LIGHT_THEME]) {
      const result = composeTheme(theme, "greyscale");
      const ground = relativeLuminance(result.fills.ground);
      const minorContrast = Math.abs(
        relativeLuminance(result.lines.minor) - ground,
      );
      const motorwayContrast = Math.abs(
        relativeLuminance(result.lines.motorway) - ground,
      );
      expect(motorwayContrast).toBeGreaterThan(minorContrast);
    }
    expect(
      relativeLuminance(composeTheme(DARK_THEME, "greyscale").fills.ground),
    ).toBeLessThan(0.05);
    expect(
      relativeLuminance(composeTheme(LIGHT_THEME, "greyscale").fills.ground),
    ).toBeGreaterThan(0.8);
  });

  it("does not mutate custom themes", () => {
    const custom = structuredClone(DARK_THEME);
    custom.name = "custom";
    const snapshot = structuredClone(custom);
    const result = composeTheme(custom, "greyscale");
    expect(custom).toEqual(snapshot);
    expect(result).not.toBe(custom);
    expect(composeTheme(custom, "color")).toBe(custom);
  });

  it("supports deterministic contrast remapping", () => {
    expect(greyscaleColor([120, 60, 20], 0.1)).toEqual(
      greyscaleColor([120, 60, 20], 0.1),
    );
  });

  it("rejects unsupported color modes at runtime", () => {
    expect(
      () => new LowResBasemap({ colorMode: "sepia" as never }),
    ).toThrowError("Unsupported color mode: sepia");
    expect(() =>
      new LowResBasemap().setColorMode("sepia" as never),
    ).toThrowError("Unsupported color mode: sepia");
  });
});
