/**
 * One-time batch enrichment of all KV listings.
 *
 * Adds preScore, preTier, preSignals, preNarrative, preOffer to every listing.
 * Uses Claude Sonnet 4.5 for initial enrichment (higher quality narratives).
 *
 * Usage: npx tsx scripts/enrich-listings.ts
 *
 * Requires KV_REST_API_URL, KV_REST_API_TOKEN, OPENROUTER_API_KEY in .env.local
 */

import { readFileSync } from "fs";

// Load .env.local
const envContent = readFileSync(".env.local", "utf-8");
for (const line of envContent.split("\n")) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, "");
}

import { getAllListings, writeAllListings } from "../src/lib/kv/listings";
import { lookupAssessmentSync } from "../src/lib/assessment";
import { lookupAB } from "../src/lib/assessment/ab";
import { scoreV2 } from "../src/lib/scoring";
import { offerModel, offerModelLanguage } from "../src/lib/offer-model";
import { getSignals } from "../src/lib/signals";
import { deterministicNarrative } from "../src/lib/llm";
import { Listing, Assessment, OfferResult, PrecomputedOffer } from "../src/lib/types";
import { fmt } from "../src/lib/utils";
import OpenAI from "openai";

const openrouter = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY || "",
});

// Use Claude Sonnet 4 for initial enrichment (higher quality than MiniMax)
const MODEL = "anthropic/claude-sonnet-4";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function offerToPrecomputed(offer: OfferResult): PrecomputedOffer {
  return {
    anchor: offer.anchor,
    anchor_tag: offer.anchorTag,
    ratio: offer.listToAssessedRatio,
    dom_adjusted: offer.domAdjusted,
    dom_mult: offer.domMultiplier,
    dom_tag: offer.domTag,
    signal_adjusted: offer.signalAdjusted,
    signal_tags: offer.signalTags,
    final_offer: offer.finalOffer,
    pct_of_list: offer.percentOfList,
    savings: offer.savings,
    floor_applied: offer.finalOffer <= offer.anchor * 0.79,
  };
}

async function llmNarrative(
  listing: Listing,
  assessment: Assessment | null,
  offer: OfferResult | null,
  signals: string[]
): Promise<{ signals: string[]; narrative: string }> {
  const desc = listing.description || "";
  if (!desc.trim() && !offer) return { signals: [], narrative: "" };

  // Build assessment context
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

  const priceSqft = listing.sqft && parseInt(listing.sqft) > 0
    ? `$${Math.round(listing.price / parseInt(listing.sqft))}/sqft`
    : "price/sqft unknown";

  const response = await openrouter.chat.completions.create({
    model: MODEL,
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
  if (!jsonMatch) return { signals: [], narrative: "" };

  const parsed = JSON.parse(jsonMatch[0]);
  return {
    signals: Array.isArray(parsed.signals) ? parsed.signals : [],
    narrative: typeof parsed.narrative === "string" ? parsed.narrative : "",
  };
}

async function main() {
  console.log("=== Batch Enrichment (Sonnet 4.5) ===\n");

  const listings = await getAllListings();
  console.log(`Loaded ${listings.length} listings from KV\n`);

  let enriched = 0;
  let skipped = 0;
  let llmCalls = 0;
  let deterministicCount = 0;

  for (let i = 0; i < listings.length; i++) {
    const listing = listings[i];

    // Skip already-enriched WATCH listings (deterministic is fine)
    // Re-enrich HOT/WARM that may have fallen back to deterministic
    const preCheck = scoreV2(listing);
    if (listing.preNarrative && listing.preOffer && preCheck.tier === "WATCH") {
      skipped++;
      continue;
    }
    if (listing.preNarrative && listing.preOffer && preCheck.tier !== "WATCH") {
      const isDeterministic = listing.preNarrative.startsWith(listing.address);
      if (!isDeterministic) {
        skipped++;
        continue;
      }
    }

    console.log(`[${i + 1}/${listings.length}] ${listing.address}, ${listing.city}`);

    // Assessment lookup: cache-only for BC/ON, live SODA API for AB
    let assessment: Assessment | null = null;
    if (listing.province === "AB") {
      try {
        assessment = await lookupAB(listing.address);
        if (assessment?.found) {
          console.log(`  Assessment (AB live): ${fmt(assessment.totalValue)}`);
        }
      } catch {
        assessment = lookupAssessmentSync(listing.address, listing.province);
      }
    } else {
      assessment = lookupAssessmentSync(listing.address, listing.province);
      if (assessment?.found) {
        console.log(`  Assessment (cache): ${fmt(assessment.totalValue)}`);
      }
    }

    // Score + offer
    const score = scoreV2(listing);
    const offer = assessment?.found
      ? offerModel(listing, assessment)
      : offerModelLanguage(listing);
    const signals = getSignals(listing);

    // Narrative
    let narrative: string;
    let llmSignals: string[] = [];

    if (score.tier === "WATCH") {
      narrative = deterministicNarrative({ listing, assessment, offer, signals });
      deterministicCount++;
      console.log(`  ${score.tier} (${score.total}pts) — deterministic`);
    } else {
      try {
        const result = await llmNarrative(listing, assessment, offer, signals);
        narrative = result.narrative;
        llmSignals = result.signals;
        llmCalls++;
        console.log(`  ${score.tier} (${score.total}pts) — LLM (${llmSignals.length} extra signals)`);
        // Rate limit: 2s between LLM calls
        await sleep(2000);
      } catch (err) {
        console.log(`  LLM failed, using deterministic: ${err}`);
        narrative = deterministicNarrative({ listing, assessment, offer, signals });
        deterministicCount++;
      }
    }

    // Write pre-computed fields
    listing.preScore = score.total;
    listing.preTier = score.tier;
    listing.preSignals = [...signals, ...llmSignals];
    listing.preNarrative = narrative;
    listing.preOffer = offer ? offerToPrecomputed(offer) : undefined;

    if (assessment?.found) {
      listing.assessmentNote = `${assessment.assessmentYear}: ${fmt(assessment.totalValue)}`;
    }

    enriched++;
  }

  console.log(`\n=== Writing ${listings.length} enriched listings to KV ===`);
  const result = await writeAllListings(listings);
  console.log(`Written: ${result.written} listings, ${result.slugs} slug entries`);

  console.log(`\n=== Summary ===`);
  console.log(`Enriched: ${enriched}`);
  console.log(`Skipped (already enriched): ${skipped}`);
  console.log(`LLM calls (Sonnet 4.5): ${llmCalls}`);
  console.log(`Deterministic (WATCH): ${deterministicCount}`);

  // Province breakdown
  const byTier = new Map<string, number>();
  for (const l of listings) {
    const tier = l.preTier || "unknown";
    byTier.set(tier, (byTier.get(tier) || 0) + 1);
  }
  console.log(`\nBy tier:`);
  for (const [tier, count] of byTier) {
    console.log(`  ${tier}: ${count}`);
  }
}

main().catch((err) => {
  console.error("Enrichment failed:", err);
  process.exit(1);
});
