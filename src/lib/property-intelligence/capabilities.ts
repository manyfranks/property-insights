import type { PropertyClassification } from "./classification";
import type { AssessmentSubject } from "./subject";

export type CapabilityName =
  | "addressSaleValuation"
  | "addressRentEstimate"
  | "regionalRentBenchmark"
  | "offerAnalysis"
  | "grossYieldScreen"
  | "landImprovementAnalysis"
  | "countyMarketRiskContext"
  | "wholeBuildingCommercialAnalysis"
  | "insurancePrefill";

export type CapabilityReason =
  | "available"
  | "missing_field"
  | "unsupported_scope"
  | "provider_exclusion"
  | "regional_proxy_only"
  | "conflicting_evidence";

export type CapabilityScope = "unit" | "building" | "parcel" | "regional" | "unknown";

export interface CapabilityEvidenceFact {
  available: boolean;
  scope: CapabilityScope;
  source?: string;
}

export interface CapabilityDecision {
  available: boolean;
  reason: CapabilityReason;
  evidence: string[];
  explanation: string;
}

export interface PropertyCapabilities {
  schemaVersion: 1;
  shadowMode: true;
  subjectScope: AssessmentSubject["scope"];
  items: Record<CapabilityName, CapabilityDecision>;
}

/**
 * Facts are deliberately already-fetched booleans/scopes. Capability
 * evaluation stays pure and can never trigger a provider request.
 */
export interface PropertyCapabilityFacts {
  addressSaleValue?: CapabilityEvidenceFact;
  addressRentEstimate?: CapabilityEvidenceFact;
  regionalRentBenchmark?: CapabilityEvidenceFact;
  activeListing?: boolean;
  offerComputed?: boolean;
  landImprovementSplit?: CapabilityEvidenceFact;
  countyMarketContext?: boolean;
  countyRiskContext?: boolean;
  insurancePrefillCore?: boolean;
}

function decision(
  available: boolean,
  reason: CapabilityReason,
  explanation: string,
  evidence: string[] = []
): CapabilityDecision {
  return { available, reason, evidence, explanation };
}

function factEvidence(fact: CapabilityEvidenceFact | undefined): string[] {
  if (!fact?.available) return [];
  return [fact.source ? `${fact.source}:${fact.scope}` : fact.scope];
}

function resolvedScope(
  subject: AssessmentSubject,
  classification: PropertyClassification
): CapabilityScope {
  if (subject.unit || classification.listingScope.value === "unit") return "unit";
  if (classification.listingScope.value === "whole building" || subject.scope === "building") return "building";
  if (classification.listingScope.value === "parcel" || subject.scope === "parcel") return "parcel";
  return "unknown";
}

function factMatchesSubject(fact: CapabilityEvidenceFact, scope: CapabilityScope): boolean {
  if (fact.scope === "regional" || fact.scope === "unknown") return false;
  if (scope === "unknown") return false;
  return fact.scope === scope;
}

function residentialExclusion(
  classification: PropertyClassification,
  scope: CapabilityScope
): "provider_exclusion" | "unsupported_scope" | "conflicting_evidence" | null {
  const scopedUse = scope === "unit" ? classification.unitUse : classification.parcelUse;
  if (scopedUse.state === "conflicting") return "conflicting_evidence";
  if (scope === "building" && classification.buildingForm.value === "apartment") {
    return "unsupported_scope";
  }
  if (
    scopedUse.value === "commercial" ||
    scopedUse.value === "institutional" ||
    scopedUse.value === "land" ||
    (scope !== "unit" && scopedUse.value === "mixed-use")
  ) {
    return "provider_exclusion";
  }
  return null;
}

function unavailableAddressCapability(args: {
  subject: AssessmentSubject;
  classification: PropertyClassification;
  fact?: CapabilityEvidenceFact;
  label: string;
}): CapabilityDecision | null {
  const scope = resolvedScope(args.subject, args.classification);
  if (args.subject.requiresClarification || args.subject.conflicts.length > 0) {
    return decision(
      false,
      "conflicting_evidence",
      `${args.label} is withheld until the assessment subject is resolved.`
    );
  }
  const exclusion = residentialExclusion(args.classification, scope);
  if (exclusion) {
    return decision(
      false,
      exclusion,
      exclusion === "unsupported_scope"
        ? `${args.label} cannot safely treat an entire apartment building as a single residential unit.`
        : `${args.label} is outside the verified residential scope for this subject.`
    );
  }
  if (!args.fact?.available) {
    return decision(false, "missing_field", `No property-specific ${args.label.toLowerCase()} is available.`);
  }
  if (args.fact.scope === "regional") {
    return decision(
      false,
      "regional_proxy_only",
      `Only a regional proxy is available; it is not an address-level ${args.label.toLowerCase()}.`,
      factEvidence(args.fact)
    );
  }
  if (!factMatchesSubject(args.fact, scope)) {
    return decision(
      false,
      "unsupported_scope",
      `The available ${args.label.toLowerCase()} applies to ${args.fact.scope}, not the resolved ${scope} subject.`,
      factEvidence(args.fact)
    );
  }
  return null;
}

export function evaluatePropertyCapabilities(args: {
  subject: AssessmentSubject;
  classification: PropertyClassification;
  facts?: PropertyCapabilityFacts;
}): PropertyCapabilities {
  const facts = args.facts ?? {};
  const scope = resolvedScope(args.subject, args.classification);

  const saleUnavailable = unavailableAddressCapability({
    subject: args.subject,
    classification: args.classification,
    fact: facts.addressSaleValue,
    label: "Address sale valuation",
  });
  const addressSaleValuation = saleUnavailable ?? decision(
    true,
    "available",
    "A property-specific sale value matches the resolved subject scope.",
    factEvidence(facts.addressSaleValue)
  );

  const rentUnavailable = unavailableAddressCapability({
    subject: args.subject,
    classification: args.classification,
    fact: facts.addressRentEstimate,
    label: "Address rent estimate",
  });
  const addressRentEstimate = rentUnavailable ?? decision(
    true,
    "available",
    "A property-specific rent estimate matches the resolved subject scope.",
    factEvidence(facts.addressRentEstimate)
  );

  const regionalRentBenchmark = facts.regionalRentBenchmark?.available
    ? decision(
        true,
        "available",
        "A regional rent benchmark is available and remains labeled as regional context.",
        factEvidence(facts.regionalRentBenchmark)
      )
    : decision(false, "missing_field", "No regional rent benchmark is available for this geography.");

  let offerAnalysis: CapabilityDecision;
  const offerExclusion = residentialExclusion(args.classification, scope);
  if (args.subject.requiresClarification || args.subject.conflicts.length > 0) {
    offerAnalysis = decision(false, "conflicting_evidence", "Offer analysis is withheld until the assessment subject is resolved.");
  } else if (offerExclusion) {
    offerAnalysis = decision(false, offerExclusion, offerExclusion === "conflicting_evidence"
      ? "Offer analysis is withheld because the scoped property-use evidence conflicts."
      : offerExclusion === "unsupported_scope"
        ? "The residential offer model cannot safely treat an entire apartment building as a single home or unit."
        : "The residential offer model does not support this property class.");
  } else if (!facts.activeListing || !facts.offerComputed) {
    offerAnalysis = decision(false, "missing_field", "Offer analysis requires an active listing and a computed offer.");
  } else if (scope === "unknown") {
    offerAnalysis = decision(false, "unsupported_scope", "Offer analysis requires a resolved unit, building, or parcel scope.");
  } else {
    offerAnalysis = decision(true, "available", "An active listing and computed offer match the resolved subject.", [scope]);
  }

  let grossYieldScreen: CapabilityDecision;
  if (!addressSaleValuation.available || !addressRentEstimate.available) {
    const regionalOnly =
      regionalRentBenchmark.available &&
      addressSaleValuation.available &&
      addressRentEstimate.reason === "missing_field";
    grossYieldScreen = decision(
      false,
      regionalOnly ? "regional_proxy_only" :
        addressSaleValuation.reason === "conflicting_evidence" || addressRentEstimate.reason === "conflicting_evidence"
          ? "conflicting_evidence"
          : addressSaleValuation.reason === "provider_exclusion" || addressRentEstimate.reason === "provider_exclusion"
            ? "provider_exclusion"
            : addressSaleValuation.reason === "unsupported_scope" || addressRentEstimate.reason === "unsupported_scope"
              ? "unsupported_scope"
              : "missing_field",
      regionalOnly
        ? "Regional rent context cannot produce a property-specific gross-yield screen."
        : "Gross yield requires compatible property-specific sale and rent values."
    );
  } else {
    grossYieldScreen = decision(true, "available", "Compatible property-specific sale and rent values support gross-yield screening.");
  }

  let landImprovementAnalysis: CapabilityDecision;
  if (args.subject.requiresClarification || args.subject.conflicts.length > 0) {
    landImprovementAnalysis = decision(false, "conflicting_evidence", "Land/improvement analysis is withheld until subject scope is resolved.");
  } else if (scope === "unit") {
    landImprovementAnalysis = decision(false, "unsupported_scope", "Parcel-level land/improvement values do not describe an individual unit.");
  } else if (!facts.landImprovementSplit?.available) {
    landImprovementAnalysis = decision(false, "missing_field", "No paired land and improvement values are available.");
  } else if (facts.landImprovementSplit.scope !== "parcel" && facts.landImprovementSplit.scope !== "building") {
    landImprovementAnalysis = decision(false, "unsupported_scope", "The value split is not scoped to a parcel or whole building.");
  } else {
    landImprovementAnalysis = decision(
      true,
      "available",
      "Paired land and improvement values support a ratio analysis at parcel/building scope.",
      factEvidence(facts.landImprovementSplit)
    );
  }

  const countyMarketRiskContext = facts.countyMarketContext || facts.countyRiskContext
    ? decision(
        true,
        "available",
        "Regional market and/or hazard context is available and remains clearly scoped above the property.",
        [facts.countyMarketContext ? "regional_market" : "", facts.countyRiskContext ? "regional_risk" : ""].filter(Boolean)
      )
    : decision(false, "missing_field", "No regional market or hazard context is available.");

  const wholeBuildingCommercialAnalysis = decision(
    false,
    "provider_exclusion",
    "The current providers do not supply building-specific NOI, lease rolls, or commercial cap-rate evidence."
  );

  let insurancePrefill: CapabilityDecision;
  const insuranceExclusion = residentialExclusion(args.classification, scope);
  if (args.subject.requiresClarification || args.subject.conflicts.length > 0) {
    insurancePrefill = decision(false, "conflicting_evidence", "Insurance prefill is withheld until the insured subject is resolved.");
  } else if (insuranceExclusion) {
    insurancePrefill = decision(false, insuranceExclusion, insuranceExclusion === "conflicting_evidence"
      ? "Insurance prefill is withheld because the scoped property-use evidence conflicts."
      : insuranceExclusion === "unsupported_scope"
        ? "Residential insurance prefill does not support an entire apartment-building subject."
        : "Insurance prefill is limited to supported residential subjects.");
  } else if (scope === "unknown") {
    insurancePrefill = decision(false, "unsupported_scope", "Insurance prefill requires a resolved unit, building, or parcel scope.");
  } else if (!facts.insurancePrefillCore) {
    insurancePrefill = decision(false, "missing_field", "Core address and property facts are incomplete for insurance prefill.");
  } else {
    insurancePrefill = decision(
      true,
      "available",
      "Core residential address and property facts support prefill. Occupancy evidence is deliberately not used."
    );
  }

  return {
    schemaVersion: 1,
    shadowMode: true,
    subjectScope: args.subject.scope,
    items: {
      addressSaleValuation,
      addressRentEstimate,
      regionalRentBenchmark,
      offerAnalysis,
      grossYieldScreen,
      landImprovementAnalysis,
      countyMarketRiskContext,
      wholeBuildingCommercialAnalysis,
      insurancePrefill,
    },
  };
}
