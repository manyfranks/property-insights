/**
 * compare-models.ts
 *
 * Runs the same narrative prompt against multiple OpenRouter models
 * for a specific listing, and outputs results side-by-side for comparison.
 *
 * Usage: npx tsx scripts/compare-models.ts
 */

import { readFileSync } from "fs";

// Load .env.local
const envContent = readFileSync(".env.local", "utf-8");
for (const line of envContent.split("\n")) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, "");
}

import OpenAI from "openai";
import { getAllListings } from "../src/lib/kv/listings";
import { scoreV2 } from "../src/lib/scoring";
import { offerModelLanguage } from "../src/lib/offer-model";
import { getSignals } from "../src/lib/signals";
import { fmt } from "../src/lib/utils";

const MODELS = [
  "minimax/minimax-m2.5",
  "anthropic/claude-haiku-4.5",
  "google/gemini-3.1-flash-lite-preview",
  "x-ai/grok-4.1-fast",
  "moonshotai/kimi-k2.5",
  "anthropic/claude-sonnet-4-6",
];

const TARGET_ADDRESS = "2094 Tomat Ave";

const openrouter = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY || "",
  timeout: 60000,
});

function buildPrompt(listing: {
  address: string;
  city: string;
  province: string;
  price: number;
  beds: string;
  baths: string;
  sqft: string;
  yearBuilt: string;
  taxes: string;
  description: string;
  dom: number;
}, signals: string[], offer: { anchorTag: string; anchorType: string; domTag: string; domMultiplier: number; signalTags: string[]; finalOffer: number; percentOfList: number; savings: number; anchor: number } | null) {
  const sqft = listing.sqft ? `${listing.sqft} sqft` : "sqft unknown";
  const year = listing.yearBuilt ? `built ${listing.yearBuilt}` : "year unknown";
  const taxes = listing.taxes ? `$${listing.taxes}/yr taxes` : "taxes unknown";
  const profile = `${listing.beds} bed / ${listing.baths} bath, ${sqft}, ${year}, ${taxes}`;
  const priceSqft = listing.sqft && parseInt(listing.sqft) > 0
    ? `$${Math.round(listing.price / parseInt(listing.sqft))}/sqft`
    : "price/sqft unknown";

  const assessmentBlock = "Assessment: Not available — using language-based offer model (higher uncertainty)";

  let offerBlock = "Offer: Not computed";
  if (offer) {
    offerBlock = `Offer model: ${offer.anchorType === "assessment" ? "Assessment-anchored" : "Language-based"}
  Anchor: ${fmt(offer.anchor)} (${offer.anchorTag})
  DOM bracket: ${offer.domTag} (×${offer.domMultiplier})
  Signal adjustments: ${offer.signalTags.length > 0 ? offer.signalTags.join(", ") : "none"}
  Final offer: ${fmt(offer.finalOffer)} (${(offer.percentOfList * 100).toFixed(1)}% of list)
  Savings: ${fmt(offer.savings)}`;
  }

  const systemPrompt = `You are a real estate acquisition analyst writing property assessments for an investor. You produce two outputs:

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
{"signals": ["signal1"], "confidence": 0.0, "narrative": "Your 4-6 sentence assessment..."}`;

  const userPrompt = `Property: ${listing.address}, ${listing.city}, ${listing.province}
List price: ${fmt(listing.price)}
Profile: ${profile}
Price per sqft: ${priceSqft}
${assessmentBlock}
${offerBlock}
Detected signals: ${signals.length > 0 ? signals.join(", ") : "none"}

Description:
${listing.description || "(No description available)"}`;

  return { systemPrompt, userPrompt };
}

async function runModel(model: string, systemPrompt: string, userPrompt: string): Promise<{
  model: string;
  narrative: string;
  signals: string[];
  confidence: number;
  latencyMs: number;
  error?: string;
}> {
  const start = Date.now();
  try {
    const response = await openrouter.chat.completions.create({
      model,
      max_tokens: 500,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const text = response.choices[0]?.message?.content?.trim() || "";
    const latencyMs = Date.now() - start;

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { model, narrative: text, signals: [], confidence: 0, latencyMs, error: "No JSON found in response" };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      model,
      narrative: typeof parsed.narrative === "string" ? parsed.narrative : "",
      signals: Array.isArray(parsed.signals) ? parsed.signals : [],
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
      latencyMs,
    };
  } catch (err) {
    return {
      model,
      narrative: "",
      signals: [],
      confidence: 0,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main() {
  console.log("Loading listing from KV...\n");

  const all = await getAllListings();
  const listing = all.find((l) => l.address.includes(TARGET_ADDRESS));

  if (!listing) {
    console.error(`Listing "${TARGET_ADDRESS}" not found in KV. Available listings: ${all.length}`);
    console.log("Searching for similar...");
    const matches = all.filter((l) => l.city.toLowerCase().includes("kelowna"));
    if (matches.length > 0) {
      console.log("Found Kelowna listings:", matches.map((m) => m.address));
    }
    process.exit(1);
  }

  console.log(`Found: ${listing.address}, ${listing.city}, ${listing.province}`);
  console.log(`Price: ${fmt(listing.price)} | ${listing.beds}bd/${listing.baths}ba | DOM: ${listing.dom}`);
  console.log(`Description: ${listing.description?.slice(0, 100)}...\n`);

  // Build context
  const score = scoreV2(listing);
  const offer = offerModelLanguage(listing);
  const signals = getSignals(listing);

  console.log(`Score: ${score.total} (${score.tier}) | Signals: ${signals.join(", ") || "none"}`);
  if (offer) {
    console.log(`Offer: ${fmt(offer.finalOffer)} (${(offer.percentOfList * 100).toFixed(1)}% of list)\n`);
  }

  const { systemPrompt, userPrompt } = buildPrompt(listing, signals, offer);

  console.log("=".repeat(80));
  console.log("Running all models in parallel...\n");

  const results = await Promise.all(
    MODELS.map((model) => runModel(model, systemPrompt, userPrompt))
  );

  for (const r of results) {
    console.log("=".repeat(80));
    console.log(`MODEL: ${r.model}`);
    console.log(`Latency: ${(r.latencyMs / 1000).toFixed(1)}s`);
    if (r.error) {
      console.log(`ERROR: ${r.error}`);
    }
    if (r.signals.length > 0) {
      console.log(`Signals: ${r.signals.join("; ")}`);
    }
    console.log(`Confidence: ${r.confidence}`);
    console.log(`\nNARRATIVE:\n${r.narrative}\n`);
  }

  console.log("=".repeat(80));
  console.log("SUMMARY");
  console.log("=".repeat(80));
  console.log(
    results
      .map((r) => `${r.model.padEnd(42)} ${(r.latencyMs / 1000).toFixed(1).padStart(5)}s  ${r.error ? "ERROR" : r.narrative.length + " chars"}`)
      .join("\n")
  );
}

main().catch(console.error);
