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
import type { AnchorPlausibility, Assessment, Listing, OfferResult } from "../types";
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
  /** Anchor plausibility verdict (src/lib/pipeline/us-assess.ts's
   * assessAnchorPlausibility) — undefined when there was no assessed value
   * to evaluate. When present with verdict "context_only" (or the
   * "asking_outlier" flavor of "anchor"), both the LLM prompt and the
   * deterministic fallback explain the anchor choice in one sentence. */
  anchorDecision?: AnchorPlausibility;
}

/**
 * County feeds can expose an assessor's current market-value estimate rather
 * than the taxable assessment. Keep the generated prose from collapsing those
 * two government figures back into the same label after the structured input
 * has correctly distinguished them.
 */
export function normalizeAssessmentTerminology(
  narrative: string,
  assessment: Assessment | null
): string {
  const isCountyMarketValue =
    assessment?.liveCountySource && assessment.liveCountyValueKind === "market_value";
  if (!isCountyMarketValue) return narrative;

  return narrative
    .replace(/\btax[- ]assessed value\b/gi, "county assessor market value")
    .replace(/\btax assessment\b/gi, "county assessor market value");
}

// ---------------------------------------------------------------------------
// Deterministic fallback (mirrors llm.ts's deterministicNarrative tone —
// short, hedged, numbers-only, no LLM flourish) — used when the LLM call
// fails, times out, or OPENROUTER_API_KEY isn't set, so "THE SIGNAL" never
// renders empty.
// ---------------------------------------------------------------------------

export function deterministicUsNarrative(context: UsNarrativeContext): string {
  const { listing, offer, advantage, anchorDecision } = context;
  const { triangulation, equitySignal, overAssessment } = advantage;
  const addr = listing.address;

  const parts: string[] = [];
  parts.push(`${addr} — listed at ${fmt(listing.price)} in ${listing.city}, ${listing.province}.`);

  // One-sentence explanation of the anchor choice whenever the anchor gate
  // found something worth flagging — demoted ("context_only") or the
  // asking-outlier flavor of a confirmed anchor.
  if (anchorDecision && anchorDecision.reason) {
    parts.push(anchorDecision.note);
  }

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
  const isCountyMarketValue =
    assessment.liveCountySource && assessment.liveCountyValueKind === "market_value";
  const sourceLabel =
    assessment.source === "avm"
      ? "RentCast AVM estimate (modeled, not government-verified)"
      : isCountyMarketValue
        ? "county assessor market value (government)"
        : "county tax assessment (government)";
  let block = `${isCountyMarketValue ? "County assessor market value" : "Tax/assessed value"} (${assessment.assessmentYear}, ${sourceLabel}): ${fmt(assessment.totalValue)}`;
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

/** Structured anchor-plausibility input (src/lib/pipeline/us-assess.ts's
 * assessAnchorPlausibility) — empty string when there's nothing to flag
 * (verdict "anchor" with no reason), matching the other optional blocks'
 * "omit when not applicable" convention. */
function buildAnchorDecisionBlock(anchorDecision: AnchorPlausibility | undefined): string {
  if (!anchorDecision || !anchorDecision.reason) return "";
  const verdictLabel = anchorDecision.verdict === "context_only" ? "DEMOTED (context only, not used as offer anchor)" : "CONFIRMED (still the anchor)";
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

// ---------------------------------------------------------------------------
// System prompt — "THE SIGNAL" voice guide
// (docs/plans/11-NARRATIVE-VOICE-GUIDE.md), section 5's exact replacement
// text, pasted in verbatim. Persona: a sharp, experienced buyer's agent
// talking to their client, not a valuation model narrating its own inputs —
// see the guide for the full before/after rationale and sample runs. Same
// hard constraints as the prior prompt and as llm.ts's analyzeAndNarrate()
// (banned words, no fabricated numbers, no seller-emotion framing, the
// DOM<60 rule), built around the US Advantage data instead of MLS remarks
// text (see module doc above for why).
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a sharp, experienced buyer's agent talking to a client about a specific property. You've already been through the numbers — the client hasn't. Your job is to tell them what the numbers MEAN, in plain spoken language, not to read the numbers back to them. You sound like someone who has walked a hundred buyers through a hundred deals: plain-spoken, confident, occasionally wry. Not a valuation model narrating its own inputs.

You produce two outputs:

1. SIGNALS: Additional motivation or leverage signals detected by connecting the structured data points below in ways a threshold-based system would miss (e.g. an equity/tenure tier combining with an over-assessment flag, a triangulation spread that undercuts the asking price, elevated risk/peril scores compounding a soft market read). Only surface signals that are genuinely implied by the data provided — do not invent transaction detail, condition detail, or seller motivation that isn't backed by a specific number in the input.

2. NARRATIVE: 2-3 short paragraphs, talking directly to the buyer about this property as a trade opportunity, in the voice described above.

This property has NO MLS listing remarks available (RentCast's free tier doesn't return them) — do not reference "the description" or invent language-based motivation. Instead, this input is richer than a typical listing in a different way: multiple independent valuation anchors (the government value exactly as labeled in the input, AVM, asking, comp $/sqft) instead of the usual two, real sale-history-derived equity/tenure data, an investor yield read, and county-level risk/momentum context.

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
- NEVER call a "County assessor market value" a tax assessment or tax-assessed value. Those are different fields. Repeat the government-value label from the input exactly.
- No exclamation marks. No hype, no fear-mongering, no stacked salesy adjectives. Plain color and one small metaphor are fine (see CREATIVE LATITUDE above) — a sales pitch is not.
- Separate paragraphs with a blank line (\\n\\n). Do NOT write a wall of text.

Return ONLY valid JSON:
{"signals": ["signal1"], "confidence": 0.0, "narrative": "Paragraph one.\\n\\nParagraph two.\\n\\nParagraph three."}`;

function buildUserMessage(context: UsNarrativeContext): string {
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
    narrative:
      typeof parsed.narrative === "string"
        ? normalizeAssessmentTerminology(parsed.narrative, context.assessment)
        : "",
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
