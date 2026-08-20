export type HeroCity = {
  slug: string;
  name: string;
  center: readonly [longitude: number, latitude: number];
  zoom: number;
  bearing: number;
  wanderRadiusMeters: number;
};

export const HERO_CITIES = [
  {
    slug: "new-york",
    name: "New York",
    center: [-73.9857, 40.725],
    zoom: 10.9,
    bearing: -28,
    wanderRadiusMeters: 2_200,
  },
  {
    slug: "mexico-city",
    name: "Mexico City",
    center: [-99.1332, 19.4326],
    zoom: 10.7,
    bearing: -10,
    wanderRadiusMeters: 2_500,
  },
  {
    slug: "sao-paulo",
    name: "São Paulo",
    center: [-46.6333, -23.5505],
    zoom: 10.8,
    bearing: 18,
    wanderRadiusMeters: 2_500,
  },
  {
    slug: "buenos-aires",
    name: "Buenos Aires",
    center: [-58.3816, -34.6037],
    zoom: 10.7,
    bearing: -12,
    wanderRadiusMeters: 2_400,
  },
  {
    slug: "london",
    name: "London",
    center: [-0.1276, 51.5072],
    zoom: 10.8,
    bearing: -20,
    wanderRadiusMeters: 2_000,
  },
  {
    slug: "paris",
    name: "Paris",
    center: [2.3522, 48.8566],
    zoom: 11,
    bearing: 12,
    wanderRadiusMeters: 1_800,
  },
  {
    slug: "istanbul",
    name: "Istanbul",
    center: [28.9784, 41.0082],
    zoom: 10.5,
    bearing: -32,
    wanderRadiusMeters: 2_500,
  },
  {
    slug: "cairo",
    name: "Cairo",
    center: [31.2357, 30.0444],
    zoom: 10.6,
    bearing: 18,
    wanderRadiusMeters: 2_400,
  },
  {
    slug: "lagos",
    name: "Lagos",
    center: [3.3792, 6.5244],
    zoom: 10.6,
    bearing: -15,
    wanderRadiusMeters: 2_500,
  },
  {
    slug: "nairobi",
    name: "Nairobi",
    center: [36.8219, -1.2921],
    zoom: 10.8,
    bearing: 8,
    wanderRadiusMeters: 2_100,
  },
  {
    slug: "cape-town",
    name: "Cape Town",
    center: [18.4241, -33.9249],
    zoom: 10.7,
    bearing: -25,
    wanderRadiusMeters: 2_200,
  },
  {
    slug: "dubai",
    name: "Dubai",
    center: [55.2708, 25.2048],
    zoom: 10.7,
    bearing: 34,
    wanderRadiusMeters: 2_300,
  },
  {
    slug: "mumbai",
    name: "Mumbai",
    center: [72.8777, 19.076],
    zoom: 10.6,
    bearing: -20,
    wanderRadiusMeters: 2_300,
  },
  {
    slug: "delhi",
    name: "Delhi",
    center: [77.209, 28.6139],
    zoom: 10.5,
    bearing: 12,
    wanderRadiusMeters: 2_600,
  },
  {
    slug: "bangkok",
    name: "Bangkok",
    center: [100.5018, 13.7563],
    zoom: 10.6,
    bearing: -10,
    wanderRadiusMeters: 2_400,
  },
  {
    slug: "singapore",
    name: "Singapore",
    center: [103.8198, 1.3521],
    zoom: 11,
    bearing: 24,
    wanderRadiusMeters: 1_800,
  },
  {
    slug: "shanghai",
    name: "Shanghai",
    center: [121.4737, 31.2304],
    zoom: 10.5,
    bearing: -18,
    wanderRadiusMeters: 2_600,
  },
  {
    slug: "seoul",
    name: "Seoul",
    center: [126.978, 37.5665],
    zoom: 10.7,
    bearing: 15,
    wanderRadiusMeters: 2_200,
  },
  {
    slug: "tokyo",
    name: "Tokyo",
    center: [139.6917, 35.6895],
    zoom: 10.5,
    bearing: -25,
    wanderRadiusMeters: 2_600,
  },
  {
    slug: "sydney",
    name: "Sydney",
    center: [151.2093, -33.8688],
    zoom: 10.7,
    bearing: 30,
    wanderRadiusMeters: 2_200,
  },
] as const satisfies readonly HeroCity[];

export type HeroCamera = {
  center: [longitude: number, latitude: number];
  bearing: number;
};

const METERS_PER_DEGREE_LATITUDE = 111_320;

export const selectHeroCity = (random = Math.random): HeroCity => {
  const unit = Math.min(Math.max(random(), 0), 1 - Number.EPSILON);
  return HERO_CITIES[Math.floor(unit * HERO_CITIES.length)] ?? HERO_CITIES[0];
};

export const heroCameraAt = (
  city: HeroCity,
  elapsedMilliseconds: number,
  phase: number,
): HeroCamera => {
  const seconds = Math.max(0, elapsedMilliseconds) / 1_000;
  const ramp = Math.min(1, seconds / 12);
  const radiusScale = ramp * (0.52 + 0.16 * Math.sin(seconds / 31 + phase));
  const angle = phase + seconds / 42 + 0.32 * Math.sin(seconds / 19 + phase);
  const eastMeters = city.wanderRadiusMeters * radiusScale * Math.cos(angle);
  const northMeters = city.wanderRadiusMeters * radiusScale * Math.sin(angle);
  const latitudeRadians = (city.center[1] * Math.PI) / 180;
  const metersPerDegreeLongitude =
    METERS_PER_DEGREE_LATITUDE * Math.cos(latitudeRadians);

  return {
    center: [
      city.center[0] + eastMeters / metersPerDegreeLongitude,
      city.center[1] + northMeters / METERS_PER_DEGREE_LATITUDE,
    ],
    bearing: city.bearing + 3 * Math.sin(seconds / 34),
  };
};
