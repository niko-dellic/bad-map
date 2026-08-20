import type { LowResTrip } from "../../src";

const DATA_URL =
  "https://raw.githubusercontent.com/visgl/deck.gl-data/master/examples/trips/trips-v7.json";

let request: Promise<LowResTrip[]> | undefined;

const isFiniteCoordinate = (
  value: unknown,
): value is readonly [longitude: number, latitude: number] =>
  Array.isArray(value) &&
  value.length >= 2 &&
  Number.isFinite(value[0]) &&
  Number.isFinite(value[1]);

export function parseTrips(value: unknown): LowResTrip[] {
  if (!Array.isArray(value)) throw new TypeError("Unexpected trips data");
  const trips: LowResTrip[] = [];
  for (const [index, candidate] of value.entries()) {
    if (!candidate || typeof candidate !== "object") continue;
    const source = candidate as {
      vendor?: unknown;
      path?: unknown;
      timestamps?: unknown;
    };
    if (
      !Array.isArray(source.path) ||
      !Array.isArray(source.timestamps) ||
      source.path.length < 2 ||
      source.path.length !== source.timestamps.length ||
      !source.path.every(isFiniteCoordinate) ||
      !source.timestamps.every(
        (timestamp, item, timestamps) =>
          typeof timestamp === "number" &&
          Number.isFinite(timestamp) &&
          (item === 0 || timestamp > (timestamps[item - 1] as number)),
      )
    )
      continue;
    const vendor =
      typeof source.vendor === "number" && Number.isFinite(source.vendor)
        ? source.vendor
        : -1;
    trips.push({
      id: index,
      path: source.path,
      timestamps: source.timestamps as number[],
      color: vendor === 0 ? [253, 128, 93] : [23, 184, 190],
      properties: { vendor },
    });
  }
  return trips;
}

export function loadTrips(): Promise<LowResTrip[]> {
  request ??= fetch(DATA_URL)
    .then((response) => {
      if (!response.ok)
        throw new Error(`Trips request failed (${response.status})`);
      return response.json() as Promise<unknown>;
    })
    .then(parseTrips);
  return request;
}
