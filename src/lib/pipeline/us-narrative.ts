/**
 * pipeline/us-narrative.ts
 *
 * "THE SIGNAL" narrative for US listed properties — the US analogue of
 * src/lib/llm.ts's analyzeAndNarrate(). Canadian listed properties get a
 * 2-3 paragraph LLM-written analytical brief on /property/[slug]; the US
 * listed flow (POST /api/assess, src/app/api/assess/route.ts's
 * handleUSAssessment) computed the full offer cascade and the US Advantage
 * layer (src/lib/pipeline/us-advantage.ts) but never turned any of it into
 * prose. This module closes that gap.
 *
 * Why a separate prompt instead of reusing analyzeAndNarrate() directly:
 * the CA prompt is built around Zoocasa MLS remarks text (a `description`
 * field to mine for motivation keywords) and a 2-anchor offer model
 * (assessment + asking). RentCast's free tier returns no MLS remarks at all
 * (see us-assess.ts's module doc), so `listing.description` is always empty
 * for US listings — the CA prompt's SIGNAL DETECTION section and half its
 * NARRATIVE framing would be asking the model to read text that doesn't
 * exist. What the US pipeline has INSTEAD, and CA structurally cannot, is
 * richer: 3-4-anchor valuation triangulation with an explicit spread/
 * confidence read, a seller equity/tenure signal derived from real
 * transaction history (hold years + implied appreciation, corroborated
 * against county HPI), an investor yield read, county risk/momentum
 * context, and an over-assessment flag. This prompt is built around THAT
 * data instead — same analytical voice and the same hard constraints as
 * the CA prompt (banned language, no fabricated numbers, no seller-emotion
 * framing), copied verbatim from llm.ts where they apply.
 *
 * Model/config, JSON-parse + retry-once + graceful-null pattern, and the
 * deterministic-fallback convention all mirror llm.ts's analyzeAndNarrate()/
 * deterministicNarrative() 1:1 — see that file's comments for the reasoning
 * behind each (qwen3.7-flash defaults to reasoning-on via OpenRouter, which
 * burns max_tokens on hidden chain-of-thought unless explicitly disabled;
 * a single retry absorbs transient truncation/malformed-JSON failures; a
 * graceful `{signals: [], confidence: 0, narrative: ""}` on total failure
 * lets the caller fall back to deterministicUsNarrative() rather than
 * rendering an empty "THE SIGNAL" section).
 *
 * Additional time-box: the US route (maxDuration 60s) already spends time
 * on geocoding + RentCast + county panel lookups before this ever runs, so
 * generateUsNarrative() races the LLM call against a ~12s timeout on top of
 * llm.ts's own retry logic — a hung/slow OpenRouter call can't eat the rest
 * of the route's budget. Timing out is treated exactly like any other LLM
 * failure: graceful null, caller falls back to the deterministic template.
 */

import OpenAI from "openai";
import type { Assessment, Listing, OfferResult } from "../types";
import type { UsCompSupport } from "./us-assess";
import type { UsAdvantageBundle } from "./us-advantage";
import type { CountyMarketPanel } from "../db/regional-econ";
import { fmt, pct } from "../utils";

// ---------------------------------------------------------------------------
// OpenRouter client — mirrors llm.ts's openrouter() helper (not exported
// there, so mirrored rather than imported; same lazy-singleton shape).
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

export interface UsLLMAnalysis {
  signals: string[];
  confidence: number;
  narrative: string;
}

/** Everything the narrative (LLM or deterministic) needs — the offer/score
 * inputs shared with CA, plus the full US Advantage bundle and county panel
 * that have no CA equivalent. */
export interface UsNarrativeContext {
  listing: Listing;
  assessment: Assessment | null;
  offer: OfferResult | null;
  /** Structural signals already detected (DOM bracket, price-reduced,
   * building-age, equity/tenure chip label) — see route.ts's `signals`
   * array in handleUSAssessment's listed branch. */
  signals: string[];
  comparables: UsCompSupport;
  advantage: UsAdvantageBundle;
  marketPanel: CountyMarketPanel | null;
}

// ---------------------------------------------------------------------------
// Deterministic fallback (mirrors llm.ts's deterministicNarrative tone —
// short, hedged, numbers-only, no LLM flourish) — used when the LLM call
// fails, times out, or OPENROUTER_API_KEY isn't set, so "THE SIGNAL" never
// renders empty.
// ---------------------------------------------------------------------------

export function deterministicUsNarrative(context: UsNarrativeContext): string {
  const { listing, offer, advantage } = context;
  const { triangulation, equitySignal, overAssessment } = advantage;
  const addr = listing.address;

  const parts: string[] = [];
  parts.push(`${addr} — listed at ${fmt(listing.price)} in ${listing.city}, ${listing.province}.`);

  if (triangulation.triangulatedValue != null) {
    parts.push(
      `Triangulated value ${fmt(triangulation.triangulatedValue)} from ${triangulation.anchors.length} anchor` +
        `${triangulation.anchors.length === 1 ? "" : "s"} (${triangulation.anchors.map((a) => a.label).join(", ")}). ` +
        `${triangulation.agreementNote}`
    );
  }

  if (equitySignal && equitySignal.tier !== "moderate_hold") {
    parts.push(equitySignal.narrative);
  }

  if (listing.dom >= 60) {
    parts.push(`On market ${listing.dom} days — a pressure indicator at this length.`);
  }

  if (offer) {
    parts.push(
      `Offer modeled at ${fmt(offer.finalOffer)} (${pct(offer.percentOfList)} of list, save ${fmt(offer.savings)}), ` +
        `anchored to ${offer.anchorTag}.`
    );
  }

  if (overAssessment.triggered && overAssessment.note) {
    parts.push(overAssessment.note);
  }

  parts.push(
    "RentCast doesn't provide MLS remarks for this address, so this read leans on transaction history, " +
      "valuation triangulation, and county context rather than listing language."
  );

  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Prompt input blocks
// ---------------------------------------------------------------------------

function buildAssessmentBlock(assessment: Assessment | null): string {
  if (!assessment || !assessment.found) {
    return "Tax-assessed value: Not available for this address.";
  }
  const sourceLabel = assessment.source === "avm" ? "RentCast AVM estimate (modeled, not government-verified)" : "county tax assessment (government)";
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

// ---------------------------------------------------------------------------
// System prompt — same voice, same hard constraints as llm.ts's
// analyzeAndNarrate(), built around the US Advantage data instead of MLS
// remarks text (see module doc for why).
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a buyer's acquisition analyst. You work for the buyer. Your job is to arm them with data-backed conviction so they can make the sharpest possible offer on a property.

You produce two outputs:

1. SIGNALS: Additional motivation or leverage signals detected by connecting the structured data points below in ways a threshold-based system would miss (e.g. an equity/tenure tier combining with an over-assessment flag, a triangulation spread that undercuts the asking price, elevated risk/peril scores compounding a soft market read). Only surface signals that are genuinely implied by the data provided — do not invent transaction detail, condition detail, or seller motivation that isn't backed by a specific number in the input.

2. NARRATIVE: A 2-3 paragraph analytical brief on this property as a trade opportunity.

This property has NO MLS listing remarks available (RentCast's free tier doesn't return them) — do not reference "the description" or invent language-based motivation. Instead, this input is richer than a typical listing in a different way: multiple independent valuation anchors (tax-assessed, AVM, asking, comp $/sqft) instead of the usual two, real sale-history-derived equity/tenure data, an investor yield read, and county-level risk/momentum context.

NARRATIVE — THE BUYER'S BRIEF:
Write 2-3 SHORT paragraphs separated by blank lines (\\n\\n). Each paragraph should be 2-3 sentences max.

PARAGRAPH 1 — THE NUMBERS: What does the valuation triangulation tell us? If multiple independent anchors (tax-assessed, AVM, asking, comp $/sqft) agree tightly, that's a high-confidence read the buyer can lean on; if they disagree widely, say so plainly and note that DOM/equity signals should carry more weight instead. Reference the DOM bracket and comps where they add real evidence. Don't recite every number — interpret what the spread and the anchors actually mean for negotiating room.

PARAGRAPH 2 — THE READ: This is where the seller equity/tenure story belongs when one is present — hold years, implied appreciation (disclosed as a proxy, not a net-equity figure), and whether it's corroborated by or diverges from the county's own HPI trend. A loss-sale or short-hold-flip tier is a structural motivation signal, stronger than any keyword; a long-tenure high-equity tier reads as negotiating room without desperation. Weave in the over-assessment flag and county risk/momentum context if they add to the read. If there's no equity/tenure data (no sale history on file), say so honestly and lean on DOM and triangulation confidence instead.

PARAGRAPH 3 — THE POSITION: Is this a good trade? State it clearly. Cite the specific data that justifies the offer: the anchor used, the DOM bracket, the triangulation confidence, the equity/tenure tier if present. The buyer should walk away knowing exactly why the number is what it is. Frame the offer as a defensible market position, not a gamble.

WHO YOU WORK FOR:
You work for the buyer. The deal is won on the buy side. Every dollar below list is equity on day one. Your narrative should give the buyer confidence and clarity, backed by evidence.

NEVER DO THESE:
- NEVER use the words "insulting", "lowball", "offensive", "too aggressive", or "risks appearing." These are seller-protection words and have no place in acquisition analysis. An offer backed by valuation data, market duration, and transaction history is not aggressive — it is the current market position supported by evidence.
- NEVER evaluate an offer through the lens of the seller's emotional reaction. We don't care if the seller is offended. We care if the numbers are defensible.
- NEVER treat the asking price as ground truth. The asking price is the seller's opening position. Our model produces the current market offer based on what the data says right now.
- NEVER use time-sensitive freshness language: "just listed", "fresh to market", "newly listed", "0 DOM", "only X days" for listings under 60 days.
- DOM below 60 tells you NOTHING about motivation — do not reference it.
- DOM at 60+ IS a pressure indicator — reference the bracket tag and what it means for the seller's position.
- NEVER hedge with "this might not work" or "the seller may not accept." Of course the seller might counter — that's how negotiation works. Present the position with conviction.
- NEVER fabricate a number. Every number in your narrative must trace directly to a value given in the input below. When data is missing, acknowledge the gap and what it means for confidence — don't invent a figure to fill it.
- No sales language. No exclamation marks. No emotion. Write with influence, clarity, and conviction.
- Separate paragraphs with a blank line (\\n\\n). Do NOT write a wall of text.

Return ONLY valid JSON:
{"signals": ["signal1"], "confidence": 0.0, "narrative": "Paragraph one.\\n\\nParagraph two.\\n\\nParagraph three."}`;

function buildUserMessage(context: UsNarrativeContext): string {
  const { listing, assessment, offer, signals, comparables, advantage, marketPanel } = context;

  const sqft = listing.sqft ? `${listing.sqft} sqft` : "sqft unknown";
  const year = listing.yearBuilt ? `built ${listing.yearBuilt}` : "year unknown";
  const taxes = listing.taxes ? `$${listing.taxes}/yr taxes` : "taxes unknown";
  const priceSqft =
    listing.sqft && parseInt(listing.sqft) > 0 ? `$${Math.round(listing.price / parseInt(listing.sqft))}/sqft` : "price/sqft unknown";

  const overAssessmentBlock = buildOverAssessmentBlock(advantage.overAssessment);

  return `Property: ${listing.address}, ${listing.city}, ${listing.province}
Asking price: ${fmt(listing.price)}
Profile: ${listing.beds} bed / ${listing.baths} bath, ${sqft}, ${year}, ${taxes}
Price per sqft: ${priceSqft}
Days on market: ${listing.dom ?? 0}

${buildAssessmentBlock(assessment)}

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
// LLM call — same model/config, JSON-parse + retry-once + graceful-null
// pattern as llm.ts's analyzeAndNarrate(), plus an outer ~12s time-box (see
// module doc).
// ---------------------------------------------------------------------------

const MODEL = "qwen/qwen3.7-flash";
const DEFAULT_TIMEOUT_MS = 12_000;
const EMPTY_RESULT: UsLLMAnalysis = { signals: [], confidence: 0, narrative: "" };

async function callLlm(context: UsNarrativeContext): Promise<UsLLMAnalysis> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildUserMessage(context) },
  ];

  const response = await openrouter().chat.completions.create({
    model: MODEL,
    max_tokens: 1024,
    messages,
    // Qwen flash models default to reasoning-on via OpenRouter, which burns
    // the entire max_tokens budget on hidden chain-of-thought and returns
    // null content — see llm.ts's analyzeAndNarrate() for the same fix.
    // @ts-expect-error OpenRouter extension not in the OpenAI SDK types
    reasoning: { enabled: false },
  });

  const text = response.choices[0]?.message?.content?.trim() || "";
  const finishReason = response.choices[0]?.finish_reason;
  if (finishReason === "length") {
    console.warn(`  [us-narrative] WARNING: response truncated (hit max_tokens). Raw length: ${text.length}`);
  }

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`No JSON in response (finish_reason=${finishReason}): ${text.slice(0, 200)}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error(`JSON parse failed (finish_reason=${finishReason}): ${jsonMatch[0].slice(0, 300)}`);
  }

  return {
    signals: Array.isArray(parsed.signals) ? parsed.signals : [],
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
    narrative: typeof parsed.narrative === "string" ? parsed.narrative : "",
  };
}

async function callLlmWithRetry(context: UsNarrativeContext): Promise<UsLLMAnalysis> {
  try {
    return await callLlm(context);
  } catch (firstErr) {
    console.warn(`  [us-narrative] attempt 1 failed: ${firstErr instanceof Error ? firstErr.message : String(firstErr)}`);
    await new Promise((r) => setTimeout(r, 1000));
    try {
      return await callLlm(context);
    } catch (retryErr) {
      console.warn(`  [us-narrative] attempt 2 failed: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`);
      return EMPTY_RESULT;
    }
  }
}

/**
 * Generates the US listed-property narrative. Returns
 * `{signals: [], confidence: 0, narrative: ""}` (never throws) when
 * OPENROUTER_API_KEY is unset, both LLM attempts fail, or the call exceeds
 * `timeoutMs` (default ~12s) — callers should fall back to
 * deterministicUsNarrative() on an empty `narrative`, exactly as
 * enrichListing() does for llm.ts's analyzeAndNarrate().
 */
export async function generateUsNarrative(
  context: UsNarrativeContext,
  opts?: { timeoutMs?: number }
): Promise<UsLLMAnalysis> {
  if (!process.env.OPENROUTER_API_KEY) {
    return EMPTY_RESULT;
  }

  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const timeout = new Promise<UsLLMAnalysis>((resolve) => {
      timer = setTimeout(() => {
        console.warn(`  [us-narrative] timed out after ${timeoutMs}ms — falling back to deterministic narrative`);
        resolve(EMPTY_RESULT);
      }, timeoutMs);
    });

    return await Promise.race([callLlmWithRetry(context), timeout]);
  } catch (err) {
    console.warn(`  [us-narrative] Error: ${err instanceof Error ? err.message : String(err)}`);
    return EMPTY_RESULT;
  } finally {
    // Clear the timer once the race settles either way — otherwise the
    // timeout callback fires later and logs a spurious "timed out" warning
    // even when the LLM call actually won the race.
    if (timer) clearTimeout(timer);
  }
}
