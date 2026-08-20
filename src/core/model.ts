import type { Point } from "./geometry.js";
import type { FeatureRecord } from "../types.js";

export interface ProjectedFeature {
  record: FeatureRecord;
  sourceLayer: string;
  type: 1 | 2 | 3;
  properties: Record<string, string | number | boolean | null>;
  parts: Point[][];
}

export function localizedName(
  properties: Record<string, unknown>,
  locale: string,
): string {
  const fullLocale = properties[`name:${locale}`];
  if (typeof fullLocale === "string" && fullLocale.trim())
    return fullLocale.trim();
  const short = locale.split("-")[0];
  if (short) {
    const translated = properties[`name:${short}`];
    if (typeof translated === "string" && translated.trim())
      return translated.trim();
  }
  const latin = properties["name:latin"];
  if (typeof latin === "string" && latin.trim()) return latin.trim();
  return typeof properties.name === "string" ? properties.name.trim() : "";
}
