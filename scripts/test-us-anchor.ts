/**
 * Fixture-driven tests for src/lib/pipeline/us-assess.ts's
 * assessAnchorPlausibility() — the anchor-sanity gate that runs BEFORE
 * offer-model.ts to decide whether an assessed value is trustworthy enough
 * to drive the offer, or should be demoted to display-only context (see
 * that function's module doc for the flagship 12400 Cedar St, Austin case
 * this exists to catch). Pure function, no network/KV — fixtures stand in
 * for real Assessment/AVM/asking-price shapes.
 *
 * Run: npx tsx scripts/test-us-anchor.ts
 */

import { assessAnchorPlausibility, parseMarketValueFromAssessmentNote } from "../src/lib/pipeline/us-assess";
import { triangulateValuation } from "../src/lib/pipeline/us-advantage";

// ---------------------------------------------------------------------------
// Test harness (mirrors scripts/test-us-advantage.ts)
// ---------------------------------------------------------------------------

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

function approx(a: number, b: number, tol = 0.01): boolean {
  return Math.abs(a - b) <= tol;
}

// ===========================================================================
// 1. Flagship case — TX agricultural exemption (12400 Cedar St, Austin)
// ===========================================================================

console.log("\n═══ TX ag-exemption (Cedar St) ═══\n");

{
  // Real production numbers (KV, 2026-08-08): $9.9M asking, $452,339
  // Travis County (TCAD) assessed value, TCAD's own "market value" field
  // reporting the SAME figure (the exemption/partial-parcel signature).
  const d = assessAnchorPlausibility({
    assessedValue: 452_339,
    assessmentBasis: "assessed_ratio",
    askingPrice: 9_900_000,
    avmValue: null, // us-seed-analysis.ts's zero-RentCast-call contract
    marketValueHint: 452_339,
  });
  assert("Cedar St: demoted to context_only", d.verdict === "context_only", d.verdict);
  assert("Cedar St: reason is possible_exemption_or_cap", d.reason === "possible_exemption_or_cap", d.reason ?? "null");
  assert("Cedar St: anchorSource falls back to language (no AVM)", d.anchorSource === "language", d.anchorSource);
  assert("Cedar St: ratio ~0.0457", approx(d.ratio ?? 0, 452_339 / 9_900_000, 0.0001), String(d.ratio));
  assert("Cedar St: note is render-safe and mentions exemption", d.note.toLowerCase().includes("exemption"));

  // Same numbers, but on the live-route path where a real (if unrelated)
  // AVM value is available — AVM agrees with neither assessed nor asking,
  // so it can't confirm/deny either side; still demotes on the
  // marketValueHint-agreement signature, now re-anchored on the AVM.
  const dLive = assessAnchorPlausibility({
    assessedValue: 452_339,
    assessmentBasis: "assessed_ratio",
    askingPrice: 9_900_000,
    avmValue: 876_000, // real RentCast AVM for this address
    marketValueHint: null, // RentCast's tax record has no separate market figure
  });
  assert("Cedar St (live route): still demoted", dLive.verdict === "context_only", dLive.verdict);
  // No marketValueHint on this path (RentCast's tax record has no separate
  // market figure) — honestly falls to extreme_delta rather than claiming
  // an exemption it has no corroborating evidence for, unlike the seed
  // pipeline above which read TCAD's own bulk-roll market-value field.
  assert("Cedar St (live route): reason is extreme_delta (no market-value corroboration on this path)", dLive.reason === "extreme_delta", dLive.reason ?? "null");
  assert("Cedar St (live route): re-anchors on AVM", dLive.anchorSource === "avm", dLive.anchorSource);
}

{
  // assessmentNote parsing — the pragmatic recovery of the county's
  // "market value" figure from the human-readable note
  // scripts/enrich-us-from-assessors.ts already writes.
  const note = "2026: $452,339 assessed ($452,339 market) — county assessor";
  assert("note parse: recovers 452339", parseMarketValueFromAssessmentNote(note) === 452_339, String(parseMarketValueFromAssessmentNote(note)));
  assert("note parse: no match returns null", parseMarketValueFromAssessmentNote("2026: $642,000") === null);
  assert("note parse: undefined returns null", parseMarketValueFromAssessmentNote(undefined) === null);
}

// ===========================================================================
// 2. AZ assessed_ratio — legitimately low ratio, confirmed by market value
// ===========================================================================

console.log("\n═══ AZ assessed_ratio — legit low ratio (stays anchored) ═══\n");

{
  // Maricopa's LPV (capped, below Full Cash Value by design) running at
  // 30% of asking would fail the generic band on its own — but FCV
  // (marketValueHint) tracks asking closely, confirming this is the
  // assessment scheme working as intended, not an anomaly.
  const d = assessAnchorPlausibility({
    assessedValue: 150_000,
    assessmentBasis: "assessed_ratio",
    askingPrice: 500_000,
    avmValue: null,
    marketValueHint: 480_000, // Full Cash Value, close to asking
  });
  assert("AZ legit low ratio: stays anchored (not demoted)", d.verdict === "anchor", d.verdict);
  assert("AZ legit low ratio: no demotion reason", d.reason === null, d.reason ?? "");
  assert("AZ legit low ratio: anchorSource is tax_assessed", d.anchorSource === "tax_assessed", d.anchorSource);
  assert("AZ legit low ratio: note cites the market/full-cash figure", d.note.includes("480,000"));
}

{
  // Same LPV/FCV split, but the raw ratio alone (0.5) is inside even the
  // widened band — sanity check that the ordinary in-band path still works
  // without needing marketValueHint to rescue it.
  const d = assessAnchorPlausibility({
    assessedValue: 250_000,
    assessmentBasis: "assessed_ratio",
    askingPrice: 500_000,
    avmValue: null,
    marketValueHint: null,
  });
  assert("AZ in-band without corroboration: still anchors", d.verdict === "anchor", d.verdict);
  assert("AZ in-band without corroboration: confidence is low (no corroboration)", d.confidence === "low", d.confidence);
}

// ===========================================================================
// 2b. Cook County-style 10%-ratio — derived marketValue tracks asking
// (src/lib/assessment/us-county/cook.ts, registered 2026-08-09). Cook's own
// assessedValue is a FIXED 10% Level of Assessment on class-2 residential
// (not a capped-below-some-varying-cash-value scheme like AZ's LPV) and its
// marketValue is DERIVED (assessedValue / 0.10), not an independently
// published county figure — still assessmentBasis "assessed_ratio" per
// cook.ts's own doc comment. Same mechanism as the AZ fixture above
// (marketValueHint corroborates a low raw ratio), confirming it generalizes
// to a fixed-ratio scheme, not just a capped/varying one.
// ===========================================================================

console.log("\n═══ Cook-style 10%-ratio — derived marketValue tracks asking (stays anchored) ═══\n");

{
  const d = assessAnchorPlausibility({
    assessedValue: 70_000, // 10% of the derived $700k market figure — 0.098x asking on its own
    assessmentBasis: "assessed_ratio",
    askingPrice: 715_000,
    avmValue: null,
    marketValueHint: 700_000, // Cook's derivedMarketValue() — assessedValue / 0.10
  });
  assert("Cook 10%-ratio: stays anchored (not demoted)", d.verdict === "anchor", d.verdict);
  assert("Cook 10%-ratio: no demotion reason", d.reason === null, d.reason ?? "");
  assert("Cook 10%-ratio: anchorSource is tax_assessed", d.anchorSource === "tax_assessed", d.anchorSource);
  assert("Cook 10%-ratio: note cites the market figure", d.note.includes("700,000"));
}

// ===========================================================================
// 2c. NYC-style ~4% capped assessed value — no separate marketValue on this
// path (mirrors RentCast's taxAssessments, which never carries a second
// market figure, or an NYC parcel where curmkttot itself wasn't usable).
// With nothing to corroborate a ratio this far outside even the widened
// assessed_ratio band, it must NOT be taken at face value as the anchor.
// ===========================================================================

console.log("\n═══ NYC-style ~4% capped, no market-value corroboration (demoted) ═══\n");

{
  const d = assessAnchorPlausibility({
    assessedValue: 32_000, // ~4% of an $800k market value, NYC-style (curtxbtot without curmkttot)
    assessmentBasis: "assessed_ratio",
    askingPrice: 800_000,
    avmValue: null,
    marketValueHint: null,
  });
  assert("NYC ~4%-capped, no market figure: demoted (not used as a raw anchor)", d.verdict === "context_only", d.verdict);
  assert("NYC ~4%-capped, no market figure: reason is extreme_delta", d.reason === "extreme_delta", d.reason ?? "null");
  assert("NYC ~4%-capped, no market figure: anchorSource falls back to language (no AVM)", d.anchorSource === "language", d.anchorSource);
  assert("NYC ~4%-capped, no market figure: confidence low", d.confidence === "low", d.confidence);
}

// ===========================================================================
// 3. Asking outlier — AVM + assessed agree, asking is the aspirational one
// ===========================================================================

console.log("\n═══ Asking outlier (assessed stays the anchor) ═══\n");

{
  const d = assessAnchorPlausibility({
    assessedValue: 480_000,
    assessmentBasis: "assessed_ratio",
    askingPrice: 2_200_000, // ~4.6x the agreed assessed/AVM figure
    avmValue: 510_000, // agrees with assessed, not with asking
    marketValueHint: null,
  });
  assert("asking outlier: verdict stays anchor (assessed is trustworthy)", d.verdict === "anchor", d.verdict);
  assert("asking outlier: reason is asking_outlier", d.reason === "asking_outlier", d.reason ?? "null");
  assert("asking outlier: anchorSource is tax_assessed", d.anchorSource === "tax_assessed", d.anchorSource);
  assert("asking outlier: confidence is high (independently corroborated)", d.confidence === "high", d.confidence);
  assert("asking outlier: note flags asking as aspirational", d.note.toLowerCase().includes("aspirational"));
}

// ===========================================================================
// 4. Normal case — ordinary listing, no exotic basis quirks
// ===========================================================================

console.log("\n═══ Normal case ═══\n");

{
  const d = assessAnchorPlausibility({
    assessedValue: 380_000,
    assessmentBasis: "assessed_ratio",
    askingPrice: 400_000,
    avmValue: 395_000,
    marketValueHint: null,
  });
  assert("normal case: verdict is anchor", d.verdict === "anchor", d.verdict);
  assert("normal case: no demotion reason", d.reason === null, d.reason ?? "");
  assert("normal case: anchorSource is tax_assessed", d.anchorSource === "tax_assessed", d.anchorSource);
}

{
  // market_value basis (BC-style / RentCast-AVM-as-assessment fallback) —
  // tight band applies directly, no assessed_ratio widening.
  const d = assessAnchorPlausibility({
    assessedValue: 500_000,
    assessmentBasis: "market_value",
    askingPrice: 540_000,
    avmValue: null,
    marketValueHint: null,
  });
  assert("market_value basis: verdict is anchor", d.verdict === "anchor", d.verdict);
  assert("market_value basis: confidence high (tight ratio)", d.confidence === "high", d.confidence);
}

// ===========================================================================
// 5. AVM-confirmed demotion (no assessed/market-hint corroboration at all)
// ===========================================================================

console.log("\n═══ AVM confirms demotion ═══\n");

{
  const d = assessAnchorPlausibility({
    assessedValue: 200_000,
    assessmentBasis: "assessed_ratio",
    askingPrice: 900_000,
    avmValue: 850_000, // tracks asking, not assessed
    marketValueHint: null,
  });
  assert("AVM confirms demotion: verdict context_only", d.verdict === "context_only", d.verdict);
  assert("AVM confirms demotion: reason extreme_delta", d.reason === "extreme_delta", d.reason ?? "null");
  assert("AVM confirms demotion: anchorSource avm", d.anchorSource === "avm", d.anchorSource);
  assert("AVM confirms demotion: confidence high", d.confidence === "high", d.confidence);
}

// ===========================================================================
// 5b. AVM-led override — audit-informed: AVM wins over assessed EVEN WHEN
// the raw ratio would already look "in band" under the wide assessed_ratio
// band (docs/plans/10-RENTCAST-DATA-QUALITY.md finding: AVM measured far
// more reliable than any tax-based figure for this basis).
// ===========================================================================

console.log("\n═══ AVM-led override (pre-emptive, in-band ratio) ═══\n");

{
  // Modeled on the audit's Phoenix 23222 N 22nd Pl-style shape: county LPV
  // sits at a ratio (0.556) safely inside BOTH the wide assessed_ratio band
  // and even the tight default band — old logic would have anchored on it
  // without ever consulting the AVM. A present, plausible, materially
  // disagreeing AVM should override that.
  const d = assessAnchorPlausibility({
    assessedValue: 297_555,
    assessmentBasis: "assessed_ratio",
    askingPrice: 535_000, // ratio 0.556 — "in band" on its own
    avmValue: 687_000, // ratio vs asking 1.284 (plausible), vs assessed +131% (disagrees)
    marketValueHint: null,
  });
  assert("AVM-led override: demotes despite in-band raw ratio", d.verdict === "context_only", d.verdict);
  assert("AVM-led override: reason extreme_delta", d.reason === "extreme_delta", d.reason ?? "null");
  assert("AVM-led override: anchorSource avm", d.anchorSource === "avm", d.anchorSource);
  assert("AVM-led override: confidence high", d.confidence === "high", d.confidence);
}

{
  // Sanity: when AVM AGREES with assessed (even if both look a little low
  // vs asking), no override — assessed stays the anchor via the ordinary
  // in-band path.
  const d = assessAnchorPlausibility({
    assessedValue: 300_000,
    assessmentBasis: "assessed_ratio",
    askingPrice: 500_000,
    avmValue: 310_000, // agrees with assessed
    marketValueHint: null,
  });
  assert("AVM agrees with assessed: no override, stays anchored", d.verdict === "anchor", d.verdict);
  assert("AVM agrees with assessed: anchorSource tax_assessed", d.anchorSource === "tax_assessed", d.anchorSource);
}

{
  // marketValueHint corroboration still wins over a disagreeing AVM — a
  // primary county figure that confirms legitimacy is checked first and
  // short-circuits before the AVM-led override ever runs.
  const d = assessAnchorPlausibility({
    assessedValue: 150_000,
    assessmentBasis: "assessed_ratio",
    askingPrice: 500_000,
    avmValue: 900_000, // would disagree with assessed and be "plausible"... but band-wise 900k/500k=1.8, still in [0.4,2.5]
    marketValueHint: 480_000, // confirms legitimacy first
  });
  assert("marketValueHint still wins over a disagreeing AVM", d.verdict === "anchor", d.verdict);
  assert("marketValueHint still wins: anchorSource tax_assessed", d.anchorSource === "tax_assessed", d.anchorSource);
}

// ===========================================================================
// 6. Generic extreme delta — no corroboration either way
// ===========================================================================

console.log("\n═══ Extreme delta, uncorroborated ═══\n");

{
  const d = assessAnchorPlausibility({
    assessedValue: 50_000,
    assessmentBasis: "assessed_ratio",
    askingPrice: 900_000,
    avmValue: null,
    marketValueHint: null,
  });
  assert("uncorroborated extreme: verdict context_only", d.verdict === "context_only", d.verdict);
  assert("uncorroborated extreme: reason extreme_delta", d.reason === "extreme_delta", d.reason ?? "null");
  assert("uncorroborated extreme: anchorSource language (no AVM)", d.anchorSource === "language", d.anchorSource);
  assert("uncorroborated extreme: confidence low", d.confidence === "low", d.confidence);
}

// ===========================================================================
// 7. basis_mismatch — assessed running ABOVE asking, no corroboration
// ===========================================================================

console.log("\n═══ basis_mismatch (assessed above asking) ═══\n");

{
  const d = assessAnchorPlausibility({
    assessedValue: 3_500_000,
    assessmentBasis: "assessed_ratio",
    askingPrice: 900_000,
    avmValue: null,
    marketValueHint: null,
  });
  assert("basis_mismatch: verdict context_only", d.verdict === "context_only", d.verdict);
  assert("basis_mismatch: reason basis_mismatch", d.reason === "basis_mismatch", d.reason ?? "null");
}

// ===========================================================================
// 8. Acquisition-value basis (CA Prop 13 style)
// ===========================================================================

console.log("\n═══ Acquisition-value basis ═══\n");

{
  const d = assessAnchorPlausibility({
    assessedValue: 180_000,
    assessmentBasis: "acquisition_value",
    askingPrice: 800_000, // ratio 0.225 — below ACQUISITION_VALUE_LOW_RATIO
    avmValue: 790_000,
    marketValueHint: null,
  });
  assert("acquisition_value, very low ratio: demoted", d.verdict === "context_only", d.verdict);
  assert("acquisition_value, very low ratio: reason basis_mismatch", d.reason === "basis_mismatch", d.reason ?? "null");
  assert("acquisition_value, very low ratio: re-anchors on AVM", d.anchorSource === "avm", d.anchorSource);
}

{
  const d = assessAnchorPlausibility({
    assessedValue: 400_000,
    assessmentBasis: "acquisition_value",
    askingPrice: 800_000, // ratio 0.5 — an ordinary Prop-13-lag ratio
    avmValue: null,
    marketValueHint: null,
  });
  assert("acquisition_value, ordinary lag: stays anchored", d.verdict === "anchor", d.verdict);
}

// ===========================================================================
// 9. Edge cases
// ===========================================================================

console.log("\n═══ Edge cases ═══\n");

{
  const d = assessAnchorPlausibility({
    assessedValue: 400_000,
    assessmentBasis: "assessed_ratio",
    askingPrice: null,
    avmValue: null,
    marketValueHint: null,
  });
  assert("no asking price: verdict anchor (not evaluated)", d.verdict === "anchor", d.verdict);
  assert("no asking price: ratio null", d.ratio === null);
  assert("no asking price: no reason", d.reason === null);
}

// ===========================================================================
// 10. Integration — triangulateValuation excludes a demoted anchor
// ===========================================================================

console.log("\n═══ triangulateValuation with taxAssessedDemoted ═══\n");

{
  const t = triangulateValuation({
    taxAssessedValue: 452_339,
    assessmentBasis: "assessed_ratio",
    avmValue: 876_000,
    askingPrice: 9_900_000,
    compImpliedValue: null,
    taxAssessedDemoted: true,
  });
  assert(
    "demoted: tax-assessed excluded from anchors",
    !t.anchors.some((a) => a.kind === "tax_assessed"),
    JSON.stringify(t.anchors)
  );
  assert(
    "demoted: tax-assessed present in excludedAnchors",
    t.excludedAnchors.some((a) => a.kind === "tax_assessed" && a.value === 452_339),
    JSON.stringify(t.excludedAnchors)
  );
  assert("demoted: triangulatedValue computed from remaining anchors only", t.triangulatedValue === Math.round((876_000 + 9_900_000) / 2));
  assert("demoted: agreementNote mentions the exclusion", t.agreementNote.toLowerCase().includes("excluded"));
}

{
  // Non-demoted callers see an empty excludedAnchors array, unchanged
  // otherwise (backward compatibility with existing test-us-advantage.ts
  // fixtures, which don't pass taxAssessedDemoted at all).
  const t = triangulateValuation({
    taxAssessedValue: 400_000,
    assessmentBasis: "assessed_ratio",
    avmValue: 410_000,
    askingPrice: 405_000,
    compImpliedValue: 415_000,
  });
  assert("not demoted: excludedAnchors empty", t.excludedAnchors.length === 0);
  assert("not demoted: tax-assessed included as usual", t.anchors.some((a) => a.kind === "tax_assessed"));
}

// ---------------------------------------------------------------------------
console.log("\n═══ Summary ═══");
console.log(`  ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
