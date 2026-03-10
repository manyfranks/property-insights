/**
 * pipeline/enrich.ts
 *
 * Enriches a listing with pre-computed score, offer, signals, and narrative.
 * Used by both the cron pipeline and one-shot enrichment script.
 */

import { Listing, Assessment, OfferResult, PrecomputedOffer, ComparableResult } from "../types";
import { scoreV2 } from "../scoring";
import { offerModel, offerModelLanguage } from "../offer-model";
import { getSignals } from "../signals";
import { lookupAssessment, lookupAssessmentSync } from "../assessment";
import { analyzeAndNarrate, deterministicNarrative } from "../llm";
import { matchComparables } from "../comparables";
import { ZoocasaSoldRaw } from "../zoocasa";
import { fmt } from "../utils";

export function offerToPrecomputed(offer: OfferResult): PrecomputedOffer {
  return {
    anchor: offer.anchor,
    anchor_tag: offer.anchorTag,
    ratio: offer.listToAssessedRatio,
    dom_adjusted: offer.domAdjusted,
    dom_mult: offer.domMultiplier,
    dom_tag: offer.domTag,
    signal_adjusted: offer.signalAdjusted,
    signal_tags: offer.signalTags,
    final_offer: offer.finalOffer,
    pct_of_list: offer.percentOfList,
    savings: offer.savings,
    floor_applied: offer.finalOffer <= offer.anchor * 0.79,
  };
}

/**
 * Enrich a single listing with pre-computed fields.
 * Uses async assessment lookup (live for AB, cache+scrape for BC).
 * HOT/WARM get LLM narrative; WATCH gets deterministic template.
 */
export async function enrichListing(
  listing: Listing,
  options?: { skipLlm?: boolean; forceLlm?: boolean; soldPool?: ZoocasaSoldRaw[]; syncAssessmentOnly?: boolean }
): Promise<Listing> {
  const t0 = Date.now();
  const log = (step: string, extra?: string) =>
    console.log(`  [enrich] ${step} (${Date.now() - t0}ms)${extra ? " — " + extra : ""}`);

  // Assessment: sync-only (cache + tax reverse, instant) or async (live scrape for BC)
  let assessment: Assessment | null = null;
  if (options?.syncAssessmentOnly) {
    log("assessment sync", `${listing.province} ${listing.address}`);
    assessment = lookupAssessmentSync(listing.address, listing.province, listing.unit, listing.city, listing.taxes);
    log("assessment done", assessment?.found ? `${fmt(assessment.totalValue)}` : "not found");
  } else {
    try {
      log("assessment lookup", `${listing.province} ${listing.address}`);
      assessment = await lookupAssessment(listing.address, listing.province, listing.city, listing.unit, listing.taxes);
      log("assessment done", assessment?.found ? `${fmt(assessment.totalValue)}` : "not found");
    } catch (err) {
      log("assessment error, trying sync", err instanceof Error ? err.message : String(err));
      assessment = lookupAssessmentSync(listing.address, listing.province, listing.unit, listing.city, listing.taxes);
    }
  }

  // Score + offer
  const score = scoreV2(listing);
  const offer = assessment?.found
    ? offerModel(listing, assessment)
    : offerModelLanguage(listing);
  const signals = getSignals(listing);
  log("score+offer", `tier=${score.tier} offer=${offer?.finalOffer}`);

  // Comparables
  let compResult: ComparableResult | undefined;
  if (options?.soldPool && options.soldPool.length > 0) {
    try {
      log("comparables start");
      compResult = await matchComparables(listing, options.soldPool);
      log("comparables done", `confidence=${compResult.confidence} matched=${compResult.matchedCount}`);

      // Offer validation overlay (non-blocking annotation)
      if (compResult.confidence !== "none" && compResult.medianSoldToList && offer) {
        const compDiscount = 1 - compResult.medianSoldToList;
        const ourDiscount = 1 - offer.percentOfList;
        const diff = Math.abs(compDiscount - ourDiscount);
        compResult.compValidation = diff < 0.03 ? "confirmed"
          : ourDiscount > compDiscount ? "aggressive"
          : "conservative";
      }
    } catch (err) {
      log("comparables error", err instanceof Error ? err.message : String(err));
    }
  }

  // Narrative
  let narrative: string;
  let llmSignals: string[] = [];

  const compForNarrative = compResult?.confidence !== "none" ? compResult : undefined;

  if ((score.tier === "WATCH" && !options?.forceLlm) || options?.skipLlm) {
    narrative = deterministicNarrative({ listing, assessment, offer, signals, comparables: compForNarrative });
    log("narrative", "deterministic");
  } else {
    try {
      log("llm start");
      const result = await analyzeAndNarrate({ listing, assessment, offer, signals, comparables: compForNarrative });
      narrative = result.narrative || deterministicNarrative({ listing, assessment, offer, signals, comparables: compForNarrative });
      llmSignals = result.signals;
      log("llm done", `${narrative.length} chars`);
    } catch (err) {
      log("llm error", err instanceof Error ? err.message : String(err));
      narrative = deterministicNarrative({ listing, assessment, offer, signals, comparables: compForNarrative });
    }
  }

  // Write pre-computed fields
  return {
    ...listing,
    preScore: score.total,
    preTier: score.tier,
    preSignals: [...signals, ...llmSignals],
    preNarrative: narrative,
    preOffer: offer ? offerToPrecomputed(offer) : undefined,
    preAssessment: assessment?.found ? assessment : undefined,
    preComparables: compForNarrative,
    assessmentNote: assessment?.found
      ? `${assessment.assessmentYear}: ${fmt(assessment.totalValue)}${
          assessment.source === "tax_reverse" ? " (est. from taxes)"
          : assessment.source === "area_median" ? " (area median)"
          : ""
        }`
      : undefined,
  };
}
