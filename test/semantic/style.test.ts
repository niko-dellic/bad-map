import { describe, expect, it } from "vitest";
import {
  FillClass,
  LINE_STYLES,
  bandFor,
  effectiveStyleZoom,
  fillClassFor,
  sourceZoom,
  styleForLine,
} from "../../src/semantic/style";

describe("style model", () => {
  it("uses eight deterministic zoom bands", () => {
    expect([-1, 4, 6, 8, 10.5, 11.5, 13, 14.5, 20].map(bandFor)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 7,
    ]);
  });

  it("ties effective zoom to the Braille dot pitch", () => {
    expect(effectiveStyleZoom(14, 4)).toBe(13);
    expect(effectiveStyleZoom(14, 2)).toBe(14);
    expect(sourceZoom(13, 6, 14)).toBe(14);
  });

  it("adapts OpenMapTiles road and fill classes", () => {
    expect(styleForLine("transportation", { class: "motorway", ramp: 1 })).toBe(
      "ramp",
    );
    expect(styleForLine("transportation", { class: "residential" })).toBe(
      "minor",
    );
    expect(styleForLine("boundary", { admin_level: 2 })).toBe("borderCountry");
    expect(
      styleForLine("boundary", { admin_level: 2, maritime: true }),
    ).toBeNull();
    expect(fillClassFor("water", { class: "lake" }, 0)).toBe(FillClass.Water);
    expect(fillClassFor("building", {}, 6)).toBeNull();
    expect(fillClassFor("building", {}, 7)).toBe(FillClass.Building);
  });

  it("keeps the line hierarchy independent of feature order", () => {
    expect(LINE_STYLES.motorway.rank).toBeGreaterThan(LINE_STYLES.primary.rank);
    expect(LINE_STYLES.primary.rank).toBeGreaterThan(LINE_STYLES.coast.rank);
    expect(LINE_STYLES.coast.rank).toBeGreaterThan(
      LINE_STYLES.borderCountry.rank,
    );
  });
});
