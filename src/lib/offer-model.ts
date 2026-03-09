import { Listing, Assessment, OfferResult } from "./types";
import { getSignals } from "./signals";

export function offerModel(listing: Listing, assessment: Assessment): OfferResult | null {
  if (!assessment?.found) return null;

  const listPrice = listing.price;
  const assessed = assessment.totalValue;
  const dom = listing.dom || 0;
  const text = (listing.description + " " + listing.notes).toLowerCase();

  // Step 1: Assessment Anchor
  const ratio = listPrice / assessed;
  let anchor: number;
  let anchorTag: string;

  if (ratio >= 1.4) {
    anchor = assessed * 1.03;
    anchorTag = "MASSIVE OVERREACH (+40%+)";
  } else if (ratio >= 1.25) {
    anchor = assessed * 1.05;
    anchorTag = "MAJOR OVERREACH (+25-40%)";
  } else if (ratio >= 1.15) {
    anchor = assessed * 1.08;
    anchorTag = "OVERPRICED (+15-25%)";
  } else if (ratio >= 1.05) {
    anchor = assessed * 1.1;
    anchorTag = "ABOVE ASSESSED (+5-15%)";
  } else if (ratio >= 0.96) {
    anchor = assessed * 0.97;
    anchorTag = "FAIRLY PRICED (+/-5%)";
  } else if (ratio >= 0.88) {
    anchor = listPrice * 0.95;
    anchorTag = "BELOW ASSESSED (-4-12%)";
  } else {
    anchor = listPrice * 0.92;
    anchorTag = "SELLER CAPITULATING (-12%+)";
  }

  // Step 2: DOM Desperation Multiplier
  let domMultiplier: number;
  let domTag: string;

  if (dom >= 150) {
    domMultiplier = 0.9;
    domTag = "HIGH MOTIVATION";
  } else if (dom >= 120) {
    domMultiplier = 0.92;
    domTag = "VERY STALE";
  } else if (dom >= 100) {
    domMultiplier = 0.94;
    domTag = "STALE";
  } else if (dom >= 90) {
    domMultiplier = 0.95;
    domTag = "AGING";
  } else if (dom >= 75) {
    domMultiplier = 0.96;
    domTag = "SITTING";
  } else if (dom >= 60) {
    domMultiplier = 0.97;
    domTag = "MATURING";
  } else if (dom >= 45) {
    domMultiplier = 0.98;
    domTag = "NORMAL";
  } else {
    domMultiplier = 0.99;
    domTag = "FRESH";
  }

  const domAdjusted = anchor * domMultiplier;

  // Step 3: Signal Stack
  let stack = 1.0;
  const signalTags: string[] = [];

  if (listing.estateKeywords) {
    stack *= 0.97;
    signalTags.push("Estate -3%");
  }
  if (listing.priceReduced) {
    stack *= 0.98;
    signalTags.push("Reduced -2%");
  }
  if (
    ["must sell", "priced to sell", "quick sale", "priced for quick"].some((k) => text.includes(k))
  ) {
    stack *= 0.97;
    signalTags.push("MustSell -3%");
  }
  if (
    ["motivated seller", "bring your offer", "bring all offers"].some((k) => text.includes(k))
  ) {
    stack *= 0.97;
    signalTags.push("Motivated -3%");
  }
  if (["first time on market", "40 years", "50 years"].some((k) => text.includes(k))) {
    stack *= 0.98;
    signalTags.push("LongHeld -2%");
  }
  if (listing.cluster === "Bear Mountain" || text.includes("bear mountain")) {
    stack *= 0.97;
    signalTags.push("BearMtn -3%");
  }
  if (["below assessed", "under assessed"].some((k) => text.includes(k))) {
    stack *= 0.97;
    signalTags.push("BelowAssm -3%");
  }

  const signalAdjusted = domAdjusted * stack;

  // Step 4: Floor/Ceiling
  // Stale assessments (ON 2016 MPAC) and area medians get a higher floor
  const isLowConfidence = assessment.assessmentYear === "2016" || assessment.source === "area_median";
  const floor = listPrice * (isLowConfidence ? 0.85 : 0.78);
  let finalOffer = Math.max(signalAdjusted, floor);
  finalOffer = Math.min(finalOffer, listPrice * 0.97);
  finalOffer = Math.round(finalOffer / 1000) * 1000;

  return {
    anchor: Math.round(anchor / 1000) * 1000,
    anchorTag,
    anchorType: "assessment" as const,
    listToAssessedRatio: ratio,
    domAdjusted: Math.round(domAdjusted / 1000) * 1000,
    domMultiplier,
    domTag,
    signalAdjusted: Math.round(signalAdjusted / 1000) * 1000,
    signalTags,
    finalOffer,
    percentOfList: finalOffer / listPrice,
    savings: listPrice - finalOffer,
    inTargetRange: finalOffer >= 900000 && finalOffer <= 1250000,
  };
}

/**
 * Language-based offer model — used when no assessment data is available.
 *
 * Anchors on listing language signals + DOM instead of government assessment.
 * Higher floor (85% vs 78%) because we have less certainty without assessment.
 * Used for: Ontario (frozen 2016 MPAC), new construction (not yet assessed),
 * any province where assessment lookup fails.
 */
export function offerModelLanguage(listing: Listing): OfferResult {
  const listPrice = listing.price;
  const dom = listing.dom || 0;
  const text = (listing.description + " " + listing.notes).toLowerCase();
  const signals = getSignals(listing);

  // Step 1: Language Anchor — base discount from signal strength
  const tier1Keywords = ["must sell", "priced to sell", "estate sale", "motivated seller",
    "bring your offer", "bring all offers", "power of sale", "relocation"];
  const tier2Keywords = ["price reduced", "new price", "price adjustment", "back on market",
    "as is", "as-is", "vacant", "quick possession", "flexible"];

  const hasTier1 = tier1Keywords.some(k => text.includes(k)) || listing.estateKeywords;
  const tier1Count = tier1Keywords.filter(k => text.includes(k)).length + (listing.estateKeywords ? 1 : 0);
  const hasTier2 = tier2Keywords.some(k => text.includes(k)) || listing.priceReduced;

  let baseDiscount: number;
  let anchorTag: string;

  if (tier1Count >= 2) {
    baseDiscount = 0.88;
    anchorTag = "STRONG LANGUAGE SIGNALS (" + tier1Count + " tier-1)";
  } else if (hasTier1) {
    baseDiscount = 0.90;
    anchorTag = "TIER-1 LANGUAGE SIGNAL";
  } else if (hasTier2) {
    baseDiscount = 0.94;
    anchorTag = "TIER-2 LANGUAGE SIGNAL";
  } else if (signals.length > 0) {
    baseDiscount = 0.96;
    anchorTag = "MINOR SIGNALS";
  } else {
    baseDiscount = 0.98;
    anchorTag = "NO SIGNALS";
  }

  const anchor = listPrice * baseDiscount;

  // Step 2: DOM Multiplier (same as assessment-based model)
  let domMultiplier: number;
  let domTag: string;

  if (dom >= 150) {
    domMultiplier = 0.9;
    domTag = "HIGH MOTIVATION";
  } else if (dom >= 120) {
    domMultiplier = 0.92;
    domTag = "VERY STALE";
  } else if (dom >= 100) {
    domMultiplier = 0.94;
    domTag = "STALE";
  } else if (dom >= 90) {
    domMultiplier = 0.95;
    domTag = "AGING";
  } else if (dom >= 75) {
    domMultiplier = 0.96;
    domTag = "SITTING";
  } else if (dom >= 60) {
    domMultiplier = 0.97;
    domTag = "MATURING";
  } else if (dom >= 45) {
    domMultiplier = 0.98;
    domTag = "NORMAL";
  } else {
    domMultiplier = 0.99;
    domTag = "FRESH";
  }

  const domAdjusted = anchor * domMultiplier;

  // Step 3: Signal stack (same adjustments as assessment model)
  let stack = 1.0;
  const signalTags: string[] = [];

  if (listing.estateKeywords) {
    stack *= 0.97;
    signalTags.push("Estate -3%");
  }
  if (listing.priceReduced) {
    stack *= 0.98;
    signalTags.push("Reduced -2%");
  }
  if (["must sell", "priced to sell", "quick sale", "priced for quick"].some(k => text.includes(k))) {
    stack *= 0.97;
    signalTags.push("MustSell -3%");
  }
  if (["motivated seller", "bring your offer", "bring all offers"].some(k => text.includes(k))) {
    stack *= 0.97;
    signalTags.push("Motivated -3%");
  }
  if (["first time on market", "40 years", "50 years"].some(k => text.includes(k))) {
    stack *= 0.98;
    signalTags.push("LongHeld -2%");
  }

  const signalAdjusted = domAdjusted * stack;

  // Step 4: Floor/Ceiling — higher floor than assessment model (85% vs 78%)
  const floor = listPrice * 0.85;
  let finalOffer = Math.max(signalAdjusted, floor);
  finalOffer = Math.min(finalOffer, listPrice * 0.98);
  finalOffer = Math.round(finalOffer / 1000) * 1000;

  return {
    anchor: Math.round(anchor / 1000) * 1000,
    anchorTag,
    anchorType: "language",
    listToAssessedRatio: 0,
    domAdjusted: Math.round(domAdjusted / 1000) * 1000,
    domMultiplier,
    domTag,
    signalAdjusted: Math.round(signalAdjusted / 1000) * 1000,
    signalTags,
    finalOffer,
    percentOfList: finalOffer / listPrice,
    savings: listPrice - finalOffer,
    inTargetRange: finalOffer >= 900000 && finalOffer <= 1250000,
  };
}
