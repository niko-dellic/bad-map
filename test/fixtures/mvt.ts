import { PbfWriter } from "pbf";

type Value = string | number | boolean;
type Point = readonly [number, number];

interface FixtureFeature {
  type: 1 | 2 | 3;
  properties: Record<string, Value>;
  geometry: Point[][];
}

interface FixtureLayer {
  name: string;
  features: FixtureFeature[];
}

interface EncodedLayer extends FixtureLayer {
  keys: string[];
  values: Value[];
}

function zigzag(value: number): number {
  return value < 0 ? -value * 2 - 1 : value * 2;
}

function geometryCommands(feature: FixtureFeature): number[] {
  const output: number[] = [];
  let cursorX = 0;
  let cursorY = 0;
  for (const part of feature.geometry) {
    const first = part[0];
    if (!first) continue;
    output.push(
      (1 << 3) | 1,
      zigzag(first[0] - cursorX),
      zigzag(first[1] - cursorY),
    );
    cursorX = first[0];
    cursorY = first[1];
    if (part.length > 1) {
      output.push(((part.length - 1) << 3) | 2);
      for (const [x, y] of part.slice(1)) {
        output.push(zigzag(x - cursorX), zigzag(y - cursorY));
        cursorX = x;
        cursorY = y;
      }
    }
    if (feature.type === 3) output.push((1 << 3) | 7);
  }
  return output;
}

function valueKey(value: Value): string {
  return `${typeof value}:${String(value)}`;
}

function prepareLayer(layer: FixtureLayer): EncodedLayer {
  const keys: string[] = [];
  const values: Value[] = [];
  const seenKeys = new Set<string>();
  const seenValues = new Set<string>();
  for (const feature of layer.features) {
    for (const [key, value] of Object.entries(feature.properties)) {
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        keys.push(key);
      }
      const encoded = valueKey(value);
      if (!seenValues.has(encoded)) {
        seenValues.add(encoded);
        values.push(value);
      }
    }
  }
  return { ...layer, keys, values };
}

function writeValue(value: Value, writer: PbfWriter): void {
  if (typeof value === "string") writer.writeStringField(1, value);
  else if (typeof value === "boolean") writer.writeBooleanField(7, value);
  else writer.writeDoubleField(3, value);
}

function writeFeature(
  input: { feature: FixtureFeature; layer: EncodedLayer; id: number },
  writer: PbfWriter,
): void {
  writer.writeVarintField(1, input.id);
  const tags: number[] = [];
  for (const [key, value] of Object.entries(input.feature.properties)) {
    tags.push(
      input.layer.keys.indexOf(key),
      input.layer.values.findIndex(
        (candidate) => valueKey(candidate) === valueKey(value),
      ),
    );
  }
  writer.writePackedVarint(2, tags);
  writer.writeVarintField(3, input.feature.type);
  writer.writePackedVarint(4, geometryCommands(input.feature));
}

function writeLayer(layer: EncodedLayer, writer: PbfWriter): void {
  writer.writeVarintField(15, 2);
  writer.writeStringField(1, layer.name);
  layer.features.forEach((feature, index) =>
    writer.writeMessage(2, writeFeature, { feature, layer, id: index + 1 }),
  );
  layer.keys.forEach((key) => writer.writeStringField(3, key));
  layer.values.forEach((value) => writer.writeMessage(4, writeValue, value));
  writer.writeVarintField(5, 4096);
}

function writeTile(layers: EncodedLayer[], writer: PbfWriter): void {
  layers.forEach((layer) => writer.writeMessage(3, writeLayer, layer));
}

export function semanticFixtureTile(): Uint8Array {
  const layers: FixtureLayer[] = [
    {
      name: "transportation",
      features: [
        {
          type: 2,
          properties: { class: "primary", name: "Fixture Road" },
          geometry: [
            [
              [256, 2048],
              [3840, 2048],
            ],
          ],
        },
        {
          type: 2,
          properties: {
            class: "secondary",
            name: "Fixture Tunnel",
            brunnel: "tunnel",
          },
          geometry: [
            [
              [2048, 256],
              [2048, 3840],
            ],
          ],
        },
      ],
    },
    {
      name: "water",
      features: [
        {
          type: 3,
          properties: { class: "lake", name: "Fixture Lake" },
          geometry: [
            [
              [256, 256],
              [1400, 256],
              [1400, 1400],
              [256, 1400],
            ],
          ],
        },
      ],
    },
    {
      name: "place",
      features: [
        {
          type: 1,
          properties: {
            class: "city",
            name: "Fixture City",
            "name:es": "Ciudad de Prueba",
            rank: 1,
          },
          geometry: [[[2300, 1800]]],
        },
      ],
    },
    {
      name: "park",
      features: [
        {
          type: 3,
          properties: { class: "park", name: "Fixture Park" },
          geometry: [
            [
              [2700, 2600],
              [3600, 2600],
              [3600, 3500],
              [2700, 3500],
            ],
          ],
        },
      ],
    },
    {
      name: "building",
      features: [
        {
          type: 3,
          properties: { class: "building" },
          geometry: [
            [
              [1700, 2700],
              [2200, 2700],
              [2200, 3200],
              [1700, 3200],
            ],
          ],
        },
      ],
    },
    {
      name: "transportation_name",
      features: [
        {
          type: 2,
          properties: {
            class: "motorway",
            name: "Fixture Freeway",
            ref: "I 5",
          },
          geometry: [
            [
              [256, 3600],
              [3840, 3600],
            ],
          ],
        },
      ],
    },
    {
      name: "poi",
      features: [
        {
          type: 1,
          properties: {
            class: "hospital",
            name: "Fixture Hospital",
            rank: 1,
          },
          geometry: [[[3200, 2000]]],
        },
      ],
    },
  ];
  const writer = new PbfWriter();
  writeTile(layers.map(prepareLayer), writer);
  return writer.finish();
}
