import { Listing } from "./types";

export function getSignals(listing: Listing): string[] {
  const text = (listing.description + " " + listing.notes).toLowerCase();
  const signals: string[] = [];

  if (listing.priceReduced) signals.push("Price Reduced");
  if (listing.estateKeywords) signals.push("Estate/Distress");
  if (["priced to sell", "must sell", "quick sale"].some((k) => text.includes(k)))
    signals.push("Must Sell");
  if (["motivated seller", "bring your offer"].some((k) => text.includes(k)))
    signals.push("Motivated Seller");
  if (["price adjustment", "great new price", "new price"].some((k) => text.includes(k)))
    signals.push("Price Adj");
  if (["assembly", "subdivision", "ssmuh", "development potential"].some((k) => text.includes(k)))
    signals.push("Dev Opp");
  if (["$25,000 credit", "credit promotion", "credit promo"].some((k) => text.includes(k)))
    signals.push("$25K Credit");
  if (["first time on market", "40 years", "50 years"].some((k) => text.includes(k)))
    signals.push("Long Held");
  if (["below assessed", "under assessed"].some((k) => text.includes(k)))
    signals.push("Below Assessed");
  if (listing.cluster === "Bear Mountain" || text.includes("bear mountain"))
    signals.push("Bear Mtn");
  if (listing.hasSuite) signals.push("Suite");

  return signals;
}
