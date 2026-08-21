/**
 * lib/insurance/coverage-hazards.ts
 *
 * Server-only helper that resolves the coverage-profile wizard's
 * property.hazards block (src/lib/db/coverage-profiles.ts's
 * CoverageProfileProperty) from real FEMA National Risk Index data instead
 * of the hardcoded {flood:null,wildfire:null,wind:null} the wizard used to
 * submit unconditionally.
 *
 * Reuses two existing pieces rather than inventing new plumbing:
 *   - src/lib/geo/census-geocoder.ts's geocodeUSAddress — the same
 *     KV-cached (90d) address -> state/county FIPS resolver
 *     src/lib/assessment/us.ts's lookupUS already uses for the area-median
 *     assessment fallback.
 *   - src/lib/db/regional-econ.ts's getCountyMarketPanel — already reads
 *     every fema_<hazard>_score row for a county (femaHazardScores) for
 *     src/lib/pipeline/us-enrich.ts's US Advantage bundle.
 *
 * Semantics (P5 exit gate, docs/plans/24-P5-OPERATING-SCENARIO-SPRINT.md:
 * "No output labels a user assumption or regional benchmark as a property
 * fact"):
 *   - These are COUNTY-level aggregates, never a fact about the specific
 *     parcel. Every non-null result is returned with source:"modeled" —
 *     CoverageProfileProperty's existing discriminator for "an estimate,
 *     not our own listing/assessment data" (see its doc comment, which
 *     already names "regional-econ fallback" as a modeled case, and
 *     src/lib/insurance/application/cases.ts's fieldAnswers, which already
 *     maps source:"modeled" to a MODEL_HINT evidence origin rather than
 *     ASSESSMENT). "known" is reserved for property-specific facts and is
 *     never used here.
 *   - Missing data stays null. A county with no FEMA score is unknown risk,
 *     not zero/safe.
 *   - US-only: FEMA NRI has no Canadian equivalent. A non-US country
 *     short-circuits to all-null with NO geocode or DB query attempted —
 *     "not assessed," never "assessed as safe."
 *
 * Fails soft everywhere (geocode miss, DB unavailable, unexpected error):
 * resolves to all-null hazards, never throws. A broken hazard lookup must
 * never block coverage-profile intake.
 */

import type { Country } from "@/config/affiliate-vendors";
import { geocodeUSAddress } from "@/lib/geo/census-geocoder";
import { getCountyMarketPanel } from "@/lib/db/regional-econ";
import type { CoverageFieldSource } from "@/lib/db/coverage-profiles";

export interface CoverageHazardBlock {
  flood: number | null;
  wildfire: number | null;
  wind: number | null;
  source: CoverageFieldSource;
}

const NULL_HAZARDS: CoverageHazardBlock = { flood: null, wildfire: null, wind: null, source: "modeled" };

/**
 * FEMA NRI per-hazard scores are 0-100 national percentiles where higher =
 * more exposed (see src/lib/pipeline/us-advantage.ts's
 * SIGNIFICANT_PERIL_SCORE comment) — so "combine two perils into one
 * number" means take the more severe of whichever are actually present,
 * not an average (which would understate risk when one peril dominates)
 * and not a sum (which isn't on the percentile scale at all). Returns null
 * only when every input is null/absent.
 */
function worstOf(...values: Array<number | null | undefined>): number | null {
  const present = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return present.length > 0 ? Math.max(...present) : null;
}

/**
 * Resolves county-level FEMA hazard scores for a US address. Non-US input
 * (or any resolution failure) returns all-null — see module doc comment.
 *
 * `city` is optional and improves geocode accuracy when available (mirrors
 * lookupUS's address+city+state one-line construction in
 * src/lib/assessment/us.ts) — the wizard's own address param is
 * street-only, so a matched listing's city (when one exists) is worth
 * passing through.
 */
export async function getCoverageHazards(opts: {
  country: Country;
  address: string;
  city?: string | null;
  region: string;
}): Promise<CoverageHazardBlock> {
  if (opts.country !== "US") {
    // No FEMA NRI equivalent for CA — never geocode or query for a
    // non-US address; null here means "not assessed," not "assessed as
    // low-risk."
    return NULL_HAZARDS;
  }

  try {
    const oneLine = [opts.address, opts.city, opts.region].filter(Boolean).join(", ");
    const geo = await geocodeUSAddress(oneLine);
    if (!geo) return NULL_HAZARDS;

    const fips = `US-${geo.stateFips}${geo.countyFips}`;
    const panel = await getCountyMarketPanel(fips);
    if (!panel) return NULL_HAZARDS;

    const scores = panel.femaHazardScores;

    // Riverine (fema_ifld_score, ~universal coverage) + coastal
    // (fema_cfld_score, sparse BY DESIGN — coastal counties only). A
    // missing coastal score means "this county isn't coastal" (there's
    // nothing to add), not "coastal risk unknown" — so it's simply
    // excluded from worstOf rather than forcing the combined value to
    // null whenever a property isn't on the coast.
    const flood = worstOf(scores.ifld, scores.cfld);

    // 1:1 with fema_wfir_score.
    const wildfire = worstOf(scores.wfir);

    // "Wind" combines the three FEMA tracks separately as distinct
    // perils — strong wind (swnd), tornado (trnd), hurricane (hrcn) — by
    // taking whichever reads highest. A county with severe hurricane
    // exposure but unremarkable tornado/strong-wind numbers should still
    // read as high wind risk, so picking just one metric (or averaging,
    // which would dilute the dominant peril) would misrepresent it.
    const wind = worstOf(scores.swnd, scores.trnd, scores.hrcn);

    return { flood, wildfire, wind, source: "modeled" };
  } catch (err) {
    console.error("[coverage-hazards] lookup failed unexpectedly:", err instanceof Error ? err.message : err);
    return NULL_HAZARDS;
  }
}
