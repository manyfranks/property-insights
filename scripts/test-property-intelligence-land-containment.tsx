/**
 * Recorded, minimized fixtures for the two Canadian land listings that
 * exposed the listing-scope containment gap in production on 2026-08-14.
 *
 * Run: node --import tsx scripts/test-property-intelligence-land-containment.tsx
 */

import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { PropertyJsonLd } from "../src/components/json-ld";
import PropertyJourneyHandoff from "../src/components/property-journey-handoff";
import {
  evaluatePropertyCapabilities,
  type PropertyCapabilityFacts,
} from "../src/lib/property-intelligence/capabilities";
import { classifyProperty } from "../src/lib/property-intelligence/classification";
import {
  availableEvidence,
  createPropertyEvidenceSnapshot,
} from "../src/lib/property-intelligence/evidence";
import {
  deriveCaRentalJourneyStatus,
  journeyCapabilityStatus,
} from "../src/lib/property-intelligence/journey";
import {
  buildLandPriceContext,
  containVerifiedLandListingCapabilities,
  isVerifiedLandListing,
  residentialPartnerActionsAllowed,
} from "../src/lib/property-intelligence/land-listing";
import { resolveAssessmentSubject } from "../src/lib/property-intelligence/subject";
import type { Assessment } from "../src/lib/types";

let passed = 0;
let providerCalls = 0;
global.fetch = (async () => {
  providerCalls += 1;
  throw new Error("Land-containment fixture attempted a provider call");
}) as typeof fetch;

function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

interface LandFixture {
  slug: string;
  address: string;
  city: string;
  province: string;
  sourceRecordId: string;
  listPrice: number;
  assessment: Assessment | null;
  hasSplit: boolean;
}

const ROSSTOWN: LandFixture = {
  slug: "2496-rosstown-rd",
  address: "2496 Rosstown Rd",
  city: "Nanaimo",
  province: "BC",
  sourceRecordId: "zoocasa:85864489",
  listPrice: 429_900,
  hasSplit: true,
  assessment: {
    totalValue: 410_000,
    landValue: 410_000,
    buildingValue: 0,
    componentAvailability: "available",
    assessmentYear: "2026",
    found: true,
    source: "government",
    evidenceClass: "observed",
  },
};

const MAIN_STREET: LandFixture = {
  slug: "1827-main-st",
  address: "1827 Main St",
  city: "Penticton",
  province: "BC",
  sourceRecordId: "zoocasa:1827-main-st",
  listPrice: 120_000,
  hasSplit: false,
  assessment: null,
};

function evaluateFixture(fixture: LandFixture) {
  const normalizedAddress = `${fixture.address}, ${fixture.city}, ${fixture.province}`;
  const listingUrl = `https://www.zoocasa.com/${fixture.slug}`;
  const subject = resolveAssessmentSubject({
    rawInput: listingUrl,
    directListingUrl: listingUrl,
    normalizedAddress,
    listing: {
      address: normalizedAddress,
      source: "zoocasa_listing",
      sourceRecordId: fixture.sourceRecordId,
    },
    assessment: fixture.assessment?.found
      ? {
          found: true,
          sourceRecordId: fixture.assessment.assessmentYear,
          address: normalizedAddress,
        }
      : { found: false },
  });

  const collectedAt = "2026-08-14T12:00:00.000Z";
  const base = createPropertyEvidenceSnapshot({
    surface: "assess_on_demand",
    rawInput: listingUrl,
    normalizedAddress,
    directListingUrl: listingUrl,
    collectedAt,
  });
  const evidence = {
    ...base,
    propertyTypes: [
      availableEvidence("Land", {
        source: "zoocasa_detail",
        sourceRecordId: fixture.sourceRecordId,
        ingestedAt: collectedAt,
        kind: "observed" as const,
        confidence: "high" as const,
        scope: "listing" as const,
      }),
    ],
    assessmentTotals: fixture.assessment
      ? [availableEvidence(fixture.assessment.totalValue, {
          source: "bc_assessment" as const,
          sourceRecordId: fixture.assessment.assessmentYear,
          ingestedAt: collectedAt,
          kind: "observed" as const,
          confidence: "high" as const,
          scope: "parcel" as const,
        })]
      : [],
    landValues: fixture.assessment
      ? [availableEvidence(fixture.assessment.landValue, {
          source: "bc_assessment" as const,
          sourceRecordId: fixture.assessment.assessmentYear,
          ingestedAt: collectedAt,
          kind: "observed" as const,
          confidence: "high" as const,
          scope: "parcel" as const,
        })]
      : [],
    buildingValues: fixture.assessment
      ? [availableEvidence(fixture.assessment.buildingValue, {
          source: "bc_assessment" as const,
          sourceRecordId: fixture.assessment.assessmentYear,
          ingestedAt: collectedAt,
          kind: "observed" as const,
          confidence: "high" as const,
          scope: "parcel" as const,
        })]
      : [],
  };
  const classification = classifyProperty({ subject, evidence });
  const facts: PropertyCapabilityFacts = {
    // Preserve the production shape that previously let the residential
    // offer through. Exclusion must win even when an offer was computed.
    activeListing: true,
    offerComputed: true,
    insurancePrefillCore: true,
    ...(fixture.assessment
      ? { addressSaleValue: { available: true, scope: "parcel", source: "bc_assessment" } }
      : {}),
    ...(fixture.hasSplit
      ? { landImprovementSplit: { available: true, scope: "parcel", source: "bc_assessment" } }
      : {}),
  };
  const capabilities = evaluatePropertyCapabilities({ subject, classification, facts });
  const rentalStatus = deriveCaRentalJourneyStatus(capabilities, classification, {
    hasCmhcRent: false,
    hasRegionalContext: false,
  });
  const priceContext = buildLandPriceContext({
    listPrice: fixture.listPrice,
    assessment: fixture.assessment,
    classification,
  });

  return { subject, classification, capabilities, rentalStatus, priceContext };
}

console.log("\nCanadian listing-only land containment fixtures\n");

for (const fixture of [ROSSTOWN, MAIN_STREET]) {
  test(`${fixture.slug}: listing Land remains listing-scoped but resolves deterministically to a parcel`, () => {
    const { subject, classification } = evaluateFixture(fixture);
    assert.equal(subject.scope, "listing");
    assert.equal(subject.requiresClarification, false);
    assert.equal(classification.parcelUse.value, "unknown", "listing evidence must not be promoted into parcelUse");
    assert.equal(classification.listingScope.value, "parcel");
    assert.equal(classification.listingScope.state, "deterministic");
    assert.equal(classification.listingScope.confidence, "high");
    assert.equal(isVerifiedLandListing(classification), true);
  });

  test(`${fixture.slug}: every residential property-level capability is excluded`, () => {
    const { capabilities, rentalStatus } = evaluateFixture(fixture);
    for (const capability of [
      "addressSaleValuation",
      "addressRentEstimate",
      "offerAnalysis",
      "grossYieldScreen",
      "insurancePrefill",
    ] as const) {
      assert.equal(capabilities.items[capability].available, false, capability);
      assert.equal(capabilities.items[capability].reason, "provider_exclusion", capability);
    }
    assert.equal(rentalStatus.availability, "unavailable");
    assert.match(rentalStatus.message, /verified land listing/i);
    assert.equal(residentialPartnerActionsAllowed(capabilities), false);
  });
}

test("2496-rosstown-rd: observed BC land/improvement context remains available", () => {
  const { capabilities, priceContext } = evaluateFixture(ROSSTOWN);
  assert.equal(capabilities.items.landImprovementAnalysis.available, true);
  assert.equal(capabilities.items.landImprovementAnalysis.reason, "available");
  assert.equal(priceContext?.kind, "assessed");
  assert.equal(priceContext?.assessedValue, 410_000);
  assert.equal(priceContext?.landValue, 410_000);
  assert.equal(priceContext?.improvementValue, 0);
  assert.equal(priceContext?.assessmentYear, "2026");
});

test("1827-main-st: missing assessment yields listing-only context and no invented value", () => {
  const { capabilities, priceContext } = evaluateFixture(MAIN_STREET);
  assert.equal(capabilities.items.landImprovementAnalysis.available, false);
  assert.equal(capabilities.items.landImprovementAnalysis.reason, "missing_field");
  assert.equal(priceContext?.kind, "listing_only");
  assert.equal(priceContext?.assessedValue, null);
  assert.equal(priceContext?.landValue, null);
  assert.equal(priceContext?.listToAssessedRatio, null);
});

test("pre-fix persisted capabilities are contained at read time without changing land analysis", () => {
  const { capabilities, classification } = evaluateFixture(ROSSTOWN);
  const staleCapabilities = {
    ...capabilities,
    items: {
      ...capabilities.items,
      offerAnalysis: {
        available: true,
        reason: "available" as const,
        evidence: ["listing"],
        explanation: "Legacy persisted decision",
      },
      insurancePrefill: {
        available: false,
        reason: "missing_field" as const,
        evidence: [],
        explanation: "Legacy persisted decision",
      },
    },
  };
  const contained = containVerifiedLandListingCapabilities(staleCapabilities, classification);
  assert.equal(contained?.items.offerAnalysis.reason, "provider_exclusion");
  assert.equal(contained?.items.insurancePrefill.reason, "provider_exclusion");
  assert.equal(contained?.items.landImprovementAnalysis.reason, "available");
  assert.match(contained?.items.offerAnalysis.evidence[0] ?? "", /zoocasa_detail:listing/);
  assert.equal(residentialPartnerActionsAllowed(staleCapabilities, classification), false);
});

test("land handoff is collapsed, supplemental, and cannot link to residential goals", () => {
  const { capabilities, rentalStatus } = evaluateFixture(ROSSTOWN);
  const markup = renderToStaticMarkup(
    <PropertyJourneyHandoff
      assessmentInput="2496 Rosstown Rd, Nanaimo, BC"
      goalStatuses={{
        buy_home: journeyCapabilityStatus("buy_home", capabilities),
        rental_investment: rentalStatus,
        own_manage: journeyCapabilityStatus("own_manage", capabilities),
        explore: journeyCapabilityStatus("explore", capabilities),
      }}
    />
  );
  assert.match(markup, /<details class=/);
  assert.doesNotMatch(markup, /<details[^>]* open/);
  assert.match(markup, /Change assessment focus/);
  assert.match(markup, /Optional · applies only to this property assessment/);
  assert.match(markup, /data-journey-option="rental_investment"[^>]*data-journey-availability="unavailable"/);
  assert.match(markup, /data-journey-option="buy_home"[^>]*data-journey-availability="unavailable"/);
  assert.doesNotMatch(markup, /assessmentGoal=rental_investment/);
  assert.match(markup, /assessmentGoal=explore/);
});

test("land structured data does not claim a single-family residence or bedroom count", () => {
  const markup = renderToStaticMarkup(
    <PropertyJsonLd
      url="https://www.propertyinsights.xyz/property/2496-rosstown-rd"
      address="2496 Rosstown Rd"
      city="Nanaimo"
      province="BC"
      beds="0"
      baths="0"
      price={389_900}
      assetType="land"
    />
  );
  assert.match(markup, /"@type":"Place"/);
  assert.doesNotMatch(markup, /SingleFamilyResidence/);
  assert.doesNotMatch(markup, /numberOfBedrooms|numberOfBathroomsTotal/);
});

test("supported residential evidence still permits partner actions and rental handoff", () => {
  const subject = resolveAssessmentSubject({
    rawInput: "402-123 Main St, Victoria, BC",
    normalizedAddress: "402-123 Main St, Victoria, BC",
    parsedUnit: "402",
    listing: {
      address: "402-123 Main St, Victoria, BC",
      unit: "402",
      source: "zoocasa_listing",
    },
  });
  const collectedAt = "2026-08-14T12:00:00.000Z";
  const base = createPropertyEvidenceSnapshot({
    surface: "assess_on_demand",
    rawInput: "402-123 Main St, Victoria, BC",
    normalizedAddress: "402-123 Main St, Victoria, BC",
    parsedUnit: "402",
    collectedAt,
  });
  const classification = classifyProperty({
    subject,
    evidence: {
      ...base,
      propertyTypes: [availableEvidence("Apartment/Condo", {
        source: "zoocasa_detail",
        ingestedAt: collectedAt,
        kind: "observed",
        confidence: "high",
        scope: "listing",
      })],
    },
  });
  const capabilities = evaluatePropertyCapabilities({
    subject,
    classification,
    facts: {
      addressSaleValue: { available: true, scope: "unit", source: "fixture" },
      addressRentEstimate: { available: true, scope: "unit", source: "fixture" },
      activeListing: true,
      offerComputed: true,
      insurancePrefillCore: true,
    },
  });
  assert.equal(residentialPartnerActionsAllowed(capabilities), true);
  assert.equal(journeyCapabilityStatus("rental_investment", capabilities).availability, "supported");
});

assert.equal(providerCalls, 0);
console.log(`\n${passed}/${passed} land-containment fixtures passed; provider calls: ${providerCalls}\n`);
