import { Listing, Assessment, AnalysisResult, OfferResult, ListingHistory } from "./types";
import { scoreV2 } from "./scoring";
import { offerModel, offerModelLanguage } from "./offer-model";
import { getSignals } from "./signals";
import { lookupAssessmentSync, lookupAssessment } from "./assessment";
import { buildDetailUrl } from "./zoocasa";
import { analyzeAndNarrate, deterministicNarrative } from "./llm";

function getZoocasaHistory(address: string, city: string, province: string): ListingHistory {
  return {
    found: false,
    source: "zoocasa",
    zoocasaUrl: buildDetailUrl(address, city, province),
  };
}

/**
 * Convert pre-computed offer (snake_case from JSON) to OfferResult (camelCase).
 */
function preOfferToResult(
  pre: NonNullable<Listing["preOffer"]>,
  listing: Listing,
  assessment: Assessment | null
): OfferResult {
  return {
    anchor: pre.anchor,
    anchorTag: pre.anchor_tag,
    anchorType: assessment?.found ? "assessment" : "language",
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
  const assessment = listing.preAssessment || lookupAssessmentSync(listing.address, listing.province);
  const history = getZoocasaHistory(listing.address, listing.city, listing.province);
  const score = scoreV2(listing);
  const offer = listing.preOffer
    ? preOfferToResult(listing.preOffer, listing, assessment)
    : assessment ? offerModel(listing, assessment) : offerModelLanguage(listing);
  const signals = getSignals(listing);

  return { listing, assessment, history, score, offer, signals };
}

/**
 * Full async analysis with LLM enrichment + live assessment lookup.
 *
 * Per ALGORITHM.md:
 * - WATCH tier → deterministic template (no LLM call, saves cost)
 * - HOT/WARM tier → single combined LLM call (signals + narrative)
 */
export async function analyzeListingAsync(listing: Listing): Promise<AnalysisResult & {
  llmSignals?: string[];
  llmConfidence?: number;
  narrative?: string;
}> {
  const hasPre = !!(listing.preNarrative || listing.preSignals || listing.preOffer);

  // If we have pre-computed data, skip all external calls
  if (hasPre) {
    const assessment = listing.preAssessment || lookupAssessmentSync(listing.address, listing.province);
    const history = getZoocasaHistory(listing.address, listing.city, listing.province);
    const score = listing.preScore != null && listing.preTier
      ? { total: listing.preScore, tier: listing.preTier, breakdown: scoreV2(listing).breakdown }
      : scoreV2(listing);
    const offer = listing.preOffer
      ? preOfferToResult(listing.preOffer, listing, assessment)
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

  // No pre-computed data — run assessment lookup + compute offer
  const assessment = await lookupAssessment(listing.address, listing.province);
  const history = getZoocasaHistory(listing.address, listing.city, listing.province);
  const score = scoreV2(listing);
  const offer = assessment ? offerModel(listing, assessment) : offerModelLanguage(listing);
  const signals = getSignals(listing);

  // WATCH tier: deterministic template, no LLM call (per ALGORITHM.md Stage 8)
  if (score.tier === "WATCH") {
    const narrative = deterministicNarrative({ listing, assessment, offer, signals });
    return {
      listing,
      assessment,
      history,
      score,
      offer,
      signals,
      narrative,
    };
  }

  // HOT/WARM tier: single combined LLM call (signals + Fulton-style narrative)
  const llmResult = await analyzeAndNarrate({ listing, assessment, offer, signals });

  return {
    listing,
    assessment,
    history,
    score,
    offer,
    signals,
    llmSignals: llmResult.signals.length > 0 ? llmResult.signals : undefined,
    llmConfidence: llmResult.confidence > 0 ? llmResult.confidence : undefined,
    narrative: llmResult.narrative || undefined,
  };
}
