const DATA_URL =
  "https://raw.githubusercontent.com/visgl/deck.gl-data/master/examples/screen-grid/uber-pickup-locations.json";

export type PickupRow = readonly [number, number, number];

export interface PickupData {
  rows: PickupRow[];
  compact: Float32Array;
}

let request: Promise<PickupData> | undefined;

export function loadPickupData(): Promise<PickupData> {
  request ??= fetch(DATA_URL)
    .then((response) => {
      if (!response.ok)
        throw new Error(`Pickup request failed (${response.status})`);
      return response.json() as Promise<unknown>;
    })
    .then((value) => {
      if (!Array.isArray(value)) throw new TypeError("Unexpected pickup data");
      const rows: PickupRow[] = [];
      for (const candidate of value) {
        if (
          !Array.isArray(candidate) ||
          candidate.length < 2 ||
          !candidate.slice(0, 3).every(Number.isFinite)
        )
          continue;
        rows.push([
          Number(candidate[0]),
          Number(candidate[1]),
          Number(candidate[2] ?? 1),
        ]);
      }
      const compact = new Float32Array(rows.length * 3);
      rows.forEach(([lng, lat, weight], index) => {
        compact[index * 3] = lng;
        compact[index * 3 + 1] = lat;
        compact[index * 3 + 2] = weight;
      });
      return { rows, compact };
    });
  return request;
}
