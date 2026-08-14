import assert from "node:assert/strict";
import type { PropertyCapabilities } from "../src/lib/property-intelligence/capabilities";
import { precomputedOfferAnchorType } from "../src/lib/offer-model";
import {
  assessmentAudience,
  buildRentalScreenModel,
  buildUserRentScenario,
  monthlyRentForGrossYield,
  rentCastValuationEvidenceScopes,
  shouldWithholdPropertyEvidence,
} from "../src/lib/property-intelligence/investor-journey";
import { assessmentJourneyHref } from "../src/lib/property-intelligence/journey";
import type { AssessmentSubject } from "../src/lib/property-intelligence/subject";

let providerCalls = 0;
globalThis.fetch = async () => {
  providerCalls += 1;
  throw new Error("P5 composition fixtures must not call a provider");
};

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
    subjectScope: "listing",
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

const addressRent = {
  value: 3_250,
  rangeLow: 3_000,
  rangeHigh: 3_500,
  label: "Address-level rent estimate",
  source: "RentCast rent AVM",
};
const regionalRent = {
  value: 2_100,
  label: "Regional benchmark · 2BR",
  source: "HUD Fair Market Rent",
  geography: "King County",
};
const yieldEvidence = {
  grossYieldPct: 0.052,
  rentToPriceRatio: 0.0043,
  onePercentRuleMet: false,
};

function subject(overrides: Partial<AssessmentSubject> = {}): AssessmentSubject {
  return {
    schemaVersion: 1,
    scope: "listing",
    canonicalAddress: "12400 Cedar St, Austin, TX",
    unit: null,
    selectedBy: "listing_match",
    resolutionConfidence: "high",
    requiresClarification: false,
    candidates: [],
    conflicts: [],
    ...overrides,
  };
}

const cases: Array<[string, () => void]> = [
  ["explicit rental goal routes only the CTA audience and surface", () => {
    assert.deepEqual(assessmentAudience("rental_investment"), {
      mode: "investor",
      surface: "result-investor",
    });
    assert.deepEqual(assessmentAudience("buy_home"), { mode: "buyer", surface: "result-buyer" });
    assert.deepEqual(assessmentAudience("explore"), { mode: "buyer", surface: "result-buyer" });
  }],
  ["a supported US rental screen keeps address and regional evidence distinct", () => {
    const model = buildRentalScreenModel({
      goal: "rental_investment",
      capabilities: capabilities({
        addressRentEstimate: true,
        regionalRentBenchmark: true,
        grossYieldScreen: true,
      }),
      addressRent,
      regionalRent,
      yield: yieldEvidence,
    });
    assert.equal(model?.availability, "supported");
    assert.equal(model?.addressRent?.source, "RentCast rent AVM");
    assert.equal(model?.regionalRent?.source, "HUD Fair Market Rent");
    assert.deepEqual(model?.yield, yieldEvidence);
  }],
  ["regional-only evidence produces a limited screen and never a property yield", () => {
    const model = buildRentalScreenModel({
      goal: "rental_investment",
      capabilities: capabilities({ regionalRentBenchmark: true }),
      addressRent,
      regionalRent,
      yield: yieldEvidence,
    });
    assert.equal(model?.availability, "limited");
    assert.equal(model?.addressRent, null);
    assert.equal(model?.regionalRent?.value, 2_100);
    assert.equal(model?.yield, null);
  }],
  ["capability denial withholds supplied property numbers", () => {
    const model = buildRentalScreenModel({
      goal: "rental_investment",
      capabilities: capabilities({ regionalRentBenchmark: false }),
      addressRent,
      regionalRent,
      yield: yieldEvidence,
    });
    assert.equal(model?.availability, "unavailable");
    assert.equal(model?.addressRent, null);
    assert.equal(model?.regionalRent, null);
    assert.equal(model?.yield, null);
  }],
  ["non-rental goals preserve the legacy composition", () => {
    assert.equal(buildRentalScreenModel({
      goal: "buy_home",
      capabilities: capabilities({
        addressRentEstimate: true,
        regionalRentBenchmark: true,
        grossYieldScreen: true,
      }),
      addressRent,
      regionalRent,
      yield: yieldEvidence,
    }), null);
  }],
  ["Discover handoff preserves the explicit goal and enters the journey route", () => {
    assert.equal(
      assessmentJourneyHref("12400 Cedar St, Austin, TX", "rental_investment"),
      "/assess?address=12400+Cedar+St%2C+Austin%2C+TX&journeys=1&assessmentGoal=rental_investment"
    );
  }],
  ["an unresolved multi-unit subject withholds property-level evidence", () => {
    const ambiguous = subject({
      scope: "building",
      selectedBy: "provider_match",
      resolutionConfidence: "medium",
      requiresClarification: true,
      clarificationReason: "unit_or_building_unspecified",
    });
    assert.equal(shouldWithholdPropertyEvidence(ambiguous, capabilities({
      addressRentEstimate: true,
      addressSaleValuation: true,
    })), true);
  }],
  ["a resolved subject with matching capabilities remains renderable", () => {
    assert.equal(shouldWithholdPropertyEvidence(subject(), capabilities({
      addressRentEstimate: true,
      addressSaleValuation: true,
    })), false);
  }],
  ["RentCast multi-family AVMs keep whole-building value separate from single-unit rent", () => {
    assert.deepEqual(rentCastValuationEvidenceScopes("Apartment"), {
      saleValue: "building",
      rentEstimate: "unit",
    });
    assert.deepEqual(rentCastValuationEvidenceScopes("Multi-Family"), {
      saleValue: "building",
      rentEstimate: "unit",
    });
    assert.equal(rentCastValuationEvidenceScopes("Single Family"), null);
  }],
  ["Canadian user rent scenarios calculate gross yield without creating a property fact", () => {
    assert.deepEqual(buildUserRentScenario(1_000_000, 5_000), {
      grossYieldPct: 0.06,
      rentToPriceRatio: 0.005,
      onePercentRuleMet: false,
    });
    assert.equal(monthlyRentForGrossYield(1_000_000, 0.06), 5_000);
    assert.equal(buildUserRentScenario(1_000_000, 0), null);
  }],
  ["a cached language offer cannot be relabeled as assessment-anchored", () => {
    const assessment = {
      found: true,
      totalValue: 620_000,
      landValue: 0,
      buildingValue: 0,
      assessmentYear: "2026",
      source: "government" as const,
    };
    assert.equal(precomputedOfferAnchorType({ ratio: 0 }, assessment), "language");
    assert.equal(precomputedOfferAnchorType({ ratio: 1.68 }, assessment), "assessment");
    assert.equal(precomputedOfferAnchorType({ ratio: Number.NaN }, assessment), "language");
  }],
];

console.log("\nP5 Investor/Landlord composition fixtures\n");
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

assert.equal(providerCalls, 0, "P5 fixtures made a provider call");
if (failures > 0) process.exit(1);
console.log(`\n${cases.length}/${cases.length} P5 fixtures passed; provider calls: ${providerCalls}\n`);
