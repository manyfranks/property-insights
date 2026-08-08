/**
 * /api/canary
 *
 * Daily health probe for both the Canadian and US pipelines. Runs eight
 * cheap, representative checks in parallel (wall time bounded by the
 * slowest single check, not the sum):
 *
 * Canadian:
 *   1. Zoocasa searchListings("Victoria", "BC") — shape-check the response
 *      (province/city scoping, price/address/city/dom presence).
 *   2. BC Assessment cache lookup — no network, just confirms the cache
 *      module loads and returns a well-formed Assessment.
 *   3. Calgary SODA health probe — confirms assessed_value is still
 *      present/numeric on the live dataset (broad query, no address filter).
 *   4. Edmonton SODA health probe — same shape as Calgary's, on the
 *      Edmonton dataset. Broad query rather than one hardcoded address:
 *      Edmonton's grid uses numeric street names ("109 Street"), which
 *      trips lookupAB()'s unit-vs-house-number parsing heuristic when no
 *      explicit unit is supplied, and specific parcels drop off the roll
 *      dataset over time — a broad query proves live reachability + schema
 *      health without that fragility (see RUNBOOK.md §8 gap #4).
 *   5. Winnipeg SODA health probe — same shape, on the Winnipeg (MB)
 *      dataset (RUNBOOK.md §8 gap #4).
 *
 * US:
 *   6. Census geocoder — geocodes a fixed known address (cache miss the
 *      first run, KV cache hit on every run after). A cache hit alone
 *      would mask a fully-dead upstream API, so on a cache hit this also
 *      does a short (4s), independent live liveness ping against the
 *      geocoder endpoint (RUNBOOK.md §8 gaps #3 and #10).
 *   7. Neon `regional_econ` — getCountyMarketPanel("US-48453") (Travis
 *      County, TX — same county the geocoder check resolves to) returns a
 *      non-null panel (RUNBOOK.md §8 gap #3).
 *   8. RentCast KV cache infrastructure — a KV SCAN + GET against the
 *      `rentcast:*` namespace, proving the cache read path works. This is
 *      deliberately NOT a live RentCast API call (quota is capped at
 *      45/month and this cron runs daily) — live RentCast health is
 *      intentionally not probed here to preserve quota. A cache-layer
 *      outage would still surface indirectly via `/api/assess`'s
 *      `bundle.meta.errors` logging (see RUNBOOK.md §6).
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
import { searchListings } from "@/lib/zoocasa";
import { lookupBCSync } from "@/lib/assessment/bc";
import { calgarySodaHealthCheck } from "@/lib/assessment/ab";
import { BC_ASSESSMENT_CACHE } from "@/lib/data/assessments";
import {
  geocodeUSAddressWithCacheMeta,
  pingCensusGeocoderLive,
} from "@/lib/geo/census-geocoder";
import { getCountyMarketPanel } from "@/lib/db/regional-econ";

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
    calgarySoda,
    edmontonSoda,
    winnipegSoda,
    usGeocoder,
    usNeon,
    usRentcastCache,
  ] = await Promise.all([
    checkZoocasaSearch(),
    calgarySodaHealthCheck(),
    checkCaEdmonton(),
    checkCaWinnipeg(),
    checkUsGeocoder(),
    checkUsNeon(),
    checkUsRentcastCache(),
  ]);
  const bcCache = checkBcCache();

  const checks = {
    zoocasaSearch,
    bcCache,
    calgarySoda,
    edmontonSoda,
    winnipegSoda,
    usGeocoder,
    usNeon,
    usRentcastCache,
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
