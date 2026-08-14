import type { PropertyCapabilities } from "./capabilities";
import type { PropertyClassification } from "./classification";
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

export function assessmentJourneyHref(
  address: string,
  goal: AssessmentGoal
): string {
  const params = new URLSearchParams({ address, journeys: "1", assessmentGoal: goal });
  return `/assess?${params.toString()}`;
}

/**
 * A subject scope may only be restored as an explicit confirmation when it
 * came from the authenticated assessment-state PATCH contract. URL values
 * and provider/listing matches are useful evidence, but they are not proof
 * that the user selected a particular unit, building, parcel, or listing.
 */
export function persistedConfirmedSubjectScope(
  state: Pick<AssessmentSubject, "scope" | "selectedBy"> | null | undefined
): SubjectScope | null {
  return state?.selectedBy === "user_confirmation" ? state.scope : null;
}

export function parseAssessmentGoal(value: unknown): AssessmentGoal | null {
  return typeof value === "string" && ASSESSMENT_GOALS.includes(value as AssessmentGoal)
    ? value as AssessmentGoal
    : null;
}

/**
 * A goal already present in the journey URL came from an explicit handoff
 * selection. Asking the same question again is redundant; only journey entry
 * without a goal needs the preflight chooser.
 */
export function shouldStartAssessmentImmediately(args: {
  journeyEnabled: boolean;
  initialGoal: AssessmentGoal | null;
  hasRestoredAssessment: boolean;
}): boolean {
  return !args.journeyEnabled || !!args.initialGoal || args.hasRestoredAssessment;
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

function legacyCaRentalJourneyStatus(hasCmhcRent: boolean): JourneyCapabilityStatus {
  return {
    availability: "limited",
    message: hasCmhcRent
      ? "Regional CMHC rent context and a user-entered rent scenario support a limited screen; neither is an address-level expected rent."
      : "No reliable rent estimate is available for this address or city; enter your own monthly-rent scenario to screen it against the listing price.",
  };
}

/**
 * Canada does not (yet) return an address-level rent estimate, so the
 * rental_investment goal on /property/[slug] has historically shown a
 * hardcoded "limited" status keyed only on whether CMHC regional rent
 * context exists for the city. That ignores the parcel-use/classification
 * exclusions capabilities.ts already computes (vacant land, commercial,
 * institutional, and non-unit mixed-use are excluded from residential
 * modules — see capabilities.ts's residentialExclusion()), so an excluded
 * listing would still render the interactive rent-scenario calculator.
 *
 * This derives the correct status from the already-computed capability
 * decision (never re-derives the exclusion itself — it only reads the
 * CapabilityReason enum capabilities.ts already assigned) and, when a
 * PropertyClassification is available beside it, picks class-appropriate
 * copy. Classification is used for copy only, never to decide availability
 * — that decision stays owned by capabilities.ts's reason enums so this
 * function cannot drift from the exclusion logic it is fronting.
 */
export function deriveCaRentalJourneyStatus(
  capabilities: PropertyCapabilities | null | undefined,
  classification: PropertyClassification | null | undefined,
  opts: { hasCmhcRent: boolean; hasRegionalContext: boolean }
): JourneyCapabilityStatus {
  if (!capabilities) return legacyCaRentalJourneyStatus(opts.hasCmhcRent);

  const rentReason = capabilities.items.addressRentEstimate.reason;
  const yieldReason = capabilities.items.grossYieldScreen.reason;

  // Subject-level conflicts (ambiguous unit vs. building, disagreeing
  // provider records) take precedence — the same priority
  // unavailableAddressCapability() applies in capabilities.ts. In practice
  // AssessmentJourneyPanel's hasSubjectEvidenceGap() usually already forces
  // "unavailable" for these via addressSaleValuation/offerAnalysis, but
  // addressRentEstimate/grossYieldScreen can conflict independently (e.g. a
  // unit-scoped unitUse conflict beside a clean parcelUse), so this stays
  // defensive rather than assuming the outer gap check always catches it.
  if (rentReason === "conflicting_evidence" || yieldReason === "conflicting_evidence") {
    return {
      availability: "unavailable",
      message: "The property-use evidence for this subject conflicts, so a residential rental screen is withheld until the assessment subject is resolved.",
    };
  }

  if (rentReason === "provider_exclusion" || yieldReason === "provider_exclusion") {
    const parcelUse = classification?.parcelUse.value;
    const unitUse = classification?.unitUse.value;
    if (parcelUse === "land") {
      return {
        availability: "unavailable",
        message: "Residential rental analysis doesn't apply to vacant land. Verified land, assessment, and listing context for this parcel remains visible elsewhere on this page.",
      };
    }
    if (classification?.listingScope.value === "parcel") {
      return {
        availability: "unavailable",
        message: "Residential rental analysis doesn't apply to a verified land listing. Available land, assessment, and listing context remains visible elsewhere on this page.",
      };
    }
    if (parcelUse === "institutional") {
      return {
        availability: "unavailable",
        message: "This is a restricted/institutional property. Residential rent estimates, yield screens, and financial-partner tools do not apply here.",
      };
    }
    if (parcelUse === "commercial" || unitUse === "commercial") {
      return {
        availability: "unavailable",
        message: "Commercial underwriting isn't supported yet, so no residential rent estimate or yield screen is shown for this property.",
      };
    }
    if (parcelUse === "mixed-use") {
      return {
        availability: "unavailable",
        message: "This property spans mixed residential and commercial use. Confirm the specific unit or scope you are evaluating before a residential rental screen can apply.",
      };
    }
    // The exclusion is confirmed by capabilities.ts but this function was
    // not given (or could not read) a matching classification value to
    // name the excluded use — fall back to an accurate, class-agnostic
    // explanation rather than guessing which exclusion applied.
    return {
      availability: "unavailable",
      message: "This property's classified use is outside the verified residential scope, so a residential rental screen does not apply here.",
    };
  }

  if (rentReason === "unsupported_scope" || yieldReason === "unsupported_scope") {
    return {
      availability: "unavailable",
      message: "This listing describes an entire multi-unit or mixed-use building rather than a single residential unit, so a residential rental screen cannot be safely applied without a clarified scope.",
    };
  }

  const knownUse = classification
    ? (classification.unitUse.value !== "unknown" ? classification.unitUse.value : classification.parcelUse.value)
    : null;
  if (classification && knownUse === "unknown") {
    return {
      availability: "limited",
      message: "This property's use could not be verified from the available evidence, so provider-derived rent and yield estimates are withheld. The scenario below uses only the rent you enter; it is not a use-verified property estimate.",
    };
  }

  return legacyCaRentalJourneyStatus(opts.hasCmhcRent);
}
