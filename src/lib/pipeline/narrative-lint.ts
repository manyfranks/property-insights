/**
 * pipeline/narrative-lint.ts
 *
 * LOG-ONLY validator for THE SIGNAL narratives (US pipeline — see
 * us-narrative.ts), built from docs/plans/11-NARRATIVE-VOICE-GUIDE.md
 * section 6. Owner's call for this ship: no regex banned-word guard, no
 * model switch, no hard number-count gate — just visibility into what the
 * new conversational-voice prompt actually produces, so there's a baseline
 * to monitor before deciding whether either check graduates to a real gate.
 * Nothing in this module blocks, rejects, retries, or rewrites a narrative —
 * it only computes a small result a caller can log and persist alongside
 * the narrative it describes.
 *
 * Two checks, both informational:
 *
 *  1. Number-tracing (guide section 6a) — every number-like token in the
 *     narrative should trace back, within a generous tolerance that allows
 *     for the prompt's now-intentional conversational rounding, to a value
 *     that was actually in the LLM's input context (the same
 *     UsNarrativeContext object buildUserMessage() renders into the
 *     prompt). A number with no match either means the model did its own
 *     arithmetic (not what it was asked to do) or fabricated a figure
 *     outright — both get logged as "untraced" for the owner to spot-check;
 *     this module doesn't try to tell those two cases apart.
 *
 *  2. Banned-word stems (guide section 6b) — the prompt's own banned-word
 *     list (insulting/lowball/offensive/too aggressive/risks appearing),
 *     matched as word stems via regex (not an exact-phrase check) so
 *     denied/negated forms ("isn't insulting", "without being insulting")
 *     still count — a known, reproducible failure mode on qwen3.7-flash per
 *     the guide's section 8 sample run. Counted and logged, not corrected.
 */

import type { UsNarrativeContext } from "./us-narrative";

export interface NarrativeLintResult {
  /** Count of number-like tokens found in the narrative text. */
  numbersTotal: number;
  /** The raw text of each token that didn't trace to any allowed input
   * value within tolerance — empty when every number checks out. */
  untracedNumbers: string[];
  /** The raw text of each banned-word-stem match found (denied or
   * affirmed form alike) — empty when the narrative is clean. */
  bannedWordHits: string[];
}

// ---------------------------------------------------------------------------
// 1. Number extraction (guide section 6a step 1)
// ---------------------------------------------------------------------------

// Matches dollar amounts ($928,234 / $390K / $1.66 million), bare figures
// (109, 17.8), and percentages (88.3%, 5.8%) in a single pass — the
// optional suffix/percent groups let "$1.66 million" and "88.3%" match as
// one token instead of fragmenting into "1.66" + "million" or "88.3" + "%".
const NUMBER_TOKEN_RE = /\$?\d[\d,]*(?:\.\d+)?(?:\s?(?:million|thousand|[KkMm]))?%?/g;

interface ParsedNumber {
  raw: string;
  value: number;
  isPercent: boolean;
}

/** Bare single-digit tokens ("1", "2") turn up constantly as fragments of
 * ordinals, list phrasing ("2-3 paragraphs"), or the "1% rule" — noise that
 * would swamp the untraced count without representing a real narrative
 * figure worth tracing. Anything with 2+ digits, a decimal, or a $/%/K/M
 * marker is kept. */
function isTrivialToken(raw: string): boolean {
  return /^\d$/.test(raw.trim());
}

function parseToken(raw: string): ParsedNumber | null {
  const isPercent = raw.trim().endsWith("%");
  let core = isPercent ? raw.trim().slice(0, -1) : raw.trim();
  let multiplier = 1;
  if (/million$/i.test(core)) {
    multiplier = 1_000_000;
    core = core.replace(/\s?million$/i, "");
  } else if (/thousand$/i.test(core)) {
    multiplier = 1_000;
    core = core.replace(/\s?thousand$/i, "");
  } else if (/[Kk]$/.test(core)) {
    multiplier = 1_000;
    core = core.replace(/[Kk]$/, "");
  } else if (/[Mm]$/.test(core)) {
    multiplier = 1_000_000;
    core = core.replace(/[Mm]$/, "");
  }
  core = core.replace(/^\$/, "").replace(/,/g, "").trim();
  if (!core) return null;
  const value = parseFloat(core);
  if (!Number.isFinite(value)) return null;
  return { raw: raw.trim(), value: value * multiplier, isPercent };
}

/** Extracts every candidate numeric token from a narrative string. Exported
 * for scripts/tests that want raw token visibility independent of tracing. */
export function extractNarrativeNumbers(narrative: string): ParsedNumber[] {
  const matches = narrative.match(NUMBER_TOKEN_RE) ?? [];
  const parsed: ParsedNumber[] = [];
  for (const m of matches) {
    if (isTrivialToken(m)) continue;
    const p = parseToken(m);
    if (p) parsed.push(p);
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// 2. Allowed-value reference set (guide section 6a step 2) — flattened from
// the exact UsNarrativeContext object the LLM's input is built from.
// ---------------------------------------------------------------------------

interface AllowedValue {
  value: number;
  /** True when this value is naturally a 0-100 percentage figure (so it's
   * only compared against percent-suffixed tokens, never dollar figures). */
  isPercent: boolean;
}

function pushIf(list: AllowedValue[], value: number | null | undefined, isPercent = false) {
  if (value == null || !Number.isFinite(value)) return;
  list.push({ value, isPercent });
}

/** Flattens every numeric field reachable from a UsNarrativeContext into a
 * reference list a narrative number can be checked against — see guide
 * section 6a step 2 for the enumerated field list (price, DOM, assessment
 * total/land/building, offer anchor/final/savings/percentOfList,
 * triangulation anchor values + spread, equity hold-years/lastSalePrice/
 * currentValueEstimate/impliedAppreciationPct/hpiImpliedValue, investor-
 * yield percentages, county HPI trend/vacancy rate, sqft, taxes,
 * price/sqft), plus derived ratios between any two allowed dollar values.
 * Percentage-shaped fields are stored on their 0-100 scale (0.883 -> 88.3)
 * to compare directly against a parsed "88.3%" token. */
export function buildAllowedValues(context: UsNarrativeContext): AllowedValue[] {
  const out: AllowedValue[] = [];
  const { listing, assessment, offer, comparables, advantage, marketPanel } = context;

  // Listing
  pushIf(out, listing?.price);
  pushIf(out, listing?.dom);
  const sqft = parseInt(listing?.sqft ?? "", 10);
  if (Number.isFinite(sqft) && sqft > 0) {
    pushIf(out, sqft);
    if (listing?.price) pushIf(out, listing.price / sqft); // derived $/sqft
  }
  const taxes = parseInt(listing?.taxes ?? "", 10);
  if (Number.isFinite(taxes)) pushIf(out, taxes);

  // Assessment
  if (assessment?.found) {
    pushIf(out, assessment.totalValue);
    pushIf(out, assessment.landValue);
    pushIf(out, assessment.buildingValue);
  }

  // Offer
  if (offer) {
    pushIf(out, offer.anchor);
    pushIf(out, offer.finalOffer);
    pushIf(out, offer.savings);
    if (offer.percentOfList != null) pushIf(out, offer.percentOfList * 100, true);
    if (offer.listToAssessedRatio != null) pushIf(out, offer.listToAssessedRatio * 100, true);
    pushIf(out, offer.domMultiplier);
  }

  // Triangulation (including excluded anchors — the narrative is explicitly
  // instructed to explain a demoted anchor by value, e.g. the anchor
  // decision block, so its number is legitimately traceable too). Every
  // sub-field here is guarded rather than assumed present: this context
  // frequently comes straight off an already-persisted KV listing whose
  // preUsAdvantage blob predates one of these fields being added.
  const tri = advantage?.triangulation;
  if (tri) {
    for (const a of [...(tri.anchors ?? []), ...(tri.excludedAnchors ?? [])]) pushIf(out, a?.value);
    pushIf(out, tri.triangulatedValue);
    if (tri.spreadPct != null) pushIf(out, tri.spreadPct * 100, true);
  }

  // Equity/tenure
  const eq = advantage?.equitySignal;
  if (eq) {
    pushIf(out, eq.holdYears);
    pushIf(out, eq.lastSalePrice);
    pushIf(out, eq.currentValueEstimate);
    if (eq.impliedAppreciationPct != null) pushIf(out, eq.impliedAppreciationPct * 100, true);
    if (eq.hpiImpliedValue != null) pushIf(out, eq.hpiImpliedValue);
  }

  // Investor yield
  const iy = advantage?.investorYield;
  if (iy) {
    if (iy.grossYieldPct != null) pushIf(out, iy.grossYieldPct * 100, true);
    if (iy.rentToPriceRatio != null) pushIf(out, iy.rentToPriceRatio * 100, true);
    if (iy.fmr2brDeltaPct != null) pushIf(out, iy.fmr2brDeltaPct * 100, true);
  }

  // Risk/momentum
  const rm = advantage?.riskMomentum;
  if (rm) {
    if (rm.hpiTrend5y != null) pushIf(out, rm.hpiTrend5y * 100, true);
    if (rm.vacancyRate != null) pushIf(out, rm.vacancyRate * 100, true);
    for (const p of rm.topPerils ?? []) pushIf(out, p?.score);
  }

  // Over-assessment
  if (advantage?.overAssessment?.deltaPct != null) {
    pushIf(out, Math.abs(advantage.overAssessment.deltaPct) * 100, true);
  }

  // County market panel — raw figures, kept alongside riskMomentum's own
  // copies of hpiTrend5y/vacancyRate for robustness to future field
  // renames on either side.
  if (marketPanel) {
    pushIf(out, marketPanel.medianHomeValue);
    pushIf(out, marketPanel.medianGrossRent);
    pushIf(out, marketPanel.medianHouseholdIncome);
    if (marketPanel.vacancyRate != null) pushIf(out, marketPanel.vacancyRate * 100, true);
    pushIf(out, marketPanel.fmrStudio);
    pushIf(out, marketPanel.fmr1br);
    pushIf(out, marketPanel.fmr2br);
    pushIf(out, marketPanel.fmr3br);
    pushIf(out, marketPanel.fmr4br);
    if (marketPanel.hpiTrend5y != null) pushIf(out, marketPanel.hpiTrend5y * 100, true);
  }

  // Comparables
  if (comparables?.impliedValue != null) pushIf(out, comparables.impliedValue);
  if (comparables?.medianPricePerSqft != null) pushIf(out, comparables.medianPricePerSqft);

  // Derived: ratios between any two allowed dollar values, expressed as a
  // percentage (guide section 6a step 2's "derived: ratios between any two
  // allowed values") — covers a narrative computing e.g. "about a third of
  // asking" as a bare percentage from two anchors already in the allowed
  // set, rather than citing a pre-computed spreadPct/percentOfList figure.
  const dollarValues = out.filter((v) => !v.isPercent && v.value > 0).map((v) => v.value);
  const derived: AllowedValue[] = [];
  for (let i = 0; i < dollarValues.length; i++) {
    for (let j = 0; j < dollarValues.length; j++) {
      if (i === j) continue;
      const ratio = (dollarValues[i] / dollarValues[j]) * 100;
      if (Number.isFinite(ratio) && ratio > 0 && ratio < 1000) derived.push({ value: ratio, isPercent: true });
    }
  }
  out.push(...derived);

  return out;
}

// ---------------------------------------------------------------------------
// 3. Tolerance matching (guide section 6a steps 3-4)
// ---------------------------------------------------------------------------

const DOLLAR_RELATIVE_TOLERANCE = 0.02; // 2%
const SMALL_DOLLAR_ABS_TOLERANCE = 500; // for reference values under $25K
const SMALL_DOLLAR_THRESHOLD = 25_000;
const PERCENT_RELATIVE_TOLERANCE = 0.02; // 2%
const DOM_RELATIVE_TOLERANCE = 0.15; // +/-15%, day<->week/month conversions

function withinRelative(a: number, b: number, pct: number): boolean {
  if (b === 0) return a === 0;
  return Math.abs(a - b) / Math.abs(b) <= pct;
}

/** True when `token` traces to some value in `allowed` within tolerance, or
 * (for non-percent tokens) to a DOM->weeks/months conversion of `domDays`
 * (guide section 6a step 4 — day-to-month rounding is coarser than dollar
 * rounding, so it gets its own wider band rather than the 2% dollar rule). */
function isTraced(token: ParsedNumber, allowed: AllowedValue[], domDays: number | null): boolean {
  if (!token.isPercent && domDays != null && domDays > 0) {
    const months = domDays / 30;
    const weeks = domDays / 7;
    if (withinRelative(token.value, months, DOM_RELATIVE_TOLERANCE)) return true;
    if (withinRelative(token.value, weeks, DOM_RELATIVE_TOLERANCE)) return true;
  }

  for (const a of allowed) {
    if (a.isPercent !== token.isPercent) continue;
    if (token.isPercent) {
      if (withinRelative(token.value, a.value, PERCENT_RELATIVE_TOLERANCE)) return true;
    } else {
      if (a.value < SMALL_DOLLAR_THRESHOLD && Math.abs(token.value - a.value) <= SMALL_DOLLAR_ABS_TOLERANCE) return true;
      if (withinRelative(token.value, a.value, DOLLAR_RELATIVE_TOLERANCE)) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// 4. Banned-word stems (guide section 6b) — same list as the SYSTEM_PROMPT's
// NEVER DO THESE section in us-narrative.ts, matched as stems/substrings so
// denied/negated forms ("isn't insulting") still count.
// ---------------------------------------------------------------------------

const BANNED_WORD_RE = /\b(insult\w*|lowball\w*|offensive|too aggressive|risks appearing)\b/gi;

export function detectBannedWords(narrative: string): string[] {
  const hits = narrative.match(BANNED_WORD_RE) ?? [];
  return hits.map((h) => h.toLowerCase());
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Runs both log-only checks over a finished narrative against the exact
 * context object it was generated from. Never throws (a lint failure should
 * never take down the pipeline it's monitoring) — any internal error is
 * swallowed and reported as a clean/empty result rather than propagated.
 */
export function lintUsNarrative(narrative: string, context: UsNarrativeContext): NarrativeLintResult {
  try {
    const numbers = extractNarrativeNumbers(narrative);
    const allowed = buildAllowedValues(context);
    const domDays = Number.isFinite(context.listing?.dom) ? context.listing.dom : null;

    const untracedNumbers: string[] = [];
    for (const n of numbers) {
      if (!isTraced(n, allowed, domDays)) untracedNumbers.push(n.raw);
    }

    return {
      numbersTotal: numbers.length,
      untracedNumbers,
      bannedWordHits: detectBannedWords(narrative),
    };
  } catch (err) {
    console.warn(`[narrative-lint] lint itself failed (never blocks the pipeline): ${err instanceof Error ? err.message : String(err)}`);
    return { numbersTotal: 0, untracedNumbers: [], bannedWordHits: [] };
  }
}

/** Stable, grep-able console.warn line for a lint result — every caller
 * (route.ts's live /api/assess path, us-seed-analysis.ts, us-enrich.ts)
 * should log through this so "[narrative-lint]" greps find every run. */
export function logNarrativeLint(label: string, result: NarrativeLintResult): void {
  const bits = [
    `[narrative-lint] ${label} —`,
    `numbers=${result.numbersTotal}`,
    `untraced=${result.untracedNumbers.length}${result.untracedNumbers.length ? ` [${result.untracedNumbers.join(", ")}]` : ""}`,
    `bannedWordHits=${result.bannedWordHits.length}${result.bannedWordHits.length ? ` [${result.bannedWordHits.join(", ")}]` : ""}`,
  ];
  console.warn(bits.join(" "));
}
