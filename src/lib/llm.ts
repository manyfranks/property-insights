import OpenAI from "openai";
import { Listing, Assessment, OfferResult } from "./types";
import { fmt } from "./utils";

const openrouter = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY || "",
});

export interface LLMAnalysis {
  signals: string[];
  confidence: number;
  narrative: string;
}

// ---------------------------------------------------------------------------
// Deterministic narrative templates (WATCH tier — no LLM call needed)
// ---------------------------------------------------------------------------

/**
 * Generate a deterministic narrative for WATCH-tier listings.
 * Per ALGORITHM.md Stage 8: skip LLM for WATCH to save cost.
 */
export function deterministicNarrative(context: {
  listing: Listing;
  assessment: Assessment | null;
  offer: OfferResult | null;
  signals: string[];
}): string {
  const { listing, assessment, offer, signals } = context;
  const addr = listing.address;

  // Assess description quality
  const desc = listing.description || "";
  const descQuality = desc.length < 50
    ? "No meaningful description provided."
    : "Generic marketing copy with no motivation signals.";

  // Assessment gap context (when available)
  let assessContext = "";
  if (assessment && assessment.found && offer?.anchorType === "assessment") {
    const ratio = listing.price / assessment.totalValue;
    if (ratio >= 1.15) {
      assessContext = ` Listed ${((ratio - 1) * 100).toFixed(0)}% above the ${assessment.assessmentYear} assessed value of ${fmt(assessment.totalValue)}.`;
    } else if (ratio >= 1.05) {
      assessContext = ` Listed ${((ratio - 1) * 100).toFixed(0)}% above the ${assessment.assessmentYear} assessment — the gap doesn't create leverage.`;
    } else if (ratio < 0.96) {
      assessContext = ` Listed below the ${assessment.assessmentYear} assessed value of ${fmt(assessment.totalValue)} — unusual, but no language signals to suggest urgency.`;
    }
  }

  // Functional limitation flags
  const limitations: string[] = [];
  const baths = parseInt(listing.baths) || 0;
  const beds = parseInt(listing.beds) || 0;
  if (beds >= 3 && baths === 1) limitations.push("single bathroom for a " + beds + "-bed layout limits the buyer pool");
  const sqft = parseInt(listing.sqft) || 0;
  if (sqft > 0 && sqft < 1200 && beds >= 3) limitations.push("tight at " + sqft + " sqft for " + beds + " bedrooms");
  const limitText = limitations.length > 0 ? " " + limitations.join("; ") + "." : "";

  if (signals.length === 0) {
    return `${addr} — ${descQuality} The seller is in no rush.${assessContext}${limitText} WATCH only; check back if the description changes to include price reduction language or DOM exceeds 90.`;
  }

  return `${addr} — minor signals (${signals.join(", ")}) but insufficient for a strong offer position.${assessContext}${limitText} Monitor for price reductions or increased market time.`;
}

// ---------------------------------------------------------------------------
// Combined LLM call (HOT + WARM tier only)
// ---------------------------------------------------------------------------

/**
 * Combined LLM call: detect motivation signals + generate analytical narrative.
 * Single call replaces the previous analyzeDescription + generateOfferNarrative pair.
 *
 * Only called for HOT and WARM tier listings (per ALGORITHM.md).
 * WATCH tier uses deterministicNarrative() instead.
 */
export async function analyzeAndNarrate(context: {
  listing: Listing;
  assessment: Assessment | null;
  offer: OfferResult | null;
  signals: string[];
}): Promise<LLMAnalysis> {
  if (!process.env.OPENROUTER_API_KEY) {
    return { signals: [], confidence: 0, narrative: "" };
  }

  const { listing, assessment, offer, signals } = context;
  const desc = listing.description || "";

  if (!desc.trim() && !offer) {
    return { signals: [], confidence: 0, narrative: "" };
  }

  try {
    // Build assessment context — adapt to available data per market
    let assessmentBlock: string;
    if (assessment && assessment.found) {
      const ratio = listing.price / assessment.totalValue;
      const hasLandSplit = assessment.landValue > 0 && assessment.buildingValue > 0;
      assessmentBlock = `Assessment (${assessment.assessmentYear}): ${fmt(assessment.totalValue)}`;
      if (hasLandSplit) {
        const landPct = ((assessment.landValue / assessment.totalValue) * 100).toFixed(0);
        assessmentBlock += ` (land ${fmt(assessment.landValue)} [${landPct}%], building ${fmt(assessment.buildingValue)})`;
      }
      assessmentBlock += `\nList-to-assessed ratio: ${ratio.toFixed(3)}x`;
      if (hasLandSplit) {
        assessmentBlock += `\nLand share: ${((assessment.landValue / assessment.totalValue) * 100).toFixed(0)}% — ${assessment.landValue > assessment.buildingValue ? "land-heavy valuation, structure has limited value" : "building carries meaningful value"}`;
      }
    } else {
      assessmentBlock = "Assessment: Not available — using language-based offer model (higher uncertainty)";
    }

    // Build offer context
    let offerBlock: string;
    if (offer) {
      offerBlock = `Offer model: ${offer.anchorType === "assessment" ? "Assessment-anchored" : "Language-based"}
  Anchor: ${fmt(offer.anchor)} (${offer.anchorTag})
  DOM bracket: ${offer.domTag} (×${offer.domMultiplier})
  Signal adjustments: ${offer.signalTags.length > 0 ? offer.signalTags.join(", ") : "none"}
  Final offer: ${fmt(offer.finalOffer)} (${(offer.percentOfList * 100).toFixed(1)}% of list)
  Savings: ${fmt(offer.savings)}`;
    } else {
      offerBlock = "Offer: Not computed";
    }

    // Build property profile
    const sqft = listing.sqft ? `${listing.sqft} sqft` : "sqft unknown";
    const year = listing.yearBuilt ? `built ${listing.yearBuilt}` : "year unknown";
    const taxes = listing.taxes ? `$${listing.taxes}/yr taxes` : "taxes unknown";
    const profile = `${listing.beds} bed / ${listing.baths} bath, ${sqft}, ${year}, ${taxes}`;

    // Price per sqft (when available)
    const priceSqft = listing.sqft && parseInt(listing.sqft) > 0
      ? `$${Math.round(listing.price / parseInt(listing.sqft))}/sqft`
      : "price/sqft unknown";

    const response = await openrouter.chat.completions.create({
      model: "minimax/minimax-m2.5",
      max_tokens: 400,
      messages: [
        {
          role: "system",
          content: `You are a real estate acquisition analyst writing property assessments for an investor. You produce two outputs:

1. SIGNALS: Additional motivation signals detected through reading comprehension.
2. NARRATIVE: A 4-6 sentence analytical assessment of the property as a negotiation opportunity.

SIGNAL DETECTION:
Detect signals that require reading between the lines — things our keyword system misses:
- Relocation, health, life change indicators buried in context
- Financial pressure implied by narrative tone (foreclosure, liens, divorce context)
- Property condition admissions (deferred maintenance, dated finishes presented as "charm")
- Vacancy/unoccupied indicators
- Builder/developer language indicating inventory pressure
- Urgency language not caught by standard keywords

Do NOT flag keywords already detected: "estate sale", "price reduced", "motivated seller", "must sell", "bring offers". Only flag what requires reading comprehension.

NARRATIVE — ANALYTICAL FRAMEWORK:
Structure your assessment across these dimensions (cover what the data allows):

1. DESCRIPTION QUALITY: Is this generic marketing filler (agent wrote it in two minutes), or does it reveal motivation? A zero-signal description from a professional agent means the seller is comfortable waiting. Say so.

2. ASSESSMENT GAP (when assessment data is provided): What does the list-to-assessed ratio mean? If land/building split is available, what does it tell us about what the buyer is really paying for? A building valued at $250K on a $750K assessment means you're paying for dirt. Say what the numbers mean, don't just recite them.

3. FUNCTIONAL ANALYSIS: Note limitations that shrink the buyer pool — 1 bathroom for 3+ bedrooms eliminates families, small sqft for the bedroom count, dated construction requiring renovation budget, no suite potential. These affect how long the property sits and who competes for it.

4. HONEST VERDICT: Is this a good negotiation opportunity or a weak trade? If the offer model produces savings of only 2-3% off list with no leverage signals, say it's a weak trade. If the assessment gap creates real anchor leverage, explain why.

CRITICAL RULES:
- NEVER use time-sensitive freshness language: "just listed", "fresh to market", "newly listed", "brand new listing", "0 DOM", "only X days on market" for listings under 60 days
- DOM below 60 tells you NOTHING about seller motivation — do not reference it as meaningful
- DOM at 60+ IS relevant as a pressure indicator — reference the bracket tag, not the raw number
- When data is missing (no sqft, no assessment, no year), acknowledge the gap and what it means for analysis confidence — don't fabricate
- Be direct and analytical. No sales language. No exclamation marks. Write like the Fulton analysis.

Return ONLY valid JSON:
{"signals": ["signal1"], "confidence": 0.0, "narrative": "Your 4-6 sentence assessment..."}`,
        },
        {
          role: "user",
          content: `Property: ${listing.address}, ${listing.city}, ${listing.province}
List price: ${fmt(listing.price)}
Profile: ${profile}
Price per sqft: ${priceSqft}
${assessmentBlock}
${offerBlock}
Detected signals: ${signals.length > 0 ? signals.join(", ") : "none"}

Description:
${desc || "(No description available)"}`,
        },
      ],
    });

    const text = response.choices[0]?.message?.content?.trim() || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { signals: [], confidence: 0, narrative: "" };

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      signals: Array.isArray(parsed.signals) ? parsed.signals : [],
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
      narrative: typeof parsed.narrative === "string" ? parsed.narrative : "",
    };
  } catch {
    return { signals: [], confidence: 0, narrative: "" };
  }
}

// ---------------------------------------------------------------------------
// Backward-compatible exports (kept for any other callers)
// ---------------------------------------------------------------------------

export async function analyzeDescription(description: string): Promise<{ signals: string[]; confidence: number }> {
  if (!process.env.OPENROUTER_API_KEY || !description.trim()) {
    return { signals: [], confidence: 0 };
  }

  try {
    const response = await openrouter.chat.completions.create({
      model: "minimax/minimax-m2.5",
      max_tokens: 200,
      messages: [
        {
          role: "system",
          content: `You are a real estate acquisition analyst. Analyze the listing description for seller motivation signals. Return ONLY JSON: {"signals": string[], "confidence": number}

Look for signals requiring reading comprehension:
- Relocation / moving away
- Health/age/life change
- Financial pressure
- Property condition issues
- Vacant / unoccupied
- Builder inventory
- Unusual urgency

Do NOT flag obvious keywords: "estate sale", "price reduced", "motivated seller", "must sell".
If generic marketing copy with no motivation signals, return {"signals": [], "confidence": 0}.`,
        },
        { role: "user", content: description },
      ],
    });

    const text = response.choices[0]?.message?.content?.trim() || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { signals: [], confidence: 0 };

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      signals: Array.isArray(parsed.signals) ? parsed.signals : [],
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
    };
  } catch {
    return { signals: [], confidence: 0 };
  }
}

export async function generateOfferNarrative(): Promise<string> {
  return "";
}
