/**
 * pipeline/enrich.ts
 *
 * Enriches a listing with pre-computed score, offer, signals, and narrative.
 * Used by both the cron pipeline and one-shot enrichment script.
 */

import { Listing, Assessment, OfferResult, PrecomputedOffer } from "../types";
import { scoreV2 } from "../scoring";
import { offerModel, offerModelLanguage } from "../offer-model";
import { getSignals } from "../signals";
import { lookupAssessment, lookupAssessmentSync } from "../assessment";
import { analyzeAndNarrate, deterministicNarrative } from "../llm";
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
  options?: { skipLlm?: boolean; forceLlm?: boolean }
): Promise<Listing> {
  const t0 = Date.now();
  const log = (step: string, extra?: string) =>
    console.log(`  [enrich] ${step} (${Date.now() - t0}ms)${extra ? " — " + extra : ""}`);

  // Assessment: try async (live lookup), fall back to sync (cache only)
  let assessment: Assessment | null = null;
  try {
    log("assessment lookup", `${listing.province} ${listing.address}`);
    assessment = await lookupAssessment(listing.address, listing.province, listing.city, listing.unit, listing.taxes);
    log("assessment done", assessment?.found ? `${fmt(assessment.totalValue)}` : "not found");
  } catch (err) {
    log("assessment error, trying sync", err instanceof Error ? err.message : String(err));
    assessment = lookupAssessmentSync(listing.address, listing.province, listing.unit, listing.city, listing.taxes);
  }

  // Score + offer
  const score = scoreV2(listing);
  const offer = assessment?.found
    ? offerModel(listing, assessment)
    : offerModelLanguage(listing);
  const signals = getSignals(listing);
  log("score+offer", `tier=${score.tier} offer=${offer?.finalOffer}`);

  // Narrative
  let narrative: string;
  let llmSignals: string[] = [];

  if ((score.tier === "WATCH" && !options?.forceLlm) || options?.skipLlm) {
    narrative = deterministicNarrative({ listing, assessment, offer, signals });
    log("narrative", "deterministic");
  } else {
    try {
      log("llm start");
      const result = await analyzeAndNarrate({ listing, assessment, offer, signals });
      narrative = result.narrative || deterministicNarrative({ listing, assessment, offer, signals });
      llmSignals = result.signals;
      log("llm done", `${narrative.length} chars`);
    } catch (err) {
      log("llm error", err instanceof Error ? err.message : String(err));
      narrative = deterministicNarrative({ listing, assessment, offer, signals });
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
    assessmentNote: assessment?.found
      ? `${assessment.assessmentYear}: ${fmt(assessment.totalValue)}`
      : undefined,
  };
}
