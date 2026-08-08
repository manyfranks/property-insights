/**
 * Fixture-driven tests for src/lib/pipeline/us-advantage.ts — the "US
 * Advantage" layer (seller equity/tenure, valuation triangulation, investor
 * yield, risk/momentum, over-assessment). Every function under test is pure
 * (no network, no KV, no DB) — fixtures below stand in for RentCast
 * property records and regional_econ panel shapes, matching the field
 * shapes in src/lib/rentcast.ts and src/lib/db/regional-econ.ts. This makes
 * ZERO RentCast API calls and needs no KV/DB connection.
 *
 * Run: npx tsx scripts/test-us-advantage.ts
 */

import {
  computeEquityTenureSignal,
  applyEquitySignalToScore,
  equitySignalLabel,
  triangulateValuation,
  computeInvestorYield,
  computeRiskMomentum,
  computeOverAssessmentFlag,
  buildUsAdvantageBundle,
} from "../src/lib/pipeline/us-advantage";
import type { RentCastPropertyRecord } from "../src/lib/rentcast";
import type { ScoreResult } from "../src/lib/types";

// ---------------------------------------------------------------------------
// Test harness
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

// ---------------------------------------------------------------------------
// Fixture helper — a minimal-but-realistic RentCastPropertyRecord. Shapes
// match src/lib/rentcast.ts's mapPropertyRecord() output (normalized public
// type), not the raw RentCast JSON.
// ---------------------------------------------------------------------------

function fixtureRecord(overrides: Partial<RentCastPropertyRecord> = {}): RentCastPropertyRecord {
  return {
    formattedAddress: "123 Main St, Austin, TX 78701",
    addressLine1: "123 Main St",
    city: "Austin",
    state: "TX",
    zipCode: "78701",
    county: "Travis",
    latitude: 30.27,
    longitude: -97.74,
    propertyType: "Single Family",
    bedrooms: 3,
    bathrooms: 2,
    squareFootage: 1800,
    lotSize: 6000,
    yearBuilt: 1995,
    lastSaleDate: null,
    lastSalePrice: null,
    taxAssessments: [],
    propertyTaxes: [],
    saleHistory: [],
    ownerOccupied: null,
    ...overrides,
  };
}

function isoYearsAgo(years: number, now = new Date("2026-08-07T00:00:00Z")): string {
  const d = new Date(now);
  d.setUTCFullYear(d.getUTCFullYear() - Math.floor(years));
  d.setUTCMonth(d.getUTCMonth() - Math.round((years % 1) * 12));
  return d.toISOString().slice(0, 10);
}

const NOW = new Date("2026-08-07T00:00:00Z");

// ===========================================================================
// 1. Seller Equity & Tenure signal
// ===========================================================================

console.log("\n═══ Equity/Tenure signal ═══\n");

// --- Long-tenure, high-equity case ---
{
  const record = fixtureRecord({ lastSaleDate: isoYearsAgo(15, NOW), lastSalePrice: 200_000 });
  const sig = computeEquityTenureSignal(record, 420_000, "asking", 0.25, NOW);
  assert("long-tenure: returns a signal", sig !== null);
  if (sig) {
    assert("long-tenure: tier is long_tenure_high_equity", sig.tier === "long_tenure_high_equity", sig.tier);
    assert("long-tenure: holdYears ~15", approx(sig.holdYears, 15, 0.1), String(sig.holdYears));
    assert(
      "long-tenure: impliedAppreciationPct is +110%",
      approx(sig.impliedAppreciationPct, 1.1, 0.01),
      String(sig.impliedAppreciationPct)
    );
    assert("long-tenure: motivationStrength moderate", sig.motivationStrength === "moderate");
    assert("long-tenure: scorePoints 6", sig.scorePoints === 6, String(sig.scorePoints));
    assert("long-tenure: label chip surfaces", equitySignalLabel(sig) === "Long-Tenure Equity");
  }
}

// --- Loss-sale distress case ---
{
  const record = fixtureRecord({ lastSaleDate: isoYearsAgo(2, NOW), lastSalePrice: 450_000 });
  const sig = computeEquityTenureSignal(record, 400_000, "asking", 0.05, NOW);
  assert("loss-sale: returns a signal", sig !== null);
  if (sig) {
    assert("loss-sale: tier is loss_sale_distress", sig.tier === "loss_sale_distress", sig.tier);
    assert("loss-sale: motivationStrength high", sig.motivationStrength === "high");
    assert("loss-sale: scorePoints 20 (highest tier)", sig.scorePoints === 20, String(sig.scorePoints));
    assert(
      "loss-sale: impliedAppreciationPct negative",
      sig.impliedAppreciationPct < 0,
      String(sig.impliedAppreciationPct)
    );
    assert("loss-sale: narrative mentions purchase price", sig.narrative.includes("$450,000"));
  }
}

// --- Short-hold flip case ---
{
  const record = fixtureRecord({ lastSaleDate: isoYearsAgo(0.75, NOW), lastSalePrice: 300_000 });
  const sig = computeEquityTenureSignal(record, 375_000, "asking", 0.05, NOW);
  assert("flip: returns a signal", sig !== null);
  if (sig) {
    assert("flip: tier is short_hold_flip", sig.tier === "short_hold_flip", sig.tier);
    assert("flip: scorePoints 10", sig.scorePoints === 10, String(sig.scorePoints));
    assert("flip: holdYears < 2", sig.holdYears < 2, String(sig.holdYears));
  }
}

// --- Missing sale history — graceful degradation ---
{
  const record = fixtureRecord({ lastSaleDate: null, lastSalePrice: null });
  const sig = computeEquityTenureSignal(record, 400_000, "asking", 0.1, NOW);
  assert("missing sale history: returns null (no throw)", sig === null);
  assert("missing sale history: equitySignalLabel(null) is null", equitySignalLabel(sig) === null);

  const scoreBase: ScoreResult = { total: 40, tier: "WARM", breakdown: { DOM: 40 } };
  const applied = applyEquitySignalToScore(scoreBase, sig);
  assert("missing sale history: score unchanged when signal is null", applied.total === 40 && applied.tier === "WARM");
}

// --- Null record entirely (off-market path with no RentCast property match) ---
{
  const sig = computeEquityTenureSignal(null, 400_000, "avm_estimate", 0.1, NOW);
  assert("null record: returns null", sig === null);
}

// --- Moderate hold — no signal chip, no score points, but not null ---
{
  const record = fixtureRecord({ lastSaleDate: isoYearsAgo(6, NOW), lastSalePrice: 350_000 });
  const sig = computeEquityTenureSignal(record, 370_000, "asking", 0.05, NOW);
  assert("moderate hold: returns a signal (not null)", sig !== null);
  if (sig) {
    assert("moderate hold: tier is moderate_hold", sig.tier === "moderate_hold", sig.tier);
    assert("moderate hold: scorePoints 0", sig.scorePoints === 0);
    assert("moderate hold: no chip label (filtered from signals list)", equitySignalLabel(sig) === null);
  }
}

// --- Score integration: HOT tier crossed by equity bump ---
{
  const record = fixtureRecord({ lastSaleDate: isoYearsAgo(2, NOW), lastSalePrice: 450_000 });
  const sig = computeEquityTenureSignal(record, 400_000, "asking", null, NOW); // no HPI data
  assert("no HPI data: hpiCorroboration is no_hpi_data", sig?.hpiCorroboration === "no_hpi_data");
  assert("no HPI data: hpiImpliedValue is null", sig?.hpiImpliedValue === null);

  const scoreBase: ScoreResult = { total: 30, tier: "WATCH", breakdown: { DOM: 30 } };
  const applied = applyEquitySignalToScore(scoreBase, sig);
  assert("score bump: 30 + 20 = 50, crosses into HOT", applied.total === 50 && applied.tier === "HOT", `${applied.total}/${applied.tier}`);
  assert("score bump: breakdown records the equity line", applied.breakdown["Loss-Sale Distress"] === 20);
}

// --- Score cap at 100 ---
{
  const record = fixtureRecord({ lastSaleDate: isoYearsAgo(1, NOW), lastSalePrice: 450_000 });
  const sig = computeEquityTenureSignal(record, 400_000, "asking", null, NOW);
  const scoreBase: ScoreResult = { total: 95, tier: "HOT", breakdown: {} };
  const applied = applyEquitySignalToScore(scoreBase, sig);
  assert("score cap: total never exceeds 100", applied.total === 100, String(applied.total));
}

// ===========================================================================
// 2. Valuation Triangulation
// ===========================================================================

console.log("\n═══ Valuation Triangulation ═══\n");

// --- Tight agreement ---
{
  const t = triangulateValuation({
    taxAssessedValue: 400_000,
    assessmentBasis: "assessed_ratio",
    avmValue: 410_000,
    askingPrice: 405_000,
    compImpliedValue: 415_000,
  });
  assert("tight spread: 4 anchors collected", t.anchors.length === 4, String(t.anchors.length));
  assert("tight spread: confidence high", t.confidence === "high", t.confidence);
  assert("tight spread: triangulatedValue is the anchor median", t.triangulatedValue !== null);
  assert("tight spread: spreadPct <= 10%", (t.spreadPct ?? 1) <= 0.1, String(t.spreadPct));
}

// --- Wide disagreement ---
{
  const t = triangulateValuation({
    taxAssessedValue: 300_000,
    assessmentBasis: "assessed_ratio",
    avmValue: 450_000,
    askingPrice: 500_000,
    compImpliedValue: 420_000,
  });
  assert("wide spread: confidence low", t.confidence === "low", t.confidence);
  assert("wide spread: spreadPct > 25%", (t.spreadPct ?? 0) > 0.25, String(t.spreadPct));
  assert("wide spread: agreementNote flags uncertainty", t.agreementNote.toLowerCase().includes("uncertain"));
}

// --- Acquisition-value state (CA) excludes tax-assessed anchor ---
{
  const t = triangulateValuation({
    taxAssessedValue: 150_000, // Prop-13 basis value, deliberately far below market
    assessmentBasis: "acquisition_value",
    avmValue: 800_000,
    askingPrice: 810_000,
    compImpliedValue: null,
  });
  assert(
    "acquisition-value state: tax-assessed anchor excluded",
    !t.anchors.some((a) => a.kind === "tax_assessed"),
    JSON.stringify(t.anchors)
  );
  assert("acquisition-value state: still triangulates from remaining anchors", t.anchors.length === 2);
}

// --- Insufficient anchors ---
{
  const t = triangulateValuation({
    taxAssessedValue: null,
    assessmentBasis: null,
    avmValue: 400_000,
    askingPrice: null,
    compImpliedValue: null,
  });
  assert("insufficient anchors: confidence insufficient", t.confidence === "insufficient");
  assert("insufficient anchors: triangulatedValue falls back to the sole anchor", t.triangulatedValue === 400_000);
  assert("insufficient anchors: spreadPct is null", t.spreadPct === null);
}

// --- Zero anchors ---
{
  const t = triangulateValuation({
    taxAssessedValue: null,
    assessmentBasis: null,
    avmValue: null,
    askingPrice: null,
    compImpliedValue: null,
  });
  assert("zero anchors: triangulatedValue null", t.triangulatedValue === null);
  assert("zero anchors: confidence insufficient", t.confidence === "insufficient");
}

// ===========================================================================
// 3. Investor Yield
// ===========================================================================

console.log("\n═══ Investor Yield ═══\n");

// --- With FMR data ---
{
  const y = computeInvestorYield({ priceForYield: 400_000, monthlyRent: 2_400, countyFmr2br: 2_000 });
  assert("with FMR: returns a result", y !== null);
  if (y) {
    assert("with FMR: grossYieldPct is 7.2%", approx(y.grossYieldPct, 0.072, 0.001), String(y.grossYieldPct));
    assert("with FMR: onePercentRuleMet false (2400/400000=0.6% < 1%)", y.onePercentRuleMet === false, String(y.rentToPriceRatio));
    assert("with FMR: fmr2brDeltaPct is +20%", approx(y.fmr2brDeltaPct ?? 0, 0.2, 0.001), String(y.fmr2brDeltaPct));
    assert("with FMR: verdict mentions FMR", y.verdict.includes("Fair Market Rent"));
  }
}

// --- Without FMR data ---
{
  const y = computeInvestorYield({ priceForYield: 200_000, monthlyRent: 2_000, countyFmr2br: null });
  assert("without FMR: returns a result", y !== null);
  if (y) {
    assert("without FMR: onePercentRuleMet true (2000/200000=1%)", y.onePercentRuleMet === true);
    assert("without FMR: fmr2brDeltaPct is null", y.fmr2brDeltaPct === null);
    assert("without FMR: verdict omits FMR clause", !y.verdict.includes("Fair Market Rent"));
  }
}

// --- Missing rent or price ---
{
  assert("no rent: returns null", computeInvestorYield({ priceForYield: 400_000, monthlyRent: null, countyFmr2br: null }) === null);
  assert("no price: returns null", computeInvestorYield({ priceForYield: null, monthlyRent: 2_000, countyFmr2br: null }) === null);
}

// ===========================================================================
// 4. Risk & Momentum
// ===========================================================================

console.log("\n═══ Risk & Momentum ═══\n");

{
  const r = computeRiskMomentum({ hpiTrend5y: 0.22, vacancyRate: 0.03, femaHazardScores: { wfir: 92, hrcn: 10 } });
  assert("accelerating momentum detected", r.momentum === "accelerating", r.momentum);
  assert("vacancy not flagged (low)", r.vacancyElevated === false);
  assert("top peril is wildfire only (hrcn below threshold)", r.topPerils.length === 1 && r.topPerils[0].hazard === "wfir");
  assert("note mentions wildfire", r.note.toLowerCase().includes("wildfire"));
}

{
  const r = computeRiskMomentum({ hpiTrend5y: -0.03, vacancyRate: 0.12, femaHazardScores: {} });
  assert("cooling momentum detected", r.momentum === "cooling", r.momentum);
  assert("high vacancy flagged", r.vacancyElevated === true);
  assert("note mentions cooling and vacancy", r.note.includes("cooling") && r.note.includes("vacancy"));
}

{
  const r = computeRiskMomentum({ hpiTrend5y: null, vacancyRate: null, femaHazardScores: {} });
  assert("no data: momentum unknown", r.momentum === "unknown");
  assert("no data: note is the neutral fallback", r.note.includes("No notable"));
}

// ===========================================================================
// 5. Over-assessment flag
// ===========================================================================

console.log("\n═══ Over-assessment flag ═══\n");

{
  const f = computeOverAssessmentFlag({ taxAssessedValue: 500_000, assessmentBasis: "assessed_ratio", marketReference: 440_000 });
  assert("triggers at 12% below assessed", f.triggered === true);
  assert("note references tax appeal", !!f.note?.toLowerCase().includes("appeal"));
}

{
  const f = computeOverAssessmentFlag({ taxAssessedValue: 500_000, assessmentBasis: "assessed_ratio", marketReference: 480_000 });
  assert("does not trigger at 4% below (under threshold)", f.triggered === false);
}

{
  // CA Prop-13: assessed is expected to lag market by design — must not fire.
  const f = computeOverAssessmentFlag({ taxAssessedValue: 200_000, assessmentBasis: "acquisition_value", marketReference: 800_000 });
  assert("acquisition-value state never triggers", f.triggered === false);
}

{
  const f = computeOverAssessmentFlag({ taxAssessedValue: null, assessmentBasis: "assessed_ratio", marketReference: 400_000 });
  assert("missing assessed value: no trigger, no throw", f.triggered === false && f.note === null);
}

// ===========================================================================
// 6. Integration — buildUsAdvantageBundle end-to-end
// ===========================================================================

console.log("\n═══ buildUsAdvantageBundle (integration) ═══\n");

{
  const record = fixtureRecord({
    lastSaleDate: isoYearsAgo(1.5, NOW),
    lastSalePrice: 310_000,
    taxAssessments: [{ year: 2025, value: 340_000, land: 80_000, improvements: 260_000 }],
  });

  const bundle = buildUsAdvantageBundle({
    record,
    askingPrice: 379_000,
    avmValue: 372_000,
    taxAssessedValue: 340_000,
    assessmentBasis: "assessed_ratio",
    compImpliedValue: 365_000,
    monthlyRent: 2_450,
    marketPanel: {
      countyFips: "US-48453",
      medianHomeValue: 500_000,
      medianHomeValueMoe: null,
      medianGrossRent: 1_900,
      medianGrossRentMoe: null,
      vacancyRate: 0.05,
      vacancyRateMoe: null,
      medianHouseholdIncome: 85_000,
      medianHouseholdIncomeMoe: null,
      fmrStudio: null,
      fmr1br: null,
      fmr2br: 2_000,
      fmr3br: null,
      fmr4br: null,
      hpiLatest: 310,
      hpiTrend5y: 0.18,
      femaRiskScore: 40,
      femaEalScore: 35,
      femaHazardScores: { drgt: 65, hwav: 70 },
      vintages: {},
    },
  });

  assert("integration: equity signal fires (short-hold flip)", bundle.equitySignal?.tier === "short_hold_flip", bundle.equitySignal?.tier);
  assert("integration: triangulation has 4 anchors", bundle.triangulation.anchors.length === 4);
  assert("integration: investor yield computed", bundle.investorYield !== null);
  assert("integration: risk momentum is accelerating (18% >= 15% threshold)", bundle.riskMomentum.momentum === "accelerating");
  assert("integration: no over-assessment (asking above assessed)", bundle.overAssessment.triggered === false);

  console.log("\n  Example bundle output (fixture in → enriched advantage bundle out):");
  console.log(JSON.stringify(bundle, null, 2).split("\n").map((l) => "    " + l).join("\n"));
}

{
  // Off-market fixture: no asking price, AVM stands in.
  const record = fixtureRecord({
    lastSaleDate: isoYearsAgo(12, NOW),
    lastSalePrice: 180_000,
    taxAssessments: [{ year: 2024, value: 410_000, land: null, improvements: null }],
  });

  const bundle = buildUsAdvantageBundle({
    record,
    askingPrice: null,
    avmValue: 470_000,
    taxAssessedValue: 410_000,
    assessmentBasis: "assessed_ratio",
    compImpliedValue: null,
    monthlyRent: null,
    marketPanel: null,
  });

  assert("off-market: equity signal uses avm_estimate kind", bundle.equitySignal?.currentValueKind === "avm_estimate");
  assert("off-market: equity tier is long-tenure high-equity", bundle.equitySignal?.tier === "long_tenure_high_equity");
  assert("off-market: investor yield null (no rent)", bundle.investorYield === null);
  assert("off-market: risk momentum unknown (no market panel)", bundle.riskMomentum.momentum === "unknown");
  assert("off-market: over-assessment does not trigger (avm above assessed)", bundle.overAssessment.triggered === false);
}

// ---------------------------------------------------------------------------
console.log("\n═══ Summary ═══");
console.log(`  ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
