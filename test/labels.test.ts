import { describe, expect, it } from "vitest";
import { Occupancy } from "../src/labels";

describe("label occupancy", () => {
  it("requires a one-cell horizontal halo but no vertical halo", () => {
    const occupancy = new Occupancy(20, 4);
    expect(occupancy.free(1, 3, 5)).toBe(true);
    occupancy.claim(1, 3, 5);
    expect(occupancy.free(1, 9, 2)).toBe(false);
    expect(occupancy.free(2, 3, 5)).toBe(true);
  });

  it("rejects labels outside the viewport", () => {
    const occupancy = new Occupancy(10, 2);
    expect(occupancy.free(-1, 0, 2)).toBe(false);
    expect(occupancy.free(0, 9, 2)).toBe(false);
  });
});
