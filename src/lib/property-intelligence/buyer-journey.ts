import type { CapabilityReason, PropertyCapabilities } from "./capabilities";
import type { PropertyClassification } from "./classification";
import { hasSubjectEvidenceGap } from "./journey";
import type { AssessmentSubject } from "./subject";

export type BuyerCompositionAvailability = "supported" | "limited" | "unavailable";

export interface BuyerCompositionNotice {
  kind: "scope_context" | "withheld" | "limited";
  title: string;
  detail: string;
}

export interface BuyerCompositionModel {
  contract: "capability" | "legacy";
  availability: BuyerCompositionAvailability;
  showOfferAnalysis: boolean;
  showValuationContext: boolean;
  showAcquisitionAnalysis: boolean;
  showPartnerActions: boolean;
  showInsurancePrefill: boolean;
  showRegionalContext: boolean;
  propertyEvidenceDenied: boolean;
  denialReason: CapabilityReason | null;
  notice: BuyerCompositionNotice | null;
}

const HARD_DENIALS: CapabilityReason[] = [
  "provider_exclusion",
  "unsupported_scope",
  "conflicting_evidence",
];

function hardDenial(...reasons: CapabilityReason[]): CapabilityReason | null {
  return reasons.find((reason) => HARD_DENIALS.includes(reason)) ?? null;
}

function mixedUseUnitNotice(
  subject: AssessmentSubject,
  classification: PropertyClassification
): BuyerCompositionNotice | null {
  const residentialUnit =
    (subject.scope === "unit" || !!subject.unit) &&
    classification.unitUse.value === "residential";
  const mixedUseContainer =
    classification.parcelUse.value === "mixed-use" ||
    classification.buildingForm.value === "mixed-use";

  if (!residentialUnit || !mixedUseContainer) return null;
  return {
    kind: "scope_context",
    title: "Residential unit scope confirmed",
    detail:
      "This analysis applies to the residential unit. Mixed-use evidence describes the containing building or parcel and is not substituted for the unit's value, offer, or insurance facts.",
  };
}

function deniedNotice(
  reason: CapabilityReason,
  capabilities: PropertyCapabilities
): BuyerCompositionNotice {
  const offerExplanation = capabilities.items.offerAnalysis.explanation;
  const valueExplanation = capabilities.items.addressSaleValuation.explanation;
  return {
    kind: "withheld",
    title: "Residential buyer analysis withheld",
    detail:
      reason === "provider_exclusion"
        ? "This subject is outside the verified residential scope. Listing facts and supported regional context may remain, but residential offer, motivation, partner, and insurance actions are withheld."
        : reason === "unsupported_scope"
          ? "The available property evidence does not match the resolved unit, building, or parcel scope. Residential buyer modules are withheld rather than combining different assets."
          : offerExplanation || valueExplanation ||
            "The subject evidence conflicts, so residential buyer modules are withheld until the subject is resolved.",
  };
}

/**
 * Pure P6A composition decision. It consumes only the already-computed P2/P3
 * contracts and never fetches, mutates the user's goal, or reads occupancy.
 *
 * Persisted Discover records without a capability envelope keep the existing
 * buyer composition through the explicit `legacy` contract. They do not gain
 * capability-driven persona routing until their ingestion surface has a
 * universal enrichment contract.
 */
export function buildBuyerCompositionModel(args: {
  subject?: AssessmentSubject | null;
  classification?: PropertyClassification | null;
  capabilities?: PropertyCapabilities | null;
}): BuyerCompositionModel {
  const { subject, classification, capabilities } = args;
  if (!subject || !classification || !capabilities) {
    return {
      contract: "legacy",
      availability: "supported",
      showOfferAnalysis: true,
      showValuationContext: true,
      showAcquisitionAnalysis: true,
      showPartnerActions: true,
      showInsurancePrefill: true,
      showRegionalContext: true,
      propertyEvidenceDenied: false,
      denialReason: null,
      notice: null,
    };
  }

  const items = capabilities.items;
  const subjectConflict =
    subject.requiresClarification ||
    subject.conflicts.length > 0 ||
    hasSubjectEvidenceGap(subject.scope, capabilities);
  const denialReason = subjectConflict
    ? "conflicting_evidence"
    : hardDenial(items.offerAnalysis.reason, items.addressSaleValuation.reason);
  const showOfferAnalysis = !subjectConflict && items.offerAnalysis.available;
  const showValuationContext =
    !subjectConflict && (items.addressSaleValuation.available || showOfferAnalysis);
  const propertyEvidenceDenied =
    !showOfferAnalysis && !showValuationContext && denialReason !== null;
  const showRegionalContext = items.countyMarketRiskContext.available;
  const availability: BuyerCompositionAvailability =
    showOfferAnalysis || showValuationContext
      ? "supported"
      : showRegionalContext
        ? "limited"
        : "unavailable";
  const notice = propertyEvidenceDenied && denialReason
    ? deniedNotice(denialReason, capabilities)
    : mixedUseUnitNotice(subject, classification) ?? (
      availability !== "supported"
        ? {
            kind: "limited" as const,
            title: "Property-specific buyer analysis is limited",
            detail:
              "The current evidence supports regional context only. No residential offer, property valuation, motivation conclusion, or property-oriented action is inferred.",
          }
        : null
    );

  return {
    contract: "capability",
    availability,
    showOfferAnalysis,
    showValuationContext,
    showAcquisitionAnalysis: showOfferAnalysis,
    showPartnerActions: !propertyEvidenceDenied && (showOfferAnalysis || showValuationContext),
    showInsurancePrefill: !subjectConflict && items.insurancePrefill.available,
    showRegionalContext,
    propertyEvidenceDenied,
    denialReason,
    notice,
  };
}
