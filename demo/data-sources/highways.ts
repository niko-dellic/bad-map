import type {
  Feature,
  FeatureCollection,
  LineString,
  MultiLineString,
} from "geojson";

const ROADS_URL =
  "https://raw.githubusercontent.com/visgl/deck.gl-data/master/examples/highway/roads.json";
const ACCIDENTS_URL =
  "https://raw.githubusercontent.com/visgl/deck.gl-data/master/examples/highway/accidents.csv";

export interface HighwayProperties {
  state: string;
  type: string;
  id: string;
  name: string;
  length: number;
  incidents?: number;
  fatalities?: number;
}

export type HighwayFeature = Feature<
  LineString | MultiLineString,
  HighwayProperties
>;

export interface HighwayData {
  roads: FeatureCollection<LineString | MultiLineString, HighwayProperties>;
  accidents: globalThis.Map<string, { incidents: number; fatalities: number }>;
}

let request: Promise<HighwayData> | undefined;

export function highwayKey(
  properties: Pick<HighwayProperties, "state" | "type" | "id">,
): string {
  return `${properties.state}-${properties.type}-${properties.id}`;
}

export function loadHighwayData(): Promise<HighwayData> {
  request ??= Promise.all([
    fetch(ROADS_URL).then((response) => {
      if (!response.ok)
        throw new Error(`Road request failed (${response.status})`);
      return response.json() as Promise<HighwayData["roads"]>;
    }),
    fetch(ACCIDENTS_URL).then(async (response) => {
      if (!response.ok)
        throw new Error(`Accident request failed (${response.status})`);
      return response.text();
    }),
  ]).then(([roads, csv]) => {
    const accidents = new globalThis.Map<
      string,
      { incidents: number; fatalities: number }
    >();
    for (const row of csv.trim().split(/\r?\n/).slice(1)) {
      const [state, type, id, year, incidents, fatalities] = row.split(",");
      if (!state || !type || !id || !year) continue;
      accidents.set(`${year}:${state}-${type}-${id}`, {
        incidents: Number(incidents) || 0,
        fatalities: Number(fatalities) || 0,
      });
    }
    return { roads, accidents };
  });
  return request;
}
