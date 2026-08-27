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
 *   4. Zoocasa neighbourhood-graph discovery probe
 *      (checkZoocasaNeighbourhoodDiscovery) — confirms
 *      src/lib/zoocasa-neighbourhood.ts's discoverListingUrls(), the crawler
 *      Canadian listing discovery now depends on after moving OFF the
 *      gated/frozen search endpoint, still yields a healthy number of
 *      distinct listing URLs for a small sample of data-rich cities. Checks
 *      #1-#3 above all read the OLD search surface
 *      (props.pageProps.props.listings) — exactly the surface that got
 *      gated — so none of them can see a break in the DIFFERENT surface
 *      (internalLinks "Latest Listings" blocks) this crawler depends on
 *      instead. See that function's own doc comment for the full blind-spot
 *      rationale.
 *   5. BC Assessment cache lookup — no network, just confirms the cache
 *      module loads and returns a well-formed Assessment.
 *   6. Calgary SODA health probe — confirms assessed_value is still
 *      present/numeric on the live dataset (broad query, no address filter).
 *   7. Edmonton SODA health probe — same shape as Calgary's, on the
 *      Edmonton dataset. Broad query rather than one hardcoded address:
 *      Edmonton's grid uses numeric street names ("109 Street"), which
 *      trips lookupAB()'s unit-vs-house-number parsing heuristic when no
 *      explicit unit is supplied, and specific parcels drop off the roll
 *      dataset over time — a broad query proves live reachability + schema
 *      health without that fragility (see RUNBOOK.md §8 gap #4).
 *   8. Winnipeg SODA health probe — same shape, on the Winnipeg (MB)
 *      dataset (RUNBOOK.md §8 gap #4).
 *
 * US:
 *   9. Census geocoder — geocodes a fixed known address (cache miss the
 *      first run, KV cache hit on every run after). A cache hit alone
 *      would mask a fully-dead upstream API, so on a cache hit this also
 *      does a short (4s), independent live liveness ping against the
 *      geocoder endpoint (RUNBOOK.md §8 gaps #3 and #10).
 *   10. Neon `regional_econ` — getCountyMarketPanel("US-48453") (Travis
 *      County, TX — same county the geocoder check resolves to) returns a
 *      non-null panel (RUNBOOK.md §8 gap #3).
 *   11. RentCast KV cache infrastructure — a KV SCAN + GET against the
 *      `rentcast:*` namespace, proving the cache read path works. This is
 *      deliberately NOT a live RentCast API call (quota is capped at
 *      45/month and this cron runs daily) — live RentCast health is
 *      intentionally not probed here to preserve quota. A cache-layer
 *      outage would still surface indirectly via `/api/assess`'s
 *      `bundle.meta.errors` logging (see RUNBOOK.md §6).
 *   12. County-assessor live lookup — one Maricopa County live lookup
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
 * suffices. Check #4 adds a further small, bounded amount of traffic — 1
 * city-page fetch plus a capped, early-exiting neighbourhood-page fan-out
 * per probed city, 2 cities probed in parallel — see
 * checkZoocasaNeighbourhoodDiscovery()'s doc comment for the exact budget.
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
import { searchListings, buildSearchUrl, citiesMatch } from "@/lib/zoocasa";
import { discoverListingUrls } from "@/lib/zoocasa-neighbourhood";
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

/**
 * SHAPE AND REACHABILITY ONLY — this check does not, and must not be read
 * to, assess provider health.
 *
 * It is the original canary, and its `listings.length === 0` gate is the
 * exact test that stayed green through the 2026-08 frozen-feed outage while
 * the pipeline deleted 409+ published property URLs: the failure leaked a
 * small non-zero number of listings past citiesMatch(), and "a few" is not
 * zero. Volume and scope are now answered by checkZoocasaBaseline() and
 * checkZoocasaFeedFingerprint(); this one only answers "did the endpoint
 * respond with rows shaped like Listings".
 *
 * It is kept because that is a genuinely different question — a shape
 * regression in Zoocasa's payload would break parsing in ways the other two
 * detectors cannot see — but its `detail` string says so out loud in both
 * outcomes. Observed on the first production run after the fix deployed:
 * this check reported ok while the fingerprint detector was correctly
 * failing on all three city pairs, and "zoocasaSearch: ok" next to a live
 * total outage is precisely how a monitor gets learned as noise.
 */
async function checkZoocasaSearch(): Promise<CheckResult> {
  const SCOPE_NOTE =
    "shape/reachability only — NOT a volume or scope signal, see zoocasaBaseline + zoocasaFingerprint";
  try {
    const listings = await searchListings("Victoria", "BC", { type: "house", beds: 3 });
    if (listings.length === 0) {
      return {
        ok: false,
        detail: `searchListings("Victoria", "BC") returned 0 listings — nothing to shape-check (${SCOPE_NOTE})`,
      };
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
      return { ok: false, detail: `malformed listing in response: address="${bad.address}" (${SCOPE_NOTE})` };
    }
    return { ok: true, detail: `${listings.length} listings, shape OK — ${SCOPE_NOTE}` };
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
  // independently rather than captured from that log line, and the comment
  // above SCOPE_MISMATCH_NOTE below for why it's diagnostic-only and never
  // gates ok/problems.
  scopeMatchCount: number;
  /** In-scope by the pipeline's own citiesMatch(), i.e. metro siblings count as a match. */
  scopeSiblingAwareCount: number;
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
  let scopeSiblingAwareCount = 0;
  const wantCity = city.trim().toLowerCase();
  for (const l of listings) {
    const id = l.mls || l.address;
    if (id) {
      mlsSet.add(String(id));
      mlsOrdered.push(String(id));
    }
    const returned = (l.sub_division || "").trim();
    if (returned.toLowerCase() === wantCity) scopeMatchCount++;
    // citiesMatch() is the pipeline's OWN definition of an in-scope
    // result — it deliberately accepts metro siblings, so this is the
    // only figure that means what "mismatch" sounds like.
    if (citiesMatch(returned, city)) scopeSiblingAwareCount++;
  }

  return { count: listings.length, mlsSet, mlsOrdered, scopeMatchCount, scopeSiblingAwareCount };
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

// SCOPE_MISMATCH_NOTE — P2 audit finding (2026-08): this used to be a fire
// threshold ("SCOPE_MISMATCH_THRESHOLD = 0.8") that pushed into `problems`
// — i.e. it could flip the whole canary to ok:false on its own. That was
// wrong. This
// exact-match check has no metro-sibling awareness, and CITY_SIBLINGS
// (src/lib/zoocasa.ts) exists precisely because a hub-city search
// legitimately returns its metro siblings' inventory (Victoria/Langford/
// Saanich, Vancouver/Burnaby/Surrey/Richmond/..., Toronto/Mississauga/
// Brampton/..., Ottawa/Gatineau/Kanata/...) — citiesMatch() accepts that as
// correct, and the ingestion pipeline (src/lib/pipeline/retention.ts) relies
// on it being correct. An exact-string-match check necessarily disagrees
// with citiesMatch() on every one of those legitimate cross-listings, so on
// a HEALTHY provider this number runs high for exactly the cities with the
// biggest sibling fan-out — Toronto (18 GTA siblings) and Vancouver (14)
// worst of all — which is exactly backwards for a monitor: it cries loudest
// where the pipeline is working as designed.
//
// Verified live (2026-08-25, during the ongoing outage this file's header
// documents): Vancouver's exact-match mismatch read 85% while the
// sibling-aware figure (computed with the real CITY_SIBLINGS table, offline,
// for comparison) was 56%; Toronto read 93% exact-match vs 78%
// sibling-aware. A 20-30 point inflation on cities that already run hot is
// enough to keep this "problem" permanently lit on a healthy day — the
// textbook muted-monitor failure mode this whole rewrite exists to fix (see
// file header: the OLD `listings.length === 0` canary stayed green through
// the entire outage because nobody trusted it enough to react to the noise
// it produced).
//
// Making this check metro-aware properly would mean either (a) duplicating
// CITY_SIBLINGS here, which is the same class of bug ZOOCASA_BASELINE_CITIES
// stopped committing for price bands (see that array's comment) — a second
// copy of a table that lives in zoocasa.ts, silently stale the day someone
// edits the original without remembering this shadow copy exists, with no
// visible sign it happened either way; or (b) calling searchListings() per
// city here to get the real citiesMatch()-filtered count instead of
// re-deriving it, which would double this section's request volume
// (fetchRawZoocasaSample() below already makes one request per city; this
// file's own request-volume note above budgets ~17 GETs/day specifically to
// stay a polite client, and this signal isn't worth doubling that for). Both
// were rejected. Neither CITY_SIBLINGS nor citiesMatch() is exported from
// zoocasa.ts, and this change doesn't own that file, so there is no third
// option that reproduces the real semantics from here.
//
// So: this signal is reported for visibility only (see the "notes" push in
// checkZoocasaFeedFingerprint() below) and never contributes to
// `problems`/`ok`. It is explicitly labeled in its own output as
// not-sibling-aware so nobody reads it as a real mismatch rate, and — per
// the file's fail-loud policy — its own text says outright that it cannot
// determine whether a high reading means anything, rather than quietly
// passing it off as green OR quietly failing the canary on it. The ORDERED
// fingerprint match above is the sole authority for scope-freeze pass/fail;
// do not wire this back into `problems` without first getting
// CITY_SIBLINGS/citiesMatch() exported from zoocasa.ts for real reuse.

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
 *
 * Also computes a per-city exact-match scope-mismatch percentage as a
 * secondary signal — see the SCOPE_MISMATCH_NOTE comment below for why that
 * number is diagnostic-only (reported in `notes`, never `problems`): it has
 * no metro-sibling awareness, so it reads high on sibling-heavy cities
 * (Toronto, Vancouver) even when the provider is healthy, and gating on it
 * would recreate the exact muted-monitor failure mode this whole detector
 * exists to fix.
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
      //
      // Sibling-aware, using the pipeline's own citiesMatch() rather than
      // an exact string compare. citiesMatch() accepts metro siblings on
      // purpose — a Victoria search legitimately returns Saanich/Langford,
      // an Ottawa search returns Kanata/Gatineau — and the ingestion
      // pipeline stores those rows as that city's inventory, so an exact
      // compare does not measure "wrong city", it measures "has suburbs".
      // Live during this outage it overstated by 15-29 points (Vancouver
      // 85% exact vs 56% real, Toronto 93% vs 78%), and on a HEALTHY
      // provider the sibling-heavy cities would look worst of all. A
      // monitor that reports inflated numbers gets muted, and a muted
      // monitor is how the frozen feed ran undetected for weeks.
      //
      // Still reported into `notes` rather than gating: the ordered
      // fingerprint above is the decisive detector, and a second gate on a
      // correlated signal adds noise without adding information. The exact
      // figure is carried alongside so the gap between the two stays
      // visible — a widening gap is itself a hint the sibling table has
      // drifted from Zoocasa's actual metro groupings.
      for (const [c, s] of [
        [pair.a, a] as const,
        [pair.b, b] as const,
      ]) {
        if (!s || s.count === 0) continue;
        const outOfScope = s.count - s.scopeSiblingAwareCount;
        const exactOut = s.count - s.scopeMatchCount;
        notes.push(
          `${c.city}: ${outOfScope}/${s.count} (${Math.round((outOfScope / s.count) * 100)}%) raw listings out of scope ` +
            `by citiesMatch() [exact-string compare would say ${exactOut}/${s.count}; the difference is legitimate ` +
            `metro-sibling inventory] — diagnostic only, does not affect ok/problems`
        );
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

// ---------------------------------------------------------------------------
// checkZoocasaNeighbourhoodDiscovery()
//
// Blind spot this closes: checkZoocasaSearch/Baseline/Fingerprint above all
// read Zoocasa's search-endpoint surface (props.pageProps.props.listings) —
// exactly the surface that got gated behind a board Terms-of-Use wall and
// now serves one frozen, province-wide 27-row feed (see this file's header
// and src/lib/zoocasa-neighbourhood.ts's own doc comment for the full
// history). Canadian listing discovery has moved OFF that surface entirely
// and onto zoocasa-neighbourhood.ts's crawler, which reads a DIFFERENT part
// of the same pages: internalLinks "Latest Listings" blocks. None of the
// three checks above touch that code path. If Zoocasa renames, restructures,
// or removes internalLinks the way it gated the search feed, discovery would
// quietly fall toward zero and the KV store would thin out over days or
// weeks — with EVERY check above still reporting green, including the
// fingerprint check (it fingerprints the gated feed, a completely separate
// surface it was never meant to watch). This check is the only thing in the
// file that actually exercises the crawler the pipeline now depends on.
// ---------------------------------------------------------------------------

// Cities probed: Calgary, AB and Vancouver, BC. Both are reliably >100
// distinct listing-detail URLs via the neighbourhood crawler (large metro
// areas with many neighbourhood pages to fan out across), chosen
// specifically to avoid thin markets that would false-alarm: Saanich yields
// only ~18 distinct URLs legitimately (a real small city, not a regression
// signal), and no Manitoba city is probed here (Winnipeg's neighbourhood
// fan-out volume hasn't been characterized against this check's floor). One
// BC city + one AB city also exercises two different provinces' page
// templates without paying the request cost of all 10 cron target cities.
const NEIGHBOURHOOD_DISCOVERY_CITIES: Array<{ city: string; province: string }> = [
  { city: "Calgary", province: "AB" },
  { city: "Vancouver", province: "BC" },
];

// Well below the 100+ URLs these two cities normally yield, but well above
// zero — a real regression (a renamed/removed "Latest Listings" block, or
// neighbourhood fan-out breaking) collapses the distinct-URL count toward
// single digits or makes discoverListingUrls() throw outright (see below),
// while ordinary day-to-day inventory noise in a 100+-listing metro comes
// nowhere near this floor. Not set any tighter than this: discoverListingUrls()
// already tolerates individual neighbourhood pages failing to parse (a soft
// miss, logged via console.warn — see that function's doc comment), so some
// day-to-day variance in the exact count is expected even on a fully healthy
// surface, and the floor needs headroom for that.
const NEIGHBOURHOOD_DISCOVERY_MIN_URLS = 25;

// Caps each city's crawl at a small multiple of the floor above.
// discoverListingUrls() stops fetching further neighbourhood pages once it
// has collected this many distinct URLs (see its own maxUrls early-exit) —
// this check only needs to confirm the surface yields "enough", not
// enumerate every listing in the city (that enumeration is
// fetchNeighbourhoodListings()'s job, run by the real ingestion pipeline,
// not this canary). Keeping this low bounds both the request count and the
// wall time this check adds to the canary's 60s budget.
const NEIGHBOURHOOD_DISCOVERY_MAX_URLS = 40;

// Hard per-city timeout. discoverListingUrls() takes no abort-signal
// parameter, so a hung or unusually slow crawl (e.g. a slow neighbourhood
// page) is bounded here via Promise.race instead — this keeps one bad probe
// from eating the whole 60s canary budget on its own.
const NEIGHBOURHOOD_DISCOVERY_TIMEOUT_MS = 25_000;

async function probeNeighbourhoodDiscovery(
  city: string,
  province: string
): Promise<{ ok: boolean; detail: string }> {
  try {
    const discovered = await Promise.race([
      discoverListingUrls(city, province, { maxUrls: NEIGHBOURHOOD_DISCOVERY_MAX_URLS }),
      new Promise<never>((_, reject) => {
        setTimeout(
          () =>
            reject(
              new Error(
                `discoverListingUrls("${city}", "${province}") timed out after ${NEIGHBOURHOOD_DISCOVERY_TIMEOUT_MS}ms`
              )
            ),
          NEIGHBOURHOOD_DISCOVERY_TIMEOUT_MS
        );
      }),
    ]);

    const count = discovered.length;
    if (count < NEIGHBOURHOOD_DISCOVERY_MIN_URLS) {
      return {
        ok: false,
        detail: `${city}, ${province}: only ${count} distinct listing URL(s) discovered (floor ${NEIGHBOURHOOD_DISCOVERY_MIN_URLS}) — neighbourhood-graph discovery may be degraded`,
      };
    }
    return {
      ok: true,
      detail: `${city}, ${province}: ${count} distinct listing URL(s) discovered (floor ${NEIGHBOURHOOD_DISCOVERY_MIN_URLS}, cap ${NEIGHBOURHOOD_DISCOVERY_MAX_URLS})`,
    };
  } catch (err) {
    // discoverListingUrls() THROWS on structural page-shape breakage (missing
    // __NEXT_DATA__, missing/renamed internalLinks blocks, zero URLs found —
    // see that function's own fail-loud contract) as well as on a genuine
    // timeout above. Reported as its own distinct failure rather than folded
    // into the low-count branch above, so the detail string names WHICH kind
    // of break this is — a thrown structural/network error is a different
    // signal from "yielded a suspiciously low but non-zero count" and a
    // reader shouldn't have to guess which one fired.
    return { ok: false, detail: `${city}, ${province}: ${errDetail(err)}` };
  }
}

/**
 * Confirms zoocasa-neighbourhood.ts's discoverListingUrls() — the ONLY
 * discovery path Canadian listing ingestion uses now that the search
 * endpoint's `listings` array is a gated, frozen, province-wide feed (see
 * this file's header and zoocasa-neighbourhood.ts's own doc comment) — is
 * still yielding real, current listing URLs.
 *
 * This closes a blind spot none of checkZoocasaSearch/Baseline/Fingerprint
 * can see: all three read the OLD search-endpoint surface
 * (props.pageProps.props.listings), which is exactly the surface that got
 * gated. The new crawler reads a completely different field on the same
 * pages (internalLinks "Latest Listings" blocks). If Zoocasa renames,
 * restructures, or removes that block the way it gated the search feed,
 * discovery would quietly fall toward zero — the KV store thinning out over
 * days or weeks — while every one of the other three checks stays green,
 * INCLUDING the fingerprint check (it fingerprints the gated feed, a
 * separate surface it doesn't touch).
 *
 * Probes a small, deliberately non-exhaustive sample — Calgary AB and
 * Vancouver BC (see NEIGHBOURHOOD_DISCOVERY_CITIES' comment for why these
 * two and not, say, Saanich or a Manitoba city) — in parallel, each capped
 * via discoverListingUrls()'s own maxUrls early-exit so neither probe walks
 * the city's full neighbourhood fan-out. Request budget per probed city: 1
 * city-page fetch + a handful of neighbourhood-page fetches, bounded by
 * NEIGHBOURHOOD_DISCOVERY_MAX_URLS's early exit; 2 cities run in parallel —
 * a small, bounded addition on top of this file's existing ~17 GETs/day
 * Zoocasa budget (see the file-level request volume note above).
 *
 * FAILS (ok:false) if a probed city yields fewer than
 * NEIGHBOURHOOD_DISCOVERY_MIN_URLS distinct URLs, or if discoverListingUrls()
 * throws or times out (NEIGHBOURHOOD_DISCOVERY_TIMEOUT_MS) — see
 * probeNeighbourhoodDiscovery()'s comment for why those are reported as
 * distinct failure kinds rather than folded together. A check that can't
 * tell "the surface is thin today" from "the network/crawl broke" reports
 * that ambiguity in its own detail string rather than picking one silently
 * (fail loud, never fake).
 */
async function checkZoocasaNeighbourhoodDiscovery(): Promise<CheckResult> {
  const results = await Promise.all(
    NEIGHBOURHOOD_DISCOVERY_CITIES.map((c) => probeNeighbourhoodDiscovery(c.city, c.province))
  );
  const ok = results.every((r) => r.ok);
  return { ok, detail: results.map((r) => r.detail).join(" | ") };
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
    zoocasaNeighbourhoodDiscovery,
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
    checkZoocasaNeighbourhoodDiscovery(),
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
    zoocasaNeighbourhoodDiscovery,
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
