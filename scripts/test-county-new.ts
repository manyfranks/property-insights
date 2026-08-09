/**
 * scripts/test-county-new.ts
 *
 * Live verification harness for the three new county-assessor adapters —
 * src/lib/assessment/us-county/{cook,king,nyc}.ts (Cook County IL/Chicago,
 * King County WA/Seattle, NYC's five boroughs). Deliberately standalone:
 * imports the adapters directly by relative path rather than through
 * ./index.ts, since that registry file is owned by a concurrent change and
 * these three adapters aren't wired into it yet (see this change's report
 * for the registration snippets to add there).
 *
 * For each county: runs 3 real addresses (recovered live from the source
 * dataset itself during adapter development — see each adapter's module
 * doc for provenance) through lookupByAddress(), plus one obviously-bogus
 * address expected to resolve to null, and prints a results table with
 * per-call latency.
 *
 * USAGE:
 *   npx tsx scripts/test-county-new.ts
 */

import { lookupByAddress as lookupCook } from "../src/lib/assessment/us-county/cook";
import { lookupByAddress as lookupKing } from "../src/lib/assessment/us-county/king";
import { lookupByAddress as lookupNyc } from "../src/lib/assessment/us-county/nyc";
import { CountyAssessorResult } from "../src/lib/assessment/us-county/types";

interface Case {
  label: string;
  street: string;
  city?: string;
  expectNull?: boolean;
}

interface CountySuite {
  county: string;
  lookup: (street: string, city?: string) => Promise<CountyAssessorResult | null>;
  cases: Case[];
}

const SUITES: CountySuite[] = [
  {
    county: "Cook County, IL (Chicago)",
    lookup: lookupCook,
    cases: [
      { label: "real #1", street: "3754 N Kenmore Ave", city: "Chicago" },
      { label: "real #2", street: "3743 N Seminary Ave", city: "Chicago" },
      { label: "real #3", street: "3739 N Seminary Ave", city: "Chicago" },
      { label: "bogus", street: "99999 Nonexistent Fake Ave", city: "Chicago", expectNull: true },
    ],
  },
  {
    county: "King County, WA (Seattle)",
    lookup: lookupKing,
    cases: [
      { label: "real #1", street: "209 N 41st St", city: "Seattle" },
      { label: "real #2", street: "119 N 41st St", city: "Seattle" },
      { label: "real #3", street: "4018 1st Ave NW", city: "Seattle" },
      { label: "bogus", street: "99999 Nonexistent Fake Ave", city: "Seattle", expectNull: true },
    ],
  },
  {
    county: "New York City (5 boroughs)",
    lookup: lookupNyc,
    cases: [
      { label: "real #1", street: "17 Carroll Place", city: "Staten Island" },
      { label: "real #2", street: "9 Carroll Place", city: "Staten Island" },
      { label: "real #3", street: "376 Richmond Terrace", city: "Staten Island" },
      { label: "bogus", street: "99999 Nonexistent Fake Ave", city: "Staten Island", expectNull: true },
    ],
  },
];

interface RowResult {
  county: string;
  label: string;
  street: string;
  ms: number;
  outcome: string;
  assessedValue?: number;
  marketValue?: number;
  yearBuilt?: number;
  lotSize?: number;
  assessmentYear?: string;
  pass: boolean;
  error?: string;
}

function fmt(n: number | undefined): string {
  return n == null ? "-" : n.toLocaleString("en-US");
}

async function runCase(county: string, lookup: CountySuite["lookup"], c: Case): Promise<RowResult> {
  const t0 = Date.now();
  try {
    const result = await lookup(c.street, c.city);
    const ms = Date.now() - t0;
    if (c.expectNull) {
      return {
        county,
        label: c.label,
        street: c.street,
        ms,
        outcome: result ? "UNEXPECTED MATCH" : "null (expected)",
        pass: result == null,
      };
    }
    if (!result) {
      return { county, label: c.label, street: c.street, ms, outcome: "null (UNEXPECTED)", pass: false };
    }
    return {
      county,
      label: c.label,
      street: c.street,
      ms,
      outcome: "matched",
      assessedValue: result.assessedValue,
      marketValue: result.marketValue,
      yearBuilt: result.yearBuilt,
      lotSize: result.lotSize,
      assessmentYear: result.assessmentYear,
      pass: true,
    };
  } catch (err) {
    const ms = Date.now() - t0;
    return {
      county,
      label: c.label,
      street: c.street,
      ms,
      outcome: "THREW",
      pass: false,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    };
  }
}

async function main() {
  const allResults: RowResult[] = [];

  for (const suite of SUITES) {
    console.log(`\n=== ${suite.county} ===`);
    for (const c of suite.cases) {
      const row = await runCase(suite.county, suite.lookup, c);
      allResults.push(row);
      const status = row.pass ? "PASS" : "FAIL";
      console.log(
        `  [${status}] ${row.label.padEnd(8)} "${row.street}" -> ${row.outcome} (${row.ms}ms)` +
          (row.assessedValue != null
            ? ` assessed=$${fmt(row.assessedValue)} market=$${fmt(row.marketValue)} yr=${row.assessmentYear} built=${fmt(
                row.yearBuilt
              )} lot=${fmt(row.lotSize)}sqft`
            : "") +
          (row.error ? ` error=${row.error}` : "")
      );
    }
  }

  console.log("\n\n=== RESULTS TABLE ===");
  const header = [
    "County",
    "Case",
    "Address",
    "ms",
    "Outcome",
    "Assessed",
    "Market",
    "YrBuilt",
    "Lot(sqft)",
    "AsmtYr",
  ];
  const widths = [26, 8, 28, 6, 16, 12, 12, 8, 10, 7];
  const printRow = (cells: string[]) =>
    console.log(cells.map((c, i) => c.padEnd(widths[i])).join(" | "));
  printRow(header);
  printRow(widths.map((w) => "-".repeat(w)));
  for (const r of allResults) {
    printRow([
      r.county,
      r.label,
      r.street,
      String(r.ms),
      r.outcome,
      r.assessedValue != null ? `$${fmt(r.assessedValue)}` : "-",
      r.marketValue != null ? `$${fmt(r.marketValue)}` : "-",
      fmt(r.yearBuilt),
      fmt(r.lotSize),
      r.assessmentYear ?? "-",
    ]);
  }

  const passCount = allResults.filter((r) => r.pass).length;
  const failCount = allResults.length - passCount;
  const latencies = allResults.map((r) => r.ms);
  const avgMs = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
  const maxMs = Math.max(...latencies);

  console.log(`\n${passCount}/${allResults.length} passed, ${failCount} failed. avg=${avgMs}ms max=${maxMs}ms`);

  if (failCount > 0) {
    console.log("\nFAILURES:");
    for (const r of allResults.filter((r) => !r.pass)) {
      console.log(`  [${r.county}] ${r.label} "${r.street}": ${r.outcome}${r.error ? ` (${r.error})` : ""}`);
    }
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Fatal error running county test suite:", err);
  process.exitCode = 1;
});
