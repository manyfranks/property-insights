import type { Assessment } from "../types";
import type { PropertyCapabilities } from "./capabilities";
import type { PropertyClassification } from "./classification";

export interface LandPriceContext {
  kind: "assessed" | "listing_only";
  listPrice: number;
  assessedValue: number | null;
  landValue: number | null;
  improvementValue: number | null;
  assessmentYear: string | null;
  listToAssessedRatio: number | null;
}

/**
 * A deterministic parcel-scoped listing is produced only when the listing's
 * own high-confidence type evidence explicitly says Land. This identifies the
 * resolved listing subject without promoting listing evidence into assessor-
 * scoped parcelUse.
 */
export function isVerifiedLandListing(
  classification: PropertyClassification | null | undefined
): boolean {
  return classification?.parcelUse.value === "land" || (
    classification?.listingScope.value === "parcel" &&
    classification.listingScope.state === "deterministic" &&
    classification.listingScope.confidence === "high"
  );
}

export function residentialPartnerActionsAllowed(
  capabilities: PropertyCapabilities | null | undefined,
  classification?: PropertyClassification | null
): boolean {
  // Persisted Discover records can carry a pre-fix capability envelope. A
  // current deterministic Land listing must never regain residential CTAs
  // merely because that cached envelope has not been refreshed yet.
  if (isVerifiedLandListing(classification)) return false;
  if (!capabilities) return true;
  return !["provider_exclusion", "unsupported_scope", "conflicting_evidence"].includes(
    capabilities.items.insurancePrefill.reason
  );
}

/**
 * Reconciles pre-fix persisted capability envelopes at read time. This does
 * not manufacture parcel-use evidence or any positive capability; it only
 * applies the current deterministic listing-scope exclusion to residential
 * decisions until the record is naturally refreshed by the assess pipeline.
 */
export function containVerifiedLandListingCapabilities(
  capabilities: PropertyCapabilities | null | undefined,
  classification: PropertyClassification | null | undefined
): PropertyCapabilities | null | undefined {
  if (!capabilities || !isVerifiedLandListing(classification)) return capabilities;

  const evidence = classification?.listingScope.evidence.map((item) =>
    `${item.source}:${item.scope}${item.sourceRecordId ? `:${item.sourceRecordId}` : ""}`
  ) ?? [];
  const excluded = (explanation: string) => ({
    available: false as const,
    reason: "provider_exclusion" as const,
    evidence,
    explanation,
  });

  return {
    ...capabilities,
    items: {
      ...capabilities.items,
      addressSaleValuation: excluded("Address sale valuation is outside the verified residential scope for this land listing."),
      addressRentEstimate: excluded("Address rent estimation is outside the verified residential scope for this land listing."),
      offerAnalysis: excluded("The residential offer model does not support this verified land listing."),
      grossYieldScreen: excluded("Residential gross-yield screening does not support this verified land listing."),
      insurancePrefill: excluded("Residential insurance prefill does not support this verified land listing."),
    },
  };
}

export function buildLandPriceContext(args: {
  listPrice: number;
  assessment: Assessment | null | undefined;
  classification: PropertyClassification | null | undefined;
}): LandPriceContext | null {
  if (!isVerifiedLandListing(args.classification)) return null;

  const assessment = args.assessment;
  const observedAssessment = !!assessment?.found &&
    (assessment.source === "government" || assessment.source === "cache") &&
    assessment.totalValue > 0;

  if (!observedAssessment || !assessment) {
    return {
      kind: "listing_only",
      listPrice: args.listPrice,
      assessedValue: null,
      landValue: null,
      improvementValue: null,
      assessmentYear: null,
      listToAssessedRatio: null,
    };
  }

  return {
    kind: "assessed",
    listPrice: args.listPrice,
    assessedValue: assessment.totalValue,
    landValue: assessment.componentAvailability === "available" ? assessment.landValue : null,
    improvementValue: assessment.componentAvailability === "available" ? assessment.buildingValue : null,
    assessmentYear: assessment.assessmentYear,
    listToAssessedRatio: args.listPrice / assessment.totalValue,
  };
}
