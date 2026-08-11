/**
 * pipeline/us-assess.ts
 *
 * Maps a RentCast USPropertyBundle (src/lib/rentcast.ts) into the shapes the
 * shared scoring/offer pipeline expects (Listing, Assessment — see
 * src/lib/types.ts), and computes comp support directly from AVM comps.
 *
 * This is the US analogue of src/lib/zoocasa.ts's listing mappers: Zoocasa
 * gives street-level MLS remarks (description text) that the signal/offer
 * engine mines for keywords ("motivated seller", "estate sale", etc.).
 * RentCast's free-tier endpoints don't return MLS remarks at all — so
 * `description`/`notes` are always empty for US listings, and every
 * text-keyword signal in signals.ts/scoring.ts/offer-model.ts simply never
 * fires. What *does* carry over: DOM-based scoring, building-age scoring,
 * and priceReduced (derived structurally from RentCast's price history,
 * not from text) — genuinely comparable to the CA pipeline, just thinner.
 * This is documented here rather than silently patched over.
 *
 * Comparables shortcut: matchComparables() (src/lib/comparables.ts) is
 * tightly coupled to Zoocasa's sold-listing shape (ZoocasaSoldRaw) and
 * calls fetchSoldDetail() to enrich top candidates — a Zoocasa-specific
 * network call with no RentCast equivalent, and forcing AVM comps through
 * that pipeline would mean fabricating soldPrice/soldAt/listPrice fields
 * RentCast's AVM comps don't actually provide (they're valuation
 * comparables — price + correlation + distance — not confirmed sold
 * transactions). Per the task's own fallback clause, comp support is
 * computed directly from the AVM's `comparables[]` (already returned by
 * the /avm/value call — zero extra RentCast requests) into a separate,
 * honestly-labeled UsCompSupport shape instead of forcing ComparableResult.
 */

import type { Assessment, AnchorDemotionReason, AnchorPlausibility, Listing } from "../types";
import type { RentCastAvm, RentCastPropertyRecord, USPropertyBundle } from "../rentcast";
import type { CountyAssessorResult } from "../assessment/us-county";
import { assessmentBasisForState } from "../rentcast";
import { fmt } from "../utils";
import {
  addRentCastEvidence,
  createPropertyEvidenceSnapshot,
  type EvidenceSurface,
} from "../property-intelligence/evidence";

// ---------------------------------------------------------------------------
// Assessment
// ---------------------------------------------------------------------------

/** Tax assessments older than this are treated as stale — prefer the AVM. */
const STALE_ASSESSMENT_YEARS = 3;

/**
 * Maps a live county adapter's own `assessmentBasis` (src/lib/assessment/
 * us-county/types.ts's CountyAssessorResult — "assessed_ratio" |
 * "full_value", verified per-county by whoever wrote that adapter) onto
 * Assessment.assessmentBasis (this file's broader "market_value" |
 * "assessed_ratio" | "acquisition_value", also used for RentCast-sourced
 * assessments and CA). "full_value" means the county's own figure is
 * already meant to track market value directly (WA's King County, by
 * statute) — treated the same as this codebase's "market_value" for
 * anchor-plausibility purposes (assessAnchorPlausibility's tight
 * DEFAULT_BAND). "assessed_ratio" carries straight through, and is what
 * makes assessAnchorPlausibility widen its band and consult
 * marketValueHint for a live county figure — same treatment RentCast's own
 * tax-assessed figures get for every non-acquisition-value state.
 *
 * Deliberately does NOT special-case "the anchor happens to be marketValue,
 * not assessedValue" — see this function's own doc comment below: when a
 * county's assessmentBasis is "assessed_ratio", the Assessment stays
 * tagged "assessed_ratio" even when countyLive.marketValue is what's
 * actually anchored (e.g. Cook's derived market figure, NYC's capped
 * curtxbtot/curmkttot pair), because that marketValue is still just the
 * SAME county's own figure for a basis known to run low/capped — not
 * independent corroboration of it. Only "full_value" counties (their own
 * assessedValue already IS market-tracking) get the tight band regardless
 * of which of the two fields ends up as totalValue.
 *
 * A live adapter that hasn't set assessmentBasis at all (shouldn't happen
 * for any of the six adapters registered as of this function's writing —
 * see src/lib/assessment/us-county/*.ts) falls back to the pre-existing
 * state-level default, exactly as if no live county data had been used.
 */
function assessmentBasisFromCountyLive(
  countyBasis: CountyAssessorResult["assessmentBasis"] | undefined,
  state: string
): Assessment["assessmentBasis"] {
  if (countyBasis === "assessed_ratio") return "assessed_ratio";
  if (countyBasis === "full_value") return "market_value";
  return assessmentBasisForState(state);
}

/**
 * Anchor priority: a LIVE county-assessor lookup (observed, government-
 * sourced, primary source) when one succeeded; tax-assessed value from
 * RentCast (observed, government-sourced, but a WEAKER secondary source —
 * see docs/plans/10-RENTCAST-DATA-QUALITY.md: only 59% coverage, and
 * measurably wrong for Phoenix specifically) when recent; RentCast's AVM
 * (modeled) when neither tax record is usable. Returns null only when none
 * of the three had anything for this address.
 *
 * `countyLive` — the result of src/lib/assessment/us-county's
 * lookupCountyLive(), fetched by the caller (route.ts) IN PARALLEL with the
 * RentCast bundle so this never adds latency when the county API answers
 * before RentCast does (or fails/times out — see that module's doc comment
 * for the hard per-county timeout). Optional/undefined for any caller that
 * hasn't wired the live lookup (keeps this function's existing 3-arg
 * callers, e.g. scripts/analyze-us-seeds.ts's zero-RentCast-call path,
 * source-compatible).
 *
 * Within a successful countyLive result, the assessor's own market/full-
 * cash figure (marketValue — AZ's Full Cash Value, FL's Just Value) is
 * preferred over its capped assessed figure (assessedValue — AZ's Limited
 * Property Value, FL's Save-Our-Homes-capped Assessed Value) when present:
 * the capped figure is BY DESIGN allowed to run below market, so anchoring
 * on the market-tracking figure when the county publishes one is a strictly
 * better anchor for offer-model.ts's ratio-vs-asking banding. Which figure
 * gets used as totalValue and what assessmentBasis gets reported are two
 * separate decisions, though — see assessmentBasisFromCountyLive() below:
 * a county whose own scheme is "assessed_ratio" (Cook, NYC, Maricopa,
 * Miami-Dade) stays tagged that way even when its marketValue is the one
 * anchored, since that marketValue is still just the same capped county's
 * own figure, not independent corroboration. Either way, this is still
 * just "is there a value to try" — assessAnchorPlausibility() (below) is
 * what decides whether the caller should actually trust it.
 */
export function buildUsAssessment(
  record: RentCastPropertyRecord | null,
  avm: RentCastAvm | null,
  state: string,
  countyLive?: CountyAssessorResult | null
): Assessment | null {
  if (countyLive?.marketValue && countyLive.marketValue > 0) {
    return {
      totalValue: countyLive.marketValue,
      landValue: 0,
      buildingValue: 0,
      assessmentYear: countyLive.assessmentYear,
      found: true,
      source: "government",
      evidenceClass: "observed",
      // NOT hardcoded "market_value" — a county whose OWN assessmentBasis
      // is "assessed_ratio" (Cook, NYC, Maricopa, Miami-Dade) stays tagged
      // "assessed_ratio" even though marketValue is what's anchored here,
      // so assessAnchorPlausibility still applies the wider band and
      // marketValueHint corroboration this basis calls for — see
      // assessmentBasisFromCountyLive's doc comment above.
      assessmentBasis: assessmentBasisFromCountyLive(countyLive.assessmentBasis, state),
      liveCountySource: true,
      liveCountyValueKind: "market_value",
    };
  }

  if (countyLive?.assessedValue && countyLive.assessedValue > 0) {
    return {
      totalValue: countyLive.assessedValue,
      landValue: 0,
      buildingValue: 0,
      assessmentYear: countyLive.assessmentYear,
      found: true,
      source: "government",
      evidenceClass: "observed",
      assessmentBasis: assessmentBasisFromCountyLive(countyLive.assessmentBasis, state),
      liveCountySource: true,
      liveCountyValueKind: "assessed_value",
    };
  }

  const latestTax = record?.taxAssessments?.[0];
  const currentYear = new Date().getFullYear();
  const isStale = !latestTax || currentYear - latestTax.year > STALE_ASSESSMENT_YEARS;

  if (latestTax && latestTax.value && !isStale) {
    return {
      totalValue: latestTax.value,
      landValue: latestTax.land ?? 0,
      buildingValue: latestTax.improvements ?? 0,
      assessmentYear: String(latestTax.year),
      found: true,
      source: "government",
      evidenceClass: "observed",
      assessmentBasis: assessmentBasisForState(state),
    };
  }

  if (avm?.value) {
    return {
      totalValue: avm.value,
      landValue: 0,
      buildingValue: 0,
      assessmentYear: String(currentYear),
      found: true,
      source: "avm",
      evidenceClass: "modeled",
      assessmentBasis: "market_value",
    };
  }

  // Stale/missing tax record with no AVM to fall back on — still surface
  // the stale record rather than nothing, honestly labeled as such.
  if (latestTax && latestTax.value) {
    return {
      totalValue: latestTax.value,
      landValue: latestTax.land ?? 0,
      buildingValue: latestTax.improvements ?? 0,
      assessmentYear: String(latestTax.year),
      found: true,
      source: "government",
      evidenceClass: "observed",
      assessmentBasis: assessmentBasisForState(state),
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Anchor plausibility gate
// ---------------------------------------------------------------------------
//
// buildUsAssessment() above answers "do we have an assessed value at all";
// this answers a separate question offer-model.ts never asks: "is that
// assessed value even a sane thing to anchor an offer on for THIS listing."
// County assessors are not a uniform market-value oracle — agricultural
// exemptions, assessment caps (AZ's Limited Property Value, FL's
// Save-Our-Homes), and partial-parcel/data-mismatch quirks routinely
// produce an assessed figure that's nowhere near what the property would
// transact for. offerModel()'s ratio-vs-asking banding (offer-model.ts) was
// tuned for ordinary 10-40% over/under pricing, not a 20x gap — feeding it
// one produces an anchor that LOOKS precise (it's still "3% above assessed")
// but is actually circular: assessed is wrong, so everything built on top
// of it is wrong too. This gate runs BEFORE offer-model.ts and decides
// whether the assessed value is even eligible to be that anchor.
//
// Flagship case this exists for: 12400 Cedar St, Austin — $9.9M asking,
// $452,339 Travis County (TCAD) assessed value. TCAD's own bulk roll data
// (see ../assessment/us-county/travis.ts) reports the SAME figure as both
// "assessed" and "market" value for this parcel — consistent with an
// agricultural-use valuation or a partial-parcel record (a ~2.9-acre lot on
// Lake Travis carrying an ag exemption, valued at production use rather
// than market use) rather than a data-entry error. Left unchecked, that
// $452k fed straight into offerModel() as if it were market-representative
// produced a $7.72M "recommended offer" justified by circular reasoning:
// the assessment was never a proxy for what this property is worth.
//
// Empirically validated: a data-quality audit (docs/plans/
// 10-RENTCAST-DATA-QUALITY.md, 36 /properties + 7 /avm/value calls against a
// second, isolated free-tier key — zero cost to this pipeline's quota)
// cross-referenced RentCast's tax/AVM fields against county-assessor ground
// truth on a stratified sample of this seeded pool. Two findings shaped the
// thresholds and hierarchy below: (1) the [0.4, 2.5] band on its own is a
// good discriminator — it caught the genuinely-anomalous cases while
// passing 86% of AVM samples; (2) AVM is the most reliable single dollar
// signal measured (14% of samples fell outside that band, vs 47% for
// RentCast's own taxAssessments and 41% for county-assessor values,
// including two Maricopa county figures wrong by 50-59x) — so this gate
// treats a materially-disagreeing AVM as authoritative over EITHER
// tax-based source, not just as a last-resort tiebreaker (see the
// assessed_ratio AVM-led override below). Both sources get equal suspicion
// here regardless of `assessment.source` — "county_assessor scraped it" is
// not automatically more trustworthy than "RentCast reported it" (Phoenix's
// RentCast taxAssessments ran 5-20x lower than Maricopa's own capped figure
// on half the audited sample).

/** Plausible band for a basis where assessed value is meant to track market
 * value fairly closely (assessmentBasis "market_value" — BC-style, or a
 * RentCast-AVM-as-assessment fallback with no basis quirks). Matches the
 * general real-estate norm that asking prices run somewhere between "at a
 * discount for a stale/undesirable listing" and "a premium for a hot one" —
 * 0.4x-2.5x assessed is generous enough to cover both without flagging
 * ordinary market variance. */
const DEFAULT_BAND = { lo: 0.4, hi: 2.5 };

/** Wider band for basis "assessed_ratio" (most US states — AZ's LPV, FL's
 * SOH-capped AV, and TX's uncapped-but-still-not-always-market assessed
 * value all fall here): these schemes are BY DESIGN allowed to run below
 * market for long-tenure/capped owners, so a merely-low ratio isn't
 * evidence of anything wrong. Widened relative to DEFAULT_BAND and paired
 * with a lower confidence when nothing corroborates it (see
 * ASSESSED_RATIO_UNCONFIRMED_CONFIDENCE below). */
const ASSESSED_RATIO_BAND = { lo: 0.25, hi: 3.0 };

/** When basis is "assessed_ratio" and a second county-native figure is
 * available (marketValueHint — the assessor's own Full-Cash/Just-Value
 * figure, distinct from its capped assessed value; see
 * ../../scripts/enrich-us-from-assessors.ts's CountyAssessorResult.
 * marketValue), compare THAT against asking instead of the raw assessed
 * value. If it lands in this band, the low assessed/asking ratio is fully
 * explained by the state's capping scheme — not a red flag — so the
 * assessment stays the anchor. Asymmetric on purpose: allows some
 * cushion for negotiation room on the high side (asking above the
 * county's own market figure is completely ordinary), tighter on the low
 * side (the assessor's market figure should rarely run BELOW asking by
 * much for this check to still mean "confirmed"). */
const MARKET_HINT_VS_ASKING_BAND = { lo: 0.6, hi: 1.6 };

/** How closely RentCast's AVM has to land next to a value for that value to
 * count as "independently corroborated" by the AVM tiebreaker — ±30%,
 * matching the task's own tiebreaker spec (an AVM is itself a modeled
 * estimate with real error bars; ±30% is generous enough to allow for that
 * while still meaningfully distinguishing "confirms" from "unrelated"). */
const AVM_AGREE_PCT = 0.3;

/** When the assessor's own second figure (marketValueHint) agrees with its
 * assessed value within this band, both of the county's own numbers are
 * telling the same story (assessed and "market" are the same low figure) —
 * the textbook signature of an agricultural exemption or partial-parcel
 * valuation rather than a simple data error. */
const MARKET_HINT_VS_ASSESSED_AGREE_PCT = 0.25;

/** Below/above these, the assessed/asking gap is large enough that
 * "extreme_delta" is the honest label regardless of any partial
 * corroboration — a >6.7x or <0.15x gap is well past what any legitimate
 * assessment scheme produces even in its most capped form. */
const EXTREME_RATIO_LOW = 0.15;
const EXTREME_RATIO_HIGH = 6.0;

/** Acquisition-value states (California's Prop 13) are EXPECTED to diverge
 * from market by design (see triangulateValuation()'s identical exclusion
 * in us-advantage.ts) — only demote when the gap is large enough that even
 * that generous expectation can't explain it. */
const ACQUISITION_VALUE_LOW_RATIO = 0.35;

function withinPct(a: number, b: number, tolerancePct: number): boolean {
  if (b === 0) return a === 0;
  return Math.abs(a - b) / Math.abs(b) <= tolerancePct;
}

function ratioLabel(ratio: number): string {
  return `${ratio.toFixed(ratio < 1 ? 3 : 2)}x`;
}

/** Best-effort recovery of a county assessor's own "market value" figure
 * (Full-Cash Value, Just Value, etc. — distinct from its capped assessed
 * value) from the human-readable assessmentNote string that
 * scripts/enrich-us-from-assessors.ts already writes onto the Listing
 * (format: "{year}: ${assessed} assessed (${market} market) — county
 * assessor" — see that script's applyResult()). That script's persisted
 * Assessment shape doesn't carry marketValue as a structured field, and
 * this module doesn't own that script, so this is a pragmatic parse of the
 * one place the figure already survives to KV rather than a fabricated
 * number — returns null (not a guess) whenever the pattern doesn't match. */
export function parseMarketValueFromAssessmentNote(note: string | null | undefined): number | null {
  if (!note) return null;
  const match = note.match(/\(\$([\d,]+)\s*market\)/i);
  if (!match) return null;
  const value = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Anchor plausibility gate — pure function, no network/KV access. Decides
 * whether an assessed value is trustworthy enough to drive offer-model.ts's
 * ratio-vs-asking banding ("anchor"), or should be demoted to display-only
 * context while the offer re-anchors elsewhere ("context_only"). See the
 * module doc above for the case this exists to catch.
 *
 * `avmValue` is RentCast's automated valuation model estimate for the
 * SUBJECT property (not to be confused with `marketValueHint`, the county
 * assessor's own second figure) — used only as a tiebreaker once the
 * assessed/asking ratio is already outside the plausible band, per the
 * "asking_outlier" and confirmed-demotion branches below.
 */
export function assessAnchorPlausibility(input: {
  assessedValue: number;
  assessmentBasis: Assessment["assessmentBasis"] | null | undefined;
  askingPrice: number | null;
  avmValue: number | null;
  marketValueHint: number | null;
}): AnchorPlausibility {
  const { assessedValue, assessmentBasis, askingPrice, avmValue, marketValueHint } = input;

  if (!askingPrice || askingPrice <= 0 || !assessedValue || assessedValue <= 0) {
    return {
      verdict: "anchor",
      ratio: null,
      reason: null,
      anchorSource: "tax_assessed",
      confidence: "low",
      note: "No asking price to compare the assessed value against — anchor plausibility not evaluated.",
    };
  }

  const ratio = assessedValue / askingPrice;

  // --- Acquisition-value basis: expected to diverge from market by design.
  if (assessmentBasis === "acquisition_value") {
    if (ratio >= ACQUISITION_VALUE_LOW_RATIO) {
      return {
        verdict: "anchor",
        ratio,
        reason: null,
        anchorSource: "tax_assessed",
        confidence: "medium",
        note: `Acquisition-value basis — assessed value (${fmt(assessedValue)}) tracks purchase price plus a capped annual increase, expected to run below market by design.`,
      };
    }
    const anchorSource = avmValue ? "avm" : "language";
    return {
      verdict: "context_only",
      ratio,
      reason: "basis_mismatch",
      anchorSource,
      confidence: avmValue ? "medium" : "low",
      note: `Acquisition-value basis assessed at ${fmt(assessedValue)} (${ratioLabel(ratio)} of asking) — even accounting for this state's purchase-price-plus-cap scheme, the gap is too wide to anchor on. Treated as context only.`,
    };
  }

  // --- assessed_ratio basis: prefer comparing the assessor's own
  // market/full-cash figure (when we have one) against asking, instead of
  // the capped assessed figure — a low assessed/asking ratio is completely
  // normal for this basis and isn't itself evidence of a problem.
  if (assessmentBasis === "assessed_ratio" && marketValueHint != null && marketValueHint > 0) {
    const marketRatio = marketValueHint / askingPrice;
    if (marketRatio >= MARKET_HINT_VS_ASKING_BAND.lo && marketRatio <= MARKET_HINT_VS_ASKING_BAND.hi) {
      return {
        verdict: "anchor",
        ratio,
        reason: null,
        anchorSource: "tax_assessed",
        confidence: "medium",
        note: `County full-cash/market value (${fmt(marketValueHint)}) tracks the asking price even though the capped assessed figure (${fmt(assessedValue)}) runs lower — normal for this state's assessment scheme, not a red flag.`,
      };
    }
  }

  // --- assessed_ratio basis: AVM-led override. A live data-quality audit
  // (docs/plans/10-RENTCAST-DATA-QUALITY.md, run against a second free-tier
  // key so it cost zero production quota) measured RentCast's AVM as the
  // single most trustworthy dollar signal available for this pipeline: only
  // 14% of sampled AVM/asking ratios fell outside [0.4, 2.5], vs 47% for
  // RentCast's own taxAssessments and 41% for our county-assessor values —
  // and it directly caught two Maricopa county-assessor values that were
  // wrong by 50-59x. Phoenix/Maricopa specifically showed RentCast's tax
  // data running 5-20x lower than even the county's own capped figure. Given
  // that, a materially-disagreeing AVM should win the anchor role for this
  // basis outright, not merely tiebreak once the raw ratio already looks
  // extreme — the ASSESSED_RATIO_BAND below is deliberately wide (assessed
  // legitimately runs low for this basis by design) and can mask a
  // genuinely bad assessed figure an available AVM would have caught. This
  // check applies uniformly regardless of whether the assessed value came
  // from RentCast's taxAssessments or a county-assessor scrape (see this
  // function's own doc comment on assessAnchorPlausibility) — the audit's
  // finding that even primary county sources can carry 50x+ errors means
  // scraped government data doesn't get a pass here either, though the
  // marketValueHint corroboration above is checked FIRST and can still
  // rescue this listing: direct county confirmation (a primary source) is
  // taken as stronger ground truth than a modeled AVM estimate when both
  // are available and agree.
  if (assessmentBasis === "assessed_ratio" && avmValue != null && avmValue > 0) {
    const avmVsAskingRatio = avmValue / askingPrice;
    const avmPlausibleVsAsking = avmVsAskingRatio >= DEFAULT_BAND.lo && avmVsAskingRatio <= DEFAULT_BAND.hi;
    const avmAgreesAssessed = withinPct(avmValue, assessedValue, AVM_AGREE_PCT);
    if (avmPlausibleVsAsking && !avmAgreesAssessed) {
      return {
        verdict: "context_only",
        ratio,
        reason: "extreme_delta",
        anchorSource: "avm",
        confidence: "high",
        note: `RentCast's AVM (${fmt(avmValue)}) is the more reliable dollar signal for this state's assessment scheme (audited: tax/county-assessed values run wrong far more often than the AVM) and materially disagrees with the assessed value (${fmt(assessedValue)}) — re-anchored on the AVM.`,
      };
    }
  }

  const band = assessmentBasis === "assessed_ratio" ? ASSESSED_RATIO_BAND : DEFAULT_BAND;

  if (ratio >= band.lo && ratio <= band.hi) {
    const confidence = assessmentBasis === "assessed_ratio" ? "low" : ratio >= 0.7 && ratio <= 1.3 ? "high" : "medium";
    return {
      verdict: "anchor",
      ratio,
      reason: null,
      anchorSource: "tax_assessed",
      confidence,
      note: `Assessed value (${fmt(assessedValue)}) sits within a plausible range of the ${fmt(askingPrice)} asking price (${ratioLabel(ratio)}).`,
    };
  }

  // --- Outside the plausible band: AVM tiebreaker.
  if (avmValue != null && avmValue > 0) {
    const avmAgreesAsking = withinPct(avmValue, askingPrice, AVM_AGREE_PCT);
    const avmAgreesAssessed = withinPct(avmValue, assessedValue, AVM_AGREE_PCT);

    if (avmAgreesAssessed && !avmAgreesAsking) {
      // AVM independently corroborates the low assessed figure — the
      // ASKING price is the one that doesn't line up with anything.
      return {
        verdict: "anchor",
        ratio,
        reason: "asking_outlier",
        anchorSource: "tax_assessed",
        confidence: "high",
        note: `RentCast's AVM (${fmt(avmValue)}) independently corroborates the ${fmt(assessedValue)} tax-assessed value — the ${fmt(askingPrice)} asking price looks aspirational, not the assessment. Strong footing for a low anchored offer.`,
      };
    }

    if (avmAgreesAsking && !avmAgreesAssessed) {
      // AVM tracks the asking price, not the assessment — confirms the
      // assessment is the outlier here.
      return {
        verdict: "context_only",
        ratio,
        reason: "extreme_delta",
        anchorSource: "avm",
        confidence: "high",
        note: `RentCast's AVM (${fmt(avmValue)}) tracks the ${fmt(askingPrice)} asking price, not the ${fmt(assessedValue)} tax-assessed value — the assessment looks decoupled from market value here. Not used as the offer anchor.`,
      };
    }
    // AVM agrees with neither (or with both loosely) — falls through to the
    // generic demotion below, still using the AVM as the re-anchor target
    // since it's the best independent read available even if uncorroborated.
  }

  // --- Generic demotion: determine the most informative reason available.
  let reason: AnchorDemotionReason;
  if (marketValueHint != null && withinPct(marketValueHint, assessedValue, MARKET_HINT_VS_ASSESSED_AGREE_PCT)) {
    // The county's own two figures agree with each other but both diverge
    // sharply from asking — the textbook exemption/cap/partial-parcel
    // signature (Cedar St: assessed === marketValueHint === $452,339).
    reason = "possible_exemption_or_cap";
  } else if (ratio < EXTREME_RATIO_LOW || ratio > EXTREME_RATIO_HIGH) {
    reason = "extreme_delta";
  } else if (ratio < 1) {
    // Assessed running far below asking with no corroboration is, in
    // practice, overwhelmingly an exemption/cap/partial-parcel story
    // rather than a data error running the other direction.
    reason = "possible_exemption_or_cap";
  } else {
    reason = "basis_mismatch";
  }

  const anchorSource = avmValue != null && avmValue > 0 ? "avm" : "language";
  const confidence = avmValue != null && avmValue > 0 ? "medium" : "low";

  const reasonNote =
    reason === "possible_exemption_or_cap"
      ? `Assessed value (${fmt(assessedValue)}) is ${ratioLabel(1 / ratio)} below the ${fmt(askingPrice)} asking price with no plausible market explanation — common with agricultural exemptions, assessment caps, or partial-parcel valuations.`
      : reason === "extreme_delta"
        ? `Assessed value (${fmt(assessedValue)}) diverges from the ${fmt(askingPrice)} asking price by more than any legitimate assessment scheme should produce (${ratioLabel(ratio)}).`
        : `Assessed value (${fmt(assessedValue)}) and the ${fmt(askingPrice)} asking price diverge more than this state's assessment basis should produce (${ratioLabel(ratio)}).`;

  return {
    verdict: "context_only",
    ratio,
    reason,
    anchorSource,
    confidence,
    note: `${reasonNote} Demoted from anchor to context — not used to drive the offer.`,
  };
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

/**
 * Build a Listing-shaped object from a RentCast bundle with an active
 * listing. Fields with no RentCast equivalent (description, notes,
 * hasSuite, estateKeywords, cluster, url) are left at their honest empty
 * defaults — see the module doc comment for why.
 */
export function buildUsListing(
  bundle: USPropertyBundle,
  city: string,
  state: string,
  evidence?: {
    surface?: EvidenceSurface;
    rawInput?: string | null;
    normalizedAddress?: string | null;
    parsedUnit?: string | null;
    selectedPlaceId?: string | null;
    recordQueried?: boolean;
    listingQueried?: boolean;
  }
): Listing {
  const al = bundle.activeListing!;
  const record = bundle.record;

  const address = al.addressLine1 || record?.addressLine1 || al.formattedAddress?.split(",")[0]?.trim() || "";

  const beds = al.bedrooms ?? record?.bedrooms ?? null;
  const baths = al.bathrooms ?? record?.bathrooms ?? null;
  const sqft = al.squareFootage ?? record?.squareFootage ?? null;
  const yearBuilt = record?.yearBuilt ?? null;

  // Structural price-reduced signal: RentCast's priceHistory event log,
  // not text — compares the current price to the first tracked price.
  let priceReduced = false;
  if (al.priceHistory.length > 1) {
    const first = al.priceHistory[0].price;
    const current = al.price ?? al.priceHistory[al.priceHistory.length - 1].price;
    if (first && current && current < first) priceReduced = true;
  }

  const latestTax = record?.propertyTaxes?.[0]?.total ?? record?.taxAssessments?.[0]?.value ?? null;
  const propertyEvidence = addRentCastEvidence(
    createPropertyEvidenceSnapshot({
      surface: evidence?.surface ?? "assess_on_demand",
      rawInput: evidence?.rawInput,
      normalizedAddress: evidence?.normalizedAddress ?? al.formattedAddress ?? record?.formattedAddress ?? address,
      parsedUnit: evidence?.parsedUnit,
      selectedPlaceId: evidence?.selectedPlaceId,
    }),
    {
      record,
      listing: al,
      recordQueried: evidence?.recordQueried ?? true,
      listingQueried: evidence?.listingQueried ?? true,
      unavailableReason: bundle.meta.quotaExhausted ? "quota_exhausted" : "field_missing",
    }
  );

  return {
    address,
    city: al.city || city,
    province: (al.state || state || "").toUpperCase(),
    dom: al.daysOnMarket ?? 0,
    price: al.price ?? 0,
    beds: beds != null ? String(beds) : "",
    baths: baths != null ? String(baths) : "",
    sqft: sqft != null ? String(sqft) : "",
    yearBuilt: yearBuilt != null ? String(yearBuilt) : "",
    taxes: latestTax != null ? String(Math.round(latestTax)) : "",
    lotSize: record?.lotSize != null ? String(record.lotSize) : "",
    priceReduced,
    // No MLS remarks available from RentCast's free-tier endpoints — these
    // keyword-driven signals structurally can't be detected for US listings.
    hasSuite: false,
    estateKeywords: false,
    description: "",
    notes: "",
    cluster: "",
    url: "",
    mlsNumber: al.mlsNumber || undefined,
    propertyEvidence,
  };
}

// ---------------------------------------------------------------------------
// Comp support (shortcut — see module doc comment)
// ---------------------------------------------------------------------------

export interface UsCompSupportEntry {
  address: string | null;
  price: number | null;
  distanceMi: number | null;
  correlation: number | null;
  sqft: number | null;
  beds: number | null;
  baths: number | null;
  status: string | null;
}

export interface UsCompSupport {
  source: "rentcast_avm";
  comparables: UsCompSupportEntry[];
  medianPricePerSqft: number | null;
  impliedValue: number | null;
  confidence: "high" | "medium" | "low" | "none";
  marketNote: string;
  dataGaps: string[];
}

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Comp support computed directly from the AVM's own comparables[] — no
 * extra RentCast requests (this data rides along with the /avm/value call
 * already made in getUSProperty). Not a sold-comp match like
 * matchComparables(): RentCast's AVM comps are valuation inputs (price +
 * correlation + distance), a mix of recently sold and active listings, not
 * confirmed sold-to-list transactions — hence the separate type and the
 * "rentcast_avm" source tag rather than pretending this is ComparableResult.
 *
 * See also src/lib/pipeline/us-advantage.ts — the sibling module that turns
 * this file's outputs (plus the RentCast bundle's sale/tax history) into
 * the equity/tenure, triangulation, yield, risk/momentum, and
 * over-assessment signals that have no CA equivalent.
 */
export function buildUsCompSupport(avm: RentCastAvm | null, subjectSqft: number): UsCompSupport {
  const dataGaps: string[] = [];
  if (!avm || avm.comps.length === 0) {
    return {
      source: "rentcast_avm",
      comparables: [],
      medianPricePerSqft: null,
      impliedValue: null,
      confidence: "none",
      marketNote: "No comparable data returned by RentCast's AVM for this address.",
      dataGaps: ["No AVM comparables available"],
    };
  }

  const comps = avm.comps.slice(0, 8).map((c) => ({
    address: c.formattedAddress,
    price: c.price,
    distanceMi: c.distanceMi,
    correlation: c.correlation,
    sqft: c.squareFootage,
    beds: c.bedrooms,
    baths: c.bathrooms,
    status: c.status,
  }));

  const ppsf = avm.comps
    .filter((c) => c.price && c.squareFootage && c.squareFootage > 0)
    .map((c) => c.price! / c.squareFootage!);
  const medianPricePerSqft = ppsf.length ? Math.round(median(ppsf)) : null;
  if (!ppsf.length) dataGaps.push("Comp square footage not reported — no $/sqft available");

  const impliedValue =
    medianPricePerSqft && subjectSqft > 0 ? Math.round((medianPricePerSqft * subjectSqft) / 1000) * 1000 : null;
  if (!subjectSqft) dataGaps.push("Subject sqft not reported");

  const avgCorrelation = median(avm.comps.filter((c) => c.correlation != null).map((c) => c.correlation!));
  let confidence: UsCompSupport["confidence"];
  if (avm.comps.length >= 5 && ppsf.length >= 3 && avgCorrelation >= 0.7) confidence = "high";
  else if (avm.comps.length >= 3) confidence = "medium";
  else confidence = "low";

  let marketNote = `${avm.comps.length} comparable propert${avm.comps.length === 1 ? "y" : "ies"} from RentCast's AVM.`;
  if (impliedValue) marketNote += ` Comp-implied value: $${impliedValue.toLocaleString()}.`;

  return {
    source: "rentcast_avm",
    comparables: comps,
    medianPricePerSqft,
    impliedValue,
    confidence,
    marketNote,
    dataGaps,
  };
}
