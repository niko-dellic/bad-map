import { describe, expect, it } from "vitest";
import {
  HERO_CITIES,
  heroCameraAt,
  selectHeroCity,
} from "../../demo/hero-camera";

describe("promo hero camera", () => {
  it("offers twenty globally distributed city presets", () => {
    expect(HERO_CITIES).toHaveLength(20);
    expect(new Set(HERO_CITIES.map((city) => city.slug))).toHaveLength(20);
    expect(HERO_CITIES.some((city) => city.center[0] < -30)).toBe(true);
    expect(HERO_CITIES.some((city) => city.center[0] > 100)).toBe(true);
    expect(HERO_CITIES.some((city) => city.center[1] < 0)).toBe(true);
    expect(HERO_CITIES.some((city) => city.center[1] > 0)).toBe(true);
  });

  it("selects the first and last presets at the random range boundaries", () => {
    expect(selectHeroCity(() => 0)).toBe(HERO_CITIES[0]);
    expect(selectHeroCity(() => 1)).toBe(HERO_CITIES.at(-1));
  });

  it("starts at the city anchor and wanders without leaving its radius", () => {
    const city = HERO_CITIES[0];
    expect(heroCameraAt(city, 0, 1).center).toEqual([...city.center]);

    for (let elapsed = 1_000; elapsed <= 10 * 60_000; elapsed += 1_000) {
      const camera = heroCameraAt(city, elapsed, 1);
      const latitudeMeters = (camera.center[1] - city.center[1]) * 111_320;
      const longitudeMeters =
        (camera.center[0] - city.center[0]) *
        111_320 *
        Math.cos((city.center[1] * Math.PI) / 180);
      const distance = Math.hypot(latitudeMeters, longitudeMeters);

      expect(distance).toBeLessThanOrEqual(city.wanderRadiusMeters);
      expect(Math.abs(camera.bearing - city.bearing)).toBeLessThanOrEqual(3);
    }
  });
});
