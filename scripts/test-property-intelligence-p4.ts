import assert from "node:assert/strict";
import {
  confirmAssessmentSubject,
  hasSubjectEvidenceGap,
  journeyCapabilityStatus,
  parseAssessmentGoal,
} from "../src/lib/property-intelligence/journey";
import type { PropertyCapabilities } from "../src/lib/property-intelligence/capabilities";
import type { AssessmentSubject } from "../src/lib/property-intelligence/subject";

let providerCalls = 0;
globalThis.fetch = async () => {
  providerCalls += 1;
  throw new Error("P4 contract fixtures must not call a provider");
};

function subject(overrides: Partial<AssessmentSubject> = {}): AssessmentSubject {
  return {
    schemaVersion: 1,
    scope: "unknown",
    canonicalAddress: "100 Main St",
    unit: null,
    selectedBy: "unresolved",
    resolutionConfidence: "low",
    requiresClarification: true,
    clarificationReason: "unit_or_building_unspecified",
    candidates: [
      {
        id: "requested",
        scope: "unknown",
        canonicalAddress: "100 Main St",
        unit: null,
        source: "user_input",
        sourceRecordId: null,
        confidence: "low",
        relation: "requested",
      },
      {
        id: "listing",
        scope: "listing",
        canonicalAddress: "Unit 402, 100 Main St",
        unit: "402",
        source: "rentcast_listing",
        sourceRecordId: "listing-1",
        confidence: "high",
        relation: "subject",
      },
      {
        id: "building",
        scope: "building",
        canonicalAddress: "100 Main St",
        unit: null,
        source: "rentcast_property",
        sourceRecordId: "property-1",
        confidence: "high",
        relation: "subject",
      },
    ],
    conflicts: [],
    ...overrides,
  };
}

function capabilities(available: Partial<Record<keyof PropertyCapabilities["items"], boolean>>): PropertyCapabilities {
  const names: Array<keyof PropertyCapabilities["items"]> = [
    "addressSaleValuation",
    "addressRentEstimate",
    "regionalRentBenchmark",
    "offerAnalysis",
    "grossYieldScreen",
    "landImprovementAnalysis",
    "countyMarketRiskContext",
    "wholeBuildingCommercialAnalysis",
    "insurancePrefill",
  ];
  return {
    schemaVersion: 1,
    shadowMode: true,
    subjectScope: "building",
    items: names.reduce<PropertyCapabilities["items"]>((items, name) => {
      items[name] = {
        available: available[name] ?? false,
        reason: available[name] ? "available" : "missing_field",
        evidence: [],
        explanation: "fixture",
      };
      return items;
    }, {} as PropertyCapabilities["items"]),
  };
}

const cases: Array<[string, () => void]> = [
  ["goal parser accepts only the four explicit assessment goals", () => {
    assert.equal(parseAssessmentGoal("rental_investment"), "rental_investment");
    assert.equal(parseAssessmentGoal("investor"), null);
    assert.equal(parseAssessmentGoal(null), null);
  }],
  ["specific-unit confirmation requires an actual unit identifier", () => {
    assert.throws(() => confirmAssessmentSubject(subject(), "specific_unit"), /unit identifier/i);
    const confirmed = confirmAssessmentSubject(subject(), "specific_unit", "Apt 402");
    assert.equal(confirmed.scope, "unit");
    assert.equal(confirmed.unit, "402");
    assert.equal(confirmed.selectedBy, "user_confirmation");
  }],
  ["whole-property confirmation does not inherit a listing unit", () => {
    const confirmed = confirmAssessmentSubject(subject(), "whole_property");
    assert.equal(confirmed.scope, "building");
    assert.equal(confirmed.unit, null);
    assert.equal(confirmed.canonicalAddress, "100 Main St");
  }],
  ["listing confirmation selects the listing candidate without guessing its containing entity", () => {
    const confirmed = confirmAssessmentSubject(subject(), "listing");
    assert.equal(confirmed.scope, "listing");
    assert.equal(confirmed.unit, "402");
    assert.equal(confirmed.canonicalAddress, "Unit 402, 100 Main St");
  }],
  ["general exploration remains unknown and neutral", () => {
    const confirmed = confirmAssessmentSubject(subject(), "explore_address");
    assert.equal(confirmed.scope, "unknown");
    assert.equal(confirmed.unit, null);
    assert.equal(confirmed.requiresClarification, false);
  }],
  ["rental view distinguishes property rent from a regional proxy", () => {
    assert.equal(journeyCapabilityStatus("rental_investment", capabilities({
      addressRentEstimate: true,
      addressSaleValuation: true,
      grossYieldScreen: true,
    })).availability, "supported");
    assert.equal(journeyCapabilityStatus("rental_investment", capabilities({
      regionalRentBenchmark: true,
    })).availability, "limited");
  }],
  ["capability checks never mutate or auto-switch the selected goal", () => {
    const selected = "buy_home" as const;
    const result = journeyCapabilityStatus(selected, capabilities({ regionalRentBenchmark: true }));
    assert.equal(selected, "buy_home");
    assert.equal(result.availability, "unavailable");
  }],
  ["a confirmed scope cannot inherit capabilities computed for another subject", () => {
    const buildingCapabilities = capabilities({ addressSaleValuation: true, offerAnalysis: true });
    assert.equal(hasSubjectEvidenceGap("unit", buildingCapabilities), true);
    assert.equal(hasSubjectEvidenceGap("building", buildingCapabilities), false);
  }],
];

console.log("\nP4 journey and subject-confirmation fixtures\n");
let failures = 0;
for (const [name, run] of cases) {
  try {
    run();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  ✗ ${name}`);
    console.error(error);
  }
}

assert.equal(providerCalls, 0, "P4 fixtures made a provider call");
if (failures > 0) process.exit(1);
console.log(`\n${cases.length}/${cases.length} P4 fixtures passed; provider calls: ${providerCalls}\n`);
