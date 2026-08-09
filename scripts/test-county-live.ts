/**
 * scripts/test-county-live.ts
 *
 * Live + fixture tests for the county-assessor live-lookup path added to
 * the US /api/assess flow:
 *   - src/lib/assessment/us-county/index.ts's lookupCountyLive() — the
 *     FIPS-routed, hard-timeout-bounded live lookup used by
 *     src/app/api/assess/route.ts's handleUSAssessment().
 *   - src/lib/pipeline/us-assess.ts's buildUsAssessment() — the value
 *     precedence (county marketValue > county assessedValue > RentCast
 *     taxAssessments > AVM) this task wired county-live into.
 *
 * ZERO RentCast calls anywhere in this file — every live address below is
 * hit directly against the free county APIs (Maricopa ArcGIS, Miami-Dade
 * GIS + FL DOR, and — as of 2026-08-09 — Cook County Socrata, King County
 * ArcGIS, NYC DOF Socrata), never through RentCast. Addresses are
 * known-good, previously-confirmed addresses already documented in this
 * codebase (maricopa.ts/miami-dade.ts/cook.ts/king.ts/nyc.ts's own module
 * docs, and the audit's stratified sample at
 * docs/plans/10-RENTCAST-DATA-QUALITY.md) rather than a fresh KV read, so
 * this script has no KV/env dependency beyond outbound network access to
 * the county APIs themselves. The Cook/King/NYC cases below are routed
 * through the REGISTRY (this file's `lookupCountyLive` import from
 * ./index.ts) rather than importing those adapter modules directly — see
 * scripts/test-county-new.ts for the adapter-level-only live suite (12/12)
 * this one complements.
 *
 * Run: npx tsx scripts/test-county-live.ts
 */

import { lookupCountyLive } from "../src/lib/assessment/us-county";
import { buildUsAssessment, assessAnchorPlausibility } from "../src/lib/pipeline/us-assess";
import type { CountyAssessorResult } from "../src/lib/assessment/us-county/types";

let pass = 0;
let fail = 0;

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const MARICOPA_FIPS = "04013";
const MIAMI_DADE_FIPS = "12086";
const TRAVIS_FIPS = "48453";
const COOK_FIPS = "17031";
const KING_FIPS = "53033";
const STATEN_ISLAND_FIPS = "36085";

// ===========================================================================
// Part 1 — live lookups against the real county APIs
// ===========================================================================

interface LiveCase {
  label: string;
  fips: string;
  street: string;
  city: string;
  expect: "hit" | "null";
  /** Hard ceiling this case must resolve within, on top of the ordinary
   * per-adapter timeout already enforced inside lookupCountyLive — used
   * here specifically to prove Travis short-circuits WITHOUT ever touching
   * its ~4.9GB bulk-file index (which would take minutes, not milliseconds,
   * on a cold process — see travis.ts's module doc). */
  maxMs?: number;
  /** On a "hit" case, the assessmentBasis the REGISTRY-routed result must
   * carry (./types.ts's CountyAssessorResult.assessmentBasis) — checked
   * through the actual REGISTRY (this file's `lookupCountyLive` import),
   * not by calling the adapter module directly, so this also proves the
   * FIPS-to-adapter wiring in src/lib/assessment/us-county/index.ts is
   * correct end to end, not just that the underlying adapter works in
   * isolation (that's scripts/test-county-new.ts's job). */
  expectBasis?: "assessed_ratio" | "full_value";
}

const LIVE_CASES: LiveCase[] = [
  {
    label: "Phoenix #1 (govt-assessed SFH, confirmed in the RentCast data-quality audit sample)",
    fips: MARICOPA_FIPS,
    street: "23222 N 22nd Pl",
    city: "Phoenix",
    expect: "hit",
  },
  {
    label: "Phoenix #2 (govt-assessed SFH, confirmed in the audit sample)",
    fips: MARICOPA_FIPS,
    street: "1257 E Voltaire Ave",
    city: "Phoenix",
    expect: "hit",
  },
  {
    label: "Miami #1 (govt-assessed SFH, confirmed in the audit sample — Save-Our-Homes cap)",
    fips: MIAMI_DADE_FIPS,
    street: "3376 Nw 49th St",
    city: "Miami",
    expect: "hit",
  },
  {
    label: "Miami #2 (govt-assessed SFH, confirmed in the audit sample)",
    fips: MIAMI_DADE_FIPS,
    street: "7803 Nw Miami Pl",
    city: "Miami",
    expect: "hit",
  },
  {
    label: "Travis — liveCapable:false, must short-circuit before ever calling lookupByAddress",
    fips: TRAVIS_FIPS,
    street: "5507 Burgundy Dr",
    city: "Austin",
    expect: "null",
    maxMs: 1_000, // a real travis.ts call would hang for minutes on first run
  },
  {
    label: "Bogus address (Maricopa FIPS, address doesn't exist)",
    fips: MARICOPA_FIPS,
    street: "1 Nonexistent Fake St",
    city: "Phoenix",
    expect: "null",
  },
  // Cook/King/NYC — registered 2026-08-09 (see this file's module doc and
  // src/lib/assessment/us-county/index.ts). Same known-good addresses
  // scripts/test-county-new.ts already verified directly against the
  // adapter modules; here they're routed through the REGISTRY's FIPS index
  // instead, proving the registration itself (not just the adapters in
  // isolation).
  {
    label: "Chicago (Cook County, real SFH from cook.ts's own source verification)",
    fips: COOK_FIPS,
    street: "3754 N Kenmore Ave",
    city: "Chicago",
    expect: "hit",
    expectBasis: "assessed_ratio",
  },
  {
    label: "Seattle (King County, real SFH from king.ts's own source verification)",
    fips: KING_FIPS,
    street: "209 N 41st St",
    city: "Seattle",
    expect: "hit",
    expectBasis: "full_value",
  },
  {
    label: "Staten Island (NYC/Richmond County, real SFH from nyc.ts's own source verification)",
    fips: STATEN_ISLAND_FIPS,
    street: "17 Carroll Place",
    city: "Staten Island",
    expect: "hit",
    expectBasis: "assessed_ratio",
  },
];

async function runLiveCases() {
  console.log("\n═══ Live county-API lookups (lookupCountyLive) ═══\n");

  for (const c of LIVE_CASES) {
    const t0 = Date.now();
    const result = await lookupCountyLive(c.fips, c.street, c.city);
    const elapsed = Date.now() - t0;
    const got = result ? "hit" : "null";
    const shapeOk = got === c.expect;
    const speedOk = c.maxMs == null || elapsed <= c.maxMs;

    assert(
      `${c.label}: expected=${c.expect} got=${got} (${elapsed}ms)`,
      shapeOk && speedOk,
      !shapeOk
        ? `result=${JSON.stringify(result)}`
        : !speedOk
          ? `took ${elapsed}ms, expected <=${c.maxMs}ms`
          : undefined
    );
    if (result) {
      console.log(
        `      assessedValue=${result.assessedValue}` +
          (result.marketValue ? ` marketValue=${result.marketValue}` : "") +
          ` year=${result.assessmentYear}` +
          (result.yearBuilt ? ` yearBuilt=${result.yearBuilt}` : "") +
          (result.assessmentBasis ? ` basis=${result.assessmentBasis}` : "")
      );
      if (c.expectBasis) {
        assert(
          `${c.label}: assessmentBasis is ${c.expectBasis}`,
          result.assessmentBasis === c.expectBasis,
          `got ${result.assessmentBasis ?? "undefined"}`
        );
      }
    }
  }
}

// ===========================================================================
// Part 2 — fixture tests, no network: buildUsAssessment's county-live
// precedence, and confirmation that assessAnchorPlausibility still demotes
// an implausible county-live value exactly as it would a RentCast one.
// ===========================================================================

function fixtureTests() {
  console.log("\n═══ buildUsAssessment: county-live precedence (fixtures, no network) ═══\n");

  {
    // County-live has BOTH assessedValue and marketValue — marketValue wins
    // per the documented precedence (county marketValue/full-cash > county
    // assessedValue > RentCast taxAssessments > AVM). This is a Maricopa-
    // shaped fixture (LPV/FCV split), so the adapter itself now reports
    // assessmentBasis "assessed_ratio" — since 2026-08-09's
    // assessmentBasisFromCountyLive wiring, that basis carries straight
    // through to the Assessment EVEN THOUGH marketValue (not the capped
    // assessedValue) is what's anchored: the marketValue is still just
    // Maricopa's own figure for a basis known to run capped, not
    // independent corroboration of it — see us-assess.ts's
    // assessmentBasisFromCountyLive doc comment. (Before that change this
    // asserted assessmentBasis "market_value" here — superseded.)
    const countyLive: CountyAssessorResult = {
      assessedValue: 297_555,
      marketValue: 420_000,
      assessmentYear: "2027",
      source: "county_assessor",
      assessmentBasis: "assessed_ratio",
    };
    const a = buildUsAssessment(
      { taxAssessments: [{ year: 2025, value: 44_360, land: null, improvements: null }] } as never,
      null,
      "AZ",
      countyLive
    );
    assert("county marketValue preferred over county assessedValue", a?.totalValue === 420_000, String(a?.totalValue));
    assert(
      "assessmentBasis stays assessed_ratio even when marketValue anchors (Maricopa-shaped)",
      a?.assessmentBasis === "assessed_ratio",
      a?.assessmentBasis
    );
    assert("liveCountySource flag set", a?.liveCountySource === true, String(a?.liveCountySource));
    assert("source is government", a?.source === "government", a?.source);
    assert("evidenceClass is observed", a?.evidenceClass === "observed", a?.evidenceClass);
  }

  {
    // County-live has ONLY assessedValue (no marketValue published) — still
    // preferred over a fresh RentCast taxAssessments record.
    const countyLive: CountyAssessorResult = {
      assessedValue: 214_219,
      assessmentYear: "2025",
      source: "county_assessor",
    };
    const a = buildUsAssessment(
      { taxAssessments: [{ year: 2025, value: 99_999, land: null, improvements: null }] } as never,
      null,
      "TX",
      countyLive
    );
    assert("county-live (assessedValue only) preferred over RentCast tax", a?.totalValue === 214_219, String(a?.totalValue));
    assert(
      "assessmentBasis falls back to state default (TX) when the adapter doesn't report one",
      a?.assessmentBasis === "assessed_ratio",
      a?.assessmentBasis
    );
    assert("liveCountySource flag set", a?.liveCountySource === true, String(a?.liveCountySource));
  }

  {
    // King County-shaped fixture: assessedValue only (no marketValue for
    // this parcel — e.g. an exemption-free row where APPRLNDVAL/APPR_IMPR
    // came back unpopulated), assessmentBasis "full_value" — maps to
    // Assessment.assessmentBasis "market_value" (tight band), NOT the
    // state-level "assessed_ratio" default WA would otherwise get from
    // assessmentBasisForState (which has no per-county knowledge and
    // defaults every non-CA state to assessed_ratio) — this is exactly the
    // case that per-county assessmentBasis exists to correct.
    const countyLive: CountyAssessorResult = {
      assessedValue: 512_000,
      assessmentYear: "2027",
      source: "county_assessor",
      assessmentBasis: "full_value",
    };
    const a = buildUsAssessment(null, null, "WA", countyLive);
    assert("King-shaped (assessedValue only): totalValue is the assessedValue", a?.totalValue === 512_000, String(a?.totalValue));
    assert(
      "King-shaped (full_value basis): maps to market_value, not WA's state-level assessed_ratio default",
      a?.assessmentBasis === "market_value",
      a?.assessmentBasis
    );
    assert("liveCountySource flag set", a?.liveCountySource === true, String(a?.liveCountySource));
  }

  {
    // No county-live data at all (undefined) — falls through to the
    // existing RentCast-tax-based behavior, completely unchanged.
    const a = buildUsAssessment(
      { taxAssessments: [{ year: 2025, value: 400_000, land: 100_000, improvements: 300_000 }] } as never,
      null,
      "TX",
      undefined
    );
    assert("no county-live: falls back to RentCast tax", a?.totalValue === 400_000, String(a?.totalValue));
    assert("no county-live: liveCountySource unset", a?.liveCountySource === undefined, String(a?.liveCountySource));
  }

  {
    // County-live lookup ran but returned null (miss/timeout) — identical
    // fallback behavior to "undefined", not treated as a different case.
    const a = buildUsAssessment(
      { taxAssessments: [{ year: 2025, value: 400_000, land: null, improvements: null }] } as never,
      null,
      "TX",
      null
    );
    assert("county-live null (miss/timeout): falls back to RentCast tax", a?.totalValue === 400_000, String(a?.totalValue));
  }

  console.log("\n═══ assessAnchorPlausibility: county-live value still gets demoted when implausible ═══\n");

  {
    // Audit flagship: a Maricopa county-assessor value wrong by ~50x
    // (docs/plans/10-RENTCAST-DATA-QUALITY.md, 19802 N 32nd St: $5,071,632
    // assessed vs $99,999 asking, 50.72x). Being government-sourced and
    // LIVE must NOT exempt it from the same suspicion a RentCast tax figure
    // gets — this is the whole point of assessAnchorPlausibility running
    // regardless of assessment.source/liveCountySource.
    const d = assessAnchorPlausibility({
      assessedValue: 5_071_632,
      assessmentBasis: "assessed_ratio",
      askingPrice: 99_999,
      avmValue: 135_000, // real RentCast AVM for this address, per the audit
      marketValueHint: null,
    });
    assert("50x-wrong county-live value: demoted to context_only", d.verdict === "context_only", d.verdict);
    assert("50x-wrong county-live value: re-anchors on AVM", d.anchorSource === "avm", d.anchorSource);
    assert(
      "50x-wrong county-live value: reason is extreme_delta (AVM tracks asking, not the wild assessed figure)",
      d.reason === "extreme_delta",
      d.reason ?? "null"
    );
  }

  {
    // Same shape but WITH a corroborating marketValueHint that agrees with
    // asking — proves the county-live path can still be RESCUED when it's
    // legitimately low-but-capped, not blanket-demoted just for being
    // assessed_ratio basis.
    const d = assessAnchorPlausibility({
      assessedValue: 150_000,
      assessmentBasis: "assessed_ratio",
      askingPrice: 500_000,
      avmValue: null,
      marketValueHint: 480_000, // county's own Full Cash Value tracks asking
    });
    assert("legit capped county-live value: stays anchored (not demoted)", d.verdict === "anchor", d.verdict);
    assert("legit capped county-live value: anchorSource tax_assessed", d.anchorSource === "tax_assessed", d.anchorSource);
  }
}

async function main() {
  await runLiveCases();
  fixtureTests();

  console.log("\n═══ Summary ═══");
  console.log(`  ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("test-county-live.ts crashed:", err);
  process.exit(1);
});
