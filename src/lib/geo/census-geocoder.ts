/**
 * US Census Bureau Geocoder client — one-line address → state/county FIPS +
 * lat/lon. Free, no API key. Used to route US addresses to a county for the
 * area-median assessment adapter (Phase 2 step 4).
 *
 * Docs: https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.pdf
 *
 * SPOF mitigation (RUNBOOK.md §8 gap #10): this is the single hard
 * dependency the entire US assessment flow needs before anything else can
 * run — no cache existed and no alternate provider exists. Two mitigations
 * live here:
 *
 *   1. KV cache — geocodes are stable (an address's county/lat/lon doesn't
 *      change), so a successful (or a clean "no match") result is cached
 *      90 days under `geo:us:{normalized-address}`. A cache hit costs zero
 *      network calls and fully eliminates the SPOF for any address seen
 *      before (all seeded US Discover listings + any repeat /assess call).
 *      Same cache primitive shape as rentcast.ts's cacheGet/cacheSet
 *      (wrapped `{v: value}`, Upstash REST SET/GET with EX, falls back to
 *      an in-process Map when KV isn't configured — degrade the guarantee,
 *      don't disable the guard).
 *   2. One retry on transient failure — the original single 8s attempt
 *      failed hard on a timeout or a transient network blip. A second
 *      attempt is made before giving up.
 *
 * geocodeUSAddress()'s signature/behavior is unchanged for existing callers
 * (route.ts, assessment/us.ts) — caching and retry are internal. Log prefix
 * `[geocode-cache]` is reserved for unexpected cache errors only (KV
 * reachable-but-erroring), never emitted on ordinary hits/misses.
 */

const CENSUS_GEOCODER_URL =
  "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress";

const TIMEOUT_MS = 8000;
const CACHE_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days — geocodes are stable

export interface CensusGeocodeResult {
  stateFips: string;
  countyFips: string;
  stateUsps: string;
  countyName: string;
  lat: number;
  lon: number;
  matchedAddress: string;
}

// Minimal shape of the parts of the Census geocoder response we read.
// The real payload has many more geography layers; we only care about
// States and Counties.
interface CensusGeography {
  STATE?: string;
  STUSAB?: string;
  COUNTY?: string;
  NAME?: string;
}

interface CensusAddressMatch {
  matchedAddress?: string;
  coordinates?: { x: number; y: number };
  geographies?: {
    States?: CensusGeography[];
    Counties?: CensusGeography[];
  };
}

interface CensusGeocoderResponse {
  result?: {
    addressMatches?: CensusAddressMatch[];
  };
}

// ---------------------------------------------------------------------------
// KV cache primitives — same key/value/EX pattern as src/lib/kv/listings.ts
// and rentcast.ts's cacheGet/cacheSet, kept local to this file. Falls back
// to an in-process Map when KV isn't configured (local dev) — non-
// persistent, but still exercises the cache path instead of silently
// disabling it.
// ---------------------------------------------------------------------------

function kvUrl(): string | null {
  return process.env.KV_REST_API_URL || null;
}
function kvToken(): string | null {
  return process.env.KV_REST_API_TOKEN || null;
}
function kvAvailable(): boolean {
  return !!(kvUrl() && kvToken());
}
function kvHeaders(): HeadersInit {
  return { Authorization: `Bearer ${kvToken()}`, "Content-Type": "application/json" };
}

const memCache = new Map<string, { value: unknown; expiresAt: number }>();

async function cacheGet<T>(key: string): Promise<{ hit: boolean; value: T | null }> {
  if (kvAvailable()) {
    try {
      const res = await fetch(`${kvUrl()}/get/${encodeURIComponent(key)}`, {
        method: "GET",
        headers: kvHeaders(),
      });
      if (!res.ok) return { hit: false, value: null };
      const body = await res.json();
      if (body.result == null) return { hit: false, value: null };
      const raw = typeof body.result === "string" ? body.result : JSON.stringify(body.result);
      const parsed = JSON.parse(raw) as { v: T };
      return { hit: true, value: parsed.v };
    } catch (err) {
      console.error("[geocode-cache] KV read failed unexpectedly:", err);
      return { hit: false, value: null };
    }
  }

  const entry = memCache.get(key);
  if (!entry || entry.expiresAt < Date.now()) {
    memCache.delete(key);
    return { hit: false, value: null };
  }
  return { hit: true, value: (entry.value as { v: T }).v };
}

async function cacheSet<T>(key: string, value: T | null, ttlSeconds: number): Promise<void> {
  const wrapped = { v: value };
  if (kvAvailable()) {
    try {
      await fetch(`${kvUrl()}`, {
        method: "POST",
        headers: kvHeaders(),
        body: JSON.stringify(["SET", key, JSON.stringify(wrapped), "EX", String(ttlSeconds)]),
      });
    } catch (err) {
      // Best-effort — a failed cache write just means the next call
      // re-geocodes. Still worth a log line since it's unexpected (KV was
      // reachable enough to answer kvAvailable() but the write failed).
      console.error("[geocode-cache] KV write failed unexpectedly:", err);
    }
    return;
  }
  memCache.set(key, { value: wrapped, expiresAt: Date.now() + ttlSeconds * 1000 });
}

function normalizeAddressKey(oneLine: string): string {
  return oneLine.trim().toLowerCase().replace(/\s+/g, " ");
}

function cacheKeyFor(oneLine: string): string {
  return `geo:us:${normalizeAddressKey(oneLine)}`;
}

// ---------------------------------------------------------------------------
// Live fetch — single attempt, wrapped by geocodeLive() below for the retry.
// ---------------------------------------------------------------------------

async function geocodeAttempt(oneLine: string): Promise<CensusGeocodeResult | null> {
  const url = new URL(CENSUS_GEOCODER_URL);
  url.searchParams.set("address", oneLine);
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("vintage", "Current_Current");
  url.searchParams.set("format", "json");

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(
      `Census geocoder request failed: ${res.status} ${res.statusText}`
    );
  }

  const data = (await res.json()) as CensusGeocoderResponse;
  const match = data.result?.addressMatches?.[0];
  if (!match) return null;

  const state = match.geographies?.States?.[0];
  const county = match.geographies?.Counties?.[0];
  if (!state?.STATE || !state?.STUSAB || !county?.COUNTY || !county?.NAME) {
    return null;
  }
  if (!match.coordinates || !match.matchedAddress) return null;

  return {
    stateFips: state.STATE,
    countyFips: county.COUNTY,
    stateUsps: state.STUSAB,
    countyName: county.NAME,
    lat: match.coordinates.y,
    lon: match.coordinates.x,
    matchedAddress: match.matchedAddress,
  };
}

/**
 * One retry on transient failure (timeout / network error) before giving
 * up — the original single 8s attempt failed hard on a transient blip.
 * A clean "no match" (geocodeAttempt resolving to null) is not an error and
 * is not retried.
 */
async function geocodeLive(oneLine: string): Promise<CensusGeocodeResult | null> {
  try {
    return await geocodeAttempt(oneLine);
  } catch {
    return await geocodeAttempt(oneLine);
  }
}

interface GeocodeWithMeta {
  result: CensusGeocodeResult | null;
  cacheHit: boolean;
}

async function geocodeWithCacheMeta(oneLine: string): Promise<GeocodeWithMeta> {
  const key = cacheKeyFor(oneLine);

  const cached = await cacheGet<CensusGeocodeResult | null>(key);
  if (cached.hit) {
    return { result: cached.value, cacheHit: true };
  }

  const result = await geocodeLive(oneLine);
  await cacheSet(key, result, CACHE_TTL_SECONDS);
  return { result, cacheHit: false };
}

/**
 * Geocode a one-line US address to state/county FIPS codes + coordinates.
 *
 * - Cache hit (previously-seen address, within 90 days): returns instantly,
 *   no network call, no SPOF exposure.
 * - Cache miss: live call (with one retry on transient failure). Throws on
 *   network failure or a non-200 response (fail loud — a broken geocoder
 *   should surface, not silently degrade the whole US pipeline).
 * - Returns null when the request succeeds but the address has no match
 *   (a normal, expected outcome for bad/incomplete addresses) — this null
 *   result is cached too, so a bad address doesn't get re-geocoded on every
 *   repeat request.
 */
export async function geocodeUSAddress(
  oneLine: string
): Promise<CensusGeocodeResult | null> {
  const { result } = await geocodeWithCacheMeta(oneLine);
  return result;
}

/**
 * Same as geocodeUSAddress(), but also reports whether the result came from
 * cache. Used by the canary probe (see /api/canary) to decide whether a
 * supplementary live liveness ping is needed — a cache hit alone doesn't
 * prove the upstream API is still alive.
 */
export async function geocodeUSAddressWithCacheMeta(
  oneLine: string
): Promise<GeocodeWithMeta> {
  return geocodeWithCacheMeta(oneLine);
}

/**
 * Lightweight live reachability ping — independent of the cache, short
 * timeout (default 4s, vs. the normal 8s+retry budget). Used by the canary
 * so a KV cache hit on the primary probe address doesn't mask a fully dead
 * upstream API. Returns false (never throws) on any failure.
 */
export async function pingCensusGeocoderLive(timeoutMs = 4000): Promise<boolean> {
  try {
    const url = new URL(CENSUS_GEOCODER_URL);
    url.searchParams.set("address", "1600 Pennsylvania Ave NW, Washington, DC");
    url.searchParams.set("benchmark", "Public_AR_Current");
    url.searchParams.set("vintage", "Current_Current");
    url.searchParams.set("format", "json");

    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}
