import assert from "node:assert/strict";
import type { PropertyCapabilities } from "../src/lib/property-intelligence/capabilities";
import { precomputedOfferAnchorType } from "../src/lib/offer-model";
import {
  assessmentAudience,
  buildRentalOperatingScenarioBasis,
  buildRentalScreenModel,
  buildUserRentScenario,
  monthlyRentForGrossYield,
  rentCastValuationEvidenceScopes,
  shouldWithholdPropertyEvidence,
} from "../src/lib/property-intelligence/investor-journey";
import { assessmentJourneyHref } from "../src/lib/property-intelligence/journey";
import type { AssessmentSubject } from "../src/lib/property-intelligence/subject";
import {
  buildFinancingScenario,
  buildOperatingScenario,
  monthlyMortgagePayment,
} from "../src/lib/property-intelligence/operating-scenario";

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
  ["operating math requires explicit costs while allowing zero", () => {
    const complete = buildOperatingScenario({
      purchasePrice: 1_000_000,
      monthlyRent: 6_000,
      vacancyRatePct: 5,
      monthlyPropertyTaxes: 500,
      monthlyInsurance: 150,
      monthlyMaintenance: 300,
      monthlyManagement: 400,
      monthlyUtilities: 0,
      monthlyOtherCosts: 50,
    });
    assert.ok(complete);
    assert.equal(complete.annualScheduledRent, 72_000);
    assert.equal(complete.annualVacancyLoss, 3_600);
    assert.equal(complete.annualOperatingExpenses, 16_800);
    assert.equal(complete.netOperatingIncome, 51_600);
    assert.equal(complete.capRatePct, 0.0516);

    assert.equal(buildOperatingScenario({
      purchasePrice: 1_000_000,
      monthlyRent: 6_000,
      vacancyRatePct: 0,
      monthlyPropertyTaxes: 0,
      monthlyInsurance: 0,
      monthlyMaintenance: 0,
      monthlyManagement: 0,
      monthlyUtilities: 0,
      monthlyOtherCosts: 0,
    })?.netOperatingIncome, 72_000);
  }],
  ["blank or invalid operating assumptions withhold NOI and cap rate", () => {
    const base = {
      purchasePrice: 1_000_000,
      monthlyRent: 6_000,
      vacancyRatePct: 5,
      monthlyPropertyTaxes: 500,
      monthlyInsurance: 150,
      monthlyMaintenance: 300,
      monthlyManagement: 400,
      monthlyUtilities: 0,
      monthlyOtherCosts: 50,
    };
    assert.equal(buildOperatingScenario({ ...base, monthlyInsurance: null }), null);
    assert.equal(buildOperatingScenario({ ...base, vacancyRatePct: 101 }), null);
    assert.equal(buildOperatingScenario({ ...base, monthlyMaintenance: -1 }), null);
  }],
  ["financing math handles zero interest and withholds incomplete inputs", () => {
    assert.equal(monthlyMortgagePayment(120_000, 0, 10), 1_000);
    assert.equal(monthlyMortgagePayment(120_000, -1, 10), null);

    const operating = buildOperatingScenario({
      purchasePrice: 1_000_000,
      monthlyRent: 6_000,
      vacancyRatePct: 5,
      monthlyPropertyTaxes: 500,
      monthlyInsurance: 150,
      monthlyMaintenance: 300,
      monthlyManagement: 400,
      monthlyUtilities: 0,
      monthlyOtherCosts: 50,
    });
    assert.ok(operating);
    const financed = buildFinancingScenario(1_000_000, operating, {
      downPaymentPct: 20,
      annualInterestRatePct: 5,
      amortizationYears: 25,
    });
    assert.ok(financed);
    assert.equal(financed.downPayment, 200_000);
    assert.equal(financed.loanAmount, 800_000);
    assert.ok(Math.abs(financed.monthlyDebtService - 4_676.72) < 0.01);
    assert.ok(Math.abs(financed.annualCashFlow - -4_520.64) < 0.1);
    assert.equal(buildFinancingScenario(1_000_000, operating, {
      downPaymentPct: 20,
      annualInterestRatePct: null,
      amortizationYears: 25,
    }), null);
  }],
  ["US operating scenarios use modeled rent only when price and scope are verified", () => {
    assert.deepEqual(buildRentalOperatingScenarioBasis({
      goal: "rental_investment",
      subject: subject(),
      capabilities: capabilities({ addressSaleValuation: true, addressRentEstimate: true }),
      purchasePrice: 600_000,
      modeledMonthlyRent: 3_000,
    }), {
      purchasePrice: 600_000,
      monthlyRent: 3_000,
      rentBasis: "modeled_address_rent",
    });
  }],
  ["a missing US rent may become a blank user scenario but HUD never becomes its input", () => {
    const caps = capabilities({ addressSaleValuation: true, regionalRentBenchmark: true });
    assert.deepEqual(buildRentalOperatingScenarioBasis({
      goal: "rental_investment",
      subject: subject(),
      capabilities: caps,
      purchasePrice: 600_000,
      modeledMonthlyRent: null,
    }), {
      purchasePrice: 600_000,
      monthlyRent: null,
      rentBasis: "user_required",
    });
  }],
  ["fallback values and unit-building scope conflicts cannot seed an operating scenario", () => {
    assert.equal(buildRentalOperatingScenarioBasis({
      goal: "rental_investment",
      subject: subject(),
      capabilities: capabilities({ regionalRentBenchmark: true }),
      purchasePrice: 450_000,
      modeledMonthlyRent: null,
    }), null);

    const mismatched = capabilities({ addressSaleValuation: true });
    mismatched.items.addressRentEstimate.reason = "unsupported_scope";
    assert.equal(buildRentalOperatingScenarioBasis({
      goal: "rental_investment",
      subject: subject(),
      capabilities: mismatched,
      purchasePrice: 1_200_000,
      modeledMonthlyRent: 2_000,
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
