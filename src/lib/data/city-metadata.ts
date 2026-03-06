import { PRELOADED_LISTINGS } from "./listings";

export interface CityMeta {
  name: string;
  slug: string;
  province: string;
  description: string;
  listingCount: number;
}

function countListings(city: string): number {
  return PRELOADED_LISTINGS.filter((l) => l.city === city).length;
}

export const CITY_METADATA: CityMeta[] = [
  { name: "Victoria", slug: "victoria", province: "BC", description: "Capital city, heritage homes and urban core", listingCount: countListings("Victoria") },
  { name: "Saanich", slug: "saanich", province: "BC", description: "Largest municipality, diverse neighborhoods", listingCount: countListings("Saanich") },
  { name: "Langford", slug: "langford", province: "BC", description: "Fast-growing Westshore hub", listingCount: countListings("Langford") },
  { name: "Colwood", slug: "colwood", province: "BC", description: "Waterfront community near Royal Roads", listingCount: countListings("Colwood") },
  { name: "Esquimalt", slug: "esquimalt", province: "BC", description: "Naval base community, compact and affordable", listingCount: countListings("Esquimalt") },
  { name: "Oak Bay", slug: "oak-bay", province: "BC", description: "Upscale seaside village character", listingCount: countListings("Oak Bay") },
  { name: "View Royal", slug: "view-royal", province: "BC", description: "Central location between city and Westshore", listingCount: countListings("View Royal") },
  { name: "Sooke", slug: "sooke", province: "BC", description: "Rural coastal town, growing market", listingCount: countListings("Sooke") },
];

export const PROVINCE_GROUPS: { province: string; label: string; active: boolean }[] = [
  { province: "BC", label: "BC", active: true },
  { province: "ON", label: "ON", active: false },
  { province: "AB", label: "AB", active: false },
];

export function getCityBySlug(slug: string): CityMeta | undefined {
  return CITY_METADATA.find((c) => c.slug === slug);
}
