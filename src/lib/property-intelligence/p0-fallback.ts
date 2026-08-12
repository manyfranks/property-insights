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
  | "property_identity_not_found"
  | "provider_quota_exhausted"
  | "provider_error";

interface UsBundleAvailability {
  record: unknown | null;
  avm: unknown | null;
  activeListing: unknown | null;
  meta: {
    quotaExhausted: boolean;
    errors: readonly string[];
    propertyLookup?: "completed" | "quota_blocked" | "error";
    listingLookup?: "completed" | "quota_blocked" | "error";
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
  if (!bundle) return { kind: "regional_fallback", reason: "provider_error" };

  // A missing listing is evidence of "off market" only when that endpoint
  // actually completed. Without this distinction, a cached property record
  // plus a quota-blocked listing lookup is incorrectly presented as not listed.
  if (bundle.meta.listingLookup === "quota_blocked") {
    return { kind: "regional_fallback", reason: "provider_quota_exhausted" };
  }
  if (bundle.meta.listingLookup === "error") {
    return { kind: "regional_fallback", reason: "provider_error" };
  }
  if (bundle.meta.propertyLookup === "quota_blocked") {
    return { kind: "regional_fallback", reason: "provider_quota_exhausted" };
  }
  if (bundle.meta.propertyLookup === "error") {
    return { kind: "regional_fallback", reason: "provider_error" };
  }

  // Backward-compatible handling for bundles cached/constructed before the
  // per-endpoint lookup outcome was added.
  const hasEndpointOutcomes = !!bundle.meta.propertyLookup || !!bundle.meta.listingLookup;
  if (!hasEndpointOutcomes && bundle.meta.quotaExhausted) {
    return { kind: "regional_fallback", reason: "provider_quota_exhausted" };
  }
  if (!hasEndpointOutcomes && bundle.meta.errors.length > 0) {
    return { kind: "regional_fallback", reason: "provider_error" };
  }

  // Only an identity-bearing property record can establish that an address
  // is a specific off-market property. Address-level AVM/rent responses may
  // refer to a unit, building, or parcel and are unsafe without that identity.
  if (bundle.record) return { kind: "off_market" };
  if (bundle.avm) {
    return { kind: "regional_fallback", reason: "property_identity_not_found" };
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

/**
 * Explain evidence availability without turning an operational failure into
 * a property claim. In particular, quota exhaustion means RentCast was not
 * checked for this address; it must never read as "not listed."
 */
export function usPropertyDataUnavailableMessage(
  reason: UsPropertyDataUnavailableReason,
  hasPropertySpecificCountyValue: boolean
): { title: string; detail: string } {
  const fallback = hasPropertySpecificCountyValue
    ? "The result below uses property-specific county assessor data only."
    : "The result below uses county-level context only.";

  if (reason === "provider_quota_exhausted") {
    return {
      title: "Property and listing lookup was not run",
      detail: `This month's RentCast request allowance has been reached, so RentCast was not checked for this address. ${fallback}`,
    };
  }
  if (reason === "provider_error") {
    return {
      title: "Property and listing lookup is temporarily unavailable",
      detail: `RentCast could not complete this lookup, so we could not confirm whether an active listing exists. ${fallback}`,
    };
  }
  if (reason === "property_identity_not_found") {
    return {
      title: "Property identity could not be confirmed",
      detail: `RentCast returned modeled values without a matching property record, so those values were withheld because they may describe a unit, building, or parcel. ${fallback}`,
    };
  }
  return {
    title: "No matching property record or active listing was returned",
    detail: `RentCast completed the lookup but did not return usable property or active-listing evidence for this address. ${fallback}`,
  };
}
