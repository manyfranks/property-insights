import { Assessment } from "../types";
import { geocodeUSAddress } from "../geo/census-geocoder";
import { getAcsCountyMedian } from "../db/regional-econ";

/**
 * All 50 US state USPS codes + DC — matches src/app/api/assess/route.ts's
 * REGION_MAP values for country==="US". Used as the index.ts dispatch
 * discriminator instead of a bare "2 uppercase letters" check, because
 * Canadian province codes stored on Listing.province (BC, ON, AB, QC, MB,
 * SK, NS, NB, PE, NL) are *also* uppercase 2-letter — a plain regex would
 * misroute them. None of these US codes collide with a Canadian one.
 */
export const US_STATE_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
  "DC",
]);

export function isUSState(code: string): boolean {
  return US_STATE_CODES.has(code.toUpperCase());
}

/**
 * US assessment adapter — there is no per-property government assessment
 * cache yet (all 50 states, no scraper), so this always resolves to a
 * county-level ACS median home value, mirroring how the Canadian StatCan
 * area-median fallback works (see index.ts's areaMedianFallback / bc.ts's
 * area-median semantics): landValue/buildingValue are 0 (no breakdown at
 * county granularity), source is "area_median", found is true only when a
 * real number came back.
 *
 * Geocoding failures (bad/incomplete address, network hiccup) resolve to
 * null rather than throwing — callers fall back the same way a failed
 * province adapter lookup does.
 */
export async function lookupUS(
  address: string,
  city?: string,
  state?: string
): Promise<Assessment | null> {
  const oneLine = [address, city, state].filter(Boolean).join(", ");

  let geo;
  try {
    geo = await geocodeUSAddress(oneLine);
  } catch {
    return null;
  }
  if (!geo) return null;

  const fips = `US-${geo.stateFips}${geo.countyFips}`;
  const median = await getAcsCountyMedian(fips);
  if (!median) return null;

  return {
    totalValue: median.value,
    landValue: 0,
    buildingValue: 0,
    assessmentYear: String(median.year),
    found: true,
    source: "area_median",
    evidenceClass: "modeled",
    assessmentBasis: "market_value",
  };
}

/**
 * No local/cache-only US assessment data exists yet — always null.
 * Kept for symmetry with the other adapters' lookupSync shape.
 */
export function lookupUSSync(): Assessment | null {
  return null;
}
