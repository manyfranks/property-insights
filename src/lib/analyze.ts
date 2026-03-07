import { Listing, AnalysisResult, OfferResult } from "./types";
import { scoreV2 } from "./scoring";
import { offerModel, offerModelLanguage } from "./offer-model";
import { getSignals } from "./signals";
import { lookupAssessmentSync, lookupAssessment } from "./assessment";
import { getLinkOnlyHistory } from "./housesigma";
import { analyzeDescription, generateOfferNarrative } from "./llm";

/**
 * Convert pre-computed offer (snake_case from JSON) to OfferResult (camelCase).
 */
function preOfferToResult(pre: NonNullable<Listing["preOffer"]>, listing: Listing): OfferResult {
  return {
    anchor: pre.anchor,
    anchorTag: pre.anchor_tag,
    anchorType: "assessment",
    listToAssessedRatio: pre.ratio,
    domAdjusted: pre.dom_adjusted,
    domMultiplier: pre.dom_mult,
    domTag: pre.dom_tag,
    signalAdjusted: pre.signal_adjusted,
    signalTags: pre.signal_tags,
    finalOffer: pre.final_offer,
    percentOfList: pre.pct_of_list,
    savings: pre.savings,
    inTargetRange: pre.final_offer >= 900000 && pre.final_offer <= 1250000,
  };
}

/**
 * Synchronous analysis using cached data only.
 * Used by server components (dashboard, property pages) where preloaded data is sufficient.
 */
export function analyzeListing(listing: Listing): AnalysisResult {
  const assessment = lookupAssessmentSync(listing.address, listing.province);
  const history = getLinkOnlyHistory(listing.address, listing.province);
  const score = scoreV2(listing);
  const offer = listing.preOffer
    ? preOfferToResult(listing.preOffer, listing)
    : assessment ? offerModel(listing, assessment) : offerModelLanguage(listing);
  const signals = getSignals(listing);

  return { listing, assessment, history, score, offer, signals };
}

/**
 * Full async analysis with LLM enrichment + live assessment lookup.
 * Uses pre-computed data when available, falls back to LLM calls.
 */
export async function analyzeListingAsync(listing: Listing): Promise<AnalysisResult & {
  llmSignals?: string[];
  llmConfidence?: number;
  narrative?: string;
}> {
  const hasPre = !!(listing.preNarrative || listing.preSignals || listing.preOffer);

  // If we have pre-computed data, skip LLM calls entirely
  if (hasPre) {
    const assessment = lookupAssessmentSync(listing.address, listing.province);
    const history = getLinkOnlyHistory(listing.address, listing.province);
    const score = listing.preScore != null && listing.preTier
      ? { total: listing.preScore, tier: listing.preTier, breakdown: scoreV2(listing).breakdown }
      : scoreV2(listing);
    const offer = listing.preOffer
      ? preOfferToResult(listing.preOffer, listing)
      : assessment ? offerModel(listing, assessment) : offerModelLanguage(listing);
    const signals = getSignals(listing);

    return {
      listing,
      assessment,
      history,
      score,
      offer,
      signals,
      llmSignals: listing.preSignals,
      narrative: listing.preNarrative,
    };
  }

  // No pre-computed data — run LLM pipeline
  const [assessment, llmResult] = await Promise.all([
    lookupAssessment(listing.address, listing.province),
    analyzeDescription(listing.description),
  ]);

  const history = getLinkOnlyHistory(listing.address, listing.province);
  const score = scoreV2(listing);
  const offer = assessment ? offerModel(listing, assessment) : offerModelLanguage(listing);
  const signals = getSignals(listing);

  let narrative = "";
  if (offer && assessment) {
    narrative = await generateOfferNarrative({
      address: listing.address,
      listPrice: listing.price,
      assessedValue: assessment.totalValue,
      finalOffer: offer.finalOffer,
      savings: offer.savings,
      percentOfList: offer.percentOfList,
      domTag: offer.domTag,
      dom: listing.dom,
      anchorTag: offer.anchorTag,
      signalTags: offer.signalTags,
      signals: [...signals, ...llmResult.signals],
    });
  }

  return {
    listing,
    assessment,
    history,
    score,
    offer,
    signals,
    llmSignals: llmResult.signals.length > 0 ? llmResult.signals : undefined,
    llmConfidence: llmResult.confidence > 0 ? llmResult.confidence : undefined,
    narrative: narrative || undefined,
  };
}
