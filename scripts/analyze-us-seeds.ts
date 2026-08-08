/**
 * scripts/analyze-us-seeds.ts
 *
 * Runs the free-data-only full-seed analysis stage
 * (src/lib/pipeline/us-seed-analysis.ts) over every US Discover listing
 * currently cached in KV (listings:all, province TX/FL/AZ) that hasn't
 * already been through RentCast's top-N live enrichment
 * (src/lib/pipeline/us-enrich.ts) — so every seeded listing renders the
 * full /property/[slug] US Advantage UX (offer, narrative, triangulation,
 * yield, risk/momentum) instead of the sparse "limited data" fallback,
 * without spending a single RentCast request (quota is frozen at 40/45 —
 * see src/lib/rentcast.ts's module doc).
 *
 * ZERO RentCast calls: this script imports nothing from src/lib/rentcast.ts
 * except getRentcastQuotaStatus(), which is a pure KV counter read (no
 * outbound RentCast request — see that function's implementation), used
 * here purely to print the before/after quota proof.
 *
 * IDEMPOTENT / RE-RUNNABLE: reads KV once at the start. A listing that
 * gains a preAssessment mid-run (scripts/enrich-us-from-assessors.ts is a
 * separate, concurrently-executing process) simply isn't picked up until
 * the NEXT run of this script — safe to re-run any time to pick up newer
 * county-assessor matches; each re-run recomputes every eligible listing
 * fresh from whatever's in KV at that moment (offer + triangulation +
 * narrative), so a listing that flips from language-anchored to
 * assessment-anchored between runs self-corrects on the next pass.
 *
 * USAGE:
 *   npx tsx scripts/analyze-us-seeds.ts                  # dry run (default)
 *   npx tsx scripts/analyze-us-seeds.ts --commit          # write to KV
 *   npx tsx scripts/analyze-us-seeds.ts --commit --only-missing
 *     # skip any listing that already has SOME preNarrative (ours or
 *     # RentCast's) — cheap incremental runs that only fill genuine gaps
 *     # (new listings, or ones that never got a narrative) instead of
 *     # recomputing + re-spending an LLM call on everything each time.
 *   npx tsx scripts/analyze-us-seeds.ts --commit --only-changed
 *     # Anchor-sanity re-run mode (src/lib/pipeline/us-assess.ts's
 *     # assessAnchorPlausibility, added after this script's original
 *     # ship). For every already-processed listing (has a preAssessment
 *     # AND a preNarrative from a prior run under the OLD always-anchor
 *     # logic), cheaply recomputes JUST the anchor verdict first — no LLM
 *     # call — and restricts the real (narrative-generating) pass to only
 *     # the listings whose verdict actually FLIPS from anchor to
 *     # context_only under the new gate. Prints the affected count before
 *     # doing anything else, so a dry run alone answers "how many of the
 *     # pool does this change." Existing correctly-anchored listings are
 *     # left untouched — zero wasted LLM spend.
 *   npx tsx scripts/analyze-us-seeds.ts --commit --regen-narratives
 *     # Narrative-voice rollout mode (docs/plans/11-NARRATIVE-VOICE-GUIDE.md,
 *     # src/lib/pipeline/us-seed-analysis.ts's regenerateSeedNarrative()).
 *     # "This is a voice change, not a data change" — restricts eligibility
 *     # to already-processed listings (preOffer + preUsAdvantage +
 *     # preUsComparables already on record) and reuses every one of those
 *     # fields VERBATIM, recomputing ONLY preNarrative/
 *     # preNarrativeConfidence/preNarrativeLint against the current
 *     # SYSTEM_PROMPT. Ignores --only-missing/--only-changed (a full
 *     # narrative regen is the point of this mode). Offer numbers, tiers,
 *     # and signals are provably unaffected — see regenerateSeedNarrative()'s
 *     # doc comment.
 */

import { loadEnvLocal, COMMIT } from "./lib/ingest-shared";
loadEnvLocal();

import { getAllListings, writeAllListings } from "../src/lib/kv/listings";
import { isUSState } from "../src/lib/assessment/us";
import { US_DISCOVER_CITIES } from "../src/lib/data/city-metadata";
import { getCountyMarketPanel, type CountyMarketPanel } from "../src/lib/db/regional-econ";
import { getRentcastQuotaStatus } from "../src/lib/rentcast";
import {
  analyzeSeedListing,
  regenerateSeedNarrative,
  isRentcastEnriched,
  type SeedAnalysisResult,
} from "../src/lib/pipeline/us-seed-analysis";
import { assessAnchorPlausibility, parseMarketValueFromAssessmentNote } from "../src/lib/pipeline/us-assess";
import type { Listing } from "../src/lib/types";

const ONLY_MISSING = process.argv.includes("--only-missing");
const ONLY_CHANGED = process.argv.includes("--only-changed");
const REGEN_NARRATIVES = process.argv.includes("--regen-narratives");
const CONCURRENCY = 8;

/** Cheap (no LLM, no narrative recompute) check: would this listing's
 * anchor verdict flip from "assessment-anchored" (the OLD, ungated
 * behavior — always true whenever preAssessment.found) to demoted under
 * the new assessAnchorPlausibility gate? Mirrors exactly the inputs
 * src/lib/pipeline/us-seed-analysis.ts's analyzeSeedListing() feeds the
 * gate (avmValue always null — zero RentCast calls in this pipeline). */
function anchorVerdictWouldFlipToContextOnly(listing: Listing): boolean {
  if (!listing.preAssessment?.found) return false;
  const decision = assessAnchorPlausibility({
    assessedValue: listing.preAssessment.totalValue,
    assessmentBasis: listing.preAssessment.assessmentBasis,
    askingPrice: listing.price || null,
    avmValue: null,
    marketValueHint: parseMarketValueFromAssessmentNote(listing.assessmentNote),
  });
  return decision.verdict === "context_only";
}

function listingKey(l: Listing): string {
  return `${l.address}|${l.city}|${l.province}`;
}

/** Simple fixed-concurrency pool — no new dependency for ~144 short-lived
 * async tasks. */
async function runPool<T, R>(items: T[], limit: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

interface CityStats {
  city: string;
  state: string;
  total: number;
  alreadyRentcastEnriched: number;
  skippedOnlyMissing: number;
  processed: number;
  assessmentAnchored: number;
  languageAnchored: number;
  llmNarratives: number;
  deterministicNarratives: number;
  errors: number;
}

async function main() {
  console.log(
    `Mode: ${COMMIT ? "COMMIT (writing to KV)" : "DRY RUN (pass --commit to write)"}` +
      `${ONLY_MISSING ? ", --only-missing" : ""}${ONLY_CHANGED ? ", --only-changed" : ""}${REGEN_NARRATIVES ? ", --regen-narratives" : ""}\n`
  );

  const quotaBefore = await getRentcastQuotaStatus();
  console.log(`RentCast quota BEFORE: ${quotaBefore.used}/${quotaBefore.limit} (persistedInKv=${quotaBefore.persistedInKv})`);

  const all = await getAllListings();
  const usListings = all.filter((l) => isUSState(l.province));
  console.log(`Total listings in KV: ${all.length} — US: ${usListings.length}\n`);

  // countyFips lookup, keyed by "STATE|city name" — matches US_DISCOVER_CITIES.
  const fipsByCity = new Map<string, string>();
  for (const cfg of US_DISCOVER_CITIES) {
    fipsByCity.set(`${cfg.state}|${cfg.name}`, cfg.countyFips);
  }

  // One county market panel read per city, cached and reused across every
  // listing in that city (Postgres read, not RentCast — zero quota cost).
  const panelCache = new Map<string, CountyMarketPanel | null>();
  async function panelFor(listing: Listing): Promise<CountyMarketPanel | null> {
    const fips = fipsByCity.get(`${listing.province}|${listing.city}`);
    if (!fips) return null;
    if (!panelCache.has(fips)) {
      panelCache.set(fips, await getCountyMarketPanel(fips).catch(() => null));
    }
    return panelCache.get(fips) ?? null;
  }

  const statsByCity = new Map<string, CityStats>();
  function statFor(l: Listing): CityStats {
    const key = `${l.city}|${l.province}`;
    let s = statsByCity.get(key);
    if (!s) {
      s = {
        city: l.city,
        state: l.province,
        total: 0,
        alreadyRentcastEnriched: 0,
        skippedOnlyMissing: 0,
        processed: 0,
        assessmentAnchored: 0,
        languageAnchored: 0,
        llmNarratives: 0,
        deterministicNarratives: 0,
        errors: 0,
      };
      statsByCity.set(key, s);
    }
    return s;
  }

  const toProcess: Listing[] = [];
  for (const l of usListings) {
    const s = statFor(l);
    s.total++;
    if (isRentcastEnriched(l)) {
      s.alreadyRentcastEnriched++;
      continue;
    }
    if (REGEN_NARRATIVES) {
      // Narrative-voice regen only ever targets listings that already went
      // through analyzeSeedListing() — nothing to reuse otherwise. Ignores
      // --only-missing (a full regen across every already-seeded listing is
      // the entire point of this mode).
      if (!l.preOffer || !l.preUsAdvantage || !l.preUsComparables) {
        s.skippedOnlyMissing++;
        continue;
      }
      toProcess.push(l);
      continue;
    }
    if (ONLY_MISSING && l.preNarrative) {
      s.skippedOnlyMissing++;
      continue;
    }
    toProcess.push(l);
  }

  console.log(`Eligible for free-data analysis: ${toProcess.length} (of ${usListings.length} US listings)\n`);

  // -------------------------------------------------------------------
  // Anchor-sanity impact report — cheap (no LLM), computed unconditionally
  // so a plain dry run answers "how many of the pool does the new gate
  // affect" even without --only-changed.
  // -------------------------------------------------------------------
  const alreadyProcessed = toProcess.filter((l) => !!l.preNarrative);
  const flippedToContextOnly = alreadyProcessed.filter(anchorVerdictWouldFlipToContextOnly);
  console.log(`${"=".repeat(100)}\nANCHOR-SANITY IMPACT (src/lib/pipeline/us-assess.ts's assessAnchorPlausibility)\n${"=".repeat(100)}`);
  console.log(
    `${flippedToContextOnly.length} of ${alreadyProcessed.length} already-processed listings (${usListings.length} total US, ` +
      `${toProcess.length} eligible) would flip from assessment-anchored to demoted (context_only) under the new gate:`
  );
  for (const l of flippedToContextOnly) {
    console.log(`  - ${l.address}, ${l.city}, ${l.province} — $${l.price.toLocaleString()} asking, $${l.preAssessment?.totalValue.toLocaleString()} assessed`);
  }
  console.log("");

  if (ONLY_CHANGED) {
    const before = toProcess.length;
    toProcess.length = 0;
    toProcess.push(...flippedToContextOnly);
    console.log(`--only-changed: restricting the real (narrative-generating) pass from ${before} eligible listings to ${toProcess.length} affected listing(s).\n`);
  }

  const examples: { anchorType: "assessment" | "language"; result: SeedAnalysisResult }[] = [];

  const outcomes = await runPool(toProcess, CONCURRENCY, async (listing) => {
    const s = statFor(listing);
    try {
      const panel = await panelFor(listing);
      const result = REGEN_NARRATIVES
        ? await regenerateSeedNarrative(listing, panel)
        : await analyzeSeedListing(listing, panel);
      s.processed++;
      if (result.anchorType === "assessment") s.assessmentAnchored++;
      else s.languageAnchored++;
      if (result.narrativeSource === "llm") s.llmNarratives++;
      else s.deterministicNarratives++;

      if (
        examples.length < 6 &&
        !examples.some((e) => e.anchorType === result.anchorType)
      ) {
        examples.push({ anchorType: result.anchorType, result });
      }
      return { key: listingKey(listing), listing: result.listing, ok: true as const };
    } catch (err) {
      s.errors++;
      console.error(`  [analyze-us-seeds] FAILED ${listing.address}, ${listing.city}: ${err instanceof Error ? err.message : String(err)}`);
      return { key: listingKey(listing), listing, ok: false as const };
    }
  });

  const byKey = new Map(outcomes.map((o) => [o.key, o.listing]));
  const merged = all.map((l) => byKey.get(listingKey(l)) ?? l);

  let writeVerified = false;
  let verifiedCount = 0;
  if (COMMIT) {
    console.log(`\nWriting ${merged.length} listings to KV...`);
    await writeAllListings(merged);

    // Round-trip verify: re-read from KV (fresh network call, not a cached
    // reference to `merged`) and confirm the processed listings actually
    // persisted with a preNarrative.
    const rereadAll = await getAllListings();
    const rereadByKey = new Map(rereadAll.map((l) => [listingKey(l), l]));
    verifiedCount = toProcess.filter((l) => {
      const fresh = rereadByKey.get(listingKey(l));
      return !!fresh?.preNarrative;
    }).length;
    writeVerified = verifiedCount === outcomes.filter((o) => o.ok).length;
    console.log(
      `Round-trip verify: ${verifiedCount}/${toProcess.length} processed listings confirmed with preNarrative on fresh re-read from KV ` +
        `(${writeVerified ? "OK" : "MISMATCH — see counts above"}).`
    );
  }

  const quotaAfter = await getRentcastQuotaStatus();

  // -------------------------------------------------------------------
  // Coverage table
  // -------------------------------------------------------------------
  console.log(`\n${"=".repeat(100)}\nCOVERAGE TABLE\n${"=".repeat(100)}`);
  const header = [
    "City",
    "Total",
    "RC-Enriched",
    "Skip(only-missing)",
    "Processed",
    "Assess-Anchored",
    "Lang-Anchored",
    "LLM Narr.",
    "Det. Narr.",
    "Errors",
  ];
  const rows = [...statsByCity.values()]
    .sort((a, b) => a.city.localeCompare(b.city))
    .map((s) => [
      `${s.city}, ${s.state}`,
      String(s.total),
      String(s.alreadyRentcastEnriched),
      String(s.skippedOnlyMissing),
      String(s.processed),
      String(s.assessmentAnchored),
      String(s.languageAnchored),
      String(s.llmNarratives),
      String(s.deterministicNarratives),
      String(s.errors),
    ]);
  const totals = [...statsByCity.values()].reduce(
    (acc, s) => ({
      total: acc.total + s.total,
      alreadyRentcastEnriched: acc.alreadyRentcastEnriched + s.alreadyRentcastEnriched,
      skippedOnlyMissing: acc.skippedOnlyMissing + s.skippedOnlyMissing,
      processed: acc.processed + s.processed,
      assessmentAnchored: acc.assessmentAnchored + s.assessmentAnchored,
      languageAnchored: acc.languageAnchored + s.languageAnchored,
      llmNarratives: acc.llmNarratives + s.llmNarratives,
      deterministicNarratives: acc.deterministicNarratives + s.deterministicNarratives,
      errors: acc.errors + s.errors,
    }),
    {
      total: 0,
      alreadyRentcastEnriched: 0,
      skippedOnlyMissing: 0,
      processed: 0,
      assessmentAnchored: 0,
      languageAnchored: 0,
      llmNarratives: 0,
      deterministicNarratives: 0,
      errors: 0,
    }
  );
  rows.push([
    "TOTAL",
    String(totals.total),
    String(totals.alreadyRentcastEnriched),
    String(totals.skippedOnlyMissing),
    String(totals.processed),
    String(totals.assessmentAnchored),
    String(totals.languageAnchored),
    String(totals.llmNarratives),
    String(totals.deterministicNarratives),
    String(totals.errors),
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const fmtRow = (r: string[]) => r.map((c, i) => c.padEnd(widths[i])).join("  ");
  console.log(fmtRow(header));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const r of rows) console.log(fmtRow(r));

  console.log(`\nRentCast quota BEFORE: ${quotaBefore.used}/${quotaBefore.limit}`);
  console.log(`RentCast quota AFTER:  ${quotaAfter.used}/${quotaAfter.limit}  (delta: ${quotaAfter.used - quotaBefore.used} — must be 0)`);

  // -------------------------------------------------------------------
  // Examples
  // -------------------------------------------------------------------
  console.log(`\n${"=".repeat(100)}\nEXAMPLES\n${"=".repeat(100)}`);
  for (const ex of examples) {
    const l = ex.result.listing;
    console.log(`\n--- ${ex.anchorType.toUpperCase()}-ANCHORED: ${l.address}, ${l.city}, ${l.province} ---`);
    console.log(`Price: $${l.price.toLocaleString()}  DOM: ${l.dom}  Beds/Baths: ${l.beds}/${l.baths}  Sqft: ${l.sqft || "n/a"}`);
    console.log(`Offer: $${l.preOffer?.final_offer.toLocaleString()} (${l.preOffer?.anchor_tag}, ${((l.preOffer?.pct_of_list ?? 0) * 100).toFixed(1)}% of list)`);
    if (l.preAssessment) {
      console.log(`Assessment: $${l.preAssessment.totalValue.toLocaleString()} (${l.preAssessment.source}, basis=${l.preAssessment.assessmentBasis})`);
    }
    console.log(`Triangulation: ${l.preUsAdvantage?.triangulation.anchors.length} anchors, confidence=${l.preUsAdvantage?.triangulation.confidence} — ${l.preUsAdvantage?.triangulation.agreementNote}`);
    console.log(`Yield: ${l.preUsAdvantage?.investorYield ? l.preUsAdvantage.investorYield.verdict : "n/a (no county FMR)"}`);
    console.log(`Risk/Momentum: ${l.preUsAdvantage?.riskMomentum.note}`);
    console.log(`Narrative source: ${ex.result.narrativeSource} (confidence=${ex.result.narrativeConfidence})`);
    console.log(`Narrative:\n${l.preNarrative}`);
  }

  console.log(`\n${"=".repeat(100)}`);
  console.log(`Done. ${COMMIT ? `Committed ${merged.length} listings.` : "Dry run — nothing written (pass --commit to persist)."}`);
}

main().catch((err) => {
  console.error("[analyze-us-seeds] fatal:", err);
  process.exit(1);
});
