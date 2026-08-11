import type { PropertyCapabilities } from "./capabilities";
import type { AssessmentSubject, SubjectCandidate, SubjectScope } from "./subject";

export const ASSESSMENT_GOALS = [
  "buy_home",
  "rental_investment",
  "own_manage",
  "explore",
] as const;

export type AssessmentGoal = (typeof ASSESSMENT_GOALS)[number];

export const JOURNEY_EVENT_TYPES = [
  "assessment_subject_clarification_shown",
  "assessment_subject_selected",
  "journey_selected",
  "journey_result_viewed",
  "journey_switched",
] as const;

export type JourneyEventType = (typeof JOURNEY_EVENT_TYPES)[number];

export const ASSESSMENT_SUBJECT_CHOICES = [
  "specific_unit",
  "whole_property",
  "listing",
  "explore_address",
] as const;

export type AssessmentSubjectChoice = (typeof ASSESSMENT_SUBJECT_CHOICES)[number];

export type JourneyAvailability = "supported" | "limited" | "unavailable";

export interface JourneyCapabilityStatus {
  availability: JourneyAvailability;
  message: string;
}

export function parseAssessmentGoal(value: unknown): AssessmentGoal | null {
  return typeof value === "string" && ASSESSMENT_GOALS.includes(value as AssessmentGoal)
    ? value as AssessmentGoal
    : null;
}

export function parseSubjectScope(value: unknown): SubjectScope | null {
  return typeof value === "string" && ["unit", "building", "parcel", "listing", "unknown"].includes(value)
    ? value as SubjectScope
    : null;
}

function normalizeConfirmedUnit(value: string | null | undefined): string | null {
  const normalized = value
    ?.trim()
    .replace(/^(?:#|unit|suite|ste|apt|apartment)\s*/i, "")
    .replace(/[^a-z0-9-]/gi, "")
    .toUpperCase()
    .slice(0, 32);
  return normalized || null;
}

function requestedCandidate(subject: AssessmentSubject): SubjectCandidate | undefined {
  return subject.candidates.find((candidate) => candidate.relation === "requested");
}

function listingCandidate(subject: AssessmentSubject): SubjectCandidate | undefined {
  return subject.candidates.find(
    (candidate) => candidate.scope === "listing" && candidate.relation === "subject"
  );
}

function wholePropertyScope(subject: AssessmentSubject): "building" | "parcel" {
  const subjectCandidates = subject.candidates.filter((candidate) => candidate.relation === "subject");
  if (subjectCandidates.some((candidate) => candidate.scope === "building")) return "building";
  if (subjectCandidates.some((candidate) => candidate.scope === "parcel")) return "parcel";
  return "building";
}

/**
 * Applies an explicit per-assessment subject choice without fetching data.
 * A unit choice requires its identifier; a building address can never become
 * an arbitrary unit merely because the user selected the unit journey.
 */
export function confirmAssessmentSubject(
  subject: AssessmentSubject,
  choice: AssessmentSubjectChoice,
  unitInput?: string | null
): AssessmentSubject {
  const requested = requestedCandidate(subject);
  const listing = listingCandidate(subject);
  const confirmedUnit = normalizeConfirmedUnit(unitInput) ?? subject.unit;

  if (choice === "specific_unit" && !confirmedUnit) {
    throw new Error("A unit identifier is required to confirm unit scope.");
  }

  const scope: SubjectScope = choice === "specific_unit"
    ? "unit"
    : choice === "whole_property"
      ? wholePropertyScope(subject)
      : choice === "listing"
        ? "listing"
        : "unknown";
  const selectedCandidate = choice === "listing" ? listing : requested;

  return {
    ...subject,
    scope,
    canonicalAddress: selectedCandidate?.canonicalAddress ?? subject.canonicalAddress,
    unit: scope === "unit" ? confirmedUnit : scope === "listing" ? listing?.unit ?? subject.unit : null,
    selectedBy: "user_confirmation",
    resolutionConfidence: "high",
    requiresClarification: false,
    clarificationReason: undefined,
  };
}

/**
 * Describes whether the already-fetched evidence can support the selected
 * view. It never changes the goal and deliberately ignores occupancy.
 */
export function journeyCapabilityStatus(
  goal: AssessmentGoal,
  capabilities: PropertyCapabilities | null | undefined
): JourneyCapabilityStatus {
  if (goal === "explore") {
    return {
      availability: "supported",
      message: "All currently supported evidence stays visible, with unavailable modules labeled rather than guessed.",
    };
  }
  if (!capabilities) {
    return {
      availability: "limited",
      message: "This saved result predates capability tracking, so the current report remains unchanged.",
    };
  }

  const items = capabilities.items;
  if (goal === "buy_home") {
    if (items.offerAnalysis.available || items.addressSaleValuation.available) {
      return {
        availability: "supported",
        message: "The existing valuation and offer evidence supports a home-buying view.",
      };
    }
    return {
      availability: "unavailable",
      message: "A property-specific valuation or active-listing offer is not available for this subject.",
    };
  }

  if (goal === "rental_investment") {
    if (items.grossYieldScreen.available && items.addressRentEstimate.available) {
      return {
        availability: "supported",
        message: "Property-specific rent and sale evidence can support a rental screen.",
      };
    }
    if (items.regionalRentBenchmark.available) {
      return {
        availability: "limited",
        message: "Only regional rent context is available; it cannot be presented as expected rent for this property.",
      };
    }
    return {
      availability: "unavailable",
      message: "The current evidence cannot support a rental estimate or gross-yield screen for this subject.",
    };
  }

  if (items.addressSaleValuation.available || items.addressRentEstimate.available) {
    return {
      availability: "supported",
      message: "Property-specific value or rent evidence can support an owner/manager view.",
    };
  }
  if (items.regionalRentBenchmark.available || items.countyMarketRiskContext.available) {
    return {
      availability: "limited",
      message: "Only regional context is available; property-level owner claims remain withheld.",
    };
  }
  return {
    availability: "unavailable",
    message: "The current evidence does not support a property-specific owner/manager view.",
  };
}

export function hasSubjectEvidenceGap(
  subjectScope: SubjectScope,
  capabilities: PropertyCapabilities | null | undefined
): boolean {
  if (!capabilities) return false;
  return capabilities.subjectScope !== subjectScope ||
    capabilities.items.addressSaleValuation.reason === "conflicting_evidence" ||
    capabilities.items.offerAnalysis.reason === "conflicting_evidence";
}
