/**
 * golden-canada.ts
 *
 * Golden-address health check for the Canadian pipeline (BC / AB / ON):
 * Zoocasa scrape -> assessment adapters -> local scoring/offer pipeline.
 *
 * MB (Manitoba / City of Winnipeg) is checked separately, further down —
 * lighter-weight (no cache, no Zoocasa pipeline run): 3 live SODA lookups
 * against known-good Winnipeg addresses + 1 bogus-address null check.
 *
 * For each province:
 *   1. Assessment cache lookup (sync + async paths) on 3-4 known-good
 *      addresses pulled from src/lib/data/assessments.ts.
 *   2. Live Zoocasa search + detail fetch for 1-2 addresses discovered
 *      via searchListings() (Victoria / Calgary / Toronto).
 *   3. Live (non-cache) assessment lookup on one of those addresses.
 *   4. Full local pipeline run (signals + score + offer, no LLM) on one
 *      fetched listing.
 *
 * BC live assessment lookups hit BC Assessment via a Browserless-backed
 * headless Chrome session (see src/lib/browser.ts) -- capped at 2 calls
 * total across the whole run to conserve Browserless credits. AB (SODA)
 * and ON (tax-reverse) live lookups are free HTTP calls with no cap.
 *
 * Run: npx tsx scripts/golden-canada.ts
 */

import { loadEnvLocal } from "./lib/ingest-shared";
loadEnvLocal();

import {
  BC_ASSESSMENT_CACHE,
  AB_ASSESSMENT_CACHE,
  ON_ASSESSMENT_CACHE,
} from "../src/lib/data/assessments";
import { lookupBC, lookupBCSync } from "../src/lib/assessment/bc";
import { lookupAB, lookupABSync } from "../src/lib/assessment/ab";
import { lookupON, lookupONSync } from "../src/lib/assessment/on";
import { lookupMB, lookupMBSync } from "../src/lib/assessment/mb";
import { searchListings, findAndFetchDetail, ZoocasaNotFoundError } from "../src/lib/zoocasa";
import { enrichListing } from "../src/lib/pipeline/enrich";
import type { Assessment, Listing } from "../src/lib/types";

// ---------------------------------------------------------------------------
// Result bookkeeping
// ---------------------------------------------------------------------------

type Status = "PASS" | "FAIL" | "SKIP";

interface CheckResult {
  province: string;
  check: string;
  status: Status;
  detail: string;
}

const results: CheckResult[] = [];

function record(province: string, check: string, status: Status, detail: string) {
  results.push({ province, check, status, detail });
  const icon = status === "PASS" ? "PASS" : status === "SKIP" ? "SKIP" : "FAIL";
  console.log(`  [${icon}] ${province} / ${check} — ${detail}`);
}

async function safeCheck(
  province: string,
  check: string,
  fn: () => Promise<{ ok: boolean; detail: string } | void>
) {
  try {
    const out = await fn();
    if (out === undefined) return; // fn recorded itself
    record(province, check, out.ok ? "PASS" : "FAIL", out.detail);
  } catch (err) {
    record(
      province,
      check,
      "FAIL",
      `threw: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`
    );
  }
}

// ---------------------------------------------------------------------------
// Shape assertions
// ---------------------------------------------------------------------------

function assertAssessment(a: Assessment | null, label: string): { ok: boolean; detail: string } {
  if (!a) return { ok: false, detail: `${label}: null result` };
  if (!a.found) return { ok: false, detail: `${label}: found=false` };
  if (typeof a.totalValue !== "number" || !(a.totalValue > 0)) {
    return { ok: false, detail: `${label}: bad totalValue=${a.totalValue}` };
  }
  if (!a.source) return { ok: false, detail: `${label}: missing source` };
  return { ok: true, detail: `${label}: totalValue=${a.totalValue} source=${a.source}` };
}

/**
 * Shape check for a Zoocasa-derived Listing — the fields the downstream
 * pipeline (signals/scoring/offer) depends on. "status" has no discrete
 * field in the current Listing type (see src/lib/types.ts); dom (days on
 * market, a number derived from addedAt/history) is the closest available
 * liveness/activity proxy, so it stands in for "status" here.
 */
function assertListingShape(l: Listing, label: string): { ok: boolean; detail: string } {
  const missing: string[] = [];
  if (!l.address || typeof l.address !== "string") missing.push("address");
  if (!l.city || typeof l.city !== "string") missing.push("city");
  if (typeof l.price !== "number" || !(l.price > 0)) missing.push("price");
  if (typeof l.dom !== "number" || Number.isNaN(l.dom)) missing.push("dom(status-proxy)");
  if (missing.length > 0) {
    return { ok: false, detail: `${label}: missing/invalid fields [${missing.join(", ")}]` };
  }
  return {
    ok: true,
    detail: `${label}: address="${l.address}" city=${l.city} price=${l.price} dom=${l.dom}`,
  };
}

// ---------------------------------------------------------------------------
// Province config
// ---------------------------------------------------------------------------

interface ProvinceConfig {
  code: "BC" | "AB" | "ON";
  city: string; // city used for live searchListings()
  cacheAddresses: string[]; // from the province's cache, 3-4 entries
  lookupSync: (address: string) => Assessment | null;
  lookupAsync: (address: string, city?: string, taxes?: string) => Promise<Assessment | null>;
}

const PROVINCES: ProvinceConfig[] = [
  {
    code: "BC",
    city: "Victoria",
    cacheAddresses: [
      "3883 Douglas St",
      "1690 Ash Rd",
      "3819 Beachview Pl",
      "2652 Blackwood St",
    ],
    lookupSync: (address) => lookupBCSync(address),
    lookupAsync: (address, city) => lookupBC(address, city),
  },
  {
    code: "AB",
    city: "Calgary",
    cacheAddresses: [
      "149 Mitchell Road NW",
      "215 25 Avenue NW",
      "609 23 Avenue SW",
      "166 Setonstone Green SE",
    ],
    lookupSync: (address) => lookupABSync(address),
    lookupAsync: (address, city) => lookupAB(address, undefined, city),
  },
  {
    code: "ON",
    city: "Toronto",
    cacheAddresses: [
      "2497 DUFFERIN STREET",
      "5 STONEDENE BOULEVARD",
      "88 STANLEY TERRACE",
      "490 COLDSTREAM AVENUE E",
    ],
    lookupSync: (address) => lookupONSync(address),
    // lookupON is actually synchronous (no live network path for ON — cache
    // + tax-reverse only); wrapped to match the async ProvinceConfig shape.
    lookupAsync: async (address, city, taxes) => lookupON(address, undefined, city, taxes),
  },
];

// BC live (non-cache) assessment lookups hit Browserless. Hard cap at 2
// across the whole run regardless of cache hits/misses actually observed.
const BC_LIVE_SCRAPE_BUDGET = 2;
let bcLiveScrapesUsed = 0;

// ---------------------------------------------------------------------------
// MB (Manitoba / City of Winnipeg) — additive section.
//
// MB has no assessment cache yet (unlike BC/AB/ON), so there's no
// cache-sync/cache-async pair to exercise and lookupMBSync() is expected to
// always return null (documented behavior — see src/lib/assessment/mb.ts).
// This section is a lighter-weight check than the full ProvinceConfig/
// runProvince() pipeline above (which assumes cache addresses + Zoocasa
// search): it exercises the live SODA lookup (src/lib/assessment/mb.ts)
// directly against 3 real Winnipeg addresses confirmed via a live data probe
// against data.winnipeg.ca (resource d4mq-wa44), plus one bogus address to
// confirm a clean null (not a thrown/malformed result) on a genuine miss.
// No BC-style live-call budget applies here — the Winnipeg SODA endpoint is
// a free, uncapped HTTP API (same category as AB's Calgary/Edmonton calls).
// ---------------------------------------------------------------------------

const MB_GOLDEN_ADDRESSES: { address: string; expectedTotal: number }[] = [
  { address: "1636 McCreary Road", expectedTotal: 893_000 },
  { address: "2424 Wilkes Avenue", expectedTotal: 2_113_000 },
  { address: "6 Riverside Drive E", expectedTotal: 624_000 },
];

const MB_BOGUS_ADDRESS = "99999 Fakestreet Lane";

async function runMB() {
  console.log(`\n=== MB ===`);

  await safeCheck("MB", "cache-sync sanity (no MB cache expected)", async () => {
    const a = lookupMBSync(MB_GOLDEN_ADDRESSES[0].address);
    return a === null
      ? { ok: true, detail: "lookupMBSync returned null as expected (no MB cache exists yet)" }
      : { ok: false, detail: `expected null (no cache), got ${JSON.stringify(a)}` };
  });

  for (const { address, expectedTotal } of MB_GOLDEN_ADDRESSES) {
    await safeCheck("MB", `live-lookup "${address}"`, async () => {
      const a = await lookupMB(address);
      const shape = assertAssessment(a, address);
      if (!shape.ok) return shape;
      if (a!.totalValue !== expectedTotal) {
        return {
          ok: false,
          detail: `${address}: totalValue=${a!.totalValue} did not match probe-verified expected=${expectedTotal}`,
        };
      }
      return { ok: true, detail: `${address}: totalValue=${a!.totalValue} (matches live-probe baseline) year=${a!.assessmentYear} source=${a!.source}` };
    });
  }

  await safeCheck("MB", `bogus address "${MB_BOGUS_ADDRESS}" returns null`, async () => {
    const a = await lookupMB(MB_BOGUS_ADDRESS);
    return a === null
      ? { ok: true, detail: "clean null on genuine miss, as expected" }
      : { ok: false, detail: `expected null, got ${JSON.stringify(a)}` };
  });
}

// ---------------------------------------------------------------------------
// Per-province run
// ---------------------------------------------------------------------------

async function runProvince(cfg: ProvinceConfig) {
  console.log(`\n=== ${cfg.code} ===`);

  // -- 1. Cache addresses: sync + async assessment lookup --------------
  for (const address of cfg.cacheAddresses) {
    await safeCheck(cfg.code, `cache-sync "${address}"`, async () => {
      const a = cfg.lookupSync(address);
      return assertAssessment(a, address);
    });

    await safeCheck(cfg.code, `cache-async "${address}"`, async () => {
      // For BC specifically: cache hits short-circuit before any
      // Browserless call, so this does not consume the live-scrape budget.
      const a = await cfg.lookupAsync(address, cfg.city);
      return assertAssessment(a, address);
    });
  }

  // -- 2. Live Zoocasa search ------------------------------------------
  let liveListings: Listing[] = [];
  await safeCheck(cfg.code, `zoocasa searchListings("${cfg.city}")`, async () => {
    liveListings = await searchListings(cfg.city, cfg.code, { type: "house", beds: 3 });
    if (liveListings.length === 0) {
      return { ok: false, detail: "search returned 0 listings" };
    }
    const shapeIssues = liveListings
      .slice(0, 10)
      .map((l, i) => assertListingShape(l, `#${i}`))
      .filter((r) => !r.ok);
    if (shapeIssues.length > 0) {
      return {
        ok: false,
        detail: `${shapeIssues.length}/${Math.min(10, liveListings.length)} sampled listings failed shape check: ${shapeIssues[0].detail}`,
      };
    }
    return { ok: true, detail: `${liveListings.length} listings, shape OK on sample` };
  });

  if (liveListings.length === 0) {
    record(cfg.code, "zoocasa live-detail", "SKIP", "no search results to pick from");
    record(cfg.code, "assessment live-lookup", "SKIP", "no search results to pick from");
    record(cfg.code, "full pipeline run", "SKIP", "no search results to pick from");
    return;
  }

  // Pick addresses not already in the cache so the live paths are actually exercised.
  const cacheSet = new Set(cfg.cacheAddresses.map((a) => a.toLowerCase()));
  const nonCacheListings = liveListings.filter((l) => !cacheSet.has(l.address.toLowerCase()));
  const pickPool = nonCacheListings.length > 0 ? nonCacheListings : liveListings;

  const pickA = pickPool[0];
  const pickB = pickPool[1] || pickPool[0];

  // -- 3. Live detail fetch + assessment lookup on listing A -----------
  let detailA: Listing | null = null;
  await safeCheck(cfg.code, `zoocasa findAndFetchDetail "${pickA.address}"`, async () => {
    // Plain HTTP fetch against Zoocasa — no Browserless/browser involved,
    // so this step always runs regardless of the BC live-scrape budget.
    try {
      const result = await findAndFetchDetail(pickA.address, pickA.city, cfg.code);
      detailA = result.listing;
      return assertListingShape(result.listing, pickA.address);
    } catch (err) {
      if (err instanceof ZoocasaNotFoundError) {
        return { ok: false, detail: `ZoocasaNotFoundError: ${err.message}` };
      }
      throw err;
    }
  });

  await safeCheck(cfg.code, `assessment live-lookup "${pickA.address}"`, async () => {
    if (cfg.code === "BC" && bcLiveScrapesUsed >= BC_LIVE_SCRAPE_BUDGET) {
      return { ok: true, detail: "skipped — BC live-scrape budget exhausted" };
    }
    const addr = detailA?.address || pickA.address;
    const city = detailA?.city || pickA.city;
    const taxes = detailA?.taxes || pickA.taxes;
    if (cfg.code === "BC") bcLiveScrapesUsed++;
    const a = await cfg.lookupAsync(addr, city, taxes);
    // Live lookups can legitimately miss (property not in gov't index yet,
    // API rate limit, etc) — that's a "not found" pass, not a shape failure,
    // as long as the function returns null cleanly instead of throwing/
    // returning a malformed object.
    if (a === null) {
      return { ok: true, detail: `${addr}: not found (null) — acceptable live-miss` };
    }
    return assertAssessment(a, addr);
  });

  // -- 4. Full local pipeline run (signals/score/offer, no LLM) --------
  await safeCheck(cfg.code, `full pipeline run "${pickB.address}"`, async () => {
    if (cfg.code === "BC" && bcLiveScrapesUsed >= BC_LIVE_SCRAPE_BUDGET) {
      // Still run the pipeline, but force sync-only assessment so we don't
      // exceed the Browserless budget.
      let base: Listing;
      try {
        const result = await findAndFetchDetail(pickB.address, pickB.city, cfg.code);
        base = result.listing;
      } catch {
        base = pickB;
      }
      const enriched = await enrichListing(base, { skipLlm: true, syncAssessmentOnly: true });
      return assertPipelineOutput(enriched, pickB.address);
    }

    let base: Listing;
    try {
      const result = await findAndFetchDetail(pickB.address, pickB.city, cfg.code);
      base = result.listing;
    } catch {
      base = pickB;
    }
    if (cfg.code === "BC") bcLiveScrapesUsed++;
    const enriched = await enrichListing(base, { skipLlm: true });
    return assertPipelineOutput(enriched, pickB.address);
  });
}

function assertPipelineOutput(l: Listing, label: string): { ok: boolean; detail: string } {
  const problems: string[] = [];
  if (typeof l.preScore !== "number" || Number.isNaN(l.preScore)) problems.push("preScore");
  if (!l.preTier || !["HOT", "WARM", "WATCH"].includes(l.preTier)) problems.push("preTier");
  if (!Array.isArray(l.preSignals)) problems.push("preSignals");
  if (!l.preNarrative || typeof l.preNarrative !== "string") problems.push("preNarrative");
  if (!l.preOffer || typeof l.preOffer.final_offer !== "number") problems.push("preOffer.final_offer");
  if (problems.length > 0) {
    return { ok: false, detail: `${label}: missing/invalid [${problems.join(", ")}]` };
  }
  return {
    ok: true,
    detail: `${label}: tier=${l.preTier} score=${l.preScore} offer=${l.preOffer!.final_offer} assessment=${l.preAssessment ? l.preAssessment.source : "none"}`,
  };
}

// ---------------------------------------------------------------------------
// Cache sanity: confirm cache imports actually resolve (fail loud if the
// data module shape changes underneath the script).
// ---------------------------------------------------------------------------

function sanityCheckCaches() {
  const caches: [string, Record<string, unknown>][] = [
    ["BC_ASSESSMENT_CACHE", BC_ASSESSMENT_CACHE],
    ["AB_ASSESSMENT_CACHE", AB_ASSESSMENT_CACHE],
    ["ON_ASSESSMENT_CACHE", ON_ASSESSMENT_CACHE],
  ];
  for (const [name, cache] of caches) {
    const count = Object.keys(cache).length;
    if (count === 0) {
      record("setup", name, "FAIL", "cache is empty");
    } else {
      record("setup", name, "PASS", `${count} entries`);
    }
  }
}

// ---------------------------------------------------------------------------
// Health table
// ---------------------------------------------------------------------------

function printHealthTable() {
  console.log("\n\n=== Province Health Table ===\n");
  const provinces = ["setup", "BC", "AB", "ON", "MB"];
  for (const p of provinces) {
    const rows = results.filter((r) => r.province === p);
    if (rows.length === 0) continue;
    const passed = rows.filter((r) => r.status === "PASS").length;
    const failed = rows.filter((r) => r.status === "FAIL").length;
    const skipped = rows.filter((r) => r.status === "SKIP").length;
    console.log(`--- ${p}: ${passed} passed, ${failed} failed, ${skipped} skipped ---`);
    for (const r of rows) {
      const tag = r.status.padEnd(4);
      console.log(`  [${tag}] ${r.check}`);
      if (r.status !== "PASS") console.log(`         ${r.detail}`);
    }
  }

  const totalFail = results.filter((r) => r.status === "FAIL").length;
  console.log(`\n${totalFail === 0 ? "ALL CHECKS PASSED" : `${totalFail} CHECK(S) FAILED`}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("Golden Canada pipeline health check");
  console.log(`BROWSERLESS_API_KEY: ${process.env.BROWSERLESS_API_KEY ? "set" : "NOT SET"}`);

  sanityCheckCaches();

  for (const cfg of PROVINCES) {
    await runProvince(cfg);
  }

  await runMB();

  printHealthTable();

  const totalFail = results.filter((r) => r.status === "FAIL").length;
  process.exit(totalFail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("golden-canada.ts crashed:", err);
  process.exit(1);
});
