/**
 * US Census Bureau Geocoder client — one-line address → state/county FIPS +
 * lat/lon. Free, no API key. Used to route US addresses to a county for the
 * area-median assessment adapter (Phase 2 step 4).
 *
 * Docs: https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.pdf
 */

const CENSUS_GEOCODER_URL =
  "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress";

const TIMEOUT_MS = 8000;

export interface CensusGeocodeResult {
  stateFips: string;
  countyFips: string;
  stateUsps: string;
  countyName: string;
  lat: number;
  lon: number;
  matchedAddress: string;
}

// Minimal shape of the parts of the Census geocoder response we read.
// The real payload has many more geography layers; we only care about
// States and Counties.
interface CensusGeography {
  STATE?: string;
  STUSAB?: string;
  COUNTY?: string;
  NAME?: string;
}

interface CensusAddressMatch {
  matchedAddress?: string;
  coordinates?: { x: number; y: number };
  geographies?: {
    States?: CensusGeography[];
    Counties?: CensusGeography[];
  };
}

interface CensusGeocoderResponse {
  result?: {
    addressMatches?: CensusAddressMatch[];
  };
}

/**
 * Geocode a one-line US address to state/county FIPS codes + coordinates.
 *
 * - Throws on network failure or a non-200 response (fail loud — a broken
 *   geocoder should surface, not silently degrade the whole US pipeline).
 * - Returns null when the request succeeds but the address has no match
 *   (a normal, expected outcome for bad/incomplete addresses).
 */
export async function geocodeUSAddress(
  oneLine: string
): Promise<CensusGeocodeResult | null> {
  const url = new URL(CENSUS_GEOCODER_URL);
  url.searchParams.set("address", oneLine);
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("vintage", "Current_Current");
  url.searchParams.set("format", "json");

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(
      `Census geocoder request failed: ${res.status} ${res.statusText}`
    );
  }

  const data = (await res.json()) as CensusGeocoderResponse;
  const match = data.result?.addressMatches?.[0];
  if (!match) return null;

  const state = match.geographies?.States?.[0];
  const county = match.geographies?.Counties?.[0];
  if (!state?.STATE || !state?.STUSAB || !county?.COUNTY || !county?.NAME) {
    return null;
  }
  if (!match.coordinates || !match.matchedAddress) return null;

  return {
    stateFips: state.STATE,
    countyFips: county.COUNTY,
    stateUsps: state.STUSAB,
    countyName: county.NAME,
    lat: match.coordinates.y,
    lon: match.coordinates.x,
    matchedAddress: match.matchedAddress,
  };
}
