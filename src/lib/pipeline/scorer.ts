/**
 * pipeline/scorer.ts  —  scoreV3
 *
 * Language-first motivated seller scorer.
 *
 * KEY DESIGN PRINCIPLE:
 *   DOM is NOT the primary score driver — it is a multiplier applied after
 *   the language score is established. A freshly relisted property that has
 *   been sitting for 18 months still shows DOM=0 on realtor.ca after
 *   relisting. Language is the only reliable signal that survives resets.
 *
 * SCORING STRUCTURE:
 *   1. Language score  (0–100 raw pts from description/notes NLP)
 *   2. DOM multiplier  (1.0–1.5x applied to language score)
 *   3. Assessment gap  (±15 pts bonus/penalty if assessedValue available)
 *   4. Tier assignment (HOT / WARM / WATCH)
 *
 * Signals are returned alongside the score for display in the frontend.
 */

import { Listing } from "../types";

// ---------------------------------------------------------------------------
// Signal definitions
// ---------------------------------------------------------------------------

interface SignalDef {
  /** Short label shown in the UI badge */
  label: string;
  /** Points awarded when matched */
  pts: number;
  /** One or more patterns to test against the listing text */
  patterns: RegExp[];
}

/**
 * Tier 1 — Explicit seller desperation (20 pts each)
 * These are unambiguous linguistic proof that the seller wants out.
 */
const TIER1_SIGNALS: SignalDef[] = [
  {
    label: "Must Sell",
    pts: 20,
    patterns: [/must sell/i, /need(s)? to sell/i, /seller must sell/i],
  },
  {
    label: "Motivated Seller",
    pts: 20,
    patterns: [/motivated sell/i, /seller is motivated/i, /highly motivated/i],
  },
  {
    label: "Bring All Offers",
    pts: 20,
    patterns: [/bring (all|any|your) offer/i, /all offers (considered|welcome|reviewed)/i, /open to (all )?offer/i],
  },
  {
    label: "Priced to Sell",
    pts: 20,
    patterns: [/priced (to sell|for quick|below)/i, /priced? for (action|offers)/i],
  },
  {
    label: "Relocation",
    pts: 20,
    patterns: [/relocation sale/i, /job (transfer|relocation)/i, /relocating (out|from|due)/i, /transferred (out|away)/i],
  },
  {
    label: "Estate Sale",
    pts: 20,
    patterns: [/estate sale/i, /selling (on behalf of )?(the )?estate/i, /executor (sale|is selling)/i, /probate sale/i],
  },
  {
    label: "Power of Sale",
    pts: 20,
    patterns: [/power of sale/i, /sale by mortgagee/i, /mortgagee sale/i],
  },
  {
    label: "Divorce / Separation",
    pts: 20,
    patterns: [/divorce sale/i, /separation sale/i, /selling due to (divorce|separation)/i],
  },
];

/**
 * Tier 2 — Implied pressure (10 pts each)
 * These require context but reliably indicate leverage.
 */
const TIER2_SIGNALS: SignalDef[] = [
  {
    label: "Price Reduced",
    pts: 10,
    patterns: [/price (has been )?reduced/i, /price reduction/i, /reduced from/i, /previously listed/i],
  },
  {
    label: "New Price",
    pts: 10,
    patterns: [/new price/i, /great new price/i, /price (improvement|adjustment|update)/i, /adjusted to/i],
  },
  {
    label: "Below Assessment",
    pts: 10,
    patterns: [/below (assessed|assessment)/i, /under (assessed|assessment)/i, /below bc assessment/i, /listed below assessed/i],
  },
  {
    label: "As-Is",
    pts: 10,
    patterns: [/as.?is (where.?is|condition|sale)/i, /sold (strictly )?as.?is/i, /no (representations|warranties)/i],
  },
  {
    label: "Vacant",
    pts: 10,
    patterns: [/vacant (possession|property|home|house)/i, /currently vacant/i, /empty (home|house|property)/i],
  },
  {
    label: "Quick Possession",
    pts: 10,
    patterns: [/quick (possession|close|closing)/i, /immediate possession/i, /flexible (and fast )?possession/i, /30 day (close|possession)/i],
  },
  {
    label: "Back on Market",
    pts: 10,
    patterns: [/back on (the )?market/i, /re.?listed/i, /returned to market/i, /previously listed/i, /fell through/i],
  },
  {
    label: "Flexible Terms",
    pts: 10,
    patterns: [/seller (is )?flexible/i, /flexible (on )?terms/i, /open to (creative|flexible) terms/i, /seller (will|can) (consider|look at)/i],
  },
];

/**
 * Tier 3 — Situational signals (5 pts each)
 * Softer signals. Meaningful in combination, weak alone.
 */
const TIER3_SIGNALS: SignalDef[] = [
  {
    label: "Long Held",
    pts: 5,
    patterns: [/first time (on|offered|for sale) in/i, /owned for (over )?(40|50|60) years/i, /long(time|term) owner/i, /original owner/i],
  },
  {
    label: "Needs TLC",
    pts: 5,
    patterns: [/needs? (some )?(tlc|updating|work|renovation)/i, /handyman (special|dream)/i, /sweat equity/i, /fixer(-| )upper/i, /needs updating/i],
  },
  {
    label: "Tenanted",
    pts: 5,
    patterns: [/currently tenanted/i, /tenant (in place|occupied|month.to.month)/i, /m2m (tenancy|tenant)/i],
  },
  {
    label: "Rental Income",
    pts: 5,
    patterns: [/rental (income|suite|property)/i, /income generating/i, /currently renting/i],
  },
  {
    label: "Easy to Show",
    pts: 5,
    patterns: [/easy (to show|showing)/i, /lock(box|box is on)/i, /call (to |for )?show/i, /show anytime/i],
  },
  {
    label: "Credit Incentive",
    pts: 5,
    patterns: [/\$[\d,]+k? (closing |buyer |purchase )?credit/i, /credit (promotion|promo|incentive)/i, /allowance (for |toward )?update/i],
  },
  {
    label: "Priced Below List",
    pts: 5,
    patterns: [/listed well below/i, /significantly (below|under)/i, /below (market|similar homes)/i],
  },
];

// ---------------------------------------------------------------------------
// DOM multiplier
// ---------------------------------------------------------------------------

/**
 * DOM is applied as a multiplier (1.0–1.5x) on top of the language score.
 * A DOM of 0 means no multiplier — the listing must earn score through language alone.
 * This survives relistings: a relisted property has DOM=0 but keeps whatever
 * language signals are in its description.
 */
function domMultiplier(dom: number): { multiplier: number; tag: string } {
  if (dom >= 300) return { multiplier: 1.5, tag: "300d+ — extreme staleness" };
  if (dom >= 210) return { multiplier: 1.4, tag: "210d+ — high motivation" };
  if (dom >= 150) return { multiplier: 1.3, tag: "150d+ — very stale" };
  if (dom >= 90)  return { multiplier: 1.2, tag: "90d+ — stale" };
  if (dom >= 60)  return { multiplier: 1.1, tag: "60d+ — aging" };
  if (dom >= 30)  return { multiplier: 1.05, tag: "30d+ — watching" };
  return             { multiplier: 1.0, tag: "fresh" };
}

// ---------------------------------------------------------------------------
// Main scorer
// ---------------------------------------------------------------------------

export interface ScoreV3Result {
  /** Final score after multipliers (0–100, capped) */
  total: number;

  /** Raw language score before DOM multiplier */
  languageScore: number;

  /** DOM multiplier applied */
  domMultiplier: number;
  domTag: string;

  /** HOT >= 55 | WARM >= 35 | WATCH < 35 */
  tier: "HOT" | "WARM" | "WATCH";

  /** Human-readable signal labels for frontend badges */
  signals: string[];

  /** Breakdown map for debugging/display */
  breakdown: Record<string, number>;
}

export function scoreV3(listing: Listing): ScoreV3Result {
  const text = [listing.description, listing.notes].join(" ").toLowerCase();
  const dom = typeof listing.dom === "number" ? listing.dom : 0;

  let languagePts = 0;
  const signals: string[] = [];
  const breakdown: Record<string, number> = {};

  // --- Tier 1 ---
  for (const sig of TIER1_SIGNALS) {
    if (sig.patterns.some((p) => p.test(text))) {
      languagePts += sig.pts;
      signals.push(sig.label);
      breakdown[sig.label] = sig.pts;
    }
  }

  // --- Tier 2 ---
  for (const sig of TIER2_SIGNALS) {
    if (sig.patterns.some((p) => p.test(text))) {
      languagePts += sig.pts;
      signals.push(sig.label);
      breakdown[sig.label] = sig.pts;
    }
  }

  // --- Tier 3 ---
  for (const sig of TIER3_SIGNALS) {
    if (sig.patterns.some((p) => p.test(text))) {
      languagePts += sig.pts;
      signals.push(sig.label);
      breakdown[sig.label] = sig.pts;
    }
  }

  // --- Pre-computed boolean fields (from parseRealtorResult) ---
  // These are already detected by realtor-ca.ts; add pts if not already counted
  if (listing.priceReduced && !breakdown["Price Reduced"] && !breakdown["New Price"]) {
    languagePts += 10;
    signals.push("Price Reduced");
    breakdown["Price Reduced (flag)"] = 10;
  }
  if (listing.estateKeywords && !breakdown["Estate Sale"]) {
    languagePts += 15;
    signals.push("Estate/Distress");
    breakdown["Estate (flag)"] = 15;
  }
  if (listing.hasSuite && !breakdown["Rental Income"]) {
    languagePts += 3;
    breakdown["Suite"] = 3;
  }

  // --- DOM multiplier ---
  const { multiplier, tag: dmTag } = domMultiplier(dom);
  const boosted = languagePts * multiplier;

  breakdown["DOM multiplier"] = Math.round((boosted - languagePts) * 10) / 10;

  // --- Assessment gap bonus (if available on the listing object) ---
  // The listing type carries assessedValue as optional; check defensively
  const assessed = (listing as Listing & { assessedValue?: number }).assessedValue;
  let assessPts = 0;
  if (assessed && assessed > 0 && listing.price > 0) {
    const ratio = listing.price / assessed;
    if (ratio < 0.92) {
      assessPts = 15;
      signals.push("Below Assessed");
      breakdown["Below Assessed (gap)"] = 15;
    } else if (ratio < 1.0) {
      assessPts = 8;
      breakdown["Near Assessed"] = 8;
    } else if (ratio <= 1.2) {
      // Listed 0–20% above assessed — normal range, no bonus or penalty
      assessPts = 0;
    } else {
      assessPts = -5;
      breakdown["Above Assessed penalty"] = -5;
    }
  } else {
    // Missing assessment is a mild negative — we can't confirm value
    assessPts = -3;
    breakdown["No Assessment"] = -3;
  }

  const total = Math.min(Math.round(boosted + assessPts), 100);
  const tier = total >= 55 ? "HOT" : total >= 35 ? "WARM" : "WATCH";

  return {
    total,
    languageScore: languagePts,
    domMultiplier: multiplier,
    domTag: dmTag,
    tier,
    signals,
    breakdown,
  };
}
