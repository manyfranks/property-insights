/**
 * pipeline/fetcher.ts
 *
 * Two-call fetch strategy for the pipeline using Zoocasa.
 *
 * WHY TWO CALLS?
 *   A single search misses one important motivated-seller category:
 *   properties priced conspicuously below their neighbors (financial pressure,
 *   estate situations, quick sale pricing). These often list at market and get
 *   relisted, so they appear fresh on DOM but cheap on price.
 *
 *   Call 1 — Default sort:  catches relevant/featured listings
 *   Call 2 — Oldest first:  catches stale listings (genuine DOM pressure)
 *
 *   Combined, deduplicated by MLS number, gives 20-40 candidates.
 *   The scorer then ranks by language — not by which call found them.
 */

import { Listing } from "../types";
import { FilterProfile } from "./exclusions";
import { fetchCandidates as zoocasaFetchCandidates } from "../zoocasa";

// Re-export the FetchResult type for pipeline compatibility
export interface FetchResult {
  listings: Listing[];
  internalDuplicates: number;
  /** Kept for pipeline stats compatibility */
  staleMlsNumbers: string[];
  cheapMlsNumbers: string[];
}

/**
 * Fetch candidates for a city using Zoocasa search.
 * Returns deduplicated listings across both calls.
 */
export async function fetchCandidates(
  city: string,
  province: string,
  _bounds: unknown,
  profile: FilterProfile
): Promise<FetchResult> {
  const result = await zoocasaFetchCandidates(city, province, {
    minPrice: profile.priceMin ?? undefined,
    maxPrice: profile.priceMax ?? undefined,
    minBeds: profile.minBeds ?? undefined,
    type: profile.buildingTypes.includes("1") ? "house" : undefined,
  });

  const mlsNumbers = result.listings
    .map((l) => l.mlsNumber)
    .filter(Boolean) as string[];

  return {
    listings: result.listings,
    internalDuplicates: result.internalDuplicates,
    staleMlsNumbers: mlsNumbers,
    cheapMlsNumbers: [],
  };
}
