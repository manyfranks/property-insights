/**
 * CA rental-journey exclusion fixtures.
 *
 * Bug under test: src/app/property/[slug]/page.tsx previously hardcoded
 * `caRentalJourneyStatus` to `{ availability: "limited", ... }` keyed only
 * on CMHC regional-rent presence, ignoring the parcel-use/classification
 * exclusions capabilities.ts already computes (vacant land, commercial,
 * institutional, and non-unit mixed-use are excluded from residential
 * modules — see capabilities.ts's residentialExclusion()). Net effect: an
 * excluded CA listing with a cleanly resolved subject and the
 * rental_investment goal still rendered the interactive rent-scenario
 * calculator (CanadaRentalScreen) instead of being withheld.
 *
 * This script proves the old behavior was wrong (`legacyStub` — a faithful
 * reproduction of the removed hardcoded logic — incorrectly reports
 * "limited" for excluded classes) and that the new pure function
 * (`deriveCaRentalJourneyStatus`, src/lib/property-intelligence/journey.ts)
 * correctly reports "unavailable" for them, while preserving the legacy
 * "limited" behavior for clean residential subjects.
 *
 * Run: node --import tsx scripts/test-property-intelligence-ca-exclusions.ts
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
import {
  deriveCaRentalJourneyStatus,
  type JourneyCapabilityStatus,
} from "../src/lib/property-intelligence/journey";

let passed = 0;
let providerCalls = 0;
global.fetch = (async () => {
  providerCalls += 1;
  throw new Error("CA-exclusions shadow logic attempted a provider call");
}) as typeof fetch;

function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

/** The hardcoded logic page.tsx used to run, kept here only so the fixtures
 * can prove it was wrong (a legacy no-op with respect to classification). */
function legacyStub(hasCmhcRent: boolean): JourneyCapabilityStatus {
  return {
    availability: "limited",
    message: hasCmhcRent
      ? "Regional CMHC rent context and a user-entered rent scenario support a limited screen; neither is an address-level expected rent."
      : "No reliable rent estimate is available for this address or city; enter your own monthly-rent scenario to screen it against the listing price.",
  };
}

function subject(overrides: Partial<ResolveAssessmentSubjectInput> = {}) {
  return resolveAssessmentSubject({
    rawInput: "10 Oak St, Victoria, BC, Canada",
    normalizedAddress: "10 Oak St, Victoria, BC",
    ...overrides,
  });
}

function evidence(args: {
  types?: Array<{ value: string; scope: EvidenceScope; source?: EvidenceSource }>;
} = {}): PropertyEvidenceSnapshot {
  const collectedAt = "2026-08-13T12:00:00.000Z";
  const base = createPropertyEvidenceSnapshot({
    surface: "assess_on_demand",
    rawInput: "10 Oak St, Victoria, BC, Canada",
    normalizedAddress: "10 Oak St, Victoria, BC",
    collectedAt,
  });
  const meta = (source: EvidenceSource, scope: EvidenceScope) => ({
    source,
    scope,
    ingestedAt: collectedAt,
    kind: "observed" as const,
    confidence: "high" as const,
  });
  return {
    ...base,
    propertyTypes: (args.types ?? []).map((item) =>
      availableEvidence(
        item.value,
        meta(item.source ?? (item.scope === "listing" ? "zoocasa_detail" : "rentcast_property"), item.scope)
      )
    ),
  };
}

function run(args: {
  subject: ReturnType<typeof subject>;
  evidence: PropertyEvidenceSnapshot;
  capabilityFacts?: PropertyCapabilityFacts;
}) {
  const classification = classifyProperty({ subject: args.subject, evidence: args.evidence });
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

console.log("\nCA rental-journey exclusion fixtures\n");

// ---------------------------------------------------------------------------
// Vacant land
// ---------------------------------------------------------------------------
test("CA vacant land: legacy stub wrongly reports limited (would render the calculator)", () => {
  const resolved = subject({ propertyRecord: { address: "10 Oak St, Victoria, BC", propertyType: "Vacant Land" } });
  assert.equal(resolved.requiresClarification, false);
  const stub = legacyStub(true);
  assert.equal(stub.availability, "limited");
});

test("CA vacant land: deriveCaRentalJourneyStatus withholds the rental screen", () => {
  const resolved = subject({ propertyRecord: { address: "10 Oak St, Victoria, BC", propertyType: "Vacant Land" } });
  const { classification, capabilities } = run({
    subject: resolved,
    evidence: evidence({ types: [{ value: "Vacant Land", scope: "provider_record" }] }),
    capabilityFacts: {
      addressRentEstimate: fact(true, "parcel"),
      regionalRentBenchmark: fact(true, "regional", "cmhc"),
    },
  });
  assert.equal(classification.parcelUse.value, "land");
  assert.equal(capabilities.items.addressRentEstimate.reason, "provider_exclusion");
  const status = deriveCaRentalJourneyStatus(capabilities, classification, {
    hasCmhcRent: true,
    hasRegionalContext: true,
  });
  assert.equal(status.availability, "unavailable");
  assert.match(status.message, /vacant land/i);
});

// ---------------------------------------------------------------------------
// Institutional
// ---------------------------------------------------------------------------
test("CA institutional: legacy stub wrongly reports limited (would render the calculator)", () => {
  const stub = legacyStub(false);
  assert.equal(stub.availability, "limited");
});

test("CA institutional: deriveCaRentalJourneyStatus withholds the rental screen", () => {
  const resolved = subject({
    propertyRecord: { address: "10 Oak St, Victoria, BC", propertyType: "Municipal Government Exempt" },
  });
  assert.equal(resolved.requiresClarification, false);
  const { classification, capabilities } = run({
    subject: resolved,
    evidence: evidence({ types: [{ value: "Municipal Government Exempt", scope: "provider_record" }] }),
    capabilityFacts: { addressRentEstimate: fact(true, "building") },
  });
  assert.equal(classification.parcelUse.value, "institutional");
  assert.equal(capabilities.items.addressRentEstimate.reason, "provider_exclusion");
  const status = deriveCaRentalJourneyStatus(capabilities, classification, {
    hasCmhcRent: false,
    hasRegionalContext: false,
  });
  assert.equal(status.availability, "unavailable");
  assert.match(status.message, /restricted|institutional/i);
});

// ---------------------------------------------------------------------------
// Commercial (subject cleanly resolved via a listing candidate, so the
// exclusion reason is "provider_exclusion" rather than a subject-level
// "conflicting_evidence" — this is the case the audit specifically flagged:
// a *cleanly resolved* subject that still leaked the calculator).
// ---------------------------------------------------------------------------
test("CA commercial: legacy stub wrongly reports limited (would render the calculator)", () => {
  const stub = legacyStub(false);
  assert.equal(stub.availability, "limited");
});

test("CA commercial: deriveCaRentalJourneyStatus withholds the rental screen for a cleanly resolved subject", () => {
  const resolved = subject({
    listing: { address: "10 Oak St, Victoria, BC", source: "zoocasa_listing" },
    propertyRecord: { address: "10 Oak St, Victoria, BC", propertyType: "Retail Commercial" },
  });
  assert.equal(resolved.requiresClarification, false, "subject must be cleanly resolved for this to test the exclusion path, not the subject-conflict path");
  const { classification, capabilities } = run({
    subject: resolved,
    evidence: evidence({
      types: [
        { value: "Retail Commercial", scope: "listing" },
        { value: "Retail Commercial", scope: "provider_record" },
      ],
    }),
    capabilityFacts: { addressRentEstimate: fact(true, "building") },
  });
  assert.equal(classification.parcelUse.value, "commercial");
  assert.equal(capabilities.items.addressRentEstimate.reason, "provider_exclusion");
  const status = deriveCaRentalJourneyStatus(capabilities, classification, {
    hasCmhcRent: false,
    hasRegionalContext: false,
  });
  assert.equal(status.availability, "unavailable");
  assert.match(status.message, /commercial/i);
});

// ---------------------------------------------------------------------------
// Mixed-use / ambiguous scope
// ---------------------------------------------------------------------------
test("CA mixed-use: legacy stub wrongly reports limited (would render the calculator)", () => {
  const stub = legacyStub(true);
  assert.equal(stub.availability, "limited");
});

test("CA mixed-use (non-unit scope): deriveCaRentalJourneyStatus requests clarification instead of screening", () => {
  const resolved = subject({
    listing: { address: "10 Oak St, Victoria, BC", source: "zoocasa_listing" },
    propertyRecord: { address: "10 Oak St, Victoria, BC", propertyType: "Mixed Use" },
  });
  assert.equal(resolved.requiresClarification, false);
  const { classification, capabilities } = run({
    subject: resolved,
    evidence: evidence({
      types: [
        { value: "Mixed Use", scope: "listing" },
        { value: "Mixed Use", scope: "provider_record" },
      ],
    }),
    capabilityFacts: {
      addressRentEstimate: fact(true, "building"),
      regionalRentBenchmark: fact(true, "regional", "cmhc"),
    },
  });
  assert.equal(classification.parcelUse.value, "mixed-use");
  assert.equal(capabilities.items.addressRentEstimate.reason, "provider_exclusion");
  const status = deriveCaRentalJourneyStatus(capabilities, classification, {
    hasCmhcRent: true,
    hasRegionalContext: true,
  });
  assert.equal(status.availability, "unavailable");
  assert.match(status.message, /mixed|scope|unit/i);
  // JourneyAvailability has no dedicated "needs clarification" state — see
  // the report's documented limitation. "unavailable" is the safe reuse.
});

// ---------------------------------------------------------------------------
// Unknown classification (no property-type evidence at all)
// ---------------------------------------------------------------------------
test("CA unknown classification: legacy stub cannot distinguish unknown use from confirmed residential", () => {
  const stub = legacyStub(false);
  assert.equal(stub.availability, "limited");
  assert.doesNotMatch(stub.message, /use could not be verified|classified use/i);
});

test("CA unknown classification: deriveCaRentalJourneyStatus stays limited but flags unverified use", () => {
  const resolved = subject({ listing: { address: "10 Oak St, Victoria, BC", source: "zoocasa_listing" } });
  const { classification, capabilities } = run({
    subject: resolved,
    evidence: evidence({ types: [] }),
    capabilityFacts: { regionalRentBenchmark: fact(true, "regional", "cmhc") },
  });
  assert.equal(classification.parcelUse.value, "unknown");
  assert.equal(classification.unitUse.value, "unknown");
  assert.notEqual(capabilities.items.addressRentEstimate.reason, "provider_exclusion");
  const status = deriveCaRentalJourneyStatus(capabilities, classification, {
    hasCmhcRent: true,
    hasRegionalContext: true,
  });
  assert.equal(status.availability, "limited");
  assert.match(status.message, /use could not be verified/i);
});

// ---------------------------------------------------------------------------
// Clean residential — preserve current copy exactly, both CMHC branches.
// The existing p3 CA fixtures always hardcode CMHC present; the "without"
// case locks in the no-benchmark path that was previously untested.
// ---------------------------------------------------------------------------
test("CA residential WITH CMHC: legacy copy is preserved", () => {
  const resolved = subject({
    rawInput: "402-123 Main St, Victoria, BC, Canada",
    normalizedAddress: "402-123 Main St",
    parsedUnit: "402",
    listing: { address: "402-123 Main St", unit: "402", source: "zoocasa_listing" },
  });
  const { classification, capabilities } = run({
    subject: resolved,
    evidence: evidence({ types: [{ value: "Apartment/Condo", scope: "listing" }] }),
    capabilityFacts: { regionalRentBenchmark: fact(true, "regional", "cmhc") },
  });
  assert.equal(classification.unitUse.value, "residential");
  const status = deriveCaRentalJourneyStatus(capabilities, classification, {
    hasCmhcRent: true,
    hasRegionalContext: true,
  });
  assert.deepEqual(status, {
    availability: "limited",
    message:
      "Regional CMHC rent context and a user-entered rent scenario support a limited screen; neither is an address-level expected rent.",
  });
});

test("CA residential WITHOUT CMHC: legacy copy is preserved (previously untested no-benchmark path)", () => {
  const resolved = subject({
    rawInput: "402-123 Main St, Victoria, BC, Canada",
    normalizedAddress: "402-123 Main St",
    parsedUnit: "402",
    listing: { address: "402-123 Main St", unit: "402", source: "zoocasa_listing" },
  });
  const { classification, capabilities } = run({
    subject: resolved,
    evidence: evidence({ types: [{ value: "Apartment/Condo", scope: "listing" }] }),
    capabilityFacts: {},
  });
  assert.equal(classification.unitUse.value, "residential");
  const status = deriveCaRentalJourneyStatus(capabilities, classification, {
    hasCmhcRent: false,
    hasRegionalContext: false,
  });
  assert.deepEqual(status, {
    availability: "limited",
    message:
      "No reliable rent estimate is available for this address or city; enter your own monthly-rent scenario to screen it against the listing price.",
  });
});

test("capabilities null: legacy behavior preserved exactly (savedAssessment predates capability tracking)", () => {
  const withCmhc = deriveCaRentalJourneyStatus(null, null, { hasCmhcRent: true, hasRegionalContext: true });
  const withoutCmhc = deriveCaRentalJourneyStatus(undefined, undefined, { hasCmhcRent: false, hasRegionalContext: false });
  assert.deepEqual(withCmhc, legacyStub(true));
  assert.deepEqual(withoutCmhc, legacyStub(false));
});

// ---------------------------------------------------------------------------
// US guard: the multifamily unit-rent-over-building-price case is already
// covered at scripts/test-property-intelligence-p3.ts:242-267 ("whole
// multi-family listing never combines building value with a single-unit
// rent AVM") — not duplicated here.
// ---------------------------------------------------------------------------

assert.equal(providerCalls, 0);
console.log(`\n${passed}/${passed} CA-exclusion fixtures passed; provider calls: ${providerCalls}\n`);
