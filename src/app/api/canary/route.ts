/**
 * /api/canary
 *
 * Daily health probe for both the Canadian and US pipelines. Runs cheap,
 * representative checks in parallel (wall time bounded by the slowest
 * single check, not the sum):
 *
 * Canadian:
 *   1. Zoocasa searchListings("Victoria", "BC") — shape-check the response
 *      (province/city scoping, price/address/city/dom presence).
 *   2. Zoocasa rolling per-city baseline (checkZoocasaBaseline) — probes
 *      the cron's real Canadian targets (Victoria/Saanich/Langford/
 *      Vancouver/Surrey BC, Calgary/Edmonton AB, Toronto/Hamilton/Ottawa
 *      ON, Winnipeg MB) with the SAME filtered query shape the cron sends
 *      (type=house, beds=3, that city's price band — not a bare "house"
 *      query) and compares each city's searchListings() count against its
 *      own rolling KV baseline, alerting on a SUSTAINED proportional drop
 *      rather than a fixed floor or a single low reading. See the doc
 *      comment above checkZoocasaBaseline() for the full rationale,
 *      including its cold-start honesty and its known "outage predates the
 *      baseline" blind spot.
 *   3. Zoocasa cross-city feed fingerprint (checkZoocasaFeedFingerprint) —
 *      independently re-fetches RAW (pre-citiesMatch-filter) search
 *      results for same-province, geographically-DISJOINT city pairs
 *      (Victoria/Vancouver BC, Calgary/Edmonton AB, Toronto/Ottawa ON —
 *      audited against CITY_SIBLINGS in both directions, see
 *      ZOOCASA_FINGERPRINT_PAIRS' comment) and compares their ORDERED
 *      MLS-number sequences. Near-identical order between two disjoint
 *      cities' raw inventories is unambiguous proof Zoocasa is serving one
 *      frozen feed for both (see citiesMatch()'s doc comment in
 *      src/lib/zoocasa.ts). This is the strong, history-independent signal
 *      that closes the blind spot check #1's old zero-only threshold had:
 *      outages that leak a small non-zero number of listings through the
 *      city filter used to read as healthy.
 *   4. BC Assessment cache lookup — no network, just confirms the cache
 *      module loads and returns a well-formed Assessment.
 *   5. Calgary SODA health probe — confirms assessed_value is still
 *      present/numeric on the live dataset (broad query, no address filter).
 *   6. Edmonton SODA health probe — same shape as Calgary's, on the
 *      Edmonton dataset. Broad query rather than one hardcoded address:
 *      Edmonton's grid uses numeric street names ("109 Street"), which
 *      trips lookupAB()'s unit-vs-house-number parsing heuristic when no
 *      explicit unit is supplied, and specific parcels drop off the roll
 *      dataset over time — a broad query proves live reachability + schema
 *      health without that fragility (see RUNBOOK.md §8 gap #4).
 *   7. Winnipeg SODA health probe — same shape, on the Winnipeg (MB)
 *      dataset (RUNBOOK.md §8 gap #4).
 *
 * US:
 *   8. Census geocoder — geocodes a fixed known address (cache miss the
 *      first run, KV cache hit on every run after). A cache hit alone
 *      would mask a fully-dead upstream API, so on a cache hit this also
 *      does a short (4s), independent live liveness ping against the
 *      geocoder endpoint (RUNBOOK.md §8 gaps #3 and #10).
 *   9. Neon `regional_econ` — getCountyMarketPanel("US-48453") (Travis
 *      County, TX — same county the geocoder check resolves to) returns a
 *      non-null panel (RUNBOOK.md §8 gap #3).
 *   10. RentCast KV cache infrastructure — a KV SCAN + GET against the
 *      `rentcast:*` namespace, proving the cache read path works. This is
 *      deliberately NOT a live RentCast API call (quota is capped at
 *      45/month and this cron runs daily) — live RentCast health is
 *      intentionally not probed here to preserve quota. A cache-layer
 *      outage would still surface indirectly via `/api/assess`'s
 *      `bundle.meta.errors` logging (see RUNBOOK.md §6).
 *   11. County-assessor live lookup — one Maricopa County live lookup
 *      (`lookupCountyLive`, src/lib/assessment/us-county/index.ts) against
 *      a known-good Phoenix address. Unlike RentCast, this free county API
 *      has no meaningful quota concern, so it's probed live rather than
 *      cache-only — proves the ArcGIS endpoint + field mapping are both
 *      still healthy, not just that the cache path works. A failure here
 *      degrades to RentCast-based assessment in production (never blocks a
 *      user's request), but a silent break would otherwise go undetected
 *      until someone reads `[county-live]` logs.
 *
 * Request volume note: checks #2 and #3 together make ~17 GETs to Zoocasa
 * (11 for the baseline probe, 6 for the fingerprint probe — 3 same-
 * province pairs), once per day, all in parallel. That's a deliberate
 * representative subset, not the full city-pair matrix — see
 * ZOOCASA_FINGERPRINT_PAIRS' comment for why one pair per province
 * suffices.
 *
 * Returns 500 (not 200) on any failure so Vercel's cron dashboard marks the
 * run failed and alerts, in addition to the console.error("[canary]", ...)
 * log line for log-based alerting.
 *
 * Auth: same pattern as /api/pipeline/refresh — requires CRON_SECRET as a
 * Bearer token when the env var is set; unauthenticated access is allowed
 * only when CRON_SECRET is unset (Vercel cron infra handles security then).
 */

import { NextResponse } from "next/server";
import { searchListings, buildSearchUrl } from "@/lib/zoocasa";
import { CITIES } from "@/lib/pipeline/ca-cities";
import { lookupBCSync } from "@/lib/assessment/bc";
import { calgarySodaHealthCheck } from "@/lib/assessment/ab";
import { BC_ASSESSMENT_CACHE } from "@/lib/data/assessments";
import {
  geocodeUSAddressWithCacheMeta,
  pingCensusGeocoderLive,
} from "@/lib/geo/census-geocoder";
import { getCountyMarketPanel } from "@/lib/db/regional-econ";
import { lookupCountyLive } from "@/lib/assessment/us-county";
import { getMetaValue, setMetaValue } from "@/lib/kv/listings";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

interface CheckResult {
  ok: boolean;
  detail: string;
}

function errDetail(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

async function checkZoocasaSearch(): Promise<CheckResult> {
  try {
    const listings = await searchListings("Victoria", "BC", { type: "house", beds: 3 });
    if (listings.length === 0) {
      return { ok: false, detail: "searchListings(\"Victoria\", \"BC\") returned 0 listings" };
    }
    const bad = listings.find(
      (l) =>
        !l.address ||
        typeof l.address !== "string" ||
        !l.city ||
        typeof l.city !== "string" ||
        typeof l.price !== "number" ||
        !(l.price > 0) ||
        typeof l.dom !== "number" ||
        Number.isNaN(l.dom)
    );
    if (bad) {
      return { ok: false, detail: `malformed listing in response: address="${bad.address}"` };
    }
    return { ok: true, detail: `${listings.length} listings, shape OK` };
  } catch (err) {
    return { ok: false, detail: errDetail(err) };
  }
}

// ---------------------------------------------------------------------------
// Zoocasa outage detectors — checkZoocasaBaseline() and
// checkZoocasaFeedFingerprint()
//
// Background: Zoocasa's search endpoint has a live server-side regression
// where /{city}-{prov}-real-estate resolves internally to the PROVINCE
// rather than the requested city, freezing every city/page/cursor/filter
// combination within a province onto one identical 27-listing page (see
// citiesMatch()'s doc comment in src/lib/zoocasa.ts for the full writeup).
// searchListings() defends against this by dropping listings whose
// returned city doesn't match the request, which is correct for data
// hygiene but wrong for monitoring: it turns "province-wide feed freeze"
// into "returns a small non-zero number" (Calgary 0, Ottawa 1, Victoria
// 1-2, Toronto 6, Edmonton 24 — Edmonton only survives because Edmonton IS
// the frozen AB feed). checkZoocasaSearch()'s `listings.length === 0` gate
// above is blind to this for as long as even one cousin listing leaks
// through the filter — which, empirically, it always has.
// ---------------------------------------------------------------------------

interface ZoocasaBaselineState {
  ema: number;
  streak: number;
  samples: number;
  updatedAt: string;
}

const ZOOCASA_BASELINE_KV_PREFIX = "canary:zoocasa:baseline:";
// Bump this whenever probeCityBaseline()'s query shape changes (filters
// added/removed/changed). The KV key embeds it so a shape change starts a
// clean baseline instead of comparing today's counts against yesterday's
// numbers for a DIFFERENT query — that comparison would be meaningless and
// would produce phantom drop/watch alerts (or phantom "ok"s) that have
// nothing to do with actual Zoocasa health. v1 was city-only (no version
// segment, no province segment, `{ type: "house" }` with no beds/price
// filter); v2 adds province to the key (a city name alone isn't guaranteed
// unique across provinces) and switches the probe to the cron's actual
// filtered query — see probeCityBaseline()'s doc comment.
const ZOOCASA_BASELINE_SCHEMA_VERSION = "v2";
const ZOOCASA_BASELINE_EMA_ALPHA = 0.3;
// A single low day is noise (real inventory dips happen); this many
// consecutive low readings in a row is not.
const ZOOCASA_BASELINE_MIN_STREAK_TO_ALERT = 2;
// Don't judge a "drop" against a baseline we've barely observed yet.
const ZOOCASA_BASELINE_MIN_SAMPLES_TO_TRUST = 3;
// count < 50% of the rolling baseline counts as a low reading.
const ZOOCASA_BASELINE_DROP_RATIO = 0.5;

// The cron's real Canadian targets, WITH the same price bands
// src/app/api/pipeline/refresh/route.ts's CITIES array uses. That file isn't
// exported and this change doesn't own it (a concurrent agent does, and it
// isn't allowed to be edited here), so the bands are duplicated rather than
// imported — same tradeoff already made for the city list itself. If that
// file's CITIES array changes its price bands, this list needs a manual
// update too (bump ZOOCASA_BASELINE_SCHEMA_VERSION when it does, so the
// baseline doesn't silently compare new-query counts to old-query history).
// Derived from the cron's own CITIES config — never re-declared. These
// bands used to be copied here by hand, which meant a band changed in the
// pipeline left this probe silently querying the old shape while still
// reporting on the new one. See src/lib/pipeline/ca-cities.ts.
const ZOOCASA_BASELINE_CITIES: Array<{
  city: string;
  province: string;
  minPrice: number;
  maxPrice: number;
}> = CITIES.map(({ city, province, minPrice, maxPrice }) => ({
  city,
  province,
  minPrice,
  maxPrice,
}));

type BaselineProbeStatus = "ok" | "drop" | "watch" | "cold-start" | "error";

interface BaselineProbeResult {
  city: string;
  status: BaselineProbeStatus;
  detail: string;
}

async function probeCityBaseline(
  city: string,
  province: string,
  minPrice: number,
  maxPrice: number
): Promise<BaselineProbeResult> {
  const key = `${ZOOCASA_BASELINE_KV_PREFIX}${ZOOCASA_BASELINE_SCHEMA_VERSION}:${province.toLowerCase()}:${city.toLowerCase()}`;
  try {
    // Same filter shape the refresh cron actually sends (see CITIES +
    // Phase 1 in src/app/api/pipeline/refresh/route.ts): type=house, beds=3,
    // and this city's price band. Probing with `{ type: "house" }` alone
    // (the old behavior) checks a query the cron never makes — a filtered
    // search can return zero while an unfiltered one still returns plenty,
    // which is exactly the gap that let this baseline stay green while the
    // cron's real requests came back empty. The cron also fires a second
    // variant per city (same filters, `sortBy: "days-desc"`) purely to pick
    // up listings sorted the other way for dedup purposes — same filter
    // shape, so it fails identically to the one probed here. Probing both
    // would double this check's request volume for no additional health
    // signal, so only one is sent.
    const listings = await searchListings(city, province, {
      type: "house",
      beds: 3,
      minPrice,
      maxPrice,
    });
    const count = listings.length;

    const raw = await getMetaValue(key);
    const prev: ZoocasaBaselineState | null = raw ? JSON.parse(raw) : null;

    // Cold start: not enough history to judge a proportional drop with any
    // confidence. Reported as its own distinct status rather than folded
    // into "ok" — a check that can't yet determine health must say so, not
    // pass silently (see file-level fail-loud policy).
    if (!prev || prev.samples < ZOOCASA_BASELINE_MIN_SAMPLES_TO_TRUST) {
      const samples = (prev?.samples ?? 0) + 1;
      const ema = prev ? prev.ema + ZOOCASA_BASELINE_EMA_ALPHA * (count - prev.ema) : count;
      const next: ZoocasaBaselineState = { ema, streak: 0, samples, updatedAt: new Date().toISOString() };
      await setMetaValue(key, JSON.stringify(next));
      return {
        city,
        status: "cold-start",
        detail: `${city}: ${count} listings — baseline warming up (${samples}/${ZOOCASA_BASELINE_MIN_SAMPLES_TO_TRUST} samples), drop-detection not yet active`,
      };
    }

    const isLow = count < prev.ema * ZOOCASA_BASELINE_DROP_RATIO;

    if (isLow) {
      const streak = prev.streak + 1;
      // Freeze the EMA while anomalous — otherwise a sustained outage drags
      // the "expected" count down to match itself and this check goes
      // blind for the rest of the incident (see the cold-start blind-spot
      // note in checkZoocasaBaseline()'s doc comment below).
      const next: ZoocasaBaselineState = {
        ema: prev.ema,
        streak,
        samples: prev.samples + 1,
        updatedAt: new Date().toISOString(),
      };
      await setMetaValue(key, JSON.stringify(next));
      if (streak >= ZOOCASA_BASELINE_MIN_STREAK_TO_ALERT) {
        return {
          city,
          status: "drop",
          detail: `${city}: ${count} listings vs baseline ~${Math.round(prev.ema)} (${streak} consecutive low readings) — sustained drop`,
        };
      }
      return {
        city,
        status: "watch",
        detail: `${city}: ${count} listings vs baseline ~${Math.round(prev.ema)} (streak ${streak}/${ZOOCASA_BASELINE_MIN_STREAK_TO_ALERT}, not yet alerting)`,
      };
    }

    const ema = prev.ema + ZOOCASA_BASELINE_EMA_ALPHA * (count - prev.ema);
    const next: ZoocasaBaselineState = { ema, streak: 0, samples: prev.samples + 1, updatedAt: new Date().toISOString() };
    await setMetaValue(key, JSON.stringify(next));
    return { city, status: "ok", detail: `${city}: ${count} listings (baseline ~${Math.round(ema)})` };
  } catch (err) {
    return { city, status: "error", detail: `${city}: ${errDetail(err)}` };
  }
}

/**
 * Rolling per-city baseline drop detector. A fixed floor is fragile — real
 * inventory swings by season and by city — so this keeps an exponential
 * moving average of each city's searchListings() count in KV
 * (getMetaValue/setMetaValue, src/lib/kv/listings.ts) and alerts only when
 * a city reads sustained (2+ consecutive runs, ZOOCASA_BASELINE_MIN_STREAK_TO_ALERT)
 * well below its own history — not on a single low day, and not against a
 * hardcoded number. Cold start (no baseline yet, or fewer than
 * ZOOCASA_BASELINE_MIN_SAMPLES_TO_TRUST samples) is surfaced as its own
 * "cold-start" status distinct from "ok"/"drop", per the file's fail-loud
 * philosophy: a check that cannot yet judge health must say so rather than
 * silently pass.
 *
 * Probes with the SAME filter shape the refresh cron sends per city (beds=3
 * + that city's price band — see ZOOCASA_BASELINE_CITIES), not a bare
 * `{ type: "house" }` query. A filtered search can fail (return 0, or leak
 * through only a handful of listings via a frozen province-wide feed) while
 * an unfiltered query against the same broken page still comes back with
 * plenty of results — probing the unfiltered shape would leave this check
 * blind to exactly the kind of break the cron would actually hit. KV keys
 * are province-scoped and version-tagged (ZOOCASA_BASELINE_SCHEMA_VERSION)
 * specifically so that if this probe's filters change again later, the
 * baseline resets cleanly instead of silently comparing new-query counts
 * against history built from a different query.
 *
 * Known limitation: this check has no memory of "normal" from before it
 * was deployed. The outage this check was written for predates its first
 * run, so the first several days of samples seed the baseline off of
 * already-degraded counts — a sustained-but-stable-at-a-lower-level outage
 * can look like "the new normal" to this detector alone once it warms up.
 * That is exactly why checkZoocasaFeedFingerprint() below exists as an
 * independent, history-free signal that catches the live incident on day
 * one regardless of what this check's baseline has learned.
 */
async function checkZoocasaBaseline(): Promise<CheckResult> {
  const results = await Promise.all(
    ZOOCASA_BASELINE_CITIES.map((c) => probeCityBaseline(c.city, c.province, c.minPrice, c.maxPrice))
  );

  const drops = results.filter((r) => r.status === "drop");
  const errors = results.filter((r) => r.status === "error");
  const coldStarts = results.filter((r) => r.status === "cold-start");

  const ok = drops.length === 0 && errors.length === 0;
  const summary =
    (coldStarts.length > 0 ? `[${coldStarts.length}/${results.length} cities cold-start] ` : "") +
    results.map((r) => r.detail).join(" | ");

  return { ok, detail: summary };
}

interface RawZoocasaSample {
  count: number;
  mlsSet: Set<string>;
  // Same identifiers as mlsSet, but in the order the page returned them.
  // checkZoocasaFeedFingerprint() uses this (not just the set) to detect a
  // frozen shared feed — see that function's doc comment for why ORDER
  // matters here, not just membership.
  mlsOrdered: string[];
  // Raw listings whose sub_division claims to be the requested city — a
  // crude (no metro-sibling awareness), exact-match-only recomputation of
  // the same signal searchListings() logs via
  // console.error("[zoocasa-scope] dropped N/M (P%)..."). See the comment
  // in checkZoocasaFeedFingerprint() for why this is recomputed
  // independently rather than captured from that log line.
  scopeMatchCount: number;
}

const ZOOCASA_RAW_FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

/**
 * Independent, minimal re-fetch of a Zoocasa search page, parsed BEFORE any
 * citiesMatch()-style filtering is applied. Deliberately does not call
 * searchListings() — that function's entire job is to hide exactly the
 * symptom this check is looking for.
 *
 * zoocasa.ts's __NEXT_DATA__ extractor (extractNextData) isn't exported and
 * this change isn't allowed to touch zoocasa.ts (a concurrent change owns
 * that file), so this duplicates the same few lines of JSON extraction
 * rather than reaching into that module's internals. The only zoocasa.ts
 * export used here is buildSearchUrl(), a pure URL builder with no
 * filtering behavior to sidestep.
 */
async function fetchRawZoocasaSample(city: string, province: string): Promise<RawZoocasaSample | null> {
  const url = buildSearchUrl(city, province, { type: "house" });
  const res = await fetch(url, {
    headers: ZOOCASA_RAW_FETCH_HEADERS,
    signal: AbortSignal.timeout(15_000),
    redirect: "follow",
  });
  if (!res.ok) return null;

  const html = await res.text();
  const match = html.match(
    /<script\s+id="__NEXT_DATA__"\s+type="application\/json">([\s\S]*?)<\/script>/
  );
  if (!match) return null;

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(match[1]);
  } catch {
    return null;
  }

  const props = data.props as Record<string, unknown> | undefined;
  const pageProps = props?.pageProps as Record<string, unknown> | undefined;
  const innerProps = pageProps?.props as Record<string, unknown> | undefined;
  const listings = (innerProps?.listings || []) as Array<{
    mls?: string;
    address?: string;
    sub_division?: string;
  }>;

  const mlsSet = new Set<string>();
  const mlsOrdered: string[] = [];
  let scopeMatchCount = 0;
  const wantCity = city.trim().toLowerCase();
  for (const l of listings) {
    const id = l.mls || l.address;
    if (id) {
      mlsSet.add(String(id));
      mlsOrdered.push(String(id));
    }
    if ((l.sub_division || "").trim().toLowerCase() === wantCity) scopeMatchCount++;
  }

  return { count: listings.length, mlsSet, mlsOrdered, scopeMatchCount };
}

// One same-province pair per province that has 2+ probed cities is enough
// to fingerprint: the regression resolves at the province level (see
// citiesMatch()'s doc comment in zoocasa.ts), so if it's broken for one
// pair in a province it's broken for every city in that province. Winnipeg
// (MB) has no second MB city among the cron's real targets, so MB has no
// fingerprint pair here — a gap in cron target coverage, not in this
// check's logic (see final report / RUNBOOK for this caveat).
//
// Every pair below is audited against CITY_SIBLINGS (src/lib/zoocasa.ts) in
// BOTH directions (that map is keyed by hub only, so a city can be a
// sibling of a pair partner without appearing as its own key) to make sure
// the two cities are geographically disjoint markets with no legitimate
// shared inventory:
//   - Victoria/Vancouver (BC): victoria's sibling list (Langford, Saanich,
//     Esquimalt, Oak Bay, Sooke, Colwood, View Royal, Central/North
//     Saanich, Sidney, Metchosin) does not include Vancouver; vancouver's
//     sibling list (Burnaby, Surrey, Richmond, Coquitlam, Port Coquitlam,
//     Port Moody, North/West Vancouver, New Westminster, Delta, Langley,
//     White Rock, Maple Ridge, Pitt Meadows) does not include Victoria.
//     Disjoint — replaces the PREVIOUS Victoria/Saanich pair, which was a
//     bug: Saanich is explicitly listed as a Victoria metro sibling, so
//     citiesMatch() (and this codebase's own model of the Victoria market)
//     considers genuine cross-listing between them expected behavior, not
//     evidence of a frozen feed. That pair could false-alarm on a perfectly
//     healthy provider and has been removed.
//   - Calgary/Edmonton (AB): calgary's siblings (Airdrie, Cochrane,
//     Okotoks, Chestermere) don't include Edmonton; edmonton's siblings
//     (St. Albert, Sherwood Park, Spruce Grove, Stony Plain, Beaumont,
//     Leduc, Fort Saskatchewan) don't include Calgary. Disjoint — unchanged
//     from before, confirmed clean.
//   - Toronto/Ottawa (ON): toronto's (large GTA) sibling list doesn't
//     include Ottawa; ottawa's siblings (Gatineau, Kanata, Orleans, Nepean)
//     don't include Toronto. Disjoint — unchanged from before, confirmed
//     clean.
const ZOOCASA_FINGERPRINT_PAIRS: Array<{
  a: { city: string; province: string };
  b: { city: string; province: string };
}> = [
  { a: { city: "Victoria", province: "BC" }, b: { city: "Vancouver", province: "BC" } },
  { a: { city: "Calgary", province: "AB" }, b: { city: "Edmonton", province: "AB" } },
  { a: { city: "Toronto", province: "ON" }, b: { city: "Ottawa", province: "ON" } },
];

// Two disjoint cities' raw search results matching at/above this fraction
// of compared POSITIONS (same MLS number at the same index, not just same
// membership) is unambiguous. The live frozen-feed regression serves one
// literal HTTP response for every city in a province, so a broken feed
// doesn't just share listings between two cities — it returns them in the
// exact same order, because it's the same response. An unordered overlap
// RATIO (the previous approach here) requires picking a cutoff that's a
// judgment call about "how much sharing is too much for nearby markets";
// this codebase's own sibling-pair incident (Victoria/Saanich, see the
// audit note on ZOOCASA_FINGERPRINT_PAIRS above) is proof that judgment
// call is easy to get wrong. Position-for-position identity isn't a
// judgment call: two genuinely independent cities' inventories coinciding
// on both WHICH listings appear and in WHAT ORDER is not something real
// (non-frozen) data can produce by chance, disjoint pair or not — so this
// is used instead of raising the old ratio further.
const FINGERPRINT_ORDERED_MATCH_THRESHOLD = 0.9;
// Not 1.0: the two cities in a pair are fetched with a couple of sequential
// (not simultaneous) requests, so a listing added/removed on Zoocasa's end
// between those two fetches could shift one entry without indicating
// anything is wrong. 90% tolerates that kind of single-listing jitter while
// still requiring near-total positional identity to fire.

/**
 * Fraction of index positions where two ordered ID sequences agree, over
 * the length of the shorter sequence. 1.0 means the two pages returned
 * their listings in identical order — see FINGERPRINT_ORDERED_MATCH_THRESHOLD
 * for why that's the signal this check trusts.
 */
function orderedMatchRatio(a: string[], b: string[]): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;
  let matches = 0;
  for (let i = 0; i < len; i++) {
    if (a[i] === b[i]) matches++;
  }
  return matches / len;
}

// Crude (no metro-sibling awareness) scope-mismatch floor, used only as a
// secondary signal alongside the overlap check above. Deliberately higher
// than citiesMatch()'s effective bar because this heuristic doesn't know
// about CITY_SIBLINGS (e.g. Saanich/Victoria legitimately share some metro
// inventory), so it's tuned to fire only on gross mismatch.
const SCOPE_MISMATCH_THRESHOLD = 0.8;

/**
 * Cross-city feed-identity fingerprint. Re-fetches RAW (pre-citiesMatch)
 * search results for same-province city pairs and compares the ORDERED
 * MLS-number sequences: near-identical order between two geographically
 * disjoint cities' raw inventories is unambiguous proof Zoocasa is serving
 * one frozen feed for both, regardless of what the post-filter listing
 * counts look like. This is the strong, history-independent signal that
 * catches the live incident on day one, closing the gap
 * checkZoocasaBaseline() can't (see that function's "known limitation"
 * note).
 *
 * Pair selection matters as much as the threshold: every pair in
 * ZOOCASA_FINGERPRINT_PAIRS is audited (see the comment there) to confirm
 * neither city is a CITY_SIBLINGS metro sibling of the other. Pairing
 * metro siblings (the previous Victoria/Saanich pair) would make this check
 * fire on legitimate cross-listing between adjacent markets — the exact
 * false-alarm failure mode citiesMatch() itself exists to tolerate. Anyone
 * changing these pairs must re-run that audit in both directions
 * (CITY_SIBLINGS is keyed by hub only).
 */
async function checkZoocasaFeedFingerprint(): Promise<CheckResult> {
  try {
    const cities = ZOOCASA_FINGERPRINT_PAIRS.flatMap((p) => [p.a, p.b]);
    const samples = await Promise.all(cities.map((c) => fetchRawZoocasaSample(c.city, c.province)));
    const byKey = new Map<string, RawZoocasaSample | null>();
    cities.forEach((c, i) => byKey.set(`${c.city}|${c.province}`, samples[i]));

    const problems: string[] = [];
    const notes: string[] = [];

    for (const pair of ZOOCASA_FINGERPRINT_PAIRS) {
      const a = byKey.get(`${pair.a.city}|${pair.a.province}`);
      const b = byKey.get(`${pair.b.city}|${pair.b.province}`);
      const label = `${pair.a.city}/${pair.b.city}`;

      if (!a || !b) {
        problems.push(`${label}: could not fetch raw search page for one or both cities — cannot fingerprint`);
        continue;
      }
      if (a.count === 0 || b.count === 0) {
        notes.push(`${label}: n/a (${a.count}/${b.count} raw listings returned)`);
      } else {
        // Unordered overlap is reported alongside the ordered match for
        // diagnostic context in the response, but the ordered ratio below
        // is what decides pass/fail — see FINGERPRINT_ORDERED_MATCH_THRESHOLD.
        let overlap = 0;
        for (const id of a.mlsSet) if (b.mlsSet.has(id)) overlap++;
        const smaller = Math.min(a.mlsSet.size, b.mlsSet.size);
        const matchRatio = orderedMatchRatio(a.mlsOrdered, b.mlsOrdered);

        if (matchRatio >= FINGERPRINT_ORDERED_MATCH_THRESHOLD) {
          problems.push(
            `${label}: ${Math.round(matchRatio * 100)}% of compared positions returned the SAME MLS number in the SAME order between two disjoint cities' RAW search results (${overlap}/${smaller} unordered overlap) — Zoocasa is serving one frozen feed for both, city scoping is broken`
          );
        } else {
          notes.push(
            `${label}: ${Math.round(matchRatio * 100)}% ordered match, ${overlap}/${smaller} unordered MLS overlap (independent inventories)`
          );
        }
      }

      // Secondary signal: what fraction of each city's RAW listings
      // actually claim (by sub_division) to be in that city. This is the
      // same "dropped N/M" fact searchListings() logs via
      // console.error("[zoocasa-scope] ..."), recomputed here directly
      // from independently-fetched raw data instead of capturing that log
      // line, because (a) the log string isn't a stable API contract and
      // (b) capturing console.error output would require globally
      // monkey-patching console.error, which is unsafe across the
      // concurrent per-city probes this check (and checkZoocasaBaseline)
      // intentionally run in parallel to stay inside the 60s budget.
      for (const [c, s] of [
        [pair.a, a] as const,
        [pair.b, b] as const,
      ]) {
        if (!s || s.count === 0) continue;
        const mismatchRatio = 1 - s.scopeMatchCount / s.count;
        if (mismatchRatio >= SCOPE_MISMATCH_THRESHOLD) {
          problems.push(
            `${c.city}: ${s.count - s.scopeMatchCount}/${s.count} (${Math.round(mismatchRatio * 100)}%) raw listings don't claim to be in ${c.city} — provider scope mismatch`
          );
        }
      }
    }

    if (problems.length > 0) {
      return { ok: false, detail: problems.join(" | ") };
    }
    return { ok: true, detail: notes.join(" | ") || "no fingerprint pairs available" };
  } catch (err) {
    return { ok: false, detail: errDetail(err) };
  }
}

function checkBcCache(): CheckResult {
  try {
    const [address] = Object.keys(BC_ASSESSMENT_CACHE);
    if (!address) {
      return { ok: false, detail: "BC_ASSESSMENT_CACHE is empty" };
    }
    const a = lookupBCSync(address);
    if (!a || !a.found || !(a.totalValue > 0)) {
      return { ok: false, detail: `lookupBCSync("${address}") returned ${JSON.stringify(a)}` };
    }
    return { ok: true, detail: `${address}: totalValue=${a.totalValue}` };
  } catch (err) {
    return { ok: false, detail: errDetail(err) };
  }
}

/**
 * Broad, address-agnostic SODA health probe — mirrors
 * calgarySodaHealthCheck()'s shape (ab.ts) but implemented locally since
 * ab.ts/mb.ts aren't owned by this change. Queries for any residential
 * record with no address filter, so the result reflects dataset/schema
 * health (is the assessed-value field still present and numeric?) rather
 * than whether one specific parcel still exists on the current roll.
 */
async function sodaHealthCheck(opts: {
  label: string;
  url: string;
  where?: string;
  valueField: string;
  timeoutMs?: number;
}): Promise<CheckResult> {
  try {
    const url = new URL(opts.url);
    if (opts.where) url.searchParams.set("$where", opts.where);
    url.searchParams.set("$limit", "1");

    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
    });
    if (!res.ok) {
      return { ok: false, detail: `${opts.label}: HTTP ${res.status}` };
    }
    const data = await res.json();
    if (!Array.isArray(data)) {
      return { ok: false, detail: `${opts.label}: response was not an array — got ${typeof data}` };
    }
    if (data.length === 0) {
      return { ok: false, detail: `${opts.label}: query returned 0 records` };
    }
    const raw = (data[0] as Record<string, unknown>)[opts.valueField];
    const value = Math.round(parseFloat(String(raw)));
    if (raw === undefined || raw === null || !Number.isFinite(value)) {
      return { ok: false, detail: `${opts.label}: ${opts.valueField}="${raw}" missing/unparseable` };
    }
    return { ok: true, detail: `${opts.label}: ${opts.valueField}=${value}` };
  } catch (err) {
    return { ok: false, detail: `${opts.label}: ${errDetail(err)}` };
  }
}

function checkCaEdmonton(): Promise<CheckResult> {
  return sodaHealthCheck({
    label: "edmonton q7d6-ambg",
    url: "https://data.edmonton.ca/resource/q7d6-ambg.json",
    where: "tax_class='Residential'",
    valueField: "assessed_value",
    timeoutMs: 10_000,
  });
}

function checkCaWinnipeg(): Promise<CheckResult> {
  return sodaHealthCheck({
    label: "winnipeg d4mq-wa44",
    url: "https://data.winnipeg.ca/resource/d4mq-wa44.json",
    valueField: "total_assessed_value",
    timeoutMs: 10_000,
  });
}

// Fixed, well-formed US address — resolves to Travis County, TX
// (US-48453), the same county checkUsNeon() reads. First run of the day is
// a KV cache miss (live geocode); every run after is a cache hit (see
// src/lib/geo/census-geocoder.ts). A cache hit is still a meaningful
// pass — it proves the cache+lookup path works — but doesn't by itself
// prove the upstream API is alive, hence the supplementary live ping below.
const US_GEOCODER_PROBE_ADDRESS = "301 W 2nd St, Austin, TX";

async function checkUsGeocoder(): Promise<CheckResult> {
  try {
    const { result, cacheHit } = await geocodeUSAddressWithCacheMeta(US_GEOCODER_PROBE_ADDRESS);
    if (!result) {
      return { ok: false, detail: `geocodeUSAddress("${US_GEOCODER_PROBE_ADDRESS}") returned no match` };
    }
    if (!result.countyFips || !result.stateFips || typeof result.lat !== "number" || typeof result.lon !== "number") {
      return { ok: false, detail: `malformed CensusGeocodeResult: ${JSON.stringify(result)}` };
    }

    if (cacheHit) {
      const alive = await pingCensusGeocoderLive(4000);
      if (!alive) {
        return {
          ok: false,
          detail: `cache hit (stateFips=${result.stateFips} countyFips=${result.countyFips}) but live liveness ping to the geocoder endpoint failed — upstream API may be down`,
        };
      }
      return { ok: true, detail: `cache hit, countyFips=US-${result.stateFips}${result.countyFips}; live ping OK` };
    }

    return { ok: true, detail: `cache miss (live geocode), countyFips=US-${result.stateFips}${result.countyFips}` };
  } catch (err) {
    return { ok: false, detail: errDetail(err) };
  }
}

const US_NEON_PROBE_COUNTY = "US-48453"; // Travis County, TX (Austin)

async function checkUsNeon(): Promise<CheckResult> {
  try {
    const panel = await getCountyMarketPanel(US_NEON_PROBE_COUNTY);
    if (!panel) {
      return { ok: false, detail: `getCountyMarketPanel("${US_NEON_PROBE_COUNTY}") returned null` };
    }
    return { ok: true, detail: `${US_NEON_PROBE_COUNTY}: medianHomeValue=${panel.medianHomeValue}` };
  } catch (err) {
    return { ok: false, detail: errDetail(err) };
  }
}

/**
 * Proves the RentCast KV cache read path works (SCAN + GET against the
 * `rentcast:*` namespace) WITHOUT making a live RentCast API call — RentCast
 * quota is capped at 45/month and this cron runs daily, so live RentCast
 * health is intentionally not probed here. A live RentCast outage would
 * still surface indirectly via /api/assess's `bundle.meta.errors` logging
 * (see RUNBOOK.md §6/§7.3) — this check only answers "is the cache
 * infrastructure itself reachable and readable," not "is RentCast up."
 */
async function checkUsRentcastCache(): Promise<CheckResult> {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    return { ok: false, detail: "KV_REST_API_URL/TOKEN not configured — cannot probe rentcast cache" };
  }
  const headers = { Authorization: `Bearer ${token}` };
  try {
    const scanRes = await fetch(`${url}/scan/0/match/rentcast:*/count/10`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(8000),
    });
    if (!scanRes.ok) {
      return { ok: false, detail: `KV SCAN rentcast:* failed: HTTP ${scanRes.status}` };
    }
    const scanBody = await scanRes.json();
    const keys: string[] = scanBody?.result?.[1] ?? [];
    if (keys.length === 0) {
      return { ok: false, detail: "no rentcast:* keys found in KV — cache namespace empty (not a live RentCast probe)" };
    }

    const sampleKey = keys[0];
    const getRes = await fetch(`${url}/get/${encodeURIComponent(sampleKey)}`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(8000),
    });
    if (!getRes.ok) {
      return { ok: false, detail: `KV GET "${sampleKey}" failed: HTTP ${getRes.status}` };
    }
    const getBody = await getRes.json();
    if (getBody?.result == null) {
      return { ok: false, detail: `KV GET "${sampleKey}" returned no value` };
    }
    return {
      ok: true,
      detail: `${keys.length} rentcast:* key(s) sampled, "${sampleKey}" readable — cache infra OK (live RentCast health intentionally not probed, quota-preserving)`,
    };
  } catch (err) {
    return { ok: false, detail: errDetail(err) };
  }
}

// Known-good Maricopa County (Phoenix, AZ) address — same one
// maricopaHealthCheck() in maricopa.ts probes (a genuine single-family
// match, not one of that module's documented ambiguous-condo addresses —
// see maricopaHealthCheck's own doc comment for why the address choice
// matters here). FIPS "04013" matches the registry key in
// src/lib/assessment/us-county/index.ts.
const US_COUNTY_LIVE_PROBE = { countyFips: "04013", street: "8429 W Vernon Ave", city: "Phoenix" };

async function checkUsCountyLive(): Promise<CheckResult> {
  try {
    const result = await lookupCountyLive(
      US_COUNTY_LIVE_PROBE.countyFips,
      US_COUNTY_LIVE_PROBE.street,
      US_COUNTY_LIVE_PROBE.city
    );
    if (!result) {
      return {
        ok: false,
        detail: `lookupCountyLive("${US_COUNTY_LIVE_PROBE.countyFips}", "${US_COUNTY_LIVE_PROBE.street}") returned null (no match, or the ArcGIS endpoint/schema may have changed)`,
      };
    }
    if (!(result.assessedValue > 0)) {
      return { ok: false, detail: `assessedValue not usable: ${JSON.stringify(result)}` };
    }
    return {
      ok: true,
      detail:
        `assessedValue=${result.assessedValue}` +
        (result.marketValue ? ` marketValue=${result.marketValue}` : "") +
        ` year=${result.assessmentYear}`,
    };
  } catch (err) {
    return { ok: false, detail: errDetail(err) };
  }
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const [
    zoocasaSearch,
    zoocasaBaseline,
    zoocasaFingerprint,
    calgarySoda,
    edmontonSoda,
    winnipegSoda,
    usGeocoder,
    usNeon,
    usRentcastCache,
    usCountyLive,
  ] = await Promise.all([
    checkZoocasaSearch(),
    checkZoocasaBaseline(),
    checkZoocasaFeedFingerprint(),
    calgarySodaHealthCheck(),
    checkCaEdmonton(),
    checkCaWinnipeg(),
    checkUsGeocoder(),
    checkUsNeon(),
    checkUsRentcastCache(),
    checkUsCountyLive(),
  ]);
  const bcCache = checkBcCache();

  const checks = {
    zoocasaSearch,
    zoocasaBaseline,
    zoocasaFingerprint,
    bcCache,
    calgarySoda,
    edmontonSoda,
    winnipegSoda,
    usGeocoder,
    usNeon,
    usRentcastCache,
    usCountyLive,
  };
  const failures = Object.entries(checks)
    .filter(([, result]) => !result.ok)
    .map(([name, result]) => `${name}: ${result.detail}`);

  const ok = failures.length === 0;

  if (!ok) {
    console.error(`[canary] ${failures.length} check(s) failed:`, failures.join(" | "));
  }

  return NextResponse.json({ ok, checks, failures }, { status: ok ? 200 : 500 });
}
