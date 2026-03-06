import { Listing, Assessment, OfferResult } from "./types";

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
    domTag = "DESPERATE";
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
  const floor = listPrice * 0.78;
  let finalOffer = Math.max(signalAdjusted, floor);
  finalOffer = Math.min(finalOffer, listPrice * 0.97);
  finalOffer = Math.round(finalOffer / 1000) * 1000;

  return {
    anchor: Math.round(anchor / 1000) * 1000,
    anchorTag,
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
