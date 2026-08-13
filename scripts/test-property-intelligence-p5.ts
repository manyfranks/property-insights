import assert from "node:assert/strict";
import type { PropertyCapabilities } from "../src/lib/property-intelligence/capabilities";
import {
  assessmentAudience,
  buildRentalScreenModel,
} from "../src/lib/property-intelligence/investor-journey";

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
