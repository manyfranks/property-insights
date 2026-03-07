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
  // BC — Southern Vancouver Island
  { name: "Victoria", slug: "victoria", province: "BC", description: "Capital city, heritage homes and urban core", listingCount: countListings("Victoria") },
  { name: "Saanich", slug: "saanich", province: "BC", description: "Largest municipality, diverse neighborhoods", listingCount: countListings("Saanich") },
  { name: "Langford", slug: "langford", province: "BC", description: "Fast-growing Westshore hub", listingCount: countListings("Langford") },
  { name: "Colwood", slug: "colwood", province: "BC", description: "Waterfront community near Royal Roads", listingCount: countListings("Colwood") },
  { name: "Esquimalt", slug: "esquimalt", province: "BC", description: "Naval base community, compact and affordable", listingCount: countListings("Esquimalt") },
  { name: "Oak Bay", slug: "oak-bay", province: "BC", description: "Upscale seaside village character", listingCount: countListings("Oak Bay") },
  { name: "View Royal", slug: "view-royal", province: "BC", description: "Central location between city and Westshore", listingCount: countListings("View Royal") },
  { name: "Sooke", slug: "sooke", province: "BC", description: "Rural coastal town, growing market", listingCount: countListings("Sooke") },
  { name: "Metchosin", slug: "metchosin", province: "BC", description: "Rural acreages near Victoria", listingCount: countListings("Metchosin") },
  // BC — Metro Vancouver
  { name: "Vancouver", slug: "vancouver", province: "BC", description: "Major metro, diverse housing stock", listingCount: countListings("Vancouver") },
  { name: "Burnaby", slug: "burnaby", province: "BC", description: "Urban centre east of Vancouver", listingCount: countListings("Burnaby") },
  { name: "Richmond", slug: "richmond", province: "BC", description: "Waterfront city south of Vancouver", listingCount: countListings("Richmond") },
  { name: "Surrey", slug: "surrey", province: "BC", description: "BC's second largest city, fast growth", listingCount: countListings("Surrey") },
  // AB
  { name: "Calgary", slug: "calgary", province: "AB", description: "Alberta's largest city, energy hub", listingCount: countListings("Calgary") },
  { name: "Edmonton", slug: "edmonton", province: "AB", description: "Provincial capital, affordable markets", listingCount: countListings("Edmonton") },
  // ON
  { name: "Toronto", slug: "toronto", province: "ON", description: "Canada's largest city, diverse market", listingCount: countListings("Toronto") },
  { name: "Hamilton", slug: "hamilton", province: "ON", description: "Steel city with revitalizing neighborhoods", listingCount: countListings("Hamilton") },
  { name: "Ottawa", slug: "ottawa", province: "ON", description: "National capital, stable government market", listingCount: countListings("Ottawa") },
];

export const PROVINCE_GROUPS: { province: string; label: string; active: boolean }[] = [
  { province: "BC", label: "BC", active: true },
  { province: "AB", label: "AB", active: true },
  { province: "ON", label: "ON", active: true },
];

export function getCityBySlug(slug: string): CityMeta | undefined {
  return CITY_METADATA.find((c) => c.slug === slug);
}
