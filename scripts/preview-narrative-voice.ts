/**
 * scripts/preview-narrative-voice.ts
 *
 * DESIGN-ONLY scratch script for docs/plans/11-NARRATIVE-VOICE-GUIDE.md.
 * Does NOT touch src/ — src/lib/pipeline/us-narrative.ts's SYSTEM_PROMPT is
 * a concurrent edit target owned by another agent. This script duplicates
 * (does not import) that file's prompt-input block builders so it can run
 * a *candidate* replacement system prompt (SYSTEM_PROMPT_V2 below) against
 * real KV data without editing anything the implementer will later touch.
 *
 * What it does:
 *   1. Pulls 5 hand-picked real US listings out of KV (listings:all) that
 *      already went through the current pipeline (analyzeSeedListing /
 *      the RentCast-enriched path), so preNarrative, preOffer,
 *      preUsAdvantage, preUsComparables, preAnchorDecision are all real,
 *      persisted output — not recomputed.
 *   2. Reconstructs the UsNarrativeContext each one was originally built
 *      from (see src/lib/pipeline/us-narrative.ts's UsNarrativeContext) by
 *      mapping the persisted PrecomputedOffer back to an OfferResult shape.
 *      marketPanel is intentionally omitted (null) — it only feeds one
 *      minor "County context" line and reconstructing it needs a live
 *      Neon county lookup this scratch script doesn't wire up; every other
 *      block is preserved exactly.
 *   3. "OLD" narrative = the listing's stored preNarrative (the real
 *      current-prompt output already sitting in KV — no re-call needed).
 *   4. "NEW" narrative = one live OpenRouter call per listing using
 *      SYSTEM_PROMPT_V2 against the same reconstructed context.
 *   5. Prints old vs new side by side to stdout for pasting into the guide.
 *
 * Usage: npx tsx scripts/preview-narrative-voice.ts
 * Requires OPENROUTER_API_KEY + KV_REST_API_URL/TOKEN in .env.local.
 */

import { readFileSync } from "fs";
const envContent = readFileSync(".env.local", "utf-8");
for (const line of envContent.split("\n")) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, "");
}

import OpenAI from "openai";
import { getAllListings } from "../src/lib/kv/listings";
import type { Assessment, Listing, OfferResult, AnchorPlausibility } from "../src/lib/types";
import type { UsCompSupport } from "../src/lib/pipeline/us-assess";
import type { UsAdvantageBundle } from "../src/lib/pipeline/us-advantage";
import type { CountyMarketPanel } from "../src/lib/db/regional-econ";
import { fmt } from "../src/lib/utils";

// ---------------------------------------------------------------------------
// The 5 hand-picked listings — see docs/plans/11-NARRATIVE-VOICE-GUIDE.md
// section 7 for why each was chosen.
// ---------------------------------------------------------------------------

const SELECTED: { label: string; addressFragment: string }[] = [
  { label: "1. WILD-DELTA (the owner's flagged example)", addressFragment: "19731 Ne 24th Ave" },
  { label: "2. NORMAL assessment-anchored SFH (tight triangulation)", addressFragment: "11853 Gaelic Dr" },
  { label: "3. LANGUAGE-anchored, no assessment on file", addressFragment: "2124 Burton Dr" },
  { label: "4. HOT, high structural-signal stack", addressFragment: "8922 Menchaca Rd" },
  { label: "5. WATCH, quiet — but carries a long-tenure equity story", addressFragment: "8429 W Vernon Ave" },
];

// ---------------------------------------------------------------------------
// OfferResult reconstruction from the persisted PrecomputedOffer. Two fields
// (anchorType, inTargetRange) aren't in PrecomputedOffer's shape — anchorType
// is inferred from whether an assessment was actually used (mirrors
// analyzeSeedListing's own anchorType return), inTargetRange is never read
// by buildOfferBlock so a placeholder is harmless.
// ---------------------------------------------------------------------------

function reconstructOffer(listing: Listing, usedAssessmentAnchor: boolean): OfferResult | null {
  const po = listing.preOffer;
  if (!po) return null;
  return {
    anchor: po.anchor,
    anchorTag: po.anchor_tag,
    anchorType: usedAssessmentAnchor ? "assessment" : "language",
    listToAssessedRatio: po.ratio,
    domAdjusted: po.dom_adjusted,
    domMultiplier: po.dom_mult,
    domTag: po.dom_tag,
    signalAdjusted: po.signal_adjusted,
    signalTags: po.signal_tags,
    finalOffer: po.final_offer,
    percentOfList: po.pct_of_list,
    savings: po.savings,
    inTargetRange: true,
  };
}

// ---------------------------------------------------------------------------
// Prompt input block builders — duplicated (not imported) from
// src/lib/pipeline/us-narrative.ts, byte-for-byte, so the user-message
// content fed to the candidate prompt is identical to production. If you're
// reading this after the real file changed, these may drift — that's fine,
// this script is a one-shot preview tool, not a maintained integration.
// ---------------------------------------------------------------------------

function buildAssessmentBlock(assessment: Assessment | null): string {
  if (!assessment || !assessment.found) {
    return "Tax-assessed value: Not available for this address.";
  }
  const sourceLabel =
    assessment.source === "avm"
      ? "RentCast AVM estimate (modeled, not government-verified)"
      : "county tax assessment (government)";
  let block = `Tax/assessed value (${assessment.assessmentYear}, ${sourceLabel}): ${fmt(assessment.totalValue)}`;
  if (assessment.landValue > 0 && assessment.buildingValue > 0) {
    block += ` (land ${fmt(assessment.landValue)}, building ${fmt(assessment.buildingValue)})`;
  }
  if (assessment.assessmentBasis === "acquisition_value") {
    block += `\nNOTE: This state assesses on acquisition value (purchase price + a small annual cap), not market value — expect it to lag market price by design.`;
  }
  return block;
}

function buildOfferBlock(offer: OfferResult | null): string {
  if (!offer) return "Offer: Not computed.";
  return `Offer model: ${offer.anchorType === "assessment" ? "Assessment-anchored" : "Language-based"}
  Anchor: ${fmt(offer.anchor)} (${offer.anchorTag})
  DOM bracket: ${offer.domTag} (×${offer.domMultiplier})
  Signal adjustments: ${offer.signalTags.length > 0 ? offer.signalTags.join(", ") : "none"}
  Final offer: ${fmt(offer.finalOffer)} (${(offer.percentOfList * 100).toFixed(1)}% of list)
  Savings: ${fmt(offer.savings)}`;
}

function buildTriangulationBlock(triangulation: UsAdvantageBundle["triangulation"]): string {
  if (triangulation.anchors.length === 0) {
    return "Valuation triangulation: No anchors available for this address.";
  }
  const lines = [
    `Valuation triangulation (${triangulation.confidence} confidence, ${triangulation.anchors.length} independent anchors):`,
  ];
  for (const a of triangulation.anchors) {
    lines.push(`  ${a.label}: ${fmt(a.value)}`);
  }
  if (triangulation.triangulatedValue != null) {
    lines.push(`  Triangulated (median) value: ${fmt(triangulation.triangulatedValue)}`);
  }
  if (triangulation.spreadPct != null) {
    lines.push(`  Spread across anchors: ${(triangulation.spreadPct * 100).toFixed(1)}%`);
  }
  lines.push(`  Read: ${triangulation.agreementNote}`);
  return lines.join("\n");
}

function buildEquityBlock(equitySignal: UsAdvantageBundle["equitySignal"]): string {
  if (!equitySignal) {
    return "Seller equity/tenure: No prior sale on record for this address — hold length and equity position can't be estimated.";
  }
  const lines = [
    `Seller equity/tenure (tier: ${equitySignal.label}):`,
    `  Last sale: ${fmt(equitySignal.lastSalePrice)} on ${equitySignal.lastSaleDate} (${equitySignal.holdYears.toFixed(1)}yr hold)`,
    `  Current ${equitySignal.currentValueKind === "asking" ? "asking price" : "AVM estimate"}: ${fmt(equitySignal.currentValueEstimate)}`,
    `  Implied change since purchase: ${equitySignal.impliedAppreciationPct >= 0 ? "+" : ""}${(equitySignal.impliedAppreciationPct * 100).toFixed(1)}% ` +
      `(a PROXY only — does not net out any mortgage balance or paydown)`,
    `  County HPI corroboration: ${equitySignal.hpiCorroboration.replace(/_/g, " ")}${equitySignal.hpiImpliedValue != null ? ` (HPI-projected value: ${fmt(equitySignal.hpiImpliedValue)})` : ""}`,
    `  Motivation strength: ${equitySignal.motivationStrength}`,
  ];
  return lines.join("\n");
}

function buildInvestorYieldBlock(investorYield: UsAdvantageBundle["investorYield"]): string {
  if (!investorYield) return "Investor yield: No rent estimate available for this address.";
  return `Investor yield: gross yield ${(investorYield.grossYieldPct * 100).toFixed(1)}%, rent/price ${(investorYield.rentToPriceRatio * 100).toFixed(2)}%, ${investorYield.onePercentRuleMet ? "meets" : "below"} the 1% rule.${investorYield.fmr2brDeltaPct != null ? ` Rent is ${investorYield.fmr2brDeltaPct >= 0 ? "+" : ""}${(investorYield.fmr2brDeltaPct * 100).toFixed(0)}% vs. county 2BR Fair Market Rent.` : ""}`;
}

function buildRiskMomentumBlock(riskMomentum: UsAdvantageBundle["riskMomentum"]): string {
  return `County risk/momentum: ${riskMomentum.note}`;
}

function buildOverAssessmentBlock(overAssessment: UsAdvantageBundle["overAssessment"]): string {
  if (!overAssessment.triggered || !overAssessment.note) return "";
  return `Over-assessment flag: ${overAssessment.note}`;
}

function buildAnchorDecisionBlock(anchorDecision: AnchorPlausibility | undefined): string {
  if (!anchorDecision || !anchorDecision.reason) return "";
  const verdictLabel =
    anchorDecision.verdict === "context_only" ? "DEMOTED (context only, not used as offer anchor)" : "CONFIRMED (still the anchor)";
  return `ANCHOR STATUS: ${verdictLabel} — reason: ${anchorDecision.reason}. ${anchorDecision.note}
INSTRUCTION: Explain this anchor decision in exactly one sentence somewhere in the narrative — why the offer anchors where it does given this finding. Do not treat it as a footnote; it changes what the offer is defensible on.`;
}

function buildComparablesBlock(comparables: UsCompSupport): string {
  if (comparables.confidence === "none" || comparables.comparables.length === 0) {
    return "Comparables: No usable AVM comparables for this address.";
  }
  const lines = [`Comparables (${comparables.confidence} confidence, RentCast AVM — valuation inputs, not confirmed sold transactions):`];
  lines.push(`  ${comparables.marketNote}`);
  if (comparables.dataGaps.length > 0) lines.push(`  Data gaps: ${comparables.dataGaps.join(", ")}`);
  return lines.join("\n");
}

function buildMarketPanelBlock(marketPanel: CountyMarketPanel | null): string {
  if (!marketPanel) return "County context: Not available.";
  const parts: string[] = [];
  if (marketPanel.medianGrossRent != null) parts.push(`median gross rent ${fmt(marketPanel.medianGrossRent)}/mo`);
  if (marketPanel.medianHouseholdIncome != null) parts.push(`median household income ${fmt(marketPanel.medianHouseholdIncome)}`);
  if (marketPanel.vacancyRate != null) parts.push(`vacancy rate ${(marketPanel.vacancyRate * 100).toFixed(1)}%`);
  if (parts.length === 0) return "County context: No usable figures for this county.";
  return `County context: ${parts.join(", ")}.`;
}

interface Ctx {
  listing: Listing;
  assessment: Assessment | null;
  offer: OfferResult | null;
  signals: string[];
  comparables: UsCompSupport;
  advantage: UsAdvantageBundle;
  marketPanel: CountyMarketPanel | null;
  anchorDecision?: AnchorPlausibility;
}

function buildUserMessage(context: Ctx): string {
  const { listing, assessment, offer, signals, comparables, advantage, marketPanel, anchorDecision } = context;

  const sqft = listing.sqft ? `${listing.sqft} sqft` : "sqft unknown";
  const year = listing.yearBuilt ? `built ${listing.yearBuilt}` : "year unknown";
  const taxes = listing.taxes ? `$${listing.taxes}/yr taxes` : "taxes unknown";
  const priceSqft =
    listing.sqft && parseInt(listing.sqft) > 0 ? `$${Math.round(listing.price / parseInt(listing.sqft))}/sqft` : "price/sqft unknown";

  const overAssessmentBlock = buildOverAssessmentBlock(advantage.overAssessment);
  const anchorDecisionBlock = buildAnchorDecisionBlock(anchorDecision);

  return `Property: ${listing.address}, ${listing.city}, ${listing.province}
Asking price: ${fmt(listing.price)}
Profile: ${listing.beds} bed / ${listing.baths} bath, ${sqft}, ${year}, ${taxes}
Price per sqft: ${priceSqft}
Days on market: ${listing.dom ?? 0}

${buildAssessmentBlock(assessment)}
${anchorDecisionBlock ? "\n" + anchorDecisionBlock + "\n" : ""}
${buildTriangulationBlock(advantage.triangulation)}

${buildEquityBlock(advantage.equitySignal)}

${buildInvestorYieldBlock(advantage.investorYield)}

${buildRiskMomentumBlock(advantage.riskMomentum)}
${overAssessmentBlock ? "\n" + overAssessmentBlock + "\n" : ""}
${buildOfferBlock(offer)}

${buildComparablesBlock(comparables)}

${buildMarketPanelBlock(marketPanel)}

Detected structural signals: ${signals.length > 0 ? signals.join(", ") : "none"}`;
}

// ---------------------------------------------------------------------------
// CANDIDATE system prompt — see docs/plans/11-NARRATIVE-VOICE-GUIDE.md
// section 5 for the version intended to actually replace
// src/lib/pipeline/us-narrative.ts's SYSTEM_PROMPT. Kept in sync by hand;
// this is the exact text this script sends to OpenRouter.
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT_V2 = `You are a sharp, experienced buyer's agent talking to a client about a specific property. You've already been through the numbers — the client hasn't. Your job is to tell them what the numbers MEAN, in plain spoken language, not to read the numbers back to them. You sound like someone who has walked a hundred buyers through a hundred deals: plain-spoken, confident, occasionally wry. Not a valuation model narrating its own inputs.

You produce two outputs:

1. SIGNALS: Additional motivation or leverage signals detected by connecting the structured data points below in ways a threshold-based system would miss (e.g. an equity/tenure tier combining with an over-assessment flag, a triangulation spread that undercuts the asking price, elevated risk/peril scores compounding a soft market read). Only surface signals that are genuinely implied by the data provided — do not invent transaction detail, condition detail, or seller motivation that isn't backed by a specific number in the input.

2. NARRATIVE: 2-3 short paragraphs, talking directly to the buyer about this property as a trade opportunity, in the voice described above.

This property has NO MLS listing remarks available (RentCast's free tier doesn't return them) — do not reference "the description" or invent language-based motivation. Instead, this input is richer than a typical listing in a different way: multiple independent valuation anchors (tax-assessed, AVM, asking, comp $/sqft) instead of the usual two, real sale-history-derived equity/tenure data, an investor yield read, and county-level risk/momentum context.

NARRATIVE — TALKING TO THE BUYER:
Write 2-3 SHORT paragraphs separated by a blank line (\\n\\n), 2-3 sentences each. Don't lock the first sentence to a fixed template ("the valuation triangulation reveals...") — open with whatever's actually the most interesting or unusual thing about this property. Sometimes that's the price gap, sometimes it's how long it's sat, sometimes it's the seller's history. Lead with the story, not the methodology.

Roughly, across the paragraphs:
- THE STORY: What's actually going on with this property — what's the most telling thing about it? If the valuation anchors agree, that's worth a sentence, not a headline; if they disagree, say so plainly and point to what to trust instead (usually days on market). Interpret the spread — don't recite it.
- THE SELLER'S POSITION: What does the evidence say about the seller's situation? This is where hold length, implied appreciation (a rough proxy, said as such — not a net-equity claim), and whether it tracks the county's own price trend belong, when that data exists. A short hold with a markup, or a sale below what they paid, is a real motivation signal — stronger than any adjective. A long, comfortable hold reads as room to negotiate, not desperation. If there's no sale history on file, say so plainly and lean on days-on-market and how well the anchors agree instead.
- THE OFFER: Is this worth pursuing, and why. Say it plainly. Point to the one or two things that actually justify the number — the anchor used, the time it's been sitting, the equity story if there is one. The buyer should walk away knowing exactly why this number and not some other number, and feel like the position is one they could defend to the seller's agent in the room. State the number and stop — nobody in this conversation has objected to it, so don't rebut an objection that was never raised ("this isn't X", "we aren't Y-ing them") — that framing drags in exactly the language this document tells you to avoid. Just say what the number is and why.

NUMBER DISCIPLINE — this is the part that most needs to change from how you've been writing:
- Use at most 4-5 numbers in the whole narrative. Every other one gets pruned or replaced with plain language.
- Round conversationally: "$928,234" becomes "about $930K" or "just under a million"; "109 days" becomes "just over three months"; "$389,000" becomes "about $390K" or just "the asking price" on second reference. Never carry a number to the decimal or the exact dollar unless the client would actually care about that precision (they generally don't).
- Turn percentages into comparisons, not figures: "88.3% disagreement" becomes "the tax office thinks this is worth about a third of what they're asking" or "less than half of asking"; "5.8% spread" becomes "within a few percent of each other." Only use a bare percentage when a plain-language version would actually be less clear.
- Every number you do use is still in service of a point — attach it to what it MEANS in the same breath, don't drop it and move on. A number sitting alone in a sentence with no implication attached is a sign to cut it.
- Rounding is not fabrication: "about $930K" for an input of $928,234 is fine. Inventing a number that isn't in the input, in any form, rounded or not, is never fine — see the fabrication rule below.

CREATIVE LATITUDE, BOUNDED:
- Plain color and a dry or wry aside are welcome. At most ONE metaphor, comparison, or turn of phrase per narrative — if you've already used one, the rest of the narrative should be direct.
- No hype. No fear-mongering. No stacked salesy adjectives working to talk the buyer into anything.
- When data is missing, say so in the same plain voice you'd use for anything else — "there's no sales history on file, so I can't tell you what the seller paid" — not a hedge, not an apology, just a fact stated the way you'd state any other fact.

WHO YOU WORK FOR:
You work for the buyer. The deal is won on the buy side. Every dollar below list is equity on day one. Give the buyer confidence and clarity, backed by evidence — not by volume.

NEVER DO THESE:
- NEVER use the words "insulting", "lowball", "offensive", "too aggressive", or "risks appearing," in any form, affirmed or denied. These are seller-protection words and have no place in acquisition analysis, whether you're applying them or waving them off. An offer backed by valuation data, market duration, and transaction history is not aggressive — it is the current market position supported by evidence.
- NEVER evaluate an offer through the lens of the seller's emotional reaction. We don't care if the seller is offended. We care if the numbers are defensible.
- NEVER treat the asking price as ground truth. The asking price is the seller's opening position. Our model produces the current market offer based on what the data says right now.
- NEVER use time-sensitive freshness language: "just listed", "fresh to market", "newly listed", "0 DOM", "only X days" for listings under 60 days.
- DOM below 60 tells you NOTHING about motivation — do not reference it.
- DOM at 60+ IS a pressure indicator — reference the bracket tag and what it means for the seller's position.
- NEVER hedge with "this might not work" or "the seller may not accept." Of course the seller might counter — that's how negotiation works. Present the position with conviction.
- NEVER fabricate a number. Every number in your narrative must trace directly to a value given in the input below (rounded conversationally is fine — invented is not). When data is missing, acknowledge the gap and what it means for confidence — don't invent a figure to fill it.
- NEVER invent tenure, sale-history, or equity detail beyond what the Seller equity/tenure block below actually states. When that block says no prior sale is on record, say plainly that there's no sales history to work from — never imply a purchase price, hold length, or equity position that isn't in the data.
- No exclamation marks. No hype, no fear-mongering, no stacked salesy adjectives. Plain color and one small metaphor are fine (see CREATIVE LATITUDE above) — a sales pitch is not.
- Separate paragraphs with a blank line (\\n\\n). Do NOT write a wall of text.

Return ONLY valid JSON:
{"signals": ["signal1"], "confidence": 0.0, "narrative": "Paragraph one.\\n\\nParagraph two.\\n\\nParagraph three."}`;

// ---------------------------------------------------------------------------
// OpenRouter call
// ---------------------------------------------------------------------------

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

const MODEL = "qwen/qwen3.7-flash";

async function callNewPrompt(userMessage: string): Promise<{ narrative: string; signals: string[]; confidence: number; error?: string }> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT_V2 },
    { role: "user", content: userMessage },
  ];

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await openrouter().chat.completions.create({
        model: MODEL,
        max_tokens: 1024,
        messages,
        // @ts-expect-error OpenRouter extension not in the OpenAI SDK types
        reasoning: { enabled: false },
      });
      const text = response.choices[0]?.message?.content?.trim() || "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error(`No JSON in response: ${text.slice(0, 200)}`);
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        narrative: typeof parsed.narrative === "string" ? parsed.narrative : "",
        signals: Array.isArray(parsed.signals) ? parsed.signals : [],
        confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
      };
    } catch (err) {
      if (attempt === 2) {
        return { narrative: "", signals: [], confidence: 0, error: err instanceof Error ? err.message : String(err) };
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  return { narrative: "", signals: [], confidence: 0, error: "unreachable" };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error("OPENROUTER_API_KEY not set in .env.local — aborting.");
    process.exit(1);
  }

  console.log("Loading listings from KV...\n");
  const all = await getAllListings();

  for (const { label, addressFragment } of SELECTED) {
    const listing = all.find((l) => l.address.includes(addressFragment));
    if (!listing) {
      console.log(`\n${"=".repeat(90)}\n${label}\nNOT FOUND: ${addressFragment}\n`);
      continue;
    }

    const assessment: Assessment | null = listing.preAssessment?.found ? listing.preAssessment : null;
    const usedAssessmentAnchor = !!assessment && listing.preOffer?.anchor_tag !== undefined && listing.preOffer.ratio !== 0;
    const offer = reconstructOffer(listing, usedAssessmentAnchor);
    const advantage = listing.preUsAdvantage;
    const comparables: UsCompSupport =
      listing.preUsComparables ?? {
        source: "rentcast_avm",
        comparables: [],
        medianPricePerSqft: null,
        impliedValue: null,
        confidence: "none",
        marketNote: "No comparable data returned by RentCast's AVM for this address.",
        dataGaps: ["No AVM comparables available"],
      };

    if (!advantage) {
      console.log(`\n${"=".repeat(90)}\n${label}\nSKIPPED (no preUsAdvantage bundle): ${listing.address}\n`);
      continue;
    }

    const context: Ctx = {
      listing,
      assessment,
      offer,
      signals: listing.preSignals ?? [],
      comparables,
      advantage,
      marketPanel: null,
      anchorDecision: listing.preAnchorDecision,
    };

    const userMessage = buildUserMessage(context);

    console.log(`\n${"=".repeat(90)}`);
    console.log(label);
    console.log(`${listing.address}, ${listing.city}, ${listing.province} — ${fmt(listing.price)}, DOM ${listing.dom}, tier ${listing.preTier}`);
    console.log("=".repeat(90));

    console.log("\n--- OLD (current prompt, as persisted in KV) ---\n");
    console.log(listing.preNarrative || "(none persisted)");

    console.log("\n--- NEW (candidate voice prompt, live call) ---\n");
    const result = await callNewPrompt(userMessage);
    if (result.error) {
      console.log(`ERROR: ${result.error}`);
    } else {
      console.log(result.narrative);
      console.log(`\n[confidence: ${result.confidence}, signals: ${result.signals.join("; ") || "none"}]`);
    }
  }

  console.log(`\n${"=".repeat(90)}\nDone.\n`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
