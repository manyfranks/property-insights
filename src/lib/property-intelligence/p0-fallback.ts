/**
 * P0 property-intelligence contracts for the existing US assessment paths.
 *
 * This module is deliberately pure: it does not fetch, cache, persist, or
 * resolve property entities. It only describes which of the three already-
 * shipped US result paths an already-fetched RentCast bundle can support.
 * Subject resolution and property classification belong to later phases.
 */

export type UsPropertyDataUnavailableReason =
  | "property_record_not_found"
  | "provider_quota_exhausted"
  | "provider_error";

interface UsBundleAvailability {
  record: unknown | null;
  avm: unknown | null;
  activeListing: unknown | null;
  meta: {
    quotaExhausted: boolean;
    errors: readonly string[];
  };
}

export type UsAssessmentDataPathDecision =
  | { kind: "listed" }
  | { kind: "off_market" }
  | { kind: "regional_fallback"; reason: UsPropertyDataUnavailableReason };

/**
 * Decide from evidence the caller has already fetched. This function must
 * remain provider-call-free: an unresolved/empty bundle degrades to the
 * county context path rather than trying another RentCast endpoint.
 *
 * A rent-only bundle still takes the regional fallback path, matching the
 * pre-P0 behavior: rent alone cannot support a property valuation or offer.
 */
export function decideUsAssessmentDataPath(
  bundle: UsBundleAvailability | null
): UsAssessmentDataPathDecision {
  if (bundle?.activeListing) return { kind: "listed" };
  if (bundle?.record || bundle?.avm) return { kind: "off_market" };

  if (!bundle) return { kind: "regional_fallback", reason: "provider_error" };
  if (bundle.meta.quotaExhausted) {
    return { kind: "regional_fallback", reason: "provider_quota_exhausted" };
  }
  if (bundle.meta.errors.length > 0) {
    return { kind: "regional_fallback", reason: "provider_error" };
  }
  return { kind: "regional_fallback", reason: "property_record_not_found" };
}

// Exact existing fallback UI language, centralized so the P0 fixture harness
// can prevent a later refactor from silently turning a county statistic into
// a property-level claim.
export const US_COUNTY_FALLBACK_LABEL = "County Median Home Value — Modeled Estimate";

export function usCountyFallbackDisclosure(assessmentYear: string): string {
  return `Based on US Census ACS county-level median (${assessmentYear}), not property-specific. Treat as approximate.`;
}
