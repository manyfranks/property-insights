/**
 * pipeline/us-seed-analysis.ts
 *
 * Full-seed analysis stage for the US Discover listings already sitting in
 * KV (listings:all, province TX/FL/AZ — see src/lib/pipeline/us-discover.ts)
 * that have NOT been through RentCast enrichment. RentCast's free tier is
 * quota-frozen (40/45 used this month — see src/lib/rentcast.ts's module
 * doc), so this module makes ZERO RentCast calls: every number it produces
 * comes from three free sources already sitting in KV/Postgres —
 *
 *   1. The Listing itself — price, dom, beds/baths/sqft, priceHistory-
 *      derived priceReduced, preScore/preTier/preSignals (already computed
 *      by us-discover.ts's sweep scorer), and preAssessment when the
 *      concurrent scripts/enrich-us-from-assessors.ts county-assessor pass
 *      has matched this address (assessedValue/marketValue -> totalValue,
 *      yearBuilt, lotSize — see that script's applyResult()).
 *   2. The Neon regional_econ county panel (src/lib/db/regional-econ.ts) —
 *      median home value, median rent, HUD FMR by bedroom count, FHFA HPI
 *      5yr trend, FEMA peril scores. One DB read per city, cached and
 *      reused across every listing in that city.
 *   3. The LLM (qwen via OPENROUTER_API_KEY) for the narrative — no
 *      RentCast dependency at all.
 *
 * Every computation below is a direct reuse of the exact pure functions the
 * on-demand /assess flow and the top-N RentCast enrichment path
 * (src/lib/pipeline/us-enrich.ts) already use — offerModel/offerModelLanguage
 * (src/lib/offer-model.ts), buildUsAdvantageBundle/triangulateValuation/
 * computeInvestorYield/computeRiskMomentum/computeOverAssessmentFlag
 * (src/lib/pipeline/us-advantage.ts), buildUsCompSupport (src/lib/pipeline/
 * us-assess.ts), and generateUsNarrative/deterministicUsNarrative
 * (src/lib/pipeline/us-narrative.ts). None of those functions make network
 * calls to RentCast themselves — they're pure transforms over data already
 * in hand — so calling them here with record=null/avmValue=null (the
 * "RentCast has nothing for this address" shape those functions already
 * handle gracefully) is safe and produces the exact same honest-degradation
 * behavior those modules were built for.
 *
 * WHAT'S STRUCTURALLY DIFFERENT FROM THE RENTCAST-ENRICHED PATH:
 *   - Equity/tenure signal: always null. computeEquityTenureSignal()
 *     requires record.lastSaleDate/lastSalePrice (RentCast sale history),
 *     which doesn't exist here — passing record=null makes it return null
 *     automatically, exactly the "no signal available" branch it already
 *     has. No fabricated tenure/equity data ever reaches the narrative.
 *   - AVM value / AVM comps: always null/none. triangulateValuation() drops
 *     to 2 anchors (tax-assessed + asking) or 1 (asking only, when no
 *     assessment) instead of the RentCast-enriched path's up-to-4; comp
 *     support is always buildUsCompSupport(null, sqft) -> the "none"
 *     confidence, honestly-labeled empty state that function already
 *     returns for "no AVM comparables available" (true here for a
 *     structural reason — no AVM was ever queried — not a data outage).
 *   - Comp-$/sqft-implied triangulation anchor: omitted. regional_econ has
 *     no county-level median SQUARE FOOTAGE figure (only median home
 *     VALUE), so there is no honest way to derive a $/sqft baseline from it
 *     — fabricating one from an assumed national-average home size would be
 *     exactly the kind of invented number the narrative's hard constraints
 *     (see us-narrative.ts's SYSTEM_PROMPT) forbid. The 2-anchor
 *     (tax-assessed + asking) or 1-anchor (asking-only) triangulation is
 *     still reported, honestly confidence-labeled by triangulateValuation's
 *     own spread bands (or "insufficient" at 1 anchor).
 *   - Investor yield's `monthlyRent` input: the county's own HUD Fair
 *     Market Rent, bedroom-matched to the listing (fmrForBeds() below) —
 *     real government data, but a COUNTY-level proxy, not a per-property
 *     RentCast rent-model estimate. computeInvestorYield()'s signature
 *     doesn't distinguish the two (it just takes "a monthly rent number"),
 *     so the math and the "meets the 1% rule" verdict are unaffected; the
 *     distinction is a modeling-precision note worth keeping in mind when
 *     reading the yield figure, not a data-honesty problem — HUD FMR is
 *     real, current, county-specific data, not an invented figure.
 */

import type { AnchorPlausibility, Assessment, Listing, OfferResult } from "../types";
import type { CountyMarketPanel } from "../db/regional-econ";
import { offerModel, offerModelLanguage } from "../offer-model";
import { buildUsCompSupport, assessAnchorPlausibility, parseMarketValueFromAssessmentNote, type UsCompSupport } from "./us-assess";
import { buildUsAdvantageBundle, type UsAdvantageBundle } from "./us-advantage";
import { generateUsNarrative, deterministicUsNarrative, type UsNarrativeContext } from "./us-narrative";
import { offerToPrecomputed } from "./enrich";
import { fmt } from "../utils";

// ---------------------------------------------------------------------------
// HUD FMR bedroom matching
// ---------------------------------------------------------------------------

/** Bedroom-matched HUD Fair Market Rent from the county panel, falling back
 * to the nearest adjacent bedroom count when the exact one is missing
 * (FMR series occasionally have gaps at the tails). Null when the panel has
 * no FMR data at all for the county. */
export function fmrForBeds(panel: CountyMarketPanel | null, beds: number): number | null {
  if (!panel) return null;
  if (!Number.isFinite(beds) || beds <= 0) {
    return panel.fmrStudio ?? panel.fmr1br ?? panel.fmr2br ?? null;
  }
  if (beds === 1) return panel.fmr1br ?? panel.fmr2br ?? panel.fmrStudio ?? null;
  if (beds === 2) return panel.fmr2br ?? panel.fmr1br ?? panel.fmr3br ?? null;
  if (beds === 3) return panel.fmr3br ?? panel.fmr2br ?? panel.fmr4br ?? null;
  return panel.fmr4br ?? panel.fmr3br ?? panel.fmr2br ?? null;
}

// ---------------------------------------------------------------------------
// "Already has the good stuff" detection — RentCast-enriched listings (the
// top-N per city enriched live by us-discover.ts/us-enrich.ts) carry real
// AVM/sale-history data this free-only pass structurally cannot reproduce
// (an AVM anchor in the triangulation, real AVM comps). Overwriting them
// with a free-data-only recompute would be a strict downgrade — lose real
// equity/tenure + AVM anchors for a lesser triangulation, and burn an LLM
// call for a worse narrative. Callers should skip these unconditionally.
// ---------------------------------------------------------------------------

export function isRentcastEnriched(listing: Listing): boolean {
  const hasAvmAnchor = !!listing.preUsAdvantage?.triangulation.anchors.some((a) => a.kind === "avm");
  const hasAvmComps = !!listing.preUsComparables?.comparables?.length;
  return hasAvmAnchor || hasAvmComps;
}

// ---------------------------------------------------------------------------
// Single-listing analysis
// ---------------------------------------------------------------------------

export interface SeedAnalysisResult {
  listing: Listing;
  anchorType: "assessment" | "language";
  narrativeSource: "llm" | "deterministic";
  narrativeConfidence: number;
}

/**
 * Computes the complete free-data-only US Advantage bundle + offer +
 * narrative for one seeded listing and returns the Listing with every
 * pre* field /property/[slug]'s US branch renders populated. Never throws —
 * the narrative step has its own internal LLM-failure fallback
 * (deterministicUsNarrative), matching the RentCast-enriched path's
 * contract in enrichUSListing().
 */
export async function analyzeSeedListing(
  listing: Listing,
  marketPanel: CountyMarketPanel | null
): Promise<SeedAnalysisResult> {
  const assessment: Assessment | null = listing.preAssessment?.found ? listing.preAssessment : null;

  // Anchor plausibility gate (src/lib/pipeline/us-assess.ts) — decides
  // whether the assessed value is even a sane thing to anchor an offer on
  // for this specific listing before offerModel() runs its ratio-vs-asking
  // banding on it. avmValue is always null here (zero RentCast calls, by
  // this module's own contract — see module doc); marketValueHint recovers
  // the county assessor's own market/full-cash figure, when one exists,
  // from the assessmentNote string scripts/enrich-us-from-assessors.ts
  // already wrote (that script's Assessment shape doesn't carry it as a
  // structured field).
  const anchorDecision: AnchorPlausibility | undefined = assessment
    ? assessAnchorPlausibility({
        assessedValue: assessment.totalValue,
        assessmentBasis: assessment.assessmentBasis,
        askingPrice: listing.price || null,
        avmValue: null,
        marketValueHint: parseMarketValueFromAssessmentNote(listing.assessmentNote),
      })
    : undefined;
  const taxAssessedDemoted = anchorDecision?.verdict === "context_only";

  // Re-anchoring: a demoted assessment never drives offerModel()'s
  // ratio-vs-asking banding. No AVM is ever available in this zero-
  // RentCast-call pipeline, so the only honest fallback is the DOM/
  // language-based model (offerModelLanguage) — same behavior it already
  // has for "no assessment at all," just reached for a different reason.
  const offer: OfferResult =
    assessment && !taxAssessedDemoted
      ? offerModel(listing, assessment)! // non-null: offerModel only returns null when !assessment.found
      : offerModelLanguage(listing);

  const sqft = parseInt(listing.sqft) || 0;
  // No AVM was ever queried for this listing (zero RentCast calls) — the
  // honest "none" comp-support state, not a data outage.
  const comparables: UsCompSupport = buildUsCompSupport(null, sqft);

  const beds = parseInt(listing.beds) || 0;
  const monthlyRent = fmrForBeds(marketPanel, beds);

  const advantage: UsAdvantageBundle = buildUsAdvantageBundle({
    record: null, // no RentCast sale/tax history -> equity/tenure signal resolves to null
    askingPrice: listing.price || null,
    avmValue: null,
    taxAssessedValue: assessment?.totalValue ?? null,
    assessmentBasis: assessment?.assessmentBasis,
    compImpliedValue: null, // no honest county-median-$/sqft baseline available — see module doc
    monthlyRent,
    marketPanel,
    taxAssessedDemoted,
  });

  const narrativeContext: UsNarrativeContext = {
    listing,
    assessment,
    offer,
    signals: listing.preSignals ?? [],
    comparables,
    advantage,
    marketPanel,
    anchorDecision,
  };

  let narrative: string;
  let narrativeConfidence = 0;
  let narrativeSource: "llm" | "deterministic" = "deterministic";
  try {
    const llmResult = await generateUsNarrative(narrativeContext);
    if (llmResult.narrative) {
      narrative = llmResult.narrative;
      narrativeConfidence = llmResult.confidence;
      narrativeSource = "llm";
    } else {
      narrative = deterministicUsNarrative(narrativeContext);
    }
  } catch {
    narrative = deterministicUsNarrative(narrativeContext);
  }

  const enrichedListing: Listing = {
    ...listing,
    preOffer: offerToPrecomputed(offer),
    preUsAdvantage: advantage,
    preUsComparables: comparables,
    preAnchorDecision: anchorDecision,
    preNarrative: narrative,
    preNarrativeConfidence: narrativeConfidence,
    assessmentNote:
      listing.assessmentNote ??
      (assessment
        ? `${assessment.assessmentYear}: ${fmt(assessment.totalValue)}${
            assessment.source === "avm" ? " (RentCast AVM estimate)" : ""
          }`
        : undefined),
    enrichedAt: new Date().toISOString(),
  };

  return {
    listing: enrichedListing,
    anchorType: offer.anchorType,
    narrativeSource,
    narrativeConfidence,
  };
}
