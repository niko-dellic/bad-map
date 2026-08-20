import { describe, expect, it } from "vitest";
import { parseTrips } from "../../demo/data-sources/trips";

describe("demo trip data", () => {
  it("keeps valid trips and preserves their source indices", () => {
    expect(
      parseTrips([
        null,
        {
          vendor: 0,
          path: [
            [-74.02, 40.7],
            [-73.99, 40.73],
          ],
          timestamps: [0, 1800],
        },
      ]),
    ).toEqual([
      {
        id: 1,
        path: [
          [-74.02, 40.7],
          [-73.99, 40.73],
        ],
        timestamps: [0, 1800],
        color: [253, 128, 93],
        properties: { vendor: 0 },
      },
    ]);
  });

  it("drops trips that would produce renderer validation warnings", () => {
    const valid = {
      path: [
        [-74.02, 40.7],
        [-73.99, 40.73],
      ],
      timestamps: [0, 1800],
    };
    expect(
      parseTrips([
        { ...valid, timestamps: [0, 0] },
        { ...valid, timestamps: [10, 5] },
        { ...valid, timestamps: [0, Number.NaN] },
        { ...valid, timestamps: [0] },
        { path: [[-74.02, 40.7]], timestamps: [0] },
        {
          ...valid,
          path: [
            [-74.02, 40.7],
            [Number.NaN, 40.73],
          ],
        },
        valid,
      ]),
    ).toHaveLength(1);
  });

  it("rejects a non-array response", () => {
    expect(() => parseTrips({})).toThrow("Unexpected trips data");
  });
});
