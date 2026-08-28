/**
 * P6A buyer-composition contract fixtures. Pure/offline: no KV, database,
 * browser, or provider calls.
 *
 * Run: node --import tsx scripts/test-property-intelligence-p6a.tsx
 */

import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import BuyerCompositionNotice from "../src/components/buyer-composition-notice";
import { buildBuyerCompositionModel } from "../src/lib/property-intelligence/buyer-journey";
import { evaluatePropertyCapabilities, type PropertyCapabilityFacts } from "../src/lib/property-intelligence/capabilities";
import { classifyProperty } from "../src/lib/property-intelligence/classification";
import {
  availableEvidence,
  createPropertyEvidenceSnapshot,
  type EvidenceScope,
  type EvidenceSource,
} from "../src/lib/property-intelligence/evidence";
import { resolveAssessmentSubject, type ResolveAssessmentSubjectInput } from "../src/lib/property-intelligence/subject";

let passed = 0;
let providerCalls = 0;
global.fetch = (async () => {
  providerCalls += 1;
  throw new Error("P6A buyer composition attempted a provider call");
}) as typeof fetch;

function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

function subject(overrides: Partial<ResolveAssessmentSubjectInput> = {}) {
  return resolveAssessmentSubject({
    rawInput: "123 Main St, Austin, TX",
    normalizedAddress: "123 Main St, Austin, TX",
    ...overrides,
  });
}

function evidence(
  types: Array<{ value: string; scope: EvidenceScope; source?: EvidenceSource }>,
  occupancy?: boolean
) {
  const collectedAt = "2026-08-28T12:00:00.000Z";
  const base = createPropertyEvidenceSnapshot({
    surface: "assess_on_demand",
    rawInput: "123 Main St, Austin, TX 78701",
    normalizedAddress: "123 Main St, Austin, TX 78701",
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
    propertyTypes: types.map((item) => availableEvidence(
      item.value,
      meta(item.source ?? (item.scope === "listing" ? "rentcast_listing" : "rentcast_property"), item.scope)
    )),
    occupancy: occupancy == null
      ? []
      : [availableEvidence(occupancy, meta("rentcast_property", "provider_record"))],
  };
}

function run(args: {
  subject: ReturnType<typeof subject>;
  types: Array<{ value: string; scope: EvidenceScope; source?: EvidenceSource }>;
  facts?: PropertyCapabilityFacts;
  occupancy?: boolean;
}) {
  const classification = classifyProperty({
    subject: args.subject,
    evidence: evidence(args.types, args.occupancy),
    facts: { activeListing: !!args.facts?.activeListing },
  });
  const capabilities = evaluatePropertyCapabilities({
    subject: args.subject,
    classification,
    facts: args.facts,
  });
  const model = buildBuyerCompositionModel({ subject: args.subject, classification, capabilities });
  return { classification, capabilities, model };
}

console.log("\nP6A buyer-composition fixtures\n");

test("supported detached listing preserves the complete buyer composition", () => {
  const resolved = subject({
    listing: { address: "123 Main St, Austin, TX", source: "rentcast_listing" },
    propertyRecord: { address: "123 Main St, Austin, TX", propertyType: "Single Family" },
  });
  const { model } = run({
    subject: resolved,
    types: [
      { value: "Single Family", scope: "listing" },
      { value: "Single Family", scope: "provider_record" },
    ],
    facts: {
      addressSaleValue: { available: true, scope: "building", source: "rentcast_listing" },
      activeListing: true,
      offerComputed: true,
      countyMarketContext: true,
      insurancePrefillCore: true,
    },
  });
  assert.equal(model.contract, "capability");
  assert.equal(model.availability, "supported");
  assert.equal(model.showOfferAnalysis, true);
  assert.equal(model.showValuationContext, true);
  assert.equal(model.showAcquisitionAnalysis, true);
  assert.equal(model.showPartnerActions, true);
  assert.equal(model.showInsurancePrefill, true);
  assert.equal(model.notice, null);
});

test("off-market residential keeps valuation context without inventing an offer", () => {
  const resolved = subject({
    propertyRecord: { address: "123 Main St, Austin, TX", propertyType: "Single Family" },
  });
  const { model } = run({
    subject: resolved,
    types: [{ value: "Single Family", scope: "provider_record" }],
    facts: {
      addressSaleValue: { available: true, scope: "parcel", source: "rentcast_avm" },
      activeListing: false,
      countyMarketContext: true,
      insurancePrefillCore: true,
    },
  });
  assert.equal(model.showOfferAnalysis, false);
  assert.equal(model.showAcquisitionAnalysis, false);
  assert.equal(model.showValuationContext, true);
  assert.equal(model.showPartnerActions, true);
});

test("regional fallback exposes context but no property-oriented buyer modules", () => {
  const resolved = subject();
  const { model } = run({
    subject: resolved,
    types: [],
    facts: { countyMarketContext: true },
  });
  assert.equal(model.availability, "limited");
  assert.equal(model.showOfferAnalysis, false);
  assert.equal(model.showValuationContext, false);
  assert.equal(model.showPartnerActions, false);
  assert.equal(model.showInsurancePrefill, false);
  assert.equal(model.showRegionalContext, true);
  assert.equal(model.notice?.kind, "limited");
});

test("unenriched Discover records retain the explicit legacy buyer contract", () => {
  const model = buildBuyerCompositionModel({});
  assert.equal(model.contract, "legacy");
  assert.equal(model.showOfferAnalysis, true);
  assert.equal(model.showPartnerActions, true);
  assert.equal(model.showInsurancePrefill, true);
});

for (const excluded of [
  { name: "vacant land", raw: "Vacant Land", reason: "provider_exclusion" },
  { name: "commercial", raw: "Retail Commercial", reason: "provider_exclusion" },
  { name: "institutional", raw: "Government Institutional", reason: "provider_exclusion" },
] as const) {
  test(`${excluded.name} withholds residential offer, motivation, partner, and insurance composition`, () => {
    const resolved = subject({
      listing: { address: "123 Main St, Austin, TX", source: "rentcast_listing" },
      propertyRecord: { address: "123 Main St, Austin, TX", propertyType: excluded.raw },
    });
    const { model } = run({
      subject: resolved,
      types: [
        { value: excluded.raw, scope: "listing" },
        { value: excluded.raw, scope: "provider_record" },
      ],
      facts: {
        addressSaleValue: { available: true, scope: "building" },
        activeListing: true,
        offerComputed: true,
        countyMarketContext: true,
        insurancePrefillCore: true,
      },
    });
    assert.equal(model.propertyEvidenceDenied, true);
    assert.equal(model.denialReason, excluded.reason);
    assert.equal(model.showOfferAnalysis, false);
    assert.equal(model.showAcquisitionAnalysis, false);
    assert.equal(model.showPartnerActions, false);
    assert.equal(model.showInsurancePrefill, false);
    assert.equal(model.notice?.kind, "withheld");
  });
}

test("whole apartment-building scope cannot inherit a residential unit buyer view", () => {
  const resolved = subject({
    listing: { address: "123 Main St, Austin, TX", source: "rentcast_listing" },
    propertyRecord: { address: "123 Main St, Austin, TX", propertyType: "Apartment Building" },
  });
  const { model } = run({
    subject: resolved,
    types: [
      { value: "Apartment Building", scope: "listing" },
      { value: "Apartment Building", scope: "provider_record" },
    ],
    facts: {
      addressSaleValue: { available: true, scope: "building" },
      activeListing: true,
      offerComputed: true,
      insurancePrefillCore: true,
    },
  });
  assert.equal(model.propertyEvidenceDenied, true);
  assert.equal(model.denialReason, "unsupported_scope");
});

test("residential unit in a mixed-use building stays supported with explicit scope context", () => {
  const resolved = subject({
    rawInput: "123 Main St Unit 402, Austin, TX",
    parsedUnit: "402",
    listing: { address: "123 Main St Unit 402, Austin, TX", unit: "402", source: "rentcast_listing" },
    propertyRecord: { address: "123 Main St, Austin, TX", propertyType: "Mixed Use" },
  });
  const { model } = run({
    subject: resolved,
    types: [
      { value: "Residential Condo", scope: "listing" },
      { value: "Mixed Use", scope: "provider_record" },
    ],
    facts: {
      addressSaleValue: { available: true, scope: "unit" },
      activeListing: true,
      offerComputed: true,
      insurancePrefillCore: true,
    },
  });
  assert.equal(model.propertyEvidenceDenied, false);
  assert.equal(model.showOfferAnalysis, true);
  assert.equal(model.notice?.kind, "scope_context");
  const markup = renderToStaticMarkup(<BuyerCompositionNotice model={model} />);
  assert.match(markup, /Residential unit scope confirmed/);
  assert.match(markup, /containing building or parcel/);
});

test("occupancy evidence never changes buyer composition", () => {
  const resolved = subject({
    listing: { address: "123 Main St, Austin, TX", source: "rentcast_listing" },
    propertyRecord: { address: "123 Main St, Austin, TX", propertyType: "Single Family" },
  });
  const args = {
    subject: resolved,
    types: [
      { value: "Single Family", scope: "listing" as const },
      { value: "Single Family", scope: "provider_record" as const },
    ],
    facts: {
      addressSaleValue: { available: true, scope: "building" as const },
      activeListing: true,
      offerComputed: true,
      insurancePrefillCore: true,
    },
  };
  const owner = run({ ...args, occupancy: true }).model;
  const absentee = run({ ...args, occupancy: false }).model;
  assert.deepEqual(owner, absentee);
});

assert.equal(providerCalls, 0, "P6A fixtures must make zero provider calls");
console.log(`\n${passed}/${passed} P6A buyer fixtures passed; provider calls: ${providerCalls}\n`);
