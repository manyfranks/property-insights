/**
 * Unit tests for src/lib/insurance/providers/obie/prefill-mapping.ts — pure
 * functions, no I/O, so this exercises them directly rather than following
 * test-comparables.ts's live-fetch/backtest shape. Structured after
 * scripts/validate-insurance-a1-domain.ts's expect()/mustReject() style.
 *
 * These mapping helpers are NOT wired into any UI or call site yet — this
 * script is the only thing exercising them until Obie credentials arrive.
 *
 * Run: npx tsx scripts/test-obie-prefill-mapping.ts
 *      (or: npm run test:obie-mapping)
 */

import {
  toObieDwellingType,
  asMonthlyRent,
  toAnnualLossOfRent,
  monthlyRentToAnnual,
  splitPersonName,
  ObiePrefillMappingError,
  type MonthlyRent,
} from "../src/lib/insurance/providers/obie/prefill-mapping";

let failures = 0;

function expect(condition: unknown, message: string): void {
  if (!condition) {
    failures++;
    console.error(`  ✗ ${message}`);
  } else {
    console.log(`  ✓ ${message}`);
  }
}

function mustThrow(action: () => void, message: string): void {
  try {
    action();
    failures++;
    console.error(`  ✗ ${message} (expected throw, none occurred)`);
  } catch (err) {
    if (err instanceof ObiePrefillMappingError) {
      console.log(`  ✓ ${message}`);
    } else {
      failures++;
      console.error(`  ✗ ${message} (threw, but not ObiePrefillMappingError: ${err})`);
    }
  }
}

// ---------------------------------------------------------------------------
// 1. toObieDwellingType
// ---------------------------------------------------------------------------

console.log("\n[dwelling type] normalizedType branches");
expect(toObieDwellingType({ normalizedType: "SFH" }) === "SFR", "SFH -> SFR");
expect(toObieDwellingType({ normalizedType: "Condo" }) === "CONDO", "Condo -> CONDO");
expect(toObieDwellingType({ normalizedType: "Townhouse" }) === "SFR", "Townhouse -> SFR (single dwelling unit)");
expect(toObieDwellingType({ normalizedType: "Other" }) === "OTHER", "Other -> OTHER");
expect(toObieDwellingType({}) === "OTHER", "empty input -> OTHER");
expect(toObieDwellingType({ normalizedType: null, rawType: null }) === "OTHER", "null normalizedType/rawType -> OTHER");

console.log("\n[dwelling type] rawType branches (comparables.ts TYPE_MAP vocabulary)");
expect(toObieDwellingType({ rawType: "Single Family Residence" }) === "SFR", "raw 'Single Family Residence' -> SFR");
expect(toObieDwellingType({ rawType: "detached" }) === "SFR", "raw 'detached' -> SFR");
expect(toObieDwellingType({ rawType: "Condominium" }) === "CONDO", "raw 'Condominium' -> CONDO");
expect(toObieDwellingType({ rawType: "APARTMENT" }) === "CONDO", "raw 'APARTMENT' (case-insensitive) -> CONDO");
expect(toObieDwellingType({ rawType: "  Townhouse  " }) === "SFR", "raw '  Townhouse  ' (whitespace) -> SFR");
expect(toObieDwellingType({ rawType: "Semi Detached (Half Duplex)" }) === "SFR", "raw 'Semi Detached (Half Duplex)' -> SFR");
expect(toObieDwellingType({ rawType: "Manufactured Home" }) === "OTHER", "raw 'Manufactured Home' -> OTHER");
expect(toObieDwellingType({ rawType: "some totally unknown type" }) === "OTHER", "unrecognized raw string -> OTHER");

console.log("\n[dwelling type] new Obie-specific raw vocabulary");
expect(toObieDwellingType({ rawType: "duplex" }) === "DUPLEX", "raw 'duplex' -> DUPLEX");
expect(toObieDwellingType({ rawType: "Triplex" }) === "TRIPLEX", "raw 'Triplex' -> TRIPLEX");
expect(toObieDwellingType({ rawType: "fourplex" }) === "QUADPLEX", "raw 'fourplex' -> QUADPLEX");
expect(toObieDwellingType({ rawType: "quadplex" }) === "QUADPLEX", "raw 'quadplex' -> QUADPLEX");
expect(toObieDwellingType({ rawType: "quad" }) === "QUADPLEX", "raw 'quad' -> QUADPLEX");
expect(toObieDwellingType({ rawType: "multi family" }) === "APARTMENT_BUILDING", "raw 'multi family' -> APARTMENT_BUILDING");
expect(toObieDwellingType({ rawType: "Apartment Building" }) === "APARTMENT_BUILDING", "raw 'Apartment Building' -> APARTMENT_BUILDING");

console.log("\n[dwelling type] normalizedType takes precedence over rawType when both present");
expect(
  toObieDwellingType({ normalizedType: "Condo", rawType: "detached" }) === "CONDO",
  "normalizedType 'Condo' wins over conflicting rawType 'detached'"
);

console.log("\n[dwelling type] unitCount precedence");
expect(toObieDwellingType({ rawType: "detached", unitCount: 2 }) === "DUPLEX", "generic SFR + unitCount=2 -> DUPLEX");
expect(toObieDwellingType({ rawType: "detached", unitCount: 3 }) === "TRIPLEX", "generic SFR + unitCount=3 -> TRIPLEX");
expect(toObieDwellingType({ rawType: "detached", unitCount: 4 }) === "QUADPLEX", "generic SFR + unitCount=4 -> QUADPLEX");
expect(toObieDwellingType({ rawType: "detached", unitCount: 5 }) === "APARTMENT_BUILDING", "generic SFR + unitCount=5 -> APARTMENT_BUILDING");
expect(toObieDwellingType({ rawType: "detached", unitCount: 12 }) === "APARTMENT_BUILDING", "generic SFR + unitCount=12 (5+) -> APARTMENT_BUILDING");
expect(toObieDwellingType({ unitCount: 3 }) === "TRIPLEX", "unknown/OTHER base + unitCount=3 -> TRIPLEX");
expect(
  toObieDwellingType({ normalizedType: "SFH", unitCount: 1 }) === "SFR",
  "generic SFR + unitCount=1 -> stays SFR (no override rule for 1)"
);

console.log("\n[dwelling type] CONDO must never be downgraded by unitCount");
expect(
  toObieDwellingType({ normalizedType: "Condo", unitCount: 1 }) === "CONDO",
  "explicit CONDO + unitCount=1 -> stays CONDO (not downgraded to SFR)"
);
expect(
  toObieDwellingType({ normalizedType: "Condo", unitCount: 4 }) === "CONDO",
  "explicit CONDO + unitCount=4 -> stays CONDO (unit count of the building doesn't reclassify a condo unit)"
);
expect(
  toObieDwellingType({ rawType: "duplex", unitCount: 6 }) === "DUPLEX",
  "explicit DUPLEX (from raw string) + contradicting unitCount=6 -> stays DUPLEX (already specific, not generic)"
);

// ---------------------------------------------------------------------------
// 2. Rent conversion
// ---------------------------------------------------------------------------

console.log("\n[rent] valid conversion");
expect(toAnnualLossOfRent(asMonthlyRent(2000)) === 24000, "2000/mo -> 24000/yr");
expect(toAnnualLossOfRent(asMonthlyRent(1)) === 12, "1/mo -> 12/yr");

console.log("\n[rent] zero is valid");
expect(toAnnualLossOfRent(asMonthlyRent(0)) === 0, "0/mo -> 0/yr");
expect(monthlyRentToAnnual(0) === 0, "monthlyRentToAnnual(0) === 0");

console.log("\n[rent] null/undefined passthrough on the convenience wrapper");
expect(monthlyRentToAnnual(null) === null, "monthlyRentToAnnual(null) === null");
expect(monthlyRentToAnnual(undefined) === null, "monthlyRentToAnnual(undefined) === null");

console.log("\n[rent] rejection of invalid values");
mustThrow(() => asMonthlyRent(-1), "asMonthlyRent(-1) throws ObiePrefillMappingError");
mustThrow(() => asMonthlyRent(NaN), "asMonthlyRent(NaN) throws ObiePrefillMappingError");
mustThrow(() => asMonthlyRent(Infinity), "asMonthlyRent(Infinity) throws ObiePrefillMappingError");
mustThrow(() => asMonthlyRent(-Infinity), "asMonthlyRent(-Infinity) throws ObiePrefillMappingError");
mustThrow(() => monthlyRentToAnnual(-500), "monthlyRentToAnnual(-500) throws (routes through validated path)");
mustThrow(() => monthlyRentToAnnual(NaN), "monthlyRentToAnnual(NaN) throws (routes through validated path)");

console.log("\n[rent] rounding to nearest whole unit");
expect(toAnnualLossOfRent(asMonthlyRent(100.04)) === 1200, "100.04 * 12 = 1200.48 -> rounds to 1200");
expect(toAnnualLossOfRent(asMonthlyRent(100.5)) === 1206, "100.5 * 12 = 1206 exactly -> 1206");
expect(toAnnualLossOfRent(asMonthlyRent(100.99)) === 1212, "100.99 * 12 = 1211.88 -> rounds to 1212");
expect(monthlyRentToAnnual(1499.999) === 18000, "monthlyRentToAnnual rounds through the same path (1499.999 -> 18000)");

// Type-level sanity: asMonthlyRent's return should be usable directly where
// a MonthlyRent is expected (not asserted at runtime — this just documents
// the intended call shape for a future integrator reading this test file).
const _typeCheck: MonthlyRent = asMonthlyRent(500);
void _typeCheck;

// ---------------------------------------------------------------------------
// 3. Name splitting
// ---------------------------------------------------------------------------

console.log("\n[names] Clerk precedence");
expect(
  JSON.stringify(splitPersonName({ fullName: "Full Legal Name", clerkFirstName: "Matt", clerkLastName: "Francis" })) ===
    JSON.stringify({ firstName: "Matt", lastName: "Francis" }),
  "Clerk first/last wins over conflicting fullName"
);
expect(
  JSON.stringify(splitPersonName({ fullName: "Matt Francis", clerkFirstName: "Matt", clerkLastName: "" })) ===
    JSON.stringify({ firstName: "Matt", lastName: "Francis" }),
  "Clerk lastName empty -> falls through to fullName split, not partial-Clerk"
);
expect(
  JSON.stringify(splitPersonName({ fullName: "Matt Francis", clerkFirstName: "  ", clerkLastName: "Francis" })) ===
    JSON.stringify({ firstName: "Matt", lastName: "Francis" }),
  "Clerk firstName whitespace-only -> falls through to fullName split"
);

console.log("\n[names] fullName splitting");
expect(
  JSON.stringify(splitPersonName({ fullName: "Matt Francis" })) === JSON.stringify({ firstName: "Matt", lastName: "Francis" }),
  "two-token name splits cleanly"
);
expect(
  JSON.stringify(splitPersonName({ fullName: "Matt" })) === JSON.stringify({ firstName: "Matt", lastName: null }),
  "single-token name -> firstName only, lastName null"
);
expect(
  JSON.stringify(splitPersonName({ fullName: "Mary Jane Watson Parker" })) ===
    JSON.stringify({ firstName: "Mary", lastName: "Jane Watson Parker" }),
  "three-plus tokens -> first token firstName, remainder joined as lastName"
);
expect(
  JSON.stringify(splitPersonName({ fullName: "  Matt   Francis  " })) ===
    JSON.stringify({ firstName: "Matt", lastName: "Francis" }),
  "messy internal/leading/trailing whitespace collapses correctly"
);

console.log("\n[names] empty/null handling — never throws");
expect(
  JSON.stringify(splitPersonName({ fullName: "" })) === JSON.stringify({ firstName: null, lastName: null }),
  "empty string fullName -> both null"
);
expect(
  JSON.stringify(splitPersonName({ fullName: "   " })) === JSON.stringify({ firstName: null, lastName: null }),
  "whitespace-only fullName -> both null"
);
expect(
  JSON.stringify(splitPersonName({ fullName: null })) === JSON.stringify({ firstName: null, lastName: null }),
  "null fullName, no Clerk names -> both null"
);
expect(
  JSON.stringify(splitPersonName({})) === JSON.stringify({ firstName: null, lastName: null }),
  "fully empty input -> both null"
);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log();
if (failures > 0) {
  console.error(`FAILED: ${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("PASSED: obie prefill-mapping tests");
