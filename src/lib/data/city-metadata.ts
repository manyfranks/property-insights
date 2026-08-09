import { Listing } from "../types";
import { cityToSlug } from "../utils";
import { getAllStatesWithCounties } from "../us-counties";

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
  Winnipeg: "Manitoba's capital, affordable Prairie market",
};

/**
 * Popular US states shown in the home page explorer's US panel. Slugs match
 * stateSlug in src/lib/data/us-counties.json (used by /us/[state] pages).
 */
export const POPULAR_US_STATES: { name: string; slug: string }[] = [
  { name: "California", slug: "california" },
  { name: "Texas", slug: "texas" },
  { name: "Florida", slug: "florida" },
  { name: "New York", slug: "new-york" },
  { name: "Washington", slug: "washington" },
  { name: "Arizona", slug: "arizona" },
  { name: "Colorado", slug: "colorado" },
  { name: "Georgia", slug: "georgia" },
];

/**
 * Curated "Popular markets" row shown on the homepage explorer by default
 * (no visitor geo, or geo we can't place) and appended after the
 * geo-detected leading pill when we can. Mixes both countries deliberately
 * — this product now serves CA and US alike, so the entry point shouldn't
 * default to an all-Canada wall with the US as an afterthought.
 *
 * CA entries point at a specific city (slug matches CityMeta.slug, built
 * from live listings) but select that city's whole province, matching the
 * existing province-pill behavior. US entries point at a state (slug
 * matches stateSlug in us-counties.json / POPULAR_US_STATES).
 */
export interface PopularMarket {
  country: "CA" | "US";
  label: string;
  kind: "province" | "state";
  /** CA: province code (BC/AB/ON). US: state slug (e.g. "texas"). */
  target: string;
  /** CA only — the representative city slug/name to key off of for display context. */
  city?: string;
}

export const POPULAR_MARKETS: PopularMarket[] = [
  { country: "CA", label: "Victoria", kind: "province", target: "BC", city: "Victoria" },
  { country: "CA", label: "Vancouver", kind: "province", target: "BC", city: "Vancouver" },
  { country: "CA", label: "Calgary", kind: "province", target: "AB", city: "Calgary" },
  { country: "CA", label: "Toronto", kind: "province", target: "ON", city: "Toronto" },
  { country: "US", label: "Texas", kind: "state", target: "texas" },
  { country: "US", label: "California", kind: "state", target: "california" },
  { country: "US", label: "Florida", kind: "state", target: "florida" },
  { country: "US", label: "New York", kind: "state", target: "new-york" },
];

/**
 * Map a visitor's detected US region code (USPS state code from
 * x-vercel-ip-country-region, e.g. "TX") to the state slug used by
 * /us/[state] pages and getCountiesByState. Returns null for codes with no
 * county data (shouldn't happen — every state has counties in the registry
 * — but geo headers are visitor-supplied and unverified).
 */
export function getUsStateByRegionCode(
  code: string
): { slug: string; name: string; usps: string } | null {
  const upper = code.toUpperCase();
  const match = getAllStatesWithCounties().find((s) => s.state === upper);
  if (!match) return null;
  return { slug: match.stateSlug, name: match.stateName, usps: match.state };
}

export const PROVINCE_GROUPS: { province: string; label: string; active: boolean }[] = [
  { province: "BC", label: "BC", active: true },
  { province: "AB", label: "AB", active: true },
  { province: "ON", label: "ON", active: true },
  { province: "QC", label: "QC", active: false },
  // MB (Winnipeg) activated 2026-08 — real Zoocasa coverage confirmed live
  // + the MB (City of Winnipeg SODA) assessment adapter already exists and
  // is golden-tested (src/lib/assessment/mb.ts, scripts/golden-canada.ts).
  { province: "MB", label: "MB", active: true },
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

// ---------------------------------------------------------------------------
// US Discover — cached, scored, browsable US listings by metro (see
// src/lib/pipeline/us-discover.ts). No separate registry wiring is needed
// for /discover/{slug} to resolve these: buildCityMetadata() above already
// derives CityMeta entries dynamically from whatever listings exist in KV
// (city/province fields), so once US listings land in the shared listings
// store, "/discover/austin" etc. just work. This config exists purely to
// drive the *fetch* side (which metros to pull, how often, which county to
// compare against) — the two knobs that matter for scaling off RentCast's
// free tier.
// ---------------------------------------------------------------------------

export interface USDiscoverCityConfig {
  /** RentCast /listings/sale `city` param. */
  name: string;
  /** USPS state code — RentCast `state` param, also Listing.province. */
  state: string;
  /** /discover/{slug} route slug. Matches cityToSlug(name) so US and CA
   * cities share one slug convention (see buildCityMetadata above). */
  slug: string;
  /** regional_econ geo_fips ("US-SSCCC") for the county this metro sits
   * in — used by us-discover.ts's county-median-value scoring signal via
   * src/lib/db/regional-econ.ts. Hardcoded per metro rather than geocoded
   * per listing: this list is a small, curated, hand-picked set of metros,
   * not something derived from arbitrary listing addresses. */
  countyFips: string;
}

/**
 * US Discover metro list — start small to respect RentCast's free-tier
 * quota (45 req/mo, see src/lib/rentcast.ts's module doc). Each metro costs
 * exactly ONE /listings/sale request per refresh (one city-wide call, no
 * per-listing detail fetches — see us-discover.ts's fetchUSCityListings).
 * At the default US_DISCOVER_REFRESH_DAYS cadence (3 days), 3 metros cost
 * ~30 requests/month, leaving headroom under the 45/mo cap for on-demand
 * /assess lookups that hit the same quota counter.
 *
 * Foundation tier ($74/mo, materially higher request cap) → drop
 * US_DISCOVER_REFRESH_DAYS to 1 (daily refresh) and grow this list past
 * 10 cities. Neither change touches us-discover.ts itself — both knobs
 * live here (this array) and in the env var.
 */
export const US_DISCOVER_CITIES: USDiscoverCityConfig[] = [
  { name: "Austin", state: "TX", slug: "austin", countyFips: "US-48453" }, // Travis County
  { name: "Miami", state: "FL", slug: "miami", countyFips: "US-12086" }, // Miami-Dade County
  { name: "Phoenix", state: "AZ", slug: "phoenix", countyFips: "US-04013" }, // Maricopa County
];

/**
 * Discover-city configs whose state matches the given /us/[state] slug
 * (e.g. "texas" -> Austin). Derived by mapping the slug to its USPS code
 * via getAllStatesWithCounties and matching against US_DISCOVER_CITIES'
 * `state` field, rather than hardcoding a city<->state list a second time
 * — keeps ProvinceExplorer's "browse live listings" row in sync with
 * whatever metros US_DISCOVER_CITIES actually configures.
 */
export function getUsDiscoverCitiesByStateSlug(stateSlug: string): USDiscoverCityConfig[] {
  const state = getAllStatesWithCounties().find((s) => s.stateSlug === stateSlug);
  if (!state) return [];
  return US_DISCOVER_CITIES.filter((c) => c.state === state.state);
}
