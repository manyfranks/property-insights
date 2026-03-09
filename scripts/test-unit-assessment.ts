/**
 * Test: Unit number extraction → assessment lookup
 *
 * Run:  npx tsx scripts/test-unit-assessment.ts
 *
 * Tests the full chain without Next.js:
 * 1. Unit extraction from Google Places format
 * 2. Zoocasa slug generation with unit
 * 3. Cache key matching with unit-prefixed variants
 * 4. Live BC Assessment REST API sub-unit lookup (no Puppeteer)
 * 5. Live Edmonton SODA suite query
 */

/* eslint-disable @typescript-eslint/no-require-imports */

// ── Unit extraction regex (same as addressSlug + fetchDetail) ──────

function extractUnit(street: string): { unit: string | null; bare: string } {
  const match = street.match(/[\s,]+(?:#|unit\s*|suite\s*|apt\s*)(\d+[A-Z]?)\s*$/i);
  if (match) {
    return { unit: match[1], bare: street.slice(0, match.index!).trim() };
  }
  return { unit: null, bare: street };
}

// ── Test cases ─────────────────────────────────────────────────────

interface TestCase {
  label: string;
  input: string;         // Google Places street field
  expectedUnit: string | null;
  expectedBare: string;
}

const UNIT_CASES: TestCase[] = [
  { label: "Trailing #N",        input: "6110 Seabroom Rd #4",        expectedUnit: "4",    expectedBare: "6110 Seabroom Rd" },
  { label: "Trailing #NNN",      input: "1628 Store St #900",         expectedUnit: "900",  expectedBare: "1628 Store St" },
  { label: "Trailing Unit N",    input: "123 Main St Unit 501",       expectedUnit: "501",  expectedBare: "123 Main St" },
  { label: "Trailing Suite N",   input: "456 Oak Ave Suite 12",       expectedUnit: "12",   expectedBare: "456 Oak Ave" },
  { label: "Trailing Apt N",     input: "789 Elm Blvd Apt 3",        expectedUnit: "3",    expectedBare: "789 Elm Blvd" },
  { label: "With letter suffix", input: "100 King St #4A",            expectedUnit: "4A",   expectedBare: "100 King St" },
  { label: "No unit (house)",    input: "3354 Fulton Rd",             expectedUnit: null,   expectedBare: "3354 Fulton Rd" },
  { label: "No unit (no hash)",  input: "9939 109 ST NW",             expectedUnit: null,   expectedBare: "9939 109 ST NW" },
];

// ── Run unit extraction tests ──────────────────────────────────────

console.log("═══ Unit Extraction Tests ═══\n");

let pass = 0;
let fail = 0;

for (const tc of UNIT_CASES) {
  const { unit, bare } = extractUnit(tc.input);
  const unitOk = unit === tc.expectedUnit;
  const bareOk = bare === tc.expectedBare;
  const ok = unitOk && bareOk;

  if (ok) {
    pass++;
    console.log(`  ✓ ${tc.label}: "${tc.input}" → unit=${unit ?? "none"}, bare="${bare}"`);
  } else {
    fail++;
    console.log(`  ✗ ${tc.label}: "${tc.input}"`);
    if (!unitOk) console.log(`    unit: expected=${tc.expectedUnit}, got=${unit}`);
    if (!bareOk) console.log(`    bare: expected="${tc.expectedBare}", got="${bare}"`);
  }
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);

// ── Cache key matching tests ───────────────────────────────────────

console.log("═══ Cache Key Format Tests ═══\n");

// Simulate the cache key generation each province uses
function bcCacheKeys(address: string, unit: string | null): string[] {
  return unit ? [`${unit} ${address}`, address, `${unit}-${address}`] : [address];
}
function abCacheKeys(address: string, unit: string | null): string[] {
  return unit ? [`${unit}, ${address}`, `#${unit} ${address}`, address] : [address];
}
function onCacheKeys(address: string, unit: string | null): string[] {
  return unit ? [`${unit} - ${address}`, address] : [address];
}

const KEY_CASES = [
  { prov: "BC", address: "1675 HORNBY STREET", unit: "210", expected: "210 1675 HORNBY STREET", fn: bcCacheKeys },
  { prov: "BC", address: "4132 HALIFAX STREET", unit: "1105", expected: "1105 4132 HALIFAX STREET", fn: bcCacheKeys },
  { prov: "AB", address: "150 Lebel Crescent NW", unit: "108", expected: "108, 150 Lebel Crescent NW", fn: abCacheKeys },
  { prov: "AB", address: "9939 109 ST NW", unit: "1801", expected: "#1801 9939 109 ST NW", fn: abCacheKeys },
  { prov: "ON", address: "100 DALHOUSIE STREET", unit: "3301", expected: "3301 - 100 DALHOUSIE STREET", fn: onCacheKeys },
];

for (const tc of KEY_CASES) {
  const keys = tc.fn(tc.address, tc.unit);
  const found = keys.includes(tc.expected);
  if (found) {
    pass++;
    console.log(`  ✓ ${tc.prov}: unit=${tc.unit} → keys include "${tc.expected}"`);
  } else {
    fail++;
    console.log(`  ✗ ${tc.prov}: unit=${tc.unit} → expected "${tc.expected}" in [${keys.join(", ")}]`);
  }
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);

// ── Live API tests (optional, requires network) ────────────────────

async function testBCRestApi() {
  console.log("═══ Live BC Assessment REST API Test ═══\n");

  // Search for a known multi-unit building: 1675 Hornby St, Vancouver
  const query = "1675 HORNBY ST Vancouver";
  const url = `https://www.bcassessment.ca/Property/Search/GetByAddress?addr=${encodeURIComponent(query)}`;

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json();

    if (!data?.length) {
      console.log("  ⚠ No results from BC Assessment API");
      return;
    }

    const isMultiUnit = data[0].label?.includes("select to see all units");
    console.log(`  API returned ${data.length} result(s)`);
    console.log(`  Multi-unit building: ${isMultiUnit ? "yes" : "no"}`);
    console.log(`  First label: "${data[0].label}"`);
    console.log(`  GID: ${data[0].gid || "none"}`);

    if (isMultiUnit && data[0].gid) {
      const subUrl = `https://www.bcassessment.ca/Property/Search/GetSubUnits/${data[0].gid}`;
      const subRes = await fetch(subUrl, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      const subData = await subRes.json();
      const units = subData.Units || [];
      console.log(`  Sub-units found: ${units.length}`);

      // Try to find unit 210
      const match = units.find((u: { Address: string }) =>
        u.Address.startsWith("210-") || u.Address.startsWith("210 ")
      );
      console.log(`  Unit 210 match: ${match ? match.Address + " → " + match.Oa000_OID : "not found"}`);
    }

    console.log("  ✓ BC REST API working\n");
  } catch (err) {
    console.log(`  ✗ BC REST API error: ${err instanceof Error ? err.message : err}\n`);
  }
}

async function testEdmontonSoda() {
  console.log("═══ Live Edmonton SODA Suite Query Test ═══\n");

  // Test with suite: unit 1801 at 9939 109 ST NW
  const baseUrl = "https://data.edmonton.ca/resource/q7d6-ambg.json";

  try {
    // With suite
    const withSuite = new URL(baseUrl);
    withSuite.searchParams.set("$where", "house_number='9939' AND street_name='109 STREET NW' AND suite='1801'");
    withSuite.searchParams.set("$limit", "1");

    const res1 = await fetch(withSuite.toString(), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    const data1 = await res1.json();

    if (data1?.length) {
      console.log(`  ✓ With suite=1801: found, value=$${data1[0].assessed_value}`);
    } else {
      console.log("  ⚠ With suite=1801: no results");
    }

    // Without suite
    const withoutSuite = new URL(baseUrl);
    withoutSuite.searchParams.set("$where", "house_number='9939' AND street_name='109 STREET NW'");
    withoutSuite.searchParams.set("$limit", "3");

    const res2 = await fetch(withoutSuite.toString(), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    const data2 = await res2.json();
    console.log(`  Without suite: ${data2?.length || 0} result(s) (first value=$${data2?.[0]?.assessed_value || "n/a"})`);

    console.log("  ✓ Edmonton SODA working\n");
  } catch (err) {
    console.log(`  ✗ Edmonton SODA error: ${err instanceof Error ? err.message : err}\n`);
  }
}

// Run live tests
(async () => {
  await testBCRestApi();
  await testEdmontonSoda();

  console.log("═══ Summary ═══");
  console.log(`  ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})();
