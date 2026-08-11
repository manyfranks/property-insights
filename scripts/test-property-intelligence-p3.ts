/**
 * Offline P3 classification/capability fixtures. Both functions are pure;
 * the fetch trap makes the no-new-provider-call invariant release-blocking.
 *
 * Run: node --import tsx scripts/test-property-intelligence-p3.ts
 */

import assert from "node:assert/strict";
import {
  availableEvidence,
  createPropertyEvidenceSnapshot,
  type EvidenceScope,
  type EvidenceSource,
  type PropertyEvidenceSnapshot,
} from "../src/lib/property-intelligence/evidence";
import { classifyProperty } from "../src/lib/property-intelligence/classification";
import {
  evaluatePropertyCapabilities,
  type CapabilityScope,
  type PropertyCapabilityFacts,
} from "../src/lib/property-intelligence/capabilities";
import {
  resolveAssessmentSubject,
  type ResolveAssessmentSubjectInput,
} from "../src/lib/property-intelligence/subject";

let passed = 0;
let providerCalls = 0;
global.fetch = (async () => {
  providerCalls += 1;
  throw new Error("P3 shadow logic attempted a provider call");
}) as typeof fetch;

function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

function subject(overrides: Partial<ResolveAssessmentSubjectInput> = {}) {
  return resolveAssessmentSubject({
    rawInput: "123 Main St, Austin, TX 78701, USA",
    normalizedAddress: "123 Main St, Austin, TX 78701",
    ...overrides,
  });
}

function evidence(args: {
  surface?: PropertyEvidenceSnapshot["surface"];
  types?: Array<{ value: string; scope: EvidenceScope; source?: EvidenceSource }>;
  occupancy?: boolean;
  split?: { land: number; building: number };
} = {}): PropertyEvidenceSnapshot {
  const collectedAt = "2026-08-11T12:00:00.000Z";
  const base = createPropertyEvidenceSnapshot({
    surface: args.surface ?? "assess_on_demand",
    rawInput: "123 Main St, Austin, TX 78701, USA",
    normalizedAddress: "123 Main St, Austin, TX 78701",
    collectedAt,
  });
  const meta = (source: EvidenceSource, scope: EvidenceScope, sourceRecordId?: string) => ({
    source,
    scope,
    sourceRecordId,
    ingestedAt: collectedAt,
    kind: "observed" as const,
    confidence: "high" as const,
  });
  return {
    ...base,
    propertyTypes: (args.types ?? []).map((item) =>
      availableEvidence(item.value, meta(item.source ?? (item.scope === "listing" ? "rentcast_listing" : "rentcast_property"), item.scope))
    ),
    occupancy: args.occupancy == null
      ? []
      : [availableEvidence(args.occupancy, meta("rentcast_property", "provider_record"))],
    landValues: args.split
      ? [availableEvidence(args.split.land, meta("rentcast_tax_assessment", "parcel", "2026"))]
      : [],
    buildingValues: args.split
      ? [availableEvidence(args.split.building, meta("rentcast_tax_assessment", "parcel", "2026"))]
      : [],
  };
}

function run(args: {
  subject: ReturnType<typeof subject>;
  evidence: PropertyEvidenceSnapshot;
  capabilityFacts?: PropertyCapabilityFacts;
  classificationFacts?: Parameters<typeof classifyProperty>[0]["facts"];
}) {
  const classification = classifyProperty({
    subject: args.subject,
    evidence: args.evidence,
    facts: args.classificationFacts,
  });
  const capabilities = evaluatePropertyCapabilities({
    subject: args.subject,
    classification,
    facts: args.capabilityFacts,
  });
  return { classification, capabilities };
}

function fact(available: boolean, scope: CapabilityScope, source = "fixture") {
  return { available, scope, source };
}

console.log("\nP3 property-classification and capability fixtures\n");

test("US detached listing supports scoped residential modules", () => {
  const resolved = subject({
    listing: { address: "123 Main St, Austin, TX", source: "rentcast_listing" },
    propertyRecord: { address: "123 Main St, Austin, TX", propertyType: "Single Family" },
  });
  const result = run({
    subject: resolved,
    evidence: evidence({
      types: [
        { value: "Single Family", scope: "listing" },
        { value: "Single Family", scope: "provider_record" },
      ],
      occupancy: false,
      split: { land: 200_000, building: 400_000 },
    }),
    classificationFacts: { activeListing: true, yearBuilt: 1998 },
    capabilityFacts: {
      addressSaleValue: fact(true, "building", "rentcast_avm"),
      addressRentEstimate: fact(true, "building", "rentcast_rent"),
      regionalRentBenchmark: fact(true, "regional", "hud_fmr"),
      activeListing: true,
      offerComputed: true,
      landImprovementSplit: fact(true, "parcel", "tax_assessment"),
      countyMarketContext: true,
      countyRiskContext: true,
      insurancePrefillCore: true,
    },
  });
  assert.equal(result.classification.parcelUse.value, "residential");
  assert.equal(result.classification.buildingForm.value, "detached");
  assert.equal(result.classification.listingScope.value, "whole building");
  assert.equal(result.capabilities.items.addressSaleValuation.available, true);
  assert.equal(result.capabilities.items.addressRentEstimate.available, true);
  assert.equal(result.capabilities.items.offerAnalysis.available, true);
  assert.equal(result.capabilities.items.grossYieldScreen.available, true);
  assert.equal(result.capabilities.items.wholeBuildingCommercialAnalysis.reason, "provider_exclusion");
});

test("Queens address normalization remains a whole-home listing", () => {
  const resolved = subject({
    rawInput: "51-20 69th Pl, Flushing, NY 11377, USA",
    normalizedAddress: "5120 69th Pl, Woodside, NY 11377",
    listing: { address: "5120 69th Pl, Woodside, NY 11377", source: "rentcast_listing" },
    propertyRecord: { address: "5120 69th Pl, Woodside, NY 11377", propertyType: "Single Family" },
  });
  const { classification } = run({
    subject: resolved,
    evidence: evidence({ types: [
      { value: "Single Family", scope: "listing" },
      { value: "Single Family", scope: "provider_record" },
    ] }),
  });
  assert.equal(resolved.requiresClarification, false);
  assert.equal(classification.listingScope.value, "whole building");
  assert.equal(classification.parcelUse.value, "residential");
});

test("residential unit remains distinct from its mixed-use building", () => {
  const resolved = subject({
    rawInput: "123 Main St Unit 402, Austin, TX",
    parsedUnit: "402",
    listing: { address: "123 Main St Unit 402, Austin, TX", unit: "402", source: "rentcast_listing" },
    propertyRecord: { address: "123 Main St, Austin, TX", propertyType: "Mixed Use" },
  });
  const result = run({
    subject: resolved,
    evidence: evidence({ types: [
      { value: "Residential Condo", scope: "listing" },
      { value: "Mixed Use", scope: "provider_record" },
    ] }),
    capabilityFacts: {
      addressSaleValue: fact(true, "unit", "rentcast_avm"),
      addressRentEstimate: fact(true, "unit", "rentcast_rent"),
      activeListing: true,
      offerComputed: true,
      insurancePrefillCore: true,
    },
  });
  assert.equal(result.classification.parcelUse.value, "mixed-use");
  assert.equal(result.classification.buildingForm.value, "mixed-use");
  assert.equal(result.classification.unitUse.value, "residential");
  assert.equal(result.classification.listingScope.value, "unit");
  assert.notEqual(result.classification.overallConfidence, "low");
  assert.equal(result.capabilities.items.addressSaleValuation.available, true);
  assert.equal(result.capabilities.items.insurancePrefill.available, true);
  assert.equal(result.capabilities.items.landImprovementAnalysis.reason, "unsupported_scope");
});

test("ambiguous apartment-building input withholds scoped modules", () => {
  const resolved = subject({
    propertyRecord: { address: "123 Main St, Austin, TX", propertyType: "Apartment Building" },
  });
  const result = run({
    subject: resolved,
    evidence: evidence({ types: [{ value: "Apartment Building", scope: "provider_record" }] }),
    capabilityFacts: {
      addressSaleValue: fact(true, "building"),
      addressRentEstimate: fact(true, "building"),
      insurancePrefillCore: true,
    },
  });
  assert.equal(resolved.requiresClarification, true);
  assert.equal(result.capabilities.items.addressSaleValuation.reason, "conflicting_evidence");
  assert.equal(result.capabilities.items.offerAnalysis.reason, "conflicting_evidence");
  assert.equal(result.capabilities.items.insurancePrefill.reason, "conflicting_evidence");
});

test("explicit whole-apartment-building listing is not mistaken for one unit", () => {
  const resolved = subject({
    listing: { address: "123 Main St, Austin, TX", source: "rentcast_listing" },
    propertyRecord: { address: "123 Main St, Austin, TX", propertyType: "Apartment Building" },
  });
  const result = run({
    subject: resolved,
    evidence: evidence({ types: [
      { value: "Apartment Building", scope: "listing" },
      { value: "Apartment Building", scope: "provider_record" },
    ] }),
    capabilityFacts: {
      addressSaleValue: fact(true, "building"),
      activeListing: true,
      offerComputed: true,
    },
  });
  assert.equal(resolved.requiresClarification, false);
  assert.equal(result.classification.listingScope.value, "whole building");
  assert.equal(result.classification.unitUse.value, "unknown");
  assert.equal(result.capabilities.items.addressSaleValuation.reason, "unsupported_scope");
  assert.equal(result.capabilities.items.offerAnalysis.reason, "unsupported_scope");
});

for (const [label, propertyType, expected, expectedReason] of [
  ["vacant land", "Vacant Land", "land", "provider_exclusion"],
  ["institutional", "Municipal Government Exempt", "institutional", "provider_exclusion"],
  // A no-unit commercial building remains subject-ambiguous under P2; that
  // conflict safely takes precedence over the known provider exclusion.
  ["commercial", "Retail Commercial", "commercial", "conflicting_evidence"],
] as const) {
  test(`${label} is classified and excluded from residential modules`, () => {
    const resolved = subject({
      propertyRecord: { address: "123 Main St, Austin, TX", propertyType },
    });
    const result = run({
      subject: resolved,
      evidence: evidence({ types: [{ value: propertyType, scope: "provider_record" }] }),
      capabilityFacts: {
        addressSaleValue: fact(true, expected === "land" ? "parcel" : "building"),
        addressRentEstimate: fact(true, expected === "land" ? "parcel" : "building"),
        insurancePrefillCore: true,
      },
    });
    assert.equal(result.classification.parcelUse.value, expected);
    assert.equal(result.capabilities.items.addressRentEstimate.reason, expectedReason);
    assert.equal(result.capabilities.items.insurancePrefill.reason, expectedReason);
  });
}

test("conflicting provider classes remain explicit and withhold modules", () => {
  const resolved = subject({
    propertyRecord: { address: "123 Main St, Austin, TX", propertyType: "Single Family" },
  });
  const result = run({
    subject: resolved,
    evidence: evidence({ types: [
      { value: "Single Family", scope: "provider_record" },
      { value: "Retail Commercial", scope: "provider_record", source: "us_county_assessor" },
    ] }),
    capabilityFacts: { addressSaleValue: fact(true, "parcel") },
  });
  assert.equal(result.classification.parcelUse.state, "conflicting");
  assert.equal(result.classification.overallConfidence, "low");
  assert.equal(result.capabilities.items.addressSaleValuation.reason, "conflicting_evidence");
});

test("regional-only fallback never masquerades as address-level data", () => {
  const resolved = subject();
  const result = run({
    subject: resolved,
    evidence: evidence(),
    capabilityFacts: {
      addressSaleValue: fact(true, "regional", "area_median"),
      regionalRentBenchmark: fact(true, "regional", "hud_fmr"),
      countyMarketContext: true,
    },
  });
  assert.equal(result.capabilities.items.addressSaleValuation.reason, "regional_proxy_only");
  assert.equal(result.capabilities.items.addressSaleValuation.available, false);
  assert.equal(result.capabilities.items.regionalRentBenchmark.available, true);
});

test("Canadian condo can use regional rent but not parcel split", () => {
  const resolved = subject({
    rawInput: "402-123 Main St, Victoria, BC, Canada",
    normalizedAddress: "402-123 Main St",
    parsedUnit: "402",
    listing: { address: "402-123 Main St", unit: "402", source: "zoocasa_listing" },
    assessment: { found: true, sourceRecordId: "2026", address: "123 Main St" },
  });
  const result = run({
    subject: resolved,
    evidence: evidence({
      types: [{ value: "Apartment/Condo", scope: "listing", source: "zoocasa_detail" }],
      split: { land: 100_000, building: 500_000 },
    }),
    capabilityFacts: {
      regionalRentBenchmark: fact(true, "regional", "cmhc"),
      landImprovementSplit: fact(true, "parcel", "bc_assessment"),
      activeListing: true,
      offerComputed: true,
      insurancePrefillCore: true,
    },
  });
  assert.equal(result.classification.parcelUse.value, "unknown");
  assert.equal(result.classification.unitUse.value, "residential");
  assert.equal(result.capabilities.items.regionalRentBenchmark.available, true);
  assert.equal(result.capabilities.items.addressRentEstimate.available, false);
  assert.equal(result.capabilities.items.landImprovementAnalysis.reason, "unsupported_scope");
});

test("Canadian detached assessment split supports land/improvement analysis", () => {
  const resolved = subject({
    rawInput: "10 Oak St, Victoria, BC, Canada",
    listing: { address: "10 Oak St, Victoria, BC", source: "zoocasa_listing" },
    assessment: { found: true, sourceRecordId: "2026", address: "10 Oak St" },
  });
  const result = run({
    subject: resolved,
    evidence: evidence({
      types: [{ value: "Detached House", scope: "listing", source: "zoocasa_detail" }],
      split: { land: 700_000, building: 200_000 },
    }),
    classificationFacts: { yearBuilt: 2025, asOfDate: "2026-08-11" },
    capabilityFacts: {
      regionalRentBenchmark: fact(true, "regional", "cmhc"),
      landImprovementSplit: fact(true, "parcel", "bc_assessment"),
      activeListing: true,
      offerComputed: true,
    },
  });
  assert.equal(result.classification.buildingForm.value, "detached");
  assert.ok(result.classification.tags.some((tag) => tag.name === "recent build"));
  assert.ok(result.classification.tags.some((tag) => tag.name === "high land-to-improvement ratio"));
  assert.equal(result.capabilities.items.landImprovementAnalysis.available, true);
});

test("Discover seed exposes listing classification but not assess-only capabilities", () => {
  const resolved = subject({
    listing: { address: "123 Main St, Austin, TX", source: "rentcast_listing" },
  });
  const result = run({
    subject: resolved,
    evidence: evidence({
      surface: "discover_seed",
      types: [{ value: "Single Family", scope: "listing" }],
    }),
    capabilityFacts: { activeListing: true },
  });
  assert.equal(result.classification.buildingForm.value, "detached");
  assert.equal(result.classification.occupancySignal.value, "unknown");
  assert.equal(result.capabilities.items.addressSaleValuation.reason, "missing_field");
  assert.equal(result.capabilities.items.addressRentEstimate.reason, "missing_field");
  assert.equal(result.capabilities.items.insurancePrefill.reason, "missing_field");
});

test("occupancy observations never change capabilities or infer intent", () => {
  const resolved = subject({
    listing: { address: "123 Main St, Austin, TX", source: "rentcast_listing" },
    propertyRecord: { address: "123 Main St, Austin, TX", propertyType: "Single Family" },
  });
  const facts: PropertyCapabilityFacts = {
    addressSaleValue: fact(true, "building"),
    addressRentEstimate: fact(true, "building"),
    activeListing: true,
    offerComputed: true,
    insurancePrefillCore: true,
  };
  const owner = run({
    subject: resolved,
    evidence: evidence({ types: [{ value: "Single Family", scope: "provider_record" }], occupancy: true }),
    capabilityFacts: facts,
  });
  const absentee = run({
    subject: resolved,
    evidence: evidence({ types: [{ value: "Single Family", scope: "provider_record" }], occupancy: false }),
    capabilityFacts: facts,
  });
  assert.equal(owner.classification.occupancySignal.value, "owner-occupied");
  assert.equal(absentee.classification.occupancySignal.value, "non-owner-occupied");
  assert.deepEqual(owner.capabilities, absentee.capabilities);
  const serialized = JSON.stringify(absentee);
  assert.equal(serialized.includes("goal"), false);
  assert.equal(serialized.includes("journey"), false);
  assert.equal(serialized.includes("investmentIntent"), false);
});

assert.equal(providerCalls, 0);
console.log(`\n${passed}/${passed} P3 fixtures passed; provider calls: ${providerCalls}\n`);
