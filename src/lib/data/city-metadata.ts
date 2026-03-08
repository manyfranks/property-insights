import { Listing } from "../types";
import { cityToSlug } from "../utils";

export interface CityMeta {
  name: string;
  slug: string;
  province: string;
  description: string;
  listingCount: number;
}

/** Static descriptions for known cities — used when available */
const CITY_DESCRIPTIONS: Record<string, string> = {
  Victoria: "Capital city, heritage homes and urban core",
  Saanich: "Largest municipality, diverse neighborhoods",
  Langford: "Fast-growing Westshore hub",
  Colwood: "Waterfront community near Royal Roads",
  Esquimalt: "Naval base community, compact and affordable",
  "Oak Bay": "Upscale seaside village character",
  "View Royal": "Central location between city and Westshore",
  Sooke: "Rural coastal town, growing market",
  Metchosin: "Rural acreages near Victoria",
  Vancouver: "Major metro, diverse housing stock",
  Burnaby: "Urban centre east of Vancouver",
  Richmond: "Waterfront city south of Vancouver",
  Surrey: "BC's second largest city, fast growth",
  Calgary: "Alberta's largest city, energy hub",
  Edmonton: "Provincial capital, affordable markets",
  Toronto: "Canada's largest city, diverse market",
  Hamilton: "Steel city with revitalizing neighborhoods",
  Ottawa: "National capital, stable government market",
};

export const PROVINCE_GROUPS: { province: string; label: string; active: boolean }[] = [
  { province: "BC", label: "BC", active: true },
  { province: "AB", label: "AB", active: true },
  { province: "ON", label: "ON", active: true },
  { province: "QC", label: "QC", active: false },
  { province: "MB", label: "MB", active: false },
  { province: "SK", label: "SK", active: false },
  { province: "NS", label: "NS", active: false },
  { province: "NB", label: "NB", active: false },
];

/**
 * Build city metadata dynamically from a set of listings.
 * Known cities get curated descriptions; new cities get auto-generated ones.
 * Activates province pills dynamically when listings exist for that province.
 */
export function buildCityMetadata(listings: Listing[]): {
  cities: CityMeta[];
  provinces: typeof PROVINCE_GROUPS;
} {
  // Count listings per city and track province
  const cityMap = new Map<string, { province: string; count: number }>();
  for (const l of listings) {
    const existing = cityMap.get(l.city);
    if (existing) {
      existing.count++;
    } else {
      cityMap.set(l.city, { province: l.province, count: 1 });
    }
  }

  const cities: CityMeta[] = [];
  for (const [name, { province, count }] of cityMap) {
    cities.push({
      name,
      slug: cityToSlug(name),
      province,
      description: CITY_DESCRIPTIONS[name] || `${count} assessed listing${count > 1 ? "s" : ""}`,
      listingCount: count,
    });
  }

  // Sort: most listings first within each province
  cities.sort((a, b) => b.listingCount - a.listingCount);

  // Activate province pills that have listings
  const activeProvs = new Set(cities.map((c) => c.province));
  const provinces = PROVINCE_GROUPS.map((g) => ({
    ...g,
    active: g.active || activeProvs.has(g.province),
  }));

  return { cities, provinces };
}

export function getCityBySlug(slug: string, cities: CityMeta[]): CityMeta | undefined {
  return cities.find((c) => c.slug === slug);
}
