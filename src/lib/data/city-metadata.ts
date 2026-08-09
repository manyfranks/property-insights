import { Listing } from "../types";
import { cityToSlug } from "../utils";
import { getAllStatesWithCounties } from "../us-counties";
import { getMetaValue, setMetaValue } from "../kv/listings";

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

// ---------------------------------------------------------------------------
// US Metro Fill Queue — "slowly FILL every state with cached listings in
// all major metros" (Part 4 of the 2026-08-09 incident response).
//
// US_DISCOVER_CITIES above stays exactly as-is (Austin/Miami/Phoenix, the
// original 3 hand-seeded metros) — several existing scripts
// (enrich-us-from-assessors.ts, ingest-us-dom.ts, rescore-us-relative-dom.ts,
// analyze-us-seeds.ts, enrich-us-listings.ts) import it as a plain
// synchronous constant and filter/backfill against exactly those 3; changing
// its meaning out from under them is a bigger blast radius than this
// incident-response session should take on. Instead, the ACTIVE metro set
// is now a separate, KV-persisted, growable list — see
// getActiveUSDiscoverCities()/activateNextQueuedMetro() below — seeded from
// US_DISCOVER_CITIES on first read so today's behavior is unchanged until
// the fill mechanics actually activate something new. (Follow-up, not done
// here: point the backfill scripts above at getActiveUSDiscoverCities()
// once metros beyond the original 3 are actually active in production.)
//
// ORDERING RATIONALE: built from TOP_METRO_FIPS (src/lib/us-counties.ts) —
// the same ~105-county, population-ranked, hand-curated registry that
// already has regional_econ ingested (ACS median value + FRED/realtor.com
// median DOM — see us-discover.ts's scoring doc), so every queue entry's
// county-median scoring signal works from the moment it activates with zero
// additional ingest work. One representative metro per state (its largest
// TOP_METRO_FIPS county), in that county's TOP_METRO_FIPS rank order, so
// every state gets covered before any state gets a second metro; the
// largest, highest-SEO-value states (CA/TX/FL/NY/GA/OH/NC/CO/PA/TN/MO/KS/
// FL/OK/WA/NV) then get 2nd-4th entries appended (still in rank order) to
// round out ~60 total — these are the metros with enough population to be
// worth a second RentCast city search before a small state gets its first.
//
// KNOWN GAP: AL, AR, CT, LA, ME, MS, MT, ND, NH, SD, VT, WV, WY have no
// county in TOP_METRO_FIPS at all (never population-ranked into that list),
// so they have no regional_econ ingest yet and can't join this queue
// without a follow-up ingest run (scripts/ingest-us-acs.ts,
// scripts/ingest-us-dom.ts) adding a representative county for each first.
// Not fabricating a FIPS for them here — an unverified county-value
// baseline would silently corrupt those metros' scoring.
// ---------------------------------------------------------------------------

export const US_METRO_FILL_QUEUE: USDiscoverCityConfig[] = [
  { name: "Los Angeles", state: "CA", slug: "los-angeles", countyFips: "US-06037" },
  { name: "Chicago", state: "IL", slug: "chicago", countyFips: "US-17031" },
  { name: "Houston", state: "TX", slug: "houston", countyFips: "US-48201" },
  { name: "Phoenix", state: "AZ", slug: "phoenix", countyFips: "US-04013" }, // already active
  { name: "San Diego", state: "CA", slug: "san-diego", countyFips: "US-06073" },
  { name: "Miami", state: "FL", slug: "miami", countyFips: "US-12086" }, // already active
  { name: "Dallas", state: "TX", slug: "dallas", countyFips: "US-48113" },
  { name: "New York", state: "NY", slug: "new-york", countyFips: "US-36061" },
  { name: "Seattle", state: "WA", slug: "seattle", countyFips: "US-53033" },
  { name: "Las Vegas", state: "NV", slug: "las-vegas", countyFips: "US-32003" },
  { name: "Detroit", state: "MI", slug: "detroit", countyFips: "US-26163" },
  { name: "San Antonio", state: "TX", slug: "san-antonio", countyFips: "US-48029" },
  { name: "Boston", state: "MA", slug: "boston", countyFips: "US-25025" },
  { name: "Atlanta", state: "GA", slug: "atlanta", countyFips: "US-13121" },
  { name: "Sacramento", state: "CA", slug: "sacramento", countyFips: "US-06067" },
  { name: "Minneapolis", state: "MN", slug: "minneapolis", countyFips: "US-27053" },
  { name: "Austin", state: "TX", slug: "austin", countyFips: "US-48453" }, // already active
  { name: "Salt Lake City", state: "UT", slug: "salt-lake-city", countyFips: "US-49035" },
  { name: "Tampa", state: "FL", slug: "tampa", countyFips: "US-12057" },
  { name: "Pittsburgh", state: "PA", slug: "pittsburgh", countyFips: "US-42003" },
  { name: "Orlando", state: "FL", slug: "orlando", countyFips: "US-12095" },
  { name: "Raleigh", state: "NC", slug: "raleigh", countyFips: "US-37183" },
  { name: "Charlotte", state: "NC", slug: "charlotte", countyFips: "US-37119" },
  { name: "Denver", state: "CO", slug: "denver", countyFips: "US-08031" },
  { name: "Fresno", state: "CA", slug: "fresno", countyFips: "US-06019" },
  { name: "Tucson", state: "AZ", slug: "tucson", countyFips: "US-04019" },
  { name: "Milwaukee", state: "WI", slug: "milwaukee", countyFips: "US-55079" },
  { name: "Portland", state: "OR", slug: "portland", countyFips: "US-41051" },
  { name: "Indianapolis", state: "IN", slug: "indianapolis", countyFips: "US-18097" },
  { name: "Memphis", state: "TN", slug: "memphis", countyFips: "US-47157" },
  { name: "San Francisco", state: "CA", slug: "san-francisco", countyFips: "US-06075" },
  { name: "Nashville", state: "TN", slug: "nashville", countyFips: "US-47037" },
  { name: "Newark", state: "NJ", slug: "newark", countyFips: "US-34013" },
  { name: "Oklahoma City", state: "OK", slug: "oklahoma-city", countyFips: "US-40109" },
  { name: "Louisville", state: "KY", slug: "louisville", countyFips: "US-21111" },
  { name: "Jacksonville", state: "FL", slug: "jacksonville", countyFips: "US-12031" },
  { name: "Charleston", state: "SC", slug: "charleston", countyFips: "US-45019" },
  { name: "Wilmington", state: "DE", slug: "wilmington", countyFips: "US-10003" },
  { name: "Greensboro", state: "NC", slug: "greensboro", countyFips: "US-37081" },
  { name: "Cincinnati", state: "OH", slug: "cincinnati", countyFips: "US-39061" },
  { name: "Cleveland", state: "OH", slug: "cleveland", countyFips: "US-39035" },
  { name: "Omaha", state: "NE", slug: "omaha", countyFips: "US-31055" },
  { name: "Des Moines", state: "IA", slug: "des-moines", countyFips: "US-19153" },
  { name: "Buffalo", state: "NY", slug: "buffalo", countyFips: "US-36029" },
  { name: "Honolulu", state: "HI", slug: "honolulu", countyFips: "US-15003" },
  { name: "Reno", state: "NV", slug: "reno", countyFips: "US-32031" },
  { name: "Providence", state: "RI", slug: "providence", countyFips: "US-44007" },
  { name: "St. Louis", state: "MO", slug: "st-louis", countyFips: "US-29189" },
  { name: "Kansas City", state: "MO", slug: "kansas-city", countyFips: "US-29095" },
  { name: "Wichita", state: "KS", slug: "wichita", countyFips: "US-20173" },
  { name: "Tulsa", state: "OK", slug: "tulsa", countyFips: "US-40143" },
  { name: "Fort Myers", state: "FL", slug: "fort-myers", countyFips: "US-12071" },
  { name: "Albuquerque", state: "NM", slug: "albuquerque", countyFips: "US-35001" },
  { name: "Colorado Springs", state: "CO", slug: "colorado-springs", countyFips: "US-08041" },
  { name: "Spokane", state: "WA", slug: "spokane", countyFips: "US-53063" },
  { name: "Columbia", state: "SC", slug: "columbia-sc", countyFips: "US-45079" },
  { name: "Winston-Salem", state: "NC", slug: "winston-salem", countyFips: "US-37067" },
  { name: "Lancaster", state: "PA", slug: "lancaster", countyFips: "US-42071" },
  { name: "Anchorage", state: "AK", slug: "anchorage", countyFips: "US-02020" },
  { name: "Rockville", state: "MD", slug: "rockville", countyFips: "US-24031" },
  { name: "Fairfax", state: "VA", slug: "fairfax", countyFips: "US-51059" },
];

const ACTIVE_METROS_META_KEY = "us-discover:active-metros";

/**
 * Current active-metro slug list — the growable subset of
 * US_METRO_FILL_QUEUE this deployment actually sweeps. Persisted in KV
 * (survives deploys/cold starts, per Part 4's requirement) via the same
 * getMetaValue/setMetaValue primitives us-discover.ts already uses for
 * last-refresh timestamps. Seeded from US_DISCOVER_CITIES' slugs on first
 * read (no meta key yet) so a fresh deploy's behavior is identical to
 * today's — nothing "activates" until activateNextQueuedMetro() below adds
 * to this list.
 */
async function getActiveMetroSlugs(): Promise<string[]> {
  const raw = await getMetaValue(ACTIVE_METROS_META_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((s) => typeof s === "string")) return parsed;
    } catch {
      // fall through to seed default
    }
  }
  return US_DISCOVER_CITIES.map((c) => c.slug);
}

/** Active metro configs, resolved against the fill queue (falls back to
 * US_DISCOVER_CITIES' own config for the original 3 in case a slug isn't
 * in the queue for some reason — keeps this resilient to the queue and
 * active-list ever drifting out of sync). */
export async function getActiveUSDiscoverCities(): Promise<USDiscoverCityConfig[]> {
  const slugs = await getActiveMetroSlugs();
  const bySlug = new Map(US_METRO_FILL_QUEUE.map((c) => [c.slug, c]));
  const fallback = new Map(US_DISCOVER_CITIES.map((c) => [c.slug, c]));
  return slugs.map((slug) => bySlug.get(slug) ?? fallback.get(slug)).filter((c): c is USDiscoverCityConfig => !!c);
}

/**
 * Activate the next not-yet-active metro from US_METRO_FILL_QUEUE (queue
 * order = population/SEO rank, see the module doc above) and persist it.
 * Pure list bookkeeping — does NOT sweep it; the caller (us-discover.ts's
 * refreshUSDiscover, quota-headroom-gated) is responsible for running the
 * actual RentCast fetch once activation succeeds. Returns null if every
 * queued metro is already active.
 */
export async function activateNextQueuedMetro(): Promise<USDiscoverCityConfig | null> {
  const activeSlugs = await getActiveMetroSlugs();
  const activeSet = new Set(activeSlugs);
  const next = US_METRO_FILL_QUEUE.find((c) => !activeSet.has(c.slug));
  if (!next) return null;
  await setMetaValue(ACTIVE_METROS_META_KEY, JSON.stringify([...activeSlugs, next.slug]));
  return next;
}
