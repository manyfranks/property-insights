import { Listing, ScoreResult } from "./types";

export function scoreV2(listing: Listing): ScoreResult {
  let pts = 0;
  const breakdown: Record<string, number> = {};
  const text = (listing.description + " " + listing.notes).toLowerCase();
  const dom = listing.dom || 0;

  // DOM (Days on Market) — Realtor-Calibrated Brackets
  // 45-60 days is NORMAL in Victoria. Real desperation starts at 90+.
  let domPts = 0;
  if (dom >= 150) domPts = 30;
  else if (dom >= 120) domPts = 27;
  else if (dom >= 100) domPts = 24;
  else if (dom >= 90) domPts = 20;
  else if (dom >= 75) domPts = 16;
  else if (dom >= 60) domPts = 10;
  else if (dom >= 45) domPts = 5;
  else domPts = 2;
  pts += domPts;
  breakdown["DOM"] = domPts;

  if (listing.priceReduced) {
    pts += 15;
    breakdown["Price Reduced"] = 15;
  }

  if (listing.estateKeywords) {
    pts += 18;
    breakdown["Estate/Distress"] = 18;
  }

  // NLP Signals
  if (
    ["priced to sell", "priced for quick", "must sell", "sell quickly", "quick sale"].some((k) =>
      text.includes(k)
    )
  ) {
    pts += 12;
    breakdown["Must Sell Language"] = 12;
  }

  if (
    ["motivated seller", "bring your offer", "bring all offers", "all offers considered"].some(
      (k) => text.includes(k)
    )
  ) {
    pts += 10;
    breakdown["Motivated Seller"] = 10;
  }

  if (["back on market", "relisted", "re-listed"].some((k) => text.includes(k))) {
    pts += 10;
    breakdown["Relisted"] = 10;
  }

  if (
    ["price adjustment", "great new price", "new price", "price improvement"].some((k) =>
      text.includes(k)
    ) &&
    !listing.priceReduced
  ) {
    pts += 8;
    breakdown["Price Adj Language"] = 8;
  }

  if (
    ["quick possession", "immediate possession", "vacant", "move-in ready"].some((k) =>
      text.includes(k)
    )
  ) {
    pts += 6;
    breakdown["Quick Possession"] = 6;
  }

  if (
    ["divorce", "executor", "probate", "estate sale"].some((k) => text.includes(k)) &&
    !listing.estateKeywords
  ) {
    pts += 8;
    breakdown["Executor/Probate"] = 8;
  }

  if (
    ["first time on market", "first time offered", "40 years", "50 years"].some((k) =>
      text.includes(k)
    )
  ) {
    pts += 5;
    breakdown["Long Held"] = 5;
  }

  if (
    ["$25,000 credit", "credit promotion", "limited time credit", "credit promo"].some((k) =>
      text.includes(k)
    )
  ) {
    pts += 5;
    breakdown["Credit Promo"] = 5;
  }

  // Property Age
  const built = parseInt(listing.yearBuilt) || 2000;
  let agePts = 0;
  if (built < 1950) agePts = 5;
  else if (built < 1960) agePts = 3;
  else if (built < 1970) agePts = 2;
  if (agePts) {
    pts += agePts;
    breakdown["Building Age"] = agePts;
  }

  if (listing.hasSuite) {
    pts += 4;
    breakdown["Suite"] = 4;
  }

  if (
    ["assembly", "subdivision", "two title", "ssmuh", "development potential"].some((k) =>
      text.includes(k)
    )
  ) {
    pts += 7;
    breakdown["Dev Potential"] = 7;
  }

  if (listing.cluster === "Bear Mountain" || text.includes("bear mountain")) {
    pts += 4;
    breakdown["Bear Mountain Oversupply"] = 4;
  }

  if (["below assessed", "under assessed"].some((k) => text.includes(k))) {
    pts += 8;
    breakdown["Below Assessed"] = 8;
  }

  const total = Math.min(pts, 100);
  const tier = total >= 45 ? "HOT" : total >= 33 ? "WARM" : "WATCH";

  return { total, tier, breakdown };
}
