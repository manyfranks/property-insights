/**
 * P3.5 anonymous shadow-telemetry contract tests.
 *
 * Run: node --import tsx scripts/test-property-intelligence-p35.ts
 */

import assert from "node:assert/strict";
import { buildPropertyIntelligenceEvents } from "../src/lib/db/property-intelligence-events";
import { availableEvidence, createPropertyEvidenceSnapshot } from "../src/lib/property-intelligence/evidence";
import { classifyProperty } from "../src/lib/property-intelligence/classification";
import {
  evaluatePropertyCapabilities,
  type CapabilityName,
  type PropertyCapabilities,
} from "../src/lib/property-intelligence/capabilities";
import { resolveAssessmentSubject } from "../src/lib/property-intelligence/subject";

let passed = 0;
let providerCalls = 0;
global.fetch = (async () => {
  providerCalls += 1;
  throw new Error("P3.5 telemetry builder attempted a provider call");
}) as typeof fetch;

function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const subject = resolveAssessmentSubject({
  rawInput: "123 Main St, Austin, TX 78701",
  normalizedAddress: "123 Main St, Austin, TX 78701",
  listing: {
    address: "123 Main St, Austin, TX 78701",
    source: "rentcast_listing",
    sourceRecordId: "PRIVATE-MLS-ID",
  },
  propertyRecord: {
    address: "123 Main St, Austin, TX 78701",
    propertyType: "Single Family",
  },
});
const evidence = createPropertyEvidenceSnapshot({
  surface: "assess_on_demand",
  rawInput: "123 Main St, Austin, TX 78701",
  normalizedAddress: "123 Main St, Austin, TX 78701",
  selectedPlaceId: "PRIVATE-PLACE-ID",
  collectedAt: "2026-08-11T12:00:00.000Z",
});
evidence.propertyTypes.push(availableEvidence("Single Family", {
  source: "rentcast_property",
  scope: "provider_record",
  kind: "observed",
  confidence: "high",
  sourceRecordId: "PRIVATE-RECORD-ID",
  ingestedAt: evidence.collectedAt,
}));
evidence.propertyTypes.push(availableEvidence("Single Family", {
  source: "rentcast_listing",
  scope: "listing",
  kind: "observed",
  confidence: "high",
  sourceRecordId: "PRIVATE-MLS-ID",
  ingestedAt: evidence.collectedAt,
}));
evidence.occupancy.push(availableEvidence(true, {
  source: "rentcast_property",
  scope: "provider_record",
  kind: "observed",
  confidence: "high",
  ingestedAt: evidence.collectedAt,
}));

const classification = classifyProperty({ subject, evidence });
const capabilities = evaluatePropertyCapabilities({
  subject,
  classification,
  facts: {
    addressSaleValue: { available: true, scope: "building", source: "PRIVATE-SOURCE" },
    activeListing: true,
    offerComputed: true,
    insurancePrefillCore: true,
  },
});
const events = buildPropertyIntelligenceEvents({
  country: "US",
  region: "tx-private-suffix",
  surface: "assess_on_demand",
  resultVariant: "listed",
  subject,
  classification,
  capabilities,
});

console.log("\nP3.5 anonymous shadow-telemetry fixtures\n");

test("classification and missing-capability events are emitted separately", () => {
  assert.deepEqual(events.map((event) => event.eventType), [
    "classification_result",
    "capability_missing",
  ]);
  assert.ok(Object.keys(events[1].capabilities).length > 0);
  assert.ok(Object.values(events[1].capabilities).every((reason) => reason !== "available"));
});

test("telemetry has no identity, address, unit identifier, or intent fields", () => {
  const serialized = JSON.stringify(events).toLowerCase();
  for (const forbidden of [
    "123 main",
    "private-mls",
    "private-place",
    "private-record",
    "private-source",
    "userid",
    "user_id",
    "owner-occupied",
    "occupancy",
    "goal",
    "journey",
    "investmentintent",
  ]) {
    assert.equal(serialized.includes(forbidden), false, `leaked ${forbidden}`);
  }
});

test("classification telemetry keeps decisions but strips raw evidence", () => {
  assert.equal(events[0].classification.parcelUse, "residential");
  assert.equal(events[0].classification.parcelUseConfidence, "high");
  assert.equal("evidence" in events[0].classification, false);
  assert.equal("explanation" in events[0].classification, false);
});

test("capability telemetry stores reasons without sources or explanations", () => {
  assert.equal(events[0].capabilities.addressSaleValuation, "available");
  assert.equal(events[0].capabilities.addressRentEstimate, "missing_field");
  assert.ok(Object.values(events[0].capabilities).every((value) => typeof value === "string"));
});

test("region is normalized and bounded to a coarse eight-character field", () => {
  assert.equal(events[0].region, "TX-PRIVA");
});

test("fully available synthetic capability set does not create a missing event", () => {
  const allAvailableItems: PropertyCapabilities["items"] = { ...capabilities.items };
  for (const name of Object.keys(allAvailableItems) as CapabilityName[]) {
    allAvailableItems[name] = {
      available: true,
      reason: "available",
      evidence: [],
      explanation: "fixture",
    };
  }
  const allAvailable = {
    ...capabilities,
    items: allAvailableItems,
  } satisfies PropertyCapabilities;
  const complete = buildPropertyIntelligenceEvents({
    country: "US",
    region: "TX",
    surface: "discover_enriched",
    resultVariant: "discover",
    subject,
    classification,
    capabilities: allAvailable,
  });
  assert.equal(complete.length, 1);
  assert.equal(complete[0].eventType, "classification_result");
});

assert.equal(providerCalls, 0);
console.log(`\n${passed}/${passed} P3.5 telemetry fixtures passed; provider calls: ${providerCalls}\n`);
