import type { LowResTrip } from "../../src";

const DATA_URL =
  "https://raw.githubusercontent.com/visgl/deck.gl-data/master/examples/trips/trips-v7.json";

let request: Promise<LowResTrip[]> | undefined;

export function loadTrips(): Promise<LowResTrip[]> {
  request ??= fetch(DATA_URL)
    .then((response) => {
      if (!response.ok)
        throw new Error(`Trips request failed (${response.status})`);
      return response.json() as Promise<unknown>;
    })
    .then((value) => {
      if (!Array.isArray(value)) throw new TypeError("Unexpected trips data");
      const trips: LowResTrip[] = [];
      for (const [index, candidate] of value.entries()) {
        if (!candidate || typeof candidate !== "object") continue;
        const source = candidate as {
          vendor?: number;
          path?: [number, number][];
          timestamps?: number[];
        };
        if (!Array.isArray(source.path) || !Array.isArray(source.timestamps))
          continue;
        trips.push({
          id: index,
          path: source.path,
          timestamps: source.timestamps,
          color: source.vendor === 0 ? [253, 128, 93] : [23, 184, 190],
          properties: { vendor: source.vendor ?? -1 },
        });
      }
      return trips;
    });
  return request;
}
