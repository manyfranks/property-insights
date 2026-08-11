/**
 * Offline P0 regression harness for the Property Intelligence phasemap.
 *
 * Covers the current US data-path contract without RentCast, KV, Neon, or
 * browser calls. Later phases add real subject resolution; P0 only locks the
 * existing listed/off-market/regional-fallback behavior and its honest
 * machine-readable degradation reasons.
 *
 * Run: npx tsx scripts/test-property-intelligence-p0.ts
 */

import {
  decideUsAssessmentDataPath,
  US_COUNTY_FALLBACK_LABEL,
  usCountyFallbackDisclosure,
  type UsAssessmentDataPathDecision,
} from "../src/lib/property-intelligence/p0-fallback";

interface FixtureBundle {
  record: object | null;
  avm: object | null;
  rent: object | null;
  activeListing: object | null;
  meta: { quotaExhausted: boolean; errors: string[] };
}

interface BaselineFixture {
  id: string;
  description: string;
  bundle: FixtureBundle | null;
  expected: UsAssessmentDataPathDecision;
  p0Boundary: string;
}

function bundle(overrides: Partial<FixtureBundle> = {}): FixtureBundle {
  return {
    record: null,
    avm: null,
    rent: null,
    activeListing: null,
    meta: { quotaExhausted: false, errors: [] },
    ...overrides,
  };
}

const fixtures: BaselineFixture[] = [
  {
    id: "detached_residential_listing",
    description: "Confirmed residential record with an active listing",
    bundle: bundle({ record: {}, avm: {}, activeListing: {} }),
    expected: { kind: "listed" },
    p0Boundary: "Existing listed flow remains unchanged.",
  },
  {
    id: "explicit_residential_unit_listing",
    description: "Explicit unit whose already-fetched bundle has an active listing",
    bundle: bundle({ record: {}, activeListing: {} }),
    expected: { kind: "listed" },
    p0Boundary: "P0 does not reinterpret the containing building as the subject.",
  },
  {
    id: "multi_unit_building_without_unit",
    description: "Address-level property record without an active listing or resolved unit",
    bundle: bundle({ record: {}, avm: {} }),
    expected: { kind: "off_market" },
    p0Boundary: "Scope clarification is deferred to P2; P0 does not auto-classify or auto-switch.",
  },
  {
    id: "mixed_use_building_residential_unit",
    description: "Residential unit listing inside a potentially mixed-use containing building",
    bundle: bundle({ record: {}, activeListing: {} }),
    expected: { kind: "listed" },
    p0Boundary: "Containing-building use does not trigger a P0 failpath.",
  },
  {
    id: "vacant_land_record",
    description: "Provider property record/AVM exists but no active listing",
    bundle: bundle({ record: {}, avm: {} }),
    expected: { kind: "off_market" },
    p0Boundary: "Land classification and capability suppression are deferred to P3.",
  },
  {
    id: "government_or_institutional_clean_miss",
    description: "Geocodable address with no usable RentCast property evidence",
    bundle: bundle(),
    expected: { kind: "regional_fallback", reason: "property_record_not_found" },
    p0Boundary: "Regional context may render; it is not a property valuation or a verified government classification.",
  },
  {
    id: "generic_geocodable_clean_miss",
    description: "Geocodable address with a clean provider miss",
    bundle: bundle(),
    expected: { kind: "regional_fallback", reason: "property_record_not_found" },
    p0Boundary: "Unknown remains unknown; no residential/commercial classification is inferred.",
  },
  {
    id: "provider_quota_exhausted",
    description: "No usable property evidence because the quota guard blocked lookups",
    bundle: bundle({ meta: { quotaExhausted: true, errors: [] } }),
    expected: { kind: "regional_fallback", reason: "provider_quota_exhausted" },
    p0Boundary: "The machine reason records quota exhaustion without changing the fallback UI.",
  },
  {
    id: "provider_error",
    description: "No usable property evidence after a provider error",
    bundle: bundle({ meta: { quotaExhausted: false, errors: ["property: timeout"] } }),
    expected: { kind: "regional_fallback", reason: "provider_error" },
    p0Boundary: "The user request still degrades to regional context.",
  },
  {
    id: "bundle_failure",
    description: "The full provider bundle call failed before returning metadata",
    bundle: null,
    expected: { kind: "regional_fallback", reason: "provider_error" },
    p0Boundary: "The request degrades rather than retrying or spending more provider quota.",
  },
  {
    id: "rent_only_bundle",
    description: "Rent may exist, but there is no record, AVM, or active listing",
    bundle: bundle({ rent: {} }),
    expected: { kind: "regional_fallback", reason: "property_record_not_found" },
    p0Boundary: "Rent alone cannot support a property valuation or offer.",
  },
];

let passed = 0;
let failed = 0;
let providerCalls = 0;

// Defense in depth: the pure decision harness must never attempt a network
// call. Any accidental future fetch fails the run immediately.
const originalFetch = global.fetch;
global.fetch = (async () => {
  providerCalls++;
  throw new Error("P0 fixture harness attempted a network call");
}) as typeof fetch;

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS: ${label}`);
  } else {
    failed++;
    console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("=== Property Intelligence P0 baseline fixtures ===");
for (const fixture of fixtures) {
  const actual = decideUsAssessmentDataPath(fixture.bundle);
  check(
    fixture.id,
    JSON.stringify(actual) === JSON.stringify(fixture.expected),
    `expected=${JSON.stringify(fixture.expected)} actual=${JSON.stringify(actual)}`
  );
  console.log(`        ${fixture.description}`);
  console.log(`        Boundary: ${fixture.p0Boundary}`);
}

console.log("\n=== Fallback copy contract ===");
check(
  "fallback label remains explicitly county-level and modeled",
  US_COUNTY_FALLBACK_LABEL === "County Median Home Value — Modeled Estimate"
);
check(
  "fallback disclosure remains non-property-specific and approximate",
  usCountyFallbackDisclosure("2024") ===
    "Based on US Census ACS county-level median (2024), not property-specific. Treat as approximate."
);
check("fixture harness made zero provider calls", providerCalls === 0, `calls=${providerCalls}`);

global.fetch = originalFetch;
console.log(`\n=== ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
