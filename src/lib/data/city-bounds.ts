export interface CityBounds {
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
}

export const CITY_BOUNDS: Record<string, CityBounds> = {
  // Southern Vancouver Island
  Victoria: { latMin: 48.4, latMax: 48.47, lngMin: -123.42, lngMax: -123.32 },
  Saanich: { latMin: 48.44, latMax: 48.54, lngMin: -123.42, lngMax: -123.3 },
  Langford: { latMin: 48.43, latMax: 48.5, lngMin: -123.55, lngMax: -123.46 },
  Colwood: { latMin: 48.42, latMax: 48.46, lngMin: -123.52, lngMax: -123.46 },
  Esquimalt: { latMin: 48.42, latMax: 48.45, lngMin: -123.42, lngMax: -123.38 },
  "Oak Bay": { latMin: 48.42, latMax: 48.46, lngMin: -123.33, lngMax: -123.28 },
  "View Royal": { latMin: 48.44, latMax: 48.48, lngMin: -123.47, lngMax: -123.4 },
  Sooke: { latMin: 48.35, latMax: 48.42, lngMin: -123.78, lngMax: -123.68 },
  // Ontario
  Toronto: { latMin: 43.58, latMax: 43.86, lngMin: -79.64, lngMax: -79.1 },
  Mississauga: { latMin: 43.5, latMax: 43.66, lngMin: -79.78, lngMax: -79.53 },
  Hamilton: { latMin: 43.2, latMax: 43.3, lngMin: -79.95, lngMax: -79.75 },
  Ottawa: { latMin: 45.25, latMax: 45.5, lngMin: -75.85, lngMax: -75.55 },
  // Alberta
  Calgary: { latMin: 50.88, latMax: 51.18, lngMin: -114.27, lngMax: -113.9 },
  Edmonton: { latMin: 53.42, latMax: 53.62, lngMin: -113.72, lngMax: -113.32 },
};

export const PROVINCE_CITIES: Record<string, string[]> = {
  BC: ["Victoria", "Saanich", "Langford", "Colwood", "Esquimalt", "Oak Bay", "View Royal", "Sooke"],
  ON: ["Toronto", "Mississauga", "Hamilton", "Ottawa"],
  AB: ["Calgary", "Edmonton"],
};
