/**
 * Offline P2 subject-resolution fixtures. The resolver is pure and must make
 * zero provider calls; the fetch trap below turns that invariant into a hard
 * test failure.
 *
 * Run: node --import tsx scripts/test-property-intelligence-p2.ts
 */

import assert from "node:assert/strict";
import {
  extractUnitFromAddress,
  resolveAssessmentSubject,
  type ResolveAssessmentSubjectInput,
} from "../src/lib/property-intelligence/subject";

let passed = 0;
let providerCalls = 0;
const originalFetch = global.fetch;
global.fetch = (async () => {
  providerCalls += 1;
  throw new Error("P2 subject resolver attempted a provider call");
}) as typeof fetch;

function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

function resolve(overrides: Partial<ResolveAssessmentSubjectInput> = {}) {
  return resolveAssessmentSubject({
    rawInput: "123 Main St, Austin, TX 78701, USA",
    normalizedAddress: "123 Main St, Austin, TX 78701",
    ...overrides,
  });
}

console.log("\nP2 assessment-subject fixtures\n");

test("detached listing resolves without a scope question", () => {
  const subject = resolve({
    listing: {
      address: "123 Main St, Austin, TX 78701",
      source: "rentcast_listing",
      sourceRecordId: "MLS-1",
    },
    propertyRecord: {
      address: "123 Main St, Austin, TX 78701",
      propertyType: "Single Family",
    },
    assessment: { found: true, sourceRecordId: "2026" },
  });
  assert.equal(subject.scope, "listing");
  assert.equal(subject.selectedBy, "listing_match");
  assert.equal(subject.resolutionConfidence, "high");
  assert.equal(subject.requiresClarification, false);
  assert.ok(subject.containingParcelId);
});

test("explicit unit confirmed by listing remains a unit-specific listing", () => {
  const subject = resolve({
    rawInput: "123 Main St #402, Austin, TX 78701, USA",
    parsedUnit: "402",
    listing: {
      address: "123 Main St #402, Austin, TX 78701",
      unit: "402",
      source: "rentcast_listing",
      sourceRecordId: "MLS-402",
    },
    propertyRecord: {
      address: "123 Main St #402, Austin, TX 78701",
      unit: "402",
      propertyType: "Condo",
    },
  });
  assert.equal(subject.scope, "listing");
  assert.equal(subject.unit, "402");
  assert.equal(subject.selectedBy, "explicit_input");
  assert.equal(subject.requiresClarification, false);
});

test("multi-unit address without a unit resolves to building and asks", () => {
  const subject = resolve({
    propertyRecord: {
      address: "123 Main St, Austin, TX 78701",
      propertyType: "Multi-Family",
    },
  });
  assert.equal(subject.scope, "building");
  assert.equal(subject.requiresClarification, true);
  assert.equal(subject.clarificationReason, "unit_or_building_unspecified");
});

test("mixed-use containing building does not invalidate an explicit residential unit listing", () => {
  const subject = resolve({
    rawInput: "123 Main St Unit 7, Austin, TX 78701, USA",
    listing: {
      address: "123 Main St Unit 7, Austin, TX 78701",
      unit: "7",
      source: "rentcast_listing",
    },
    propertyRecord: {
      address: "123 Main St, Austin, TX 78701",
      propertyType: "Mixed Use",
    },
  });
  assert.equal(subject.scope, "listing");
  assert.equal(subject.unit, "7");
  assert.equal(subject.requiresClarification, false);
  assert.ok(subject.containingBuildingId);
});

test("vacant-land record remains a parcel candidate without classifying it", () => {
  const subject = resolve({
    propertyRecord: {
      address: "123 Main St, Austin, TX 78701",
      propertyType: "Vacant Land",
    },
  });
  assert.equal(subject.scope, "parcel");
  assert.equal(subject.selectedBy, "provider_match");
  assert.equal(subject.requiresClarification, false);
  assert.equal("classification" in subject, false);
});

test("clean provider miss remains unknown and neutral", () => {
  const subject = resolve();
  assert.equal(subject.scope, "unknown");
  assert.equal(subject.selectedBy, "unresolved");
  assert.equal(subject.resolutionConfidence, "low");
  assert.equal(subject.requiresClarification, false);
});

test("government-style clean miss cannot become a verified class", () => {
  const subject = resolve({ rawInput: "City Hall, Austin, TX 78701, USA" });
  assert.equal(subject.scope, "unknown");
  assert.equal(subject.candidates.length, 1);
});

test("direct Zoocasa URL explicitly selects its listing", () => {
  const subject = resolve({
    rawInput: "https://www.zoocasa.com/victoria-bc-real-estate/402-123-main-st",
    normalizedAddress: "402-123 Main St",
    directListingUrl: "https://www.zoocasa.com/victoria-bc-real-estate/402-123-main-st",
    listing: {
      address: "402-123 Main St",
      unit: "402",
      source: "zoocasa_listing",
      sourceRecordId: "MLS-CA-402",
    },
  });
  assert.equal(subject.scope, "listing");
  assert.equal(subject.unit, "402");
  assert.equal(subject.selectedBy, "explicit_input");
  assert.equal(subject.resolutionConfidence, "high");
});

for (const [label, address] of [
  ["hash", "123 Main St #402, Austin, TX"],
  ["unit", "123 Main St Unit 402, Austin, TX"],
  ["suite", "123 Main St Suite 402, Austin, TX"],
  ["apt", "123 Main St Apt. 402, Austin, TX"],
  ["Canadian prefix", "402-123 Main St, Victoria, BC"],
] as const) {
  test(`${label} unit format normalizes to 402`, () => {
    assert.equal(extractUnitFromAddress(address).unit, "402");
  });
}

test("Queens hyphenated civic number is not parsed as a unit", () => {
  const parsed = extractUnitFromAddress("51-20 69th Pl, Flushing, NY 11377, USA");
  assert.equal(parsed.unit, null);
  assert.equal(parsed.addressWithoutUnit, "51-20 69th Pl, Flushing, NY 11377, USA");
});

test("canonical provider normalization does not create an address conflict", () => {
  const subject = resolve({
    rawInput: "51-20 69th Pl, Flushing, NY 11377, USA",
    normalizedAddress: "5120 69th Pl, Woodside, NY 11377",
    listing: {
      address: "5120 69th Pl, Woodside, NY 11377",
      source: "rentcast_listing",
    },
    propertyRecord: {
      address: "5120 69th Pl, Woodside, NY 11377",
      propertyType: "Single Family",
    },
  });
  assert.equal(subject.scope, "listing");
  assert.equal(subject.conflicts.length, 0);
});

test("conflicting listing and input units require clarification", () => {
  const subject = resolve({
    rawInput: "123 Main St #402, Austin, TX 78701, USA",
    listing: {
      address: "123 Main St #403, Austin, TX 78701",
      unit: "403",
      source: "rentcast_listing",
    },
  });
  assert.equal(subject.scope, "unit");
  assert.equal(subject.unit, "402");
  assert.equal(subject.resolutionConfidence, "medium");
  assert.equal(subject.requiresClarification, true);
  assert.equal(subject.clarificationReason, "conflicting_units");
});

test("explicit unit plus building-only record preserves both candidates", () => {
  const subject = resolve({
    rawInput: "123 Main St #402, Austin, TX 78701, USA",
    propertyRecord: {
      address: "123 Main St, Austin, TX 78701",
      propertyType: "Apartment Building",
    },
  });
  assert.equal(subject.scope, "unit");
  assert.equal(subject.requiresClarification, true);
  assert.equal(subject.clarificationReason, "unit_not_confirmed_by_property_record");
  assert.deepEqual(subject.candidates.map((item) => item.scope), ["unit", "building"]);
});

test("whole-building active listing remains a listing subject", () => {
  const subject = resolve({
    listing: {
      address: "123 Main St, Austin, TX 78701",
      source: "rentcast_listing",
    },
    propertyRecord: {
      address: "123 Main St, Austin, TX 78701",
      propertyType: "Apartment Building",
    },
  });
  assert.equal(subject.scope, "listing");
  assert.equal(subject.unit, null);
  assert.equal(subject.requiresClarification, false);
});

test("listing and parcel evidence coexist without destructive merging", () => {
  const subject = resolve({
    listing: {
      address: "123 Main St, Austin, TX 78701",
      source: "rentcast_listing",
      sourceRecordId: "MLS-1",
    },
    assessment: { found: true, sourceRecordId: "2026" },
  });
  assert.ok(subject.candidates.some((item) => item.scope === "listing"));
  assert.ok(subject.candidates.some((item) => item.scope === "parcel"));
  assert.ok(subject.containingParcelId);
});

test("parcel candidate never inherits the unit from a Canadian listing address", () => {
  const subject = resolve({
    rawInput: "402-123 Main St, Victoria, BC, Canada",
    normalizedAddress: "402-123 Main St",
    listing: {
      address: "402-123 Main St",
      unit: "402",
      source: "zoocasa_listing",
    },
    assessment: { found: true, sourceRecordId: "2026", address: "402-123 Main St" },
  });
  const parcel = subject.candidates.find((item) => item.scope === "parcel");
  assert.equal(parcel?.unit, null);
  assert.equal(subject.unit, "402");
});

test("different listing and provider streets emit an address conflict", () => {
  const subject = resolve({
    listing: { address: "123 Main St", source: "rentcast_listing" },
    propertyRecord: { address: "125 Main St", propertyType: "Single Family" },
  });
  assert.equal(subject.requiresClarification, true);
  assert.equal(subject.clarificationReason, "listing_address_conflict");
  assert.ok(subject.conflicts.some((item) => item.kind === "address_mismatch"));
});

test("provider-only mismatch cannot silently replace the requested address", () => {
  const subject = resolve({
    propertyRecord: { address: "125 Main St", propertyType: "Single Family" },
  });
  assert.equal(subject.scope, "parcel");
  assert.equal(subject.resolutionConfidence, "medium");
  assert.equal(subject.requiresClarification, true);
  assert.equal(subject.clarificationReason, "provider_address_conflict");
});

test("fixture harness makes zero provider calls", () => {
  assert.equal(providerCalls, 0);
});

global.fetch = originalFetch;
console.log(`\nP2 subject-resolution tests passed (${passed}/${passed}); provider calls: ${providerCalls}\n`);
