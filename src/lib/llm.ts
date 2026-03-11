import OpenAI from "openai";
import { Listing, Assessment, OfferResult, ComparableResult } from "./types";
import { fmt } from "./utils";

let _openrouter: OpenAI | null = null;
function openrouter(): OpenAI {
  if (!_openrouter) {
    _openrouter = new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: process.env.OPENROUTER_API_KEY || "",
    });
  }
  return _openrouter;
}

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
  comparables?: ComparableResult;
}): string {
  const { listing, assessment, offer, signals, comparables } = context;
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
    const sourceQualifier = assessment.source === "tax_reverse"
      ? "estimated" : assessment.source === "area_median" ? "area median" : "assessed";
    if (ratio >= 1.15) {
      assessContext = ` Listed ${((ratio - 1) * 100).toFixed(0)}% above the ${assessment.assessmentYear} ${sourceQualifier} value of ${fmt(assessment.totalValue)}.`;
    } else if (ratio >= 1.05) {
      assessContext = ` Listed ${((ratio - 1) * 100).toFixed(0)}% above the ${assessment.assessmentYear} ${sourceQualifier} value — the gap doesn't create leverage.`;
    } else if (ratio < 0.96) {
      assessContext = ` Listed below the ${assessment.assessmentYear} ${sourceQualifier} value of ${fmt(assessment.totalValue)} — unusual, but no language signals to suggest urgency.`;
    }
    if (assessment.source === "tax_reverse") {
      assessContext += " (Assessment estimated from property taxes — treat as approximate.)";
    } else if (assessment.source === "area_median") {
      assessContext += " (City-level median, not property-specific.)";
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

  // Comparable context
  let compContext = "";
  if (comparables && comparables.confidence !== "none" && comparables.medianSoldToList) {
    const pct = (comparables.medianSoldToList * 100).toFixed(1);
    compContext = ` ${comparables.matchedCount} similar properties sold recently at a median ${pct}% of list.`;
    if (comparables.impliedValue) {
      compContext += ` Comparable-implied value: ${fmt(comparables.impliedValue)}.`;
    }
    if (comparables.dataGaps.length > 0) {
      compContext += ` (${comparables.dataGaps[0]}.)`;
    }
  }

  if (signals.length === 0) {
    return `${addr} — ${descQuality} The seller is in no rush.${assessContext}${compContext}${limitText} WATCH only; check back if the description changes to include price reduction language or DOM exceeds 90.`;
  }

  return `${addr} — minor signals (${signals.join(", ")}) but insufficient for a strong offer position.${assessContext}${compContext}${limitText} Monitor for price reductions or increased market time.`;
}

// ---------------------------------------------------------------------------
// Comparables block builder (for LLM prompt)
// ---------------------------------------------------------------------------

function buildComparablesBlock(comparables?: ComparableResult): string {
  if (!comparables || comparables.confidence === "none") {
    return "Comparable sales: No usable comparables found for this listing.";
  }

  const lines: string[] = [];
  lines.push(`Comparable sales (${comparables.confidence} confidence):`);
  lines.push(`  ${comparables.matchedCount} similar properties sold within 60 days`);

  if (comparables.medianSoldToList) {
    lines.push(`  Median sold-to-list ratio: ${(comparables.medianSoldToList * 100).toFixed(1)}%`);
  }
  if (comparables.medianPricePerSqft) {
    lines.push(`  Median $/sqft sold: $${comparables.medianPricePerSqft}`);
  }
  if (comparables.impliedValue) {
    lines.push(`  Comparable-implied value: ${fmt(comparables.impliedValue)}`);
  }
  if (comparables.compValidation) {
    const labels = {
      confirmed: "Comps align with our offer range",
      aggressive: "Our offer is below comp-implied range",
      conservative: "Comps suggest room for deeper discount",
    };
    lines.push(`  Validation: ${labels[comparables.compValidation]}`);
  }
  if (comparables.dataGaps.length > 0) {
    lines.push(`  Data gaps: ${comparables.dataGaps.join(", ")}`);
  }

  // Top comps
  for (const c of comparables.comparables.slice(0, 3)) {
    const sqftStr = c.sqft ? `${c.sqft}sqft` : "?sqft";
    lines.push(`  - ${c.address}: ${c.bedrooms}bd/${sqftStr}, sold ${(c.soldToListRatio * 100).toFixed(1)}% of list (${fmt(c.soldPrice)}), ${c.distanceKm}km away${c.eraBucket ? `, ${c.eraBucket}` : ""}`);
  }

  lines.push("NOTE: Reference comparable sales to support or contextualize the offer. Communicate confidence level honestly — do not overstate thin comp evidence.");

  return lines.join("\n");
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
  comparables?: ComparableResult;
}): Promise<LLMAnalysis> {
  if (!process.env.OPENROUTER_API_KEY) {
    return { signals: [], confidence: 0, narrative: "" };
  }

  const { listing, assessment, offer, signals, comparables } = context;
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
      const sourceLabel = assessment.source === "tax_reverse"
        ? "Estimated from taxes"
        : assessment.source === "area_median"
          ? "City-level area median (StatCan)"
          : "Government";
      assessmentBlock = `Assessment (${assessment.assessmentYear}, ${sourceLabel}): ${fmt(assessment.totalValue)}`;
      if (hasLandSplit) {
        const landPct = ((assessment.landValue / assessment.totalValue) * 100).toFixed(0);
        assessmentBlock += ` (land ${fmt(assessment.landValue)} [${landPct}%], building ${fmt(assessment.buildingValue)})`;
      }
      assessmentBlock += `\nList-to-assessed ratio: ${ratio.toFixed(3)}x`;
      if (assessment.source === "tax_reverse") {
        assessmentBlock += `\nNOTE: This assessment is reverse-engineered from listed property taxes using municipal rates. It is an estimate, NOT a verified government figure. Treat with lower confidence.`;
      } else if (assessment.source === "area_median") {
        assessmentBlock += `\nNOTE: This is a city-level median from StatCan, NOT property-specific. It tells you roughly what properties in this city assess at, but says nothing about this specific property. Treat as approximate.`;
      } else if (assessment.assessmentYear === "2016") {
        assessmentBlock += `\nNOTE: Ontario MPAC assessments are frozen at 2016 Current Value Assessment. Market values have diverged significantly since then.`;
      }
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

    // DOM context for narrative
    const dom = listing.dom ?? 0;

    const response = await openrouter().chat.completions.create({
      model: "anthropic/claude-haiku-4.5",
      max_tokens: 800,
      messages: [
        {
          role: "system",
          content: `You are a buyer's acquisition analyst. You work for the buyer. Your job is to arm them with data-backed conviction so they can make the sharpest possible offer on a property.

You produce two outputs:

1. SIGNALS: Additional motivation signals detected through reading comprehension.
2. NARRATIVE: A 2-3 paragraph analytical brief on this property as a trade opportunity.

SIGNAL DETECTION:
Detect signals that require reading between the lines — things our keyword system misses:
- Relocation, health, life change indicators buried in context
- Financial pressure implied by narrative tone (foreclosure, liens, divorce context)
- Property condition admissions (deferred maintenance, dated finishes presented as "charm")
- Vacancy/unoccupied indicators
- Builder/developer language indicating inventory pressure
- Urgency language not caught by standard keywords

Do NOT flag keywords already detected: "estate sale", "price reduced", "motivated seller", "must sell", "bring offers". Only flag what requires reading comprehension.

NARRATIVE — THE BUYER'S BRIEF:
Write 2-3 SHORT paragraphs separated by blank lines (\\n\\n). Each paragraph should be 2-3 sentences max.

PARAGRAPH 1 — THE NUMBERS: What do the assessment, DOM, signals, and comps tell us about negotiable space? Don't recite data — interpret it. If listed 15% above assessment, that's negotiable room the listing agent already knows exists. If comps closed at 92% of list, that's the market speaking. Explain what the buyer is actually paying for — if land/building split is available, break down whether the value is in the dirt or the structure.

PARAGRAPH 2 — THE READ: What does the property and listing tell us about the seller's position? Read the situation: Is this a developer managing inventory? An estate executor clearing an obligation? A seller who's been sitting 150 days without reducing price — and what does that tell us about their expectations vs. reality? Functional limitations that shrink the buyer pool (and therefore the seller's negotiating leverage) matter here: 1 bath for 4 beds, small sqft, dated construction. Generic agent copy vs. urgency language tells you how motivated the other side is.

PARAGRAPH 3 — THE POSITION: Is this a good trade? State it clearly. Cite the specific data that justifies our offer: the assessment anchor, the DOM bracket, the signal stack, the comp evidence. The buyer should walk away knowing exactly why the number is what it is and what to expect from the other side (a counter, a rejection, acceptance). Frame the offer as a defensible market position, not a gamble.

WHO YOU WORK FOR:
You work for the buyer. The deal is won on the buy side. Every dollar below list is equity on day one. Your narrative should give the buyer confidence and clarity, backed by evidence.

NEVER DO THESE:
- NEVER use the words "insulting", "lowball", "offensive", "too aggressive", or "risks appearing." These are seller-protection words and have no place in acquisition analysis. An offer backed by assessment data, market duration, and comparable sales is not aggressive — it is the current market position supported by evidence.
- NEVER evaluate an offer through the lens of the seller's emotional reaction. We don't care if the seller is offended. We care if the numbers are defensible.
- NEVER treat the listing price as ground truth. The listing price is the seller's opening position — set by their agent to create negotiation room. Our model produces the current market offer based on what the data says right now.
- NEVER use time-sensitive freshness language: "just listed", "fresh to market", "newly listed", "0 DOM", "only X days" for listings under 60 days.
- DOM below 60 tells you NOTHING about motivation — do not reference it.
- DOM at 60+ IS a pressure indicator — reference the bracket tag and what it means for the seller's position.
- NEVER hedge with "this might not work" or "the seller may not accept." Of course the seller might counter — that's how negotiation works. Present the position with conviction.
- When data is missing, acknowledge the gap and what it means for confidence — don't fabricate.
- No sales language. No exclamation marks. No emotion. Write with influence, clarity, and conviction.
- Separate paragraphs with a blank line (\\n\\n). Do NOT write a wall of text.

Return ONLY valid JSON:
{"signals": ["signal1"], "confidence": 0.0, "narrative": "Paragraph one.\\n\\nParagraph two.\\n\\nParagraph three."}`,
        },
        {
          role: "user",
          content: `Property: ${listing.address}, ${listing.city}, ${listing.province}
List price: ${fmt(listing.price)}
Profile: ${profile}
Price per sqft: ${priceSqft}
Days on market: ${dom}
${assessmentBlock}
${offerBlock}
${buildComparablesBlock(comparables)}
Detected signals: ${signals.length > 0 ? signals.join(", ") : "none"}

Description:
${desc || "(No description available)"}`,
        },
      ],
    });

    const text = response.choices[0]?.message?.content?.trim() || "";
    const finishReason = response.choices[0]?.finish_reason;
    if (finishReason === "length") {
      console.warn(`  [llm] WARNING: response truncated (hit max_tokens). Raw length: ${text.length}`);
    }

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn(`  [llm] No JSON found in response. Raw: ${text.slice(0, 200)}`);
      return { signals: [], confidence: 0, narrative: "" };
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      console.warn(`  [llm] JSON parse failed. finish_reason=${finishReason}. Raw: ${jsonMatch[0].slice(0, 300)}`);
      return { signals: [], confidence: 0, narrative: "" };
    }

    return {
      signals: Array.isArray(parsed.signals) ? parsed.signals : [],
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
      narrative: typeof parsed.narrative === "string" ? parsed.narrative : "",
    };
  } catch (err) {
    console.warn(`  [llm] Error: ${err instanceof Error ? err.message : String(err)}`);
    return { signals: [], confidence: 0, narrative: "" };
  }
}

