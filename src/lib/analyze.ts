import { Listing, AnalysisResult } from "./types";
import { scoreV2 } from "./scoring";
import { offerModel } from "./offer-model";
import { getSignals } from "./signals";
import { lookupAssessmentSync, lookupAssessment } from "./assessment";
import { getLinkOnlyHistory } from "./housesigma";
import { analyzeDescription, generateOfferNarrative } from "./llm";

/**
 * Synchronous analysis using cached data only.
 * Used by server components (dashboard, property pages) where preloaded data is sufficient.
 */
export function analyzeListing(listing: Listing): AnalysisResult {
  const assessment = lookupAssessmentSync(listing.address, listing.province);
  const history = getLinkOnlyHistory(listing.address, listing.province);
  const score = scoreV2(listing);
  const offer = assessment ? offerModel(listing, assessment) : null;
  const signals = getSignals(listing);

  return { listing, assessment, history, score, offer, signals };
}

/**
 * Full async analysis with LLM enrichment + live assessment lookup.
 * Used by API routes where we can afford the latency.
 */
export async function analyzeListingAsync(listing: Listing): Promise<AnalysisResult & {
  llmSignals?: string[];
  llmConfidence?: number;
  narrative?: string;
}> {
  // Run assessment lookup and LLM analysis in parallel
  const [assessment, llmResult] = await Promise.all([
    lookupAssessment(listing.address, listing.province),
    analyzeDescription(listing.description),
  ]);

  const history = getLinkOnlyHistory(listing.address, listing.province);
  const score = scoreV2(listing);
  const offer = assessment ? offerModel(listing, assessment) : null;
  const signals = getSignals(listing);

  // Generate offer narrative if we have an offer
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
