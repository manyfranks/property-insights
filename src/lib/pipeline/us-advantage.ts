/**
 * pipeline/us-advantage.ts
 *
 * The "US Advantage" layer — signals and analysis Canada structurally
 * cannot produce, because the CA pipeline (src/lib/signals.ts,
 * src/lib/scoring.ts, src/lib/offer-model.ts) is built around Zoocasa's MLS
 * remarks text (2 anchors: assessment + asking; keyword-driven motivation
 * signals). RentCast's free tier returns no MLS remarks — see
 * src/lib/pipeline/us-assess.ts's module doc — so those keyword signals
 * structurally never fire for US listings (`getSignals`/`scoreV2` still run
 * against the US Listing and correctly return DOM/price-reduced/building-age
 * signals; they just can't see text that was never there).
 *
 * What RentCast *does* give the US pipeline that BC's cache never had: sale
 * history (last sale date + price), a full tax-assessment history, an AVM
 * with a value range and comparables, and a rent estimate — plus, riding
 * alongside, county-level HPI/vacancy/FMR/FEMA panels
 * (src/lib/db/regional-econ.ts). That is enough to build five signals with
 * no US analogue in the CA product:
 *
 *   1. computeEquityTenureSignal — hold period + implied equity from sale
 *      history, corroborated against county HPI. Structural distress/flip/
 *      flexibility detection that replaces the keyword signals RentCast
 *      can't supply. (If/when a paid RentCast tier adds MLS remarks, the
 *      keyword signals in signals.ts/scoring.ts would simply start firing
 *      again on their own — nothing here needs to change.)
 *   2. triangulateValuation — 3-4 independent value anchors (tax-assessed,
 *      AVM, asking, comp $/sqft) instead of CA's 2 (assessment + asking),
 *      with an explicit spread/confidence read.
 *   3. computeInvestorYield — gross yield, the 1% rule, and a rent-vs-FMR
 *      read; CA has no per-property rent estimate at all.
 *   4. computeRiskMomentum — HPI momentum, vacancy, and top FEMA perils
 *      condensed into one offer-adjacent note.
 *   5. computeOverAssessmentFlag — asking/AVM sitting meaningfully below the
 *      tax-assessed value, which pairs with the Ownwell tax-appeal CTA
 *      (src/config/affiliate-vendors.ts).
 *
 * Every function here is pure (record/panel shapes in, plain data out) and
 * makes zero network calls — see scripts/test-us-advantage.ts for fixture-
 * driven coverage. buildUsAdvantageBundle() is the single integration point
 * route.ts's handleUSAssessment calls; every number it returns is a modeled
 * estimate and must keep the modeled-estimate disclaimer treatment when
 * rendered (src/components/us-assessment-result.tsx).
 *
 * These are deliberately NOT wired through src/lib/signals.ts or
 * src/lib/scoring.ts: those functions are shared with the CA pipeline and
 * their weights must not shift for CA listings. The equity/tenure signal's
 * score contribution is instead applied on top of scoreV2()'s result via
 * applyEquitySignalToScore(), entirely within the US-only code path — CA
 * never calls it, so CA scoring is provably unaffected.
 */

import type { Assessment, ScoreResult } from "../types";
import type { RentCastPropertyRecord } from "../rentcast";
import type { CountyMarketPanel } from "../db/regional-econ";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ---------------------------------------------------------------------------
// 1. Seller Equity & Tenure signal
// ---------------------------------------------------------------------------

export type EquityTenureTier =
  | "loss_sale_distress"
  | "short_hold_flip"
  | "long_tenure_high_equity"
  | "moderate_hold";

export interface EquityTenureSignal {
  tier: EquityTenureTier;
  /** Short chip label, e.g. for the signals list ("Loss-Sale Distress"). */
  label: string;
  holdYears: number;
  lastSaleDate: string;
  lastSalePrice: number;
  currentValueEstimate: number;
  currentValueKind: "asking" | "avm_estimate";
  /** (currentValueEstimate - lastSalePrice) / lastSalePrice. A PROXY for
   * appreciation/equity change — it does NOT net out any mortgage balance
   * or paydown, which RentCast's free tier doesn't expose. Disclosed as
   * such wherever rendered. */
  impliedAppreciationPct: number;
  /** lastSalePrice grown forward at the county's annualized HPI rate over
   * holdYears — an independent "should be worth about this" corroboration
   * check, not derived from currentValueEstimate itself. Null if the county
   * has no HPI series. */
  hpiImpliedValue: number | null;
  hpiCorroboration: "consistent" | "below_hpi_trend" | "above_hpi_trend" | "no_hpi_data";
  motivationStrength: "high" | "moderate" | "none";
  /** Points added on top of scoreV2()'s US-pipeline total — see
   * applyEquitySignalToScore(). Weighted against scoring.ts's existing CA
   * scale (Estate/Distress=18, Price Reduced=15, Must Sell=12): a verified
   * below-purchase-price ask is a stronger, structural version of the same
   * "distress" idea, so it sits above Estate/Distress at 20. The flip and
   * long-tenure tiers are read as *negotiation leverage*, not desperation,
   * so they're weighted lower (10 / 6). */
  scorePoints: number;
  narrative: string;
}

/** "Recent" purchase window for the loss-sale check — cap it so a 2016
 * purchase that's merely flat-to-down in a soft micro-market doesn't get
 * mislabeled as acute distress; within 5 years, a sub-purchase-price ask is
 * still very likely to mean the seller owes more than they'll net. */
const LOSS_SALE_MAX_HOLD_YEARS = 5;
/** Asking must be at or below 98% of the purchase price (not just <100%) so
 * ordinary rounding/negotiation noise near breakeven doesn't false-trigger. */
const LOSS_SALE_PRICE_RATIO = 0.98;

/** Flip window — RentCast's own data can't distinguish "investor flip" from
 * "owner-occupant sold quickly for personal reasons" beyond hold length and
 * markup size, so this stays conservative: under 2 years plus a markup big
 * enough that it reads as a value-add resale rather than a wash sale. */
const FLIP_MAX_HOLD_YEARS = 2;
const FLIP_MIN_MARKUP_RATIO = 1.15;

/** Long-tenure/high-equity: a decade+ hold is the point at which most
 * conventional mortgages are substantially paid down regardless of price
 * appreciation, so hold length alone is load-bearing here, backed by a
 * meaningful (50%+) price gain as corroboration that there's real cushion. */
const LONG_TENURE_MIN_HOLD_YEARS = 10;
const LONG_TENURE_MIN_APPRECIATION = 0.5;

/** HPI corroboration band: within +/-8% of the HPI-projected value counts as
 * "the asking price is consistent with county-wide trend," matching the
 * medium-confidence band used in triangulateValuation() below. */
const HPI_CONSISTENT_BAND = 0.08;

function yearsBetween(dateStr: string, now: Date): number {
  const then = new Date(dateStr);
  if (Number.isNaN(then.getTime())) return NaN;
  return (now.getTime() - then.getTime()) / (365.25 * 24 * 3600 * 1000);
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

/**
 * Computes the seller equity/tenure signal from RentCast's sale history.
 * Returns null when there's no usable sale history (no lastSaleDate/
 * lastSalePrice, or a currentValueEstimate to compare against) — callers
 * must treat null as "no signal available," the graceful-degradation path
 * for the ~free-tier addresses where RentCast has no transaction on file.
 *
 * `currentValueKind` disambiguates the narrative: "asking" when there's a
 * live listing price, "avm_estimate" for off-market properties where the
 * AVM value stands in for what the property would likely transact at.
 */
export function computeEquityTenureSignal(
  record: RentCastPropertyRecord | null,
  currentValueEstimate: number | null,
  currentValueKind: "asking" | "avm_estimate",
  hpiTrend5y: number | null,
  now: Date = new Date()
): EquityTenureSignal | null {
  if (!record?.lastSaleDate || !record.lastSalePrice || record.lastSalePrice <= 0) return null;
  if (currentValueEstimate == null || currentValueEstimate <= 0) return null;

  const holdYears = yearsBetween(record.lastSaleDate, now);
  if (!Number.isFinite(holdYears) || holdYears < 0) return null;

  const lastSalePrice = record.lastSalePrice;
  const impliedAppreciationPct = (currentValueEstimate - lastSalePrice) / lastSalePrice;

  let hpiImpliedValue: number | null = null;
  let hpiCorroboration: EquityTenureSignal["hpiCorroboration"] = "no_hpi_data";
  if (hpiTrend5y != null) {
    const annualRate = Math.pow(1 + hpiTrend5y, 1 / 5) - 1;
    hpiImpliedValue = Math.round(lastSalePrice * Math.pow(1 + annualRate, holdYears));
    if (hpiImpliedValue > 0) {
      const dev = (currentValueEstimate - hpiImpliedValue) / hpiImpliedValue;
      hpiCorroboration =
        Math.abs(dev) <= HPI_CONSISTENT_BAND ? "consistent" : dev < 0 ? "below_hpi_trend" : "above_hpi_trend";
    }
  }

  const refWord = currentValueKind === "asking" ? "asking" : "estimated value";

  let tier: EquityTenureTier;
  let label: string;
  let motivationStrength: EquityTenureSignal["motivationStrength"];
  let scorePoints: number;
  let narrative: string;

  if (holdYears <= LOSS_SALE_MAX_HOLD_YEARS && currentValueEstimate <= lastSalePrice * LOSS_SALE_PRICE_RATIO) {
    tier = "loss_sale_distress";
    label = "Loss-Sale Distress";
    motivationStrength = "high";
    scorePoints = 20;
    narrative =
      `Bought ${holdYears.toFixed(1)}yr ago for ${money(lastSalePrice)}; the ${refWord} of ` +
      `${money(currentValueEstimate)} is below that purchase price — a structural sign of a seller under ` +
      `financial pressure, not just listing language.`;
  } else if (holdYears <= FLIP_MAX_HOLD_YEARS && currentValueEstimate >= lastSalePrice * FLIP_MIN_MARKUP_RATIO) {
    tier = "short_hold_flip";
    label = "Investor Flip";
    motivationStrength = "moderate";
    scorePoints = 10;
    narrative =
      `Bought ${holdYears.toFixed(1)}yr ago for ${money(lastSalePrice)}, now ${refWord === "asking" ? "asking" : "valued at"} ` +
      `${money(currentValueEstimate)} (+${(impliedAppreciationPct * 100).toFixed(0)}%) — a short-hold resale that reads ` +
      `as an investor/flipper, likely negotiable to avoid another cycle of carrying costs.`;
  } else if (holdYears >= LONG_TENURE_MIN_HOLD_YEARS && impliedAppreciationPct >= LONG_TENURE_MIN_APPRECIATION) {
    tier = "long_tenure_high_equity";
    label = "Long-Tenure Equity";
    motivationStrength = "moderate";
    scorePoints = 6;
    narrative =
      `Owned ${holdYears.toFixed(0)} years, purchased for ${money(lastSalePrice)} — an estimated ` +
      `+${(impliedAppreciationPct * 100).toFixed(0)}% since purchase gives this seller room to negotiate ` +
      `without going underwater.`;
  } else {
    tier = "moderate_hold";
    label = "Moderate Hold";
    motivationStrength = "none";
    scorePoints = 0;
    narrative = `Owned ${holdYears.toFixed(1)} years since the last recorded sale (${money(lastSalePrice)}). No structural distress or flip pattern detected from sale history alone.`;
  }

  return {
    tier,
    label,
    holdYears,
    lastSaleDate: record.lastSaleDate,
    lastSalePrice,
    currentValueEstimate,
    currentValueKind,
    impliedAppreciationPct,
    hpiImpliedValue,
    hpiCorroboration,
    motivationStrength,
    scorePoints,
    narrative,
  };
}

/**
 * Applies the equity/tenure signal's score contribution on top of an
 * already-computed scoreV2() result, entirely outside scoring.ts so CA's
 * weights are untouched (CA never calls this). Mirrors scoreV2()'s own
 * cap-at-100 and tier thresholds (33/45) — see src/lib/scoring.ts.
 */
export function applyEquitySignalToScore(score: ScoreResult, equitySignal: EquityTenureSignal | null): ScoreResult {
  if (!equitySignal || equitySignal.scorePoints === 0) return score;
  const total = Math.min(score.total + equitySignal.scorePoints, 100);
  const tier: ScoreResult["tier"] = total >= 45 ? "HOT" : total >= 33 ? "WARM" : "WATCH";
  return {
    total,
    tier,
    breakdown: { ...score.breakdown, [equitySignal.label]: equitySignal.scorePoints },
  };
}

/** Chip label for the signals list — null for the neutral "moderate_hold"
 * tier (nothing worth surfacing as a signal chip) or missing sale history. */
export function equitySignalLabel(equitySignal: EquityTenureSignal | null): string | null {
  if (!equitySignal || equitySignal.tier === "moderate_hold") return null;
  return equitySignal.label;
}

// ---------------------------------------------------------------------------
// 2. Valuation Triangulation
// ---------------------------------------------------------------------------

export interface TriangulationAnchor {
  label: string;
  value: number;
  kind: "tax_assessed" | "avm" | "asking" | "comp_implied";
}

export interface ValuationTriangulation {
  anchors: TriangulationAnchor[];
  /** Anchors that were computed but deliberately left OUT of the math above
   * — currently just a demoted tax-assessed value (see
   * src/lib/pipeline/us-assess.ts's assessAnchorPlausibility). Shown for
   * transparency ("here's what we have and why we didn't use it"), never
   * folded into triangulatedValue/spreadPct. Empty when nothing was
   * excluded. */
  excludedAnchors: TriangulationAnchor[];
  /** Median of the credible anchors; null when fewer than 2 anchors exist
   * (no meaningful triangulation possible). */
  triangulatedValue: number | null;
  /** (max - min) / triangulatedValue across the anchor set. Null when
   * triangulatedValue is null. */
  spreadPct: number | null;
  confidence: "high" | "medium" | "low" | "insufficient";
  agreementNote: string;
}

/** Spread bands, expressed as (max-min)/median across the anchor set. Tight
 * agreement (<=10%) between independently-sourced values (government tax
 * roll, RentCast's model, the market's own asking price, comp $/sqft) is a
 * meaningfully stronger confidence signal than CA's 2-anchor (assessment +
 * asking) setup can ever produce. */
const TRIANGULATION_HIGH_CONFIDENCE_SPREAD = 0.1;
const TRIANGULATION_MEDIUM_CONFIDENCE_SPREAD = 0.25;

/**
 * Triangulates a market value from up to 4 independent anchors: tax-
 * assessed value, RentCast's AVM, the asking price, and the AVM comps'
 * median $/sqft implied value (src/lib/pipeline/us-assess.ts's
 * buildUsCompSupport().impliedValue). CA's offer-model.ts anchors on
 * exactly 2 (assessment, asking) — this is structurally richer.
 *
 * The tax-assessed anchor is "basis-corrected": acquisition-value states
 * (California's Prop 13 — see assessmentBasisForState() in rentcast.ts)
 * assess on purchase price + a small annual cap, not market value, by
 * design. Including it as a market-value anchor there would corrupt the
 * triangulation with a number that's expected to diverge from market, not
 * a soft proxy for it — so it's excluded rather than down-weighted.
 *
 * `taxAssessedDemoted` applies the same treatment for a DIFFERENT reason:
 * src/lib/pipeline/us-assess.ts's assessAnchorPlausibility flagged the
 * assessed value itself as decoupled from market reality for this specific
 * listing (agricultural exemption, cap, partial parcel, or a flat data
 * mismatch) — not a property of the state's assessment scheme in general.
 * Rather than silently dropping it (a user who knows the county has an
 * assessed value on file would rightly wonder where it went), it's pushed
 * into `excludedAnchors` — visible, labeled, just not part of the median.
 */
export function triangulateValuation(opts: {
  taxAssessedValue: number | null;
  assessmentBasis: Assessment["assessmentBasis"] | null | undefined;
  avmValue: number | null;
  /** True asking price only — null when there's no active listing (pass
   * the AVM value to `avmValue`, not here, for off-market properties). */
  askingPrice: number | null;
  compImpliedValue: number | null;
  /** True when assessAnchorPlausibility demoted the tax-assessed value for
   * THIS listing (verdict "context_only") — excludes it from the
   * triangulation math while still surfacing it in excludedAnchors.
   * Default false (existing callers unaffected). */
  taxAssessedDemoted?: boolean;
}): ValuationTriangulation {
  const anchors: TriangulationAnchor[] = [];
  const excludedAnchors: TriangulationAnchor[] = [];

  if (opts.taxAssessedValue != null && opts.assessmentBasis !== "acquisition_value") {
    const anchor: TriangulationAnchor = { label: "Tax-assessed value", value: opts.taxAssessedValue, kind: "tax_assessed" };
    if (opts.taxAssessedDemoted) excludedAnchors.push(anchor);
    else anchors.push(anchor);
  }
  if (opts.avmValue != null) anchors.push({ label: "RentCast AVM", value: opts.avmValue, kind: "avm" });
  if (opts.askingPrice != null) anchors.push({ label: "Asking price", value: opts.askingPrice, kind: "asking" });
  if (opts.compImpliedValue != null) {
    anchors.push({ label: "Comp $/sqft implied value", value: opts.compImpliedValue, kind: "comp_implied" });
  }

  if (anchors.length < 2) {
    return {
      anchors,
      excludedAnchors,
      triangulatedValue: anchors[0]?.value ?? null,
      spreadPct: null,
      confidence: "insufficient",
      agreementNote:
        anchors.length === 1
          ? "Only one valuation anchor available for this address — no triangulation possible."
          : excludedAnchors.length > 0
            ? "No usable valuation anchors for this address — the tax-assessed value was excluded as unreliable (see below)."
            : "No valuation anchors available for this address.",
    };
  }

  const values = anchors.map((a) => a.value).sort((a, b) => a - b);
  const triangulatedValue = Math.round(median(values));
  const spreadPct = (values[values.length - 1] - values[0]) / triangulatedValue;

  let confidence: ValuationTriangulation["confidence"];
  if (spreadPct <= TRIANGULATION_HIGH_CONFIDENCE_SPREAD) confidence = "high";
  else if (spreadPct <= TRIANGULATION_MEDIUM_CONFIDENCE_SPREAD) confidence = "medium";
  else confidence = "low";

  const spreadLabel = `${(spreadPct * 100).toFixed(1)}%`;
  let agreementNote =
    confidence === "high"
      ? `${anchors.length} independent value anchors agree within ${spreadLabel} — high-confidence valuation.`
      : confidence === "medium"
        ? `${anchors.length} value anchors span ${spreadLabel} — moderate agreement.`
        : `${anchors.length} value anchors disagree by ${spreadLabel} — treat this valuation as uncertain and weight DOM/equity signals more heavily.`;
  if (excludedAnchors.length > 0) {
    agreementNote += ` (Tax-assessed value excluded as unreliable for this listing — see below.)`;
  }

  return { anchors, excludedAnchors, triangulatedValue, spreadPct, confidence, agreementNote };
}

// ---------------------------------------------------------------------------
// 3. Investor Yield layer
// ---------------------------------------------------------------------------

export interface InvestorYield {
  grossYieldPct: number;
  rentToPriceRatio: number;
  onePercentRuleMet: boolean;
  /** (monthlyRent - countyFmr2br) / countyFmr2br. Null when the county has
   * no HUD FMR-2BR figure on record. */
  fmr2brDeltaPct: number | null;
  verdict: string;
}

/** The classic real-estate-investor screening heuristic: monthly rent >= 1%
 * of purchase price. Kept as a plain ratio rather than a config knob since
 * it's a fixed, widely-recognized rule of thumb, not a tuned threshold. */
const ONE_PERCENT_RULE_RATIO = 0.01;

/**
 * Gross rental yield + 1%-rule + county Fair-Market-Rent positioning. CA has
 * no per-property rent estimate at all — this is a pure US addition.
 * Returns null when there's no price or no rent estimate to work from
 * (e.g. RentCast's rent model didn't return a value for this address).
 */
export function computeInvestorYield(opts: {
  /** Asking price if listed, else an AVM/estimated value for off-market. */
  priceForYield: number | null;
  monthlyRent: number | null;
  countyFmr2br: number | null;
}): InvestorYield | null {
  if (opts.priceForYield == null || opts.priceForYield <= 0) return null;
  if (opts.monthlyRent == null || opts.monthlyRent <= 0) return null;

  const rentToPriceRatio = opts.monthlyRent / opts.priceForYield;
  const grossYieldPct = (opts.monthlyRent * 12) / opts.priceForYield;
  const onePercentRuleMet = rentToPriceRatio >= ONE_PERCENT_RULE_RATIO;

  let fmr2brDeltaPct: number | null = null;
  let fmrNote = "";
  if (opts.countyFmr2br != null && opts.countyFmr2br > 0) {
    fmr2brDeltaPct = (opts.monthlyRent - opts.countyFmr2br) / opts.countyFmr2br;
    fmrNote = ` Rent estimate is ${fmr2brDeltaPct >= 0 ? "+" : ""}${(fmr2brDeltaPct * 100).toFixed(0)}% vs. the county's 2BR Fair Market Rent.`;
  }

  const verdict =
    `Gross yield ${(grossYieldPct * 100).toFixed(1)}% (${onePercentRuleMet ? "meets" : "below"} the 1% rule` +
    `, rent/price ${(rentToPriceRatio * 100).toFixed(2)}%).${fmrNote}`;

  return { grossYieldPct, rentToPriceRatio, onePercentRuleMet, fmr2brDeltaPct, verdict };
}

// ---------------------------------------------------------------------------
// 4. Risk & Momentum context
// ---------------------------------------------------------------------------

export interface RiskMomentumPeril {
  hazard: string;
  label: string;
  score: number;
}

export interface RiskMomentumContext {
  momentum: "accelerating" | "steady" | "cooling" | "unknown";
  hpiTrend5y: number | null;
  vacancyRate: number | null;
  vacancyElevated: boolean;
  topPerils: RiskMomentumPeril[];
  note: string;
}

/** FHFA HPI ~5yr cumulative growth thresholds. >=15% cumulative reads as an
 * accelerating market (roughly >2.8%/yr compounded); below 0% is outright
 * declining/cooling; the band between is ordinary steady appreciation. */
const HPI_ACCELERATING_THRESHOLD = 0.15;
const HPI_COOLING_THRESHOLD = 0;

/** ACS rental vacancy rate above which a market reads as soft/oversupplied
 * for a landlord — 8% is roughly double the tight-market norm most metro
 * counties run at. */
const HIGH_VACANCY_THRESHOLD = 0.08;

/** FEMA NRI per-hazard scores are 0-100 percentiles nationally; 50+ means
 * "more exposed than at least half of all US counties" for that specific
 * peril — a reasonable bar for "worth calling out," not just present. */
const SIGNIFICANT_PERIL_SCORE = 50;

const HAZARD_LABELS: Record<string, string> = {
  avln: "avalanche",
  cfld: "coastal flooding",
  cwav: "cold wave",
  drgt: "drought",
  erqk: "earthquake",
  hail: "hail",
  hwav: "heat wave",
  hrcn: "hurricane",
  istm: "ice storm",
  ifld: "riverine flooding",
  lnds: "landslide",
  ltng: "lightning",
  swnd: "strong wind",
  trnd: "tornado",
  tsun: "tsunami",
  vlcn: "volcanic activity",
  wfir: "wildfire",
  wntw: "winter weather",
};

/**
 * Condenses county HPI momentum, vacancy, and top FEMA perils
 * (src/lib/db/regional-econ.ts's CountyMarketPanel) into one risk-adjusted
 * note attachable to the offer. CA has no county-level risk/momentum panel
 * at all — pure US addition.
 */
export function computeRiskMomentum(opts: {
  hpiTrend5y: number | null;
  vacancyRate: number | null;
  femaHazardScores: Record<string, number>;
}): RiskMomentumContext {
  let momentum: RiskMomentumContext["momentum"] = "unknown";
  if (opts.hpiTrend5y != null) {
    if (opts.hpiTrend5y >= HPI_ACCELERATING_THRESHOLD) momentum = "accelerating";
    else if (opts.hpiTrend5y < HPI_COOLING_THRESHOLD) momentum = "cooling";
    else momentum = "steady";
  }

  const vacancyElevated = opts.vacancyRate != null && opts.vacancyRate >= HIGH_VACANCY_THRESHOLD;

  const topPerils: RiskMomentumPeril[] = Object.entries(opts.femaHazardScores)
    .filter(([, score]) => score >= SIGNIFICANT_PERIL_SCORE)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([hazard, score]) => ({ hazard, label: HAZARD_LABELS[hazard] ?? hazard, score }));

  const parts: string[] = [];
  if (momentum === "accelerating") {
    parts.push(
      `county home values are accelerating (+${(opts.hpiTrend5y! * 100).toFixed(1)}% over ~5yr) — less room to negotiate on market conditions alone`
    );
  } else if (momentum === "cooling") {
    parts.push(
      `county home values are cooling (${(opts.hpiTrend5y! * 100).toFixed(1)}% over ~5yr) — supports a more aggressive offer`
    );
  } else if (momentum === "steady") {
    parts.push(`county home values are growing steadily (+${(opts.hpiTrend5y! * 100).toFixed(1)}% over ~5yr)`);
  }

  if (vacancyElevated) {
    parts.push(`vacancy is elevated (${(opts.vacancyRate! * 100).toFixed(1)}%) — factor softer rental demand into any hold strategy`);
  }

  if (topPerils.length > 0) {
    const perilText = topPerils.map((p) => `${p.label} risk (score ${p.score.toFixed(0)}/100)`).join(", ");
    parts.push(`elevated ${perilText} — factor insurance costs into the offer`);
  }

  const note = parts.length > 0 ? parts.join("; ") + "." : "No notable risk or momentum signals from county data for this area.";

  return {
    momentum,
    hpiTrend5y: opts.hpiTrend5y,
    vacancyRate: opts.vacancyRate,
    vacancyElevated,
    topPerils,
    note,
  };
}

// ---------------------------------------------------------------------------
// 5. Over-assessment flag
// ---------------------------------------------------------------------------

export interface OverAssessmentFlag {
  triggered: boolean;
  taxAssessedValue: number | null;
  marketReference: number | null;
  /** (marketReference - taxAssessedValue) / taxAssessedValue. Negative means
   * the market reference sits below the assessed value. */
  deltaPct: number | null;
  note: string | null;
}

/** Trigger when the market reference sits 8%+ below the tax-assessed value
 * — enough of a gap that a formal appeal is plausibly worth the effort, not
 * just ordinary estimate noise between a government roll (often a year or
 * more stale) and a live market read. */
const OVER_ASSESSMENT_THRESHOLD = -0.08;

/**
 * Flags a potential property-tax-appeal opportunity when the market
 * reference (triangulated value, or asking/AVM as a fallback) sits
 * meaningfully below the tax-assessed value. Pairs with the Ownwell
 * tax-appeal CTA (src/config/affiliate-vendors.ts) — rendered as a
 * highlighted callout near the CTA block so the flag makes that CTA
 * contextually relevant instead of a generic pitch.
 *
 * Acquisition-value states (assessmentBasis === "acquisition_value", e.g.
 * California's Prop 13) are excluded: their assessed value is *expected* to
 * lag market value by design (it tracks purchase price + a small annual
 * cap), so a gap there isn't evidence of a mis-assessment worth appealing.
 */
export function computeOverAssessmentFlag(opts: {
  taxAssessedValue: number | null;
  assessmentBasis: Assessment["assessmentBasis"] | null | undefined;
  marketReference: number | null;
}): OverAssessmentFlag {
  if (opts.taxAssessedValue == null || opts.taxAssessedValue <= 0 || opts.marketReference == null) {
    return { triggered: false, taxAssessedValue: opts.taxAssessedValue, marketReference: opts.marketReference, deltaPct: null, note: null };
  }

  const deltaPct = (opts.marketReference - opts.taxAssessedValue) / opts.taxAssessedValue;
  const triggered = deltaPct <= OVER_ASSESSMENT_THRESHOLD && opts.assessmentBasis !== "acquisition_value";

  const note = triggered
    ? `Market value is estimated ~${Math.abs(deltaPct * 100).toFixed(0)}% below the ${money(opts.taxAssessedValue)} tax-assessed value — this may be a property-tax appeal opportunity.`
    : null;

  return { triggered, taxAssessedValue: opts.taxAssessedValue, marketReference: opts.marketReference, deltaPct, note };
}

// ---------------------------------------------------------------------------
// Integration point
// ---------------------------------------------------------------------------

export interface UsAdvantageBundle {
  equitySignal: EquityTenureSignal | null;
  triangulation: ValuationTriangulation;
  investorYield: InvestorYield | null;
  riskMomentum: RiskMomentumContext;
  overAssessment: OverAssessmentFlag;
}

/**
 * Single integration point for route.ts's handleUSAssessment: builds all
 * five US Advantage signals from data already fetched for the assessment
 * (the RentCast bundle, the resolved Assessment, the AVM-comp implied
 * value, and the county market panel) — zero additional RentCast calls.
 *
 * `askingPrice` should be the true asking price when there's an active
 * listing, or null for off-market properties (the AVM value then stands in
 * via `avmValue` for the equity-signal and yield calculations, tagged
 * `currentValueKind: "avm_estimate"` so the narrative stays honest about
 * what it's comparing against).
 */
export function buildUsAdvantageBundle(opts: {
  record: RentCastPropertyRecord | null;
  askingPrice: number | null;
  avmValue: number | null;
  taxAssessedValue: number | null;
  assessmentBasis: Assessment["assessmentBasis"] | null | undefined;
  compImpliedValue: number | null;
  monthlyRent: number | null;
  marketPanel: CountyMarketPanel | null;
  /** True when src/lib/pipeline/us-assess.ts's assessAnchorPlausibility
   * demoted the tax-assessed value for THIS listing (verdict
   * "context_only"). Excludes it from triangulation's median (still shown
   * in excludedAnchors) and from the over-assessment/tax-appeal flag, which
   * would otherwise compare a known-unreliable assessed figure against the
   * market reference and produce a meaningless "appeal opportunity" read.
   * Default false — existing callers unaffected. */
  taxAssessedDemoted?: boolean;
}): UsAdvantageBundle {
  const hpiTrend5y = opts.marketPanel?.hpiTrend5y ?? null;

  const currentValueEstimate = opts.askingPrice ?? opts.avmValue ?? null;
  const currentValueKind: "asking" | "avm_estimate" = opts.askingPrice != null ? "asking" : "avm_estimate";

  const equitySignal = computeEquityTenureSignal(opts.record, currentValueEstimate, currentValueKind, hpiTrend5y);

  const triangulation = triangulateValuation({
    taxAssessedValue: opts.taxAssessedValue,
    assessmentBasis: opts.assessmentBasis,
    avmValue: opts.avmValue,
    askingPrice: opts.askingPrice,
    compImpliedValue: opts.compImpliedValue,
    taxAssessedDemoted: opts.taxAssessedDemoted,
  });

  const investorYield = computeInvestorYield({
    priceForYield: currentValueEstimate,
    monthlyRent: opts.monthlyRent,
    countyFmr2br: opts.marketPanel?.fmr2br ?? null,
  });

  const riskMomentum = computeRiskMomentum({
    hpiTrend5y,
    vacancyRate: opts.marketPanel?.vacancyRate ?? null,
    femaHazardScores: opts.marketPanel?.femaHazardScores ?? {},
  });

  const overAssessment = computeOverAssessmentFlag({
    taxAssessedValue: opts.taxAssessedDemoted ? null : opts.taxAssessedValue,
    assessmentBasis: opts.assessmentBasis,
    marketReference: triangulation.triangulatedValue ?? currentValueEstimate,
  });

  return { equitySignal, triangulation, investorYield, riskMomentum, overAssessment };
}
