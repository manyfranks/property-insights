/**
 * rentcast.ts
 *
 * Typed client for the RentCast API (https://developers.rentcast.io) — the
 * US data source that plays the same role Zoocasa plays for Canada: property
 * facts, an active-listing price/DOM signal, and comparable sales, feeding
 * the same scoring/offer-model pipeline (see src/app/api/assess/route.ts).
 *
 * CRITICAL CONSTRAINT: the account is on RentCast's free tier — 50 requests
 * per calendar month, expensive overage. Every call in this file goes
 * through two gates before it's allowed to hit the network:
 *
 *   1. Cache — property records + AVM value are cached 30 days (they move
 *      slowly), active-listing lookups 24h (freshness matters for DOM),
 *      rent estimates 30 days. A cache hit costs zero RentCast requests.
 *   2. Quota guard — a KV counter (rentcast:quota:YYYY-MM) reserves a slot
 *      before every real call and hard-stops once RENTCAST_MONTHLY_QUOTA
 *      (default 45, leaving headroom under 50) is reached. Both cache and
 *      quota fall back to an in-process Map when KV_REST_API_URL/TOKEN
 *      aren't configured (e.g. local dev) — non-persistent, but it still
 *      exercises the guard instead of silently disabling it. Production
 *      (Vercel, KV linked) gets real cross-request persistence.
 *
 * Callers (src/app/api/assess/route.ts) treat quota exhaustion and API
 * errors identically: degrade to the existing county-median path. Never
 * throw the user-facing request into a 500, never make the 51st call.
 */

import type { Assessment } from "./types";

// ---------------------------------------------------------------------------
// Raw fetch layer
// ---------------------------------------------------------------------------

const RENTCAST_BASE = "https://api.rentcast.io/v1";
const FETCH_TIMEOUT_MS = 8000;

/**
 * Bare RentCast HTTP call. Fail-loud on any non-200 except 404 (which means
 * "no record for this query" — a normal, expected outcome, not an error).
 * Callers must not call this directly outside cachedRentcastCall() —
 * bypassing that wrapper bypasses both the cache and the quota guard.
 *
 * `apiKeyOverride` is an explicit, opt-in escape hatch for offline
 * audit/diagnostic scripts that must hit RentCast with a DIFFERENT key than
 * production (see auditRentcastCall() below for the only sanctioned
 * caller). No production code path passes this argument, and this function
 * never reads it from the environment itself — the only way a call reaches
 * a non-production key is a caller passing one explicitly, one call at a
 * time. Omitted (the default for every existing call site), behavior is
 * byte-for-byte identical to before this parameter existed.
 */
async function rentcastRequest<T>(
  path: string,
  params: Record<string, string | number | undefined>,
  apiKeyOverride?: string
): Promise<T | null> {
  const apiKey = apiKeyOverride || process.env.RENTCAST_API_KEY;
  if (!apiKey) throw new Error("RENTCAST_API_KEY not set");

  const url = new URL(`${RENTCAST_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }

  const res = await fetch(url.toString(), {
    headers: { "X-Api-Key": apiKey, Accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (res.status === 404) return null;

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`RentCast ${path} returned ${res.status}: ${body.slice(0, 300)}`);
  }

  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Cache + quota primitives
//
// Same key/value/EX pattern as src/lib/kv/listings.ts, kept local to this
// file (different key namespace, different fallback needs — a quota
// counter needs INCR, listings.ts never does). Falls back to an in-process
// Map when KV isn't configured, matching listings.ts's "fall back to static
// data" philosophy: degrade the guarantee, don't disable the guard.
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

// In-process fallback store. Non-persistent (resets on cold start/restart)
// — acceptable for local dev; production relies on real KV (confirmed
// linked in Vercel — see .env.local's KV_REST_API_URL comment).
const memCache = new Map<string, { value: unknown; expiresAt: number }>();
const memCounters = new Map<string, number>();

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
    } catch {
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
    } catch {
      // Best-effort — a failed cache write just means the next call re-fetches.
    }
    return;
  }
  memCache.set(key, { value: wrapped, expiresAt: Date.now() + ttlSeconds * 1000 });
}

/**
 * `namespace` defaults to "quota" — every existing call site invokes this
 * with zero arguments and gets the exact same key string as before
 * (`rentcast:quota:YYYY-MM`, production's counter). The parameter exists
 * only so auditRentcastCall() below can point at a sibling counter
 * (`rentcast:quota2:YYYY-MM`) without touching production's key or logic.
 */
function quotaKey(namespace: string = "quota"): string {
  const now = new Date();
  return `rentcast:${namespace}:${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthlyQuotaLimit(): number {
  return Number(process.env.RENTCAST_MONTHLY_QUOTA) || 45;
}

async function quotaIncr(key: string): Promise<number> {
  if (kvAvailable()) {
    try {
      const res = await fetch(`${kvUrl()}/incr/${encodeURIComponent(key)}`, {
        method: "GET",
        headers: kvHeaders(),
      });
      if (!res.ok) throw new Error(`KV incr failed: ${res.status}`);
      const body = await res.json();
      const n = Number(body.result);
      if (n === 1) {
        // First increment this month — set a ~40 day expiry so the counter
        // doesn't linger forever (best-effort, doesn't block the increment).
        fetch(`${kvUrl()}`, {
          method: "POST",
          headers: kvHeaders(),
          body: JSON.stringify(["EXPIRE", key, String(60 * 60 * 24 * 40)]),
        }).catch(() => {});
      }
      return n;
    } catch {
      // KV reachable-but-erroring is treated the same as unavailable below —
      // fall through to the in-process counter rather than failing open.
    }
  }
  const next = (memCounters.get(key) || 0) + 1;
  memCounters.set(key, next);
  return next;
}

async function quotaDecr(key: string): Promise<void> {
  if (kvAvailable()) {
    try {
      await fetch(`${kvUrl()}/decr/${encodeURIComponent(key)}`, { method: "GET", headers: kvHeaders() });
    } catch {
      // Best-effort — worst case the counter overcounts by one until reset.
    }
    return;
  }
  memCounters.set(key, Math.max(0, (memCounters.get(key) || 0) - 1));
}

async function quotaPeek(key: string): Promise<number> {
  if (kvAvailable()) {
    try {
      const res = await fetch(`${kvUrl()}/get/${encodeURIComponent(key)}`, { method: "GET", headers: kvHeaders() });
      if (!res.ok) return 0;
      const body = await res.json();
      return body.result ? Number(body.result) : 0;
    } catch {
      return 0;
    }
  }
  return memCounters.get(key) || 0;
}

export interface RentcastQuotaStatus {
  used: number;
  limit: number;
  exhausted: boolean;
  persistedInKv: boolean;
}

/**
 * Current-month quota usage — for logging/observability and the live test
 * script. `namespace` defaults to "quota" (production's counter, governed
 * by RENTCAST_MONTHLY_QUOTA) — every existing call site keeps calling this
 * with zero arguments and sees identical behavior. Pass "quota2" to read
 * the sibling counter auditRentcastCall() writes to instead (governed by
 * RENTCAST_AUDIT_MONTHLY_QUOTA, default 45) — used by
 * scripts/audit-rentcast-quality.ts for before/after proof that its
 * key-2 traffic never touches production's counter.
 */
export async function getRentcastQuotaStatus(namespace: string = "quota"): Promise<RentcastQuotaStatus> {
  const used = await quotaPeek(quotaKey(namespace));
  const limit =
    namespace === "quota" ? monthlyQuotaLimit() : Number(process.env.RENTCAST_AUDIT_MONTHLY_QUOTA) || 45;
  return { used, limit, exhausted: used >= limit, persistedInKv: kvAvailable() };
}

export interface CachedCallResult<T> {
  data: T | null;
  cacheHit: boolean;
  quotaBlocked: boolean;
  error?: string;
}

/**
 * The only path to the RentCast network in this file. Cache hit → zero
 * quota cost. Cache miss → reserve a quota slot (atomic incr, decremented
 * back if it pushed past the limit) *before* calling out, so a request that
 * would exceed the monthly cap is blocked, never made.
 */
async function cachedRentcastCall<T>(opts: {
  cacheKey: string;
  ttlSeconds: number;
  path: string;
  params: Record<string, string | number | undefined>;
  /** Explicit alternate credential for offline seeding/audit scripts.
   * When set, quotaNamespace MUST also be set so spend is counted against
   * that key's own truthful counter, never the production key's. Production
   * request paths never set these. */
  apiKeyOverride?: string;
  quotaNamespace?: string;
}): Promise<CachedCallResult<T>> {
  const cached = await cacheGet<T>(opts.cacheKey);
  if (cached.hit) return { data: cached.value, cacheHit: true, quotaBlocked: false };

  if (opts.apiKeyOverride && !opts.quotaNamespace) {
    throw new Error("apiKeyOverride requires an explicit quotaNamespace — per-key spend must be tracked against its own counter");
  }
  const key = quotaKey(opts.quotaNamespace);
  const limit = monthlyQuotaLimit();
  const count = await quotaIncr(key);
  if (count > limit) {
    await quotaDecr(key);
    return { data: null, cacheHit: false, quotaBlocked: true };
  }

  try {
    const data = await rentcastRequest<T>(opts.path, opts.params, opts.apiKeyOverride);
    await cacheSet(opts.cacheKey, data, opts.ttlSeconds);
    return { data, cacheHit: false, quotaBlocked: false };
  } catch (err) {
    return {
      data: null,
      cacheHit: false,
      quotaBlocked: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Audit override path — offline diagnostic scripts ONLY
//
// Everything above this point is production's only path to RentCast
// (getUSProperty, getUSPropertyLite, getUSActiveListing,
// discoverActiveListingsByCity — all funnel through cachedRentcastCall(),
// which always uses process.env.RENTCAST_API_KEY and always increments
// the "quota" namespace counter). None of those functions gained a new
// parameter, so production's call sites (src/app/api/assess/route.ts,
// src/lib/pipeline/us-enrich.ts, src/lib/pipeline/us-discover.ts) are
// structurally unable to reach a different key or counter — there is
// nothing to opt out of.
//
// auditRentcastCall() below is a SEPARATE, explicitly-named entry point for
// offline scripts (e.g. scripts/audit-rentcast-quality.ts) that need to
// spend requests against a second, independently-provisioned free-tier key
// (RENTCAST_API_KEY_2 in .env.local) without touching production's 45/mo
// budget or its tracked usage counter. Every argument that matters —
// apiKey, cache key, quota counter — is supplied explicitly by the caller;
// this function reads no ambient env var of its own (not even
// RENTCAST_API_KEY_2 — the script owns that lookup and passes the string
// in). That is the whole safety property: reaching a non-production key
// requires a caller to opt in, by name, on every single call.
// ---------------------------------------------------------------------------

/**
 * Same cache-hit/quota-guard/error-handling shape as cachedRentcastCall(),
 * with two differences that keep this fully quarantined from production:
 *
 *   1. `apiKey` is required and passed straight to rentcastRequest() — never
 *      falls back to process.env.RENTCAST_API_KEY.
 *   2. The quota counter is hardcoded to the "quota2" namespace
 *      (`rentcast:quota2:YYYY-MM`), never "quota" — so no caller, however
 *      it constructs its options, can accidentally decrement production's
 *      headroom. The limit is RENTCAST_AUDIT_MONTHLY_QUOTA (default 45),
 *      read independently of RENTCAST_MONTHLY_QUOTA.
 *
 * Callers should also pass a `cacheKey` in a namespace that can't collide
 * with production's (`rentcast:property:*`, `rentcast:avm:*`, etc.) — e.g.
 * prefixed `rentcast-audit:` — so a key-2-fetched response is never read
 * back by a production lookup for the same address. Not enforced here
 * (this function is generic over the cache key string) but documented as
 * the required convention; see scripts/audit-rentcast-quality.ts.
 */
export async function auditRentcastCall<T>(opts: {
  apiKey: string;
  cacheKey: string;
  ttlSeconds: number;
  path: string;
  params: Record<string, string | number | undefined>;
}): Promise<CachedCallResult<T>> {
  const cached = await cacheGet<T>(opts.cacheKey);
  if (cached.hit) return { data: cached.value, cacheHit: true, quotaBlocked: false };

  const key = quotaKey("quota2");
  const limit = Number(process.env.RENTCAST_AUDIT_MONTHLY_QUOTA) || 45;
  const count = await quotaIncr(key);
  if (count > limit) {
    await quotaDecr(key);
    return { data: null, cacheHit: false, quotaBlocked: true };
  }

  try {
    const data = await rentcastRequest<T>(opts.path, opts.params, opts.apiKey);
    await cacheSet(opts.cacheKey, data, opts.ttlSeconds);
    return { data, cacheHit: false, quotaBlocked: false };
  } catch (err) {
    return {
      data: null,
      cacheHit: false,
      quotaBlocked: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Canonical address → cache-key normalizer. THE single function used by
 * every RentCast cache-key derivation in this file — getUSProperty(),
 * getUSActiveListing(), getUSPropertyLite(), discoverActiveListingsByCity()'s
 * per-address priming, and primeUSPropertyCache() all call this exact
 * function (not a re-implementation), so a sweep-primed cache entry and a
 * later user-typed lookup for the same address can never diverge on key
 * shape — verified against production KV (scripts/diag-cedar.ts): the key
 * this function computes for "12400 Cedar St"/"Austin"/"TX" byte-for-byte
 * matches the literal `rentcast:listing:12400-cedar-st|austin|tx` key the
 * Austin sweep actually wrote. Exported so scripts (diagnostics, reseed
 * cleanup) can compute/verify the same keys without duplicating this logic.
 */
export function normalizeAddressKey(address: string, city: string, state: string): string {
  return `${address}|${city}|${state}`
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9|]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// ---------------------------------------------------------------------------
// Cache TTLs (spec: property/AVM/rent 30 days, active-listing lookups 24h)
// ---------------------------------------------------------------------------

const TTL_PROPERTY_SECONDS = 30 * 24 * 3600;
const TTL_AVM_SECONDS = 30 * 24 * 3600;
const TTL_RENT_SECONDS = 30 * 24 * 3600;
const TTL_LISTING_SECONDS = 24 * 3600;

// ---------------------------------------------------------------------------
// Raw RentCast response shapes (only the fields we read)
// ---------------------------------------------------------------------------

interface RawTaxAssessmentEntry {
  year?: number;
  value?: number;
  land?: number;
  improvements?: number;
}

interface RawPropertyTaxEntry {
  year?: number;
  total?: number;
}

interface RawHistoryEntry {
  event?: string;
  date?: string;
  price?: number;
}

interface RawPropertyRecord {
  formattedAddress?: string;
  addressLine1?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  county?: string;
  latitude?: number;
  longitude?: number;
  propertyType?: string;
  bedrooms?: number;
  bathrooms?: number;
  squareFootage?: number;
  lotSize?: number;
  yearBuilt?: number;
  lastSaleDate?: string;
  lastSalePrice?: number;
  taxAssessments?: Record<string, RawTaxAssessmentEntry>;
  propertyTaxes?: Record<string, RawPropertyTaxEntry>;
  history?: Record<string, RawHistoryEntry>;
  ownerOccupied?: boolean;
}

interface RawAvmComp {
  formattedAddress?: string;
  price?: number;
  correlation?: number;
  distance?: number;
  daysOnMarket?: number;
  daysOld?: number;
  squareFootage?: number;
  bedrooms?: number;
  bathrooms?: number;
  yearBuilt?: number;
  latitude?: number;
  longitude?: number;
  status?: string;
  listedDate?: string;
}

interface RawAvm {
  price?: number;
  priceRangeLow?: number;
  priceRangeHigh?: number;
  comparables?: RawAvmComp[];
}

interface RawRent {
  rent?: number;
  rentRangeLow?: number;
  rentRangeHigh?: number;
}

interface RawListing {
  id?: string;
  formattedAddress?: string;
  addressLine1?: string;
  city?: string;
  state?: string;
  price?: number;
  status?: string;
  listingType?: string;
  listedDate?: string;
  daysOnMarket?: number;
  bedrooms?: number;
  bathrooms?: number;
  squareFootage?: number;
  propertyType?: string;
  mlsNumber?: string;
  history?: Record<string, { event?: string; price?: number; listingType?: string; daysOnMarket?: number }>;
}

// ---------------------------------------------------------------------------
// Public types — normalized, null-tolerant per field
// ---------------------------------------------------------------------------

export interface RentCastTaxAssessment {
  year: number;
  value: number | null;
  land: number | null;
  improvements: number | null;
}

export interface RentCastPropertyTax {
  year: number;
  total: number | null;
}

export interface RentCastSaleEvent {
  date: string;
  event: string;
  price: number | null;
}

export interface RentCastPropertyRecord {
  formattedAddress: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  county: string | null;
  latitude: number | null;
  longitude: number | null;
  propertyType: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  squareFootage: number | null;
  lotSize: number | null;
  yearBuilt: number | null;
  lastSaleDate: string | null;
  lastSalePrice: number | null;
  /** Sorted descending by year — [0] is the most recent. */
  taxAssessments: RentCastTaxAssessment[];
  propertyTaxes: RentCastPropertyTax[];
  saleHistory: RentCastSaleEvent[];
  ownerOccupied: boolean | null;
}

export interface RentCastAvmComp {
  formattedAddress: string | null;
  price: number | null;
  correlation: number | null;
  distanceMi: number | null;
  daysOnMarket: number | null;
  squareFootage: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  yearBuilt: number | null;
  status: string | null;
}

export interface RentCastAvm {
  value: number;
  rangeLow: number | null;
  rangeHigh: number | null;
  comps: RentCastAvmComp[];
}

export interface RentCastRent {
  value: number;
  rangeLow: number | null;
  rangeHigh: number | null;
}

export interface RentCastActiveListing {
  formattedAddress: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  price: number | null;
  status: string | null;
  listingType: string | null;
  listedDate: string | null;
  daysOnMarket: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  squareFootage: number | null;
  propertyType: string | null;
  mlsNumber: string | null;
  /** Sorted ascending by date. */
  priceHistory: { date: string; event: string; price: number | null }[];
}

export interface USPropertyBundle {
  record: RentCastPropertyRecord | null;
  avm: RentCastAvm | null;
  rent: RentCastRent | null;
  activeListing: RentCastActiveListing | null;
  meta: {
    /** true if ANY of the 4 lookups were blocked by the monthly quota guard. */
    quotaExhausted: boolean;
    cacheHits: number;
    liveCalls: number;
    errors: string[];
  };
}

// ---------------------------------------------------------------------------
// Mappers — raw RentCast JSON → normalized public types
// ---------------------------------------------------------------------------

function mapPropertyRecord(raw: RawPropertyRecord | undefined): RentCastPropertyRecord | null {
  if (!raw) return null;

  const taxAssessments: RentCastTaxAssessment[] = Object.entries(raw.taxAssessments || {})
    .map(([yearKey, v]) => ({
      year: v.year ?? Number(yearKey) ?? 0,
      value: v.value ?? null,
      land: v.land ?? null,
      improvements: v.improvements ?? null,
    }))
    .filter((t) => t.year > 0)
    .sort((a, b) => b.year - a.year);

  const propertyTaxes: RentCastPropertyTax[] = Object.entries(raw.propertyTaxes || {})
    .map(([yearKey, v]) => ({ year: v.year ?? Number(yearKey) ?? 0, total: v.total ?? null }))
    .filter((t) => t.year > 0)
    .sort((a, b) => b.year - a.year);

  const saleHistory: RentCastSaleEvent[] = Object.entries(raw.history || {})
    .map(([dateKey, v]) => ({ date: v.date ?? dateKey, event: v.event ?? "unknown", price: v.price ?? null }))
    .filter((h) => (h.event || "").toLowerCase().includes("sale"))
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  return {
    formattedAddress: raw.formattedAddress ?? null,
    addressLine1: raw.addressLine1 ?? null,
    city: raw.city ?? null,
    state: raw.state ?? null,
    zipCode: raw.zipCode ?? null,
    county: raw.county ?? null,
    latitude: raw.latitude ?? null,
    longitude: raw.longitude ?? null,
    propertyType: raw.propertyType ?? null,
    bedrooms: raw.bedrooms ?? null,
    bathrooms: raw.bathrooms ?? null,
    squareFootage: raw.squareFootage ?? null,
    lotSize: raw.lotSize ?? null,
    yearBuilt: raw.yearBuilt ?? null,
    lastSaleDate: raw.lastSaleDate ?? null,
    lastSalePrice: raw.lastSalePrice ?? null,
    taxAssessments,
    propertyTaxes,
    saleHistory,
    ownerOccupied: raw.ownerOccupied ?? null,
  };
}

function mapAvm(raw: RawAvm | undefined): RentCastAvm | null {
  if (!raw || raw.price == null) return null;
  return {
    value: raw.price,
    rangeLow: raw.priceRangeLow ?? null,
    rangeHigh: raw.priceRangeHigh ?? null,
    comps: (raw.comparables || []).map((c) => ({
      formattedAddress: c.formattedAddress ?? null,
      price: c.price ?? null,
      correlation: c.correlation ?? null,
      distanceMi: c.distance ?? null,
      daysOnMarket: c.daysOnMarket ?? c.daysOld ?? null,
      squareFootage: c.squareFootage ?? null,
      bedrooms: c.bedrooms ?? null,
      bathrooms: c.bathrooms ?? null,
      yearBuilt: c.yearBuilt ?? null,
      status: c.status ?? null,
    })),
  };
}

function mapRent(raw: RawRent | undefined): RentCastRent | null {
  if (!raw || raw.rent == null) return null;
  return { value: raw.rent, rangeLow: raw.rentRangeLow ?? null, rangeHigh: raw.rentRangeHigh ?? null };
}

function mapActiveListing(raw: RawListing | undefined): RentCastActiveListing | null {
  if (!raw) return null;
  // Defensive: /listings/sale defaults status filter server-side, but an
  // "Inactive" record can still surface via the address-exact lookup — only
  // treat it as an active listing when explicitly marked so.
  if (raw.status && raw.status.toLowerCase() !== "active") return null;

  const priceHistory = Object.entries(raw.history || {})
    .map(([dateKey, v]) => ({ date: dateKey, event: v.event ?? "unknown", price: v.price ?? null }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  return {
    formattedAddress: raw.formattedAddress ?? null,
    addressLine1: raw.addressLine1 ?? null,
    city: raw.city ?? null,
    state: raw.state ?? null,
    price: raw.price ?? null,
    status: raw.status ?? null,
    listingType: raw.listingType ?? null,
    listedDate: raw.listedDate ?? null,
    daysOnMarket: raw.daysOnMarket ?? null,
    bedrooms: raw.bedrooms ?? null,
    bathrooms: raw.bathrooms ?? null,
    squareFootage: raw.squareFootage ?? null,
    propertyType: raw.propertyType ?? null,
    mlsNumber: raw.mlsNumber ?? null,
    priceHistory,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch the full RentCast bundle for one address: property record, AVM
 * value + comps, long-term rent estimate, and an active-listing lookup.
 * Each of the 4 fields is cached and quota-guarded independently — a cache
 * hit on one doesn't affect the others, and quota exhaustion degrades that
 * one field to null rather than throwing.
 *
 * Never throws for "no data" (404s resolve to null fields); only throws if
 * RENTCAST_API_KEY is unset (a config error, not a runtime one).
 */
export async function getUSProperty(
  address: string,
  city: string,
  state: string
): Promise<USPropertyBundle> {
  const addrKey = normalizeAddressKey(address, city, state);
  const fullAddress = `${address}, ${city}, ${state}`;

  const [propRes, avmRes, rentRes, listingRes] = await Promise.all([
    cachedRentcastCall<RawPropertyRecord[]>({
      cacheKey: `rentcast:property:${addrKey}`,
      ttlSeconds: TTL_PROPERTY_SECONDS,
      path: "/properties",
      params: { address: fullAddress, limit: 1 },
    }),
    cachedRentcastCall<RawAvm>({
      cacheKey: `rentcast:avm:${addrKey}`,
      ttlSeconds: TTL_AVM_SECONDS,
      path: "/avm/value",
      params: { address: fullAddress },
    }),
    cachedRentcastCall<RawRent>({
      cacheKey: `rentcast:rent:${addrKey}`,
      ttlSeconds: TTL_RENT_SECONDS,
      path: "/avm/rent/long-term",
      params: { address: fullAddress },
    }),
    cachedRentcastCall<RawListing[]>({
      cacheKey: `rentcast:listing:${addrKey}`,
      ttlSeconds: TTL_LISTING_SECONDS,
      path: "/listings/sale",
      params: { address: fullAddress, status: "Active", limit: 1 },
    }),
  ]);

  let quotaExhausted = false;
  let cacheHits = 0;
  let liveCalls = 0;
  const errors: string[] = [];

  function tally<T>(res: CachedCallResult<T>, label: string) {
    if (res.cacheHit) cacheHits++;
    else if (res.quotaBlocked) quotaExhausted = true;
    else liveCalls++;
    if (res.error) errors.push(`${label}: ${res.error}`);
  }
  tally(propRes, "property");
  tally(avmRes, "avm");
  tally(rentRes, "rent");
  tally(listingRes, "listing");

  const propRaw = Array.isArray(propRes.data) ? propRes.data[0] : undefined;
  const listingRaw = Array.isArray(listingRes.data) ? listingRes.data[0] : undefined;

  return {
    record: mapPropertyRecord(propRaw),
    avm: mapAvm(avmRes.data ?? undefined),
    rent: mapRent(rentRes.data ?? undefined),
    activeListing: mapActiveListing(listingRaw),
    meta: { quotaExhausted, cacheHits, liveCalls, errors },
  };
}

export interface DiscoveredListing extends RentCastActiveListing {
  address: string;
}

/**
 * Browse active listings in a city — used to discover real addresses for
 * testing, and reusable for a future "browse this city" surface. Each
 * result's listing data is also primed into the per-address active-listing
 * cache (same key getUSProperty() reads), so a subsequent getUSProperty()
 * call for one of these exact addresses doesn't spend a second identical
 * /listings/sale request — the city-search and address-search endpoints
 * return the same underlying record for a given property.
 *
 * `listingTtlSeconds` overrides the per-address priming TTL (default
 * TTL_LISTING_SECONDS, 24h — right for a genuinely live-fetched one-off
 * lookup). Callers seeding from a periodic city-wide sweep (us-discover.ts)
 * should pass their own refresh cadence instead: the sweep only re-visits a
 * city every US_DISCOVER_REFRESH_DAYS (default 3), so a 24h TTL on the
 * primed entry expires mid-cycle — a user who assesses a seeded listing on
 * day 2 gets a cache MISS and pays for a live /listings/sale call the sweep
 * already answered for free days earlier. Passing a TTL that matches the
 * sweep's own cadence keeps the primed entry alive until the next sweep
 * actually refreshes it, so it's always either "answered by the last sweep"
 * or "about to be re-answered by the next one" — never a gap in between.
 */
export async function discoverActiveListingsByCity(
  city: string,
  state: string,
  limit = 5,
  listingTtlSeconds: number = TTL_LISTING_SECONDS,
  keyOpts?: { apiKeyOverride: string; quotaNamespace: string }
): Promise<DiscoveredListing[]> {
  const cacheKey = `rentcast:discover:${city.toLowerCase()}:${state.toLowerCase()}:${limit}`;
  const res = await cachedRentcastCall<RawListing[]>({
    cacheKey,
    ttlSeconds: TTL_LISTING_SECONDS,
    path: "/listings/sale",
    params: { city, state, status: "Active", limit },
    ...keyOpts,
  });

  if (!res.data) return [];

  const results: DiscoveredListing[] = [];
  for (const raw of res.data) {
    const addressLine1 = raw.addressLine1 || raw.formattedAddress?.split(",")[0]?.trim();
    if (!addressLine1) continue;
    const mapped = mapActiveListing(raw);
    if (!mapped) continue;
    results.push({ ...mapped, address: addressLine1 });

    // Cached as a 1-element array — getUSProperty()'s listing field always
    // unwraps `Array.isArray(data) ? data[0] : undefined` to match the real
    // /listings/sale response shape (an array). Caching the bare object
    // here would silently fail that unwrap and read back as "no listing".
    const addrKey = normalizeAddressKey(addressLine1, raw.city || city, raw.state || state);
    await cacheSet(`rentcast:listing:${addrKey}`, [raw], listingTtlSeconds);
  }
  return results;
}

/**
 * Active-listing lookup only (no property/avm/rent) — same cache key and
 * quota guard as getUSProperty()'s listing field, exposed standalone for
 * callers that only need listing status (e.g. confirming a listing is
 * still live) without paying for the other 3 fields.
 */
export async function getUSActiveListing(
  address: string,
  city: string,
  state: string
): Promise<RentCastActiveListing | null> {
  const addrKey = normalizeAddressKey(address, city, state);
  const fullAddress = `${address}, ${city}, ${state}`;
  const res = await cachedRentcastCall<RawListing[]>({
    cacheKey: `rentcast:listing:${addrKey}`,
    ttlSeconds: TTL_LISTING_SECONDS,
    path: "/listings/sale",
    params: { address: fullAddress, status: "Active", limit: 1 },
  });
  const raw = Array.isArray(res.data) ? res.data[0] : undefined;
  return mapActiveListing(raw);
}

/**
 * Seed the cache for an address from already-known RentCast responses
 * without spending quota — e.g. replaying a previously live-fetched bundle,
 * or a batch import pre-warming caches for known addresses. Each field is
 * optional; omitted fields are left as a cache miss (a later
 * getUSProperty() call fetches only those live). Raw shapes must match
 * what the real endpoints return: `record`/`listing` are the *array*
 * response bodies of /properties and /listings/sale respectively; `avm`/
 * `rent` are the object response bodies of /avm/value and
 * /avm/rent/long-term.
 */
export async function primeUSPropertyCache(
  address: string,
  city: string,
  state: string,
  data: { record?: unknown; avm?: unknown; rent?: unknown; listing?: unknown },
  opts?: { listingTtlSeconds?: number }
): Promise<void> {
  const addrKey = normalizeAddressKey(address, city, state);
  const writes: Promise<void>[] = [];
  if (data.record !== undefined) writes.push(cacheSet(`rentcast:property:${addrKey}`, data.record, TTL_PROPERTY_SECONDS));
  if (data.avm !== undefined) writes.push(cacheSet(`rentcast:avm:${addrKey}`, data.avm, TTL_AVM_SECONDS));
  if (data.rent !== undefined) writes.push(cacheSet(`rentcast:rent:${addrKey}`, data.rent, TTL_RENT_SECONDS));
  if (data.listing !== undefined)
    writes.push(cacheSet(`rentcast:listing:${addrKey}`, data.listing, opts?.listingTtlSeconds ?? TTL_LISTING_SECONDS));
  await Promise.all(writes);
}

// ---------------------------------------------------------------------------
// Assessment-basis helpers
// ---------------------------------------------------------------------------

// States with acquisition-value-based assessment schemes (e.g. California's
// Prop 13 — assessed value tracks purchase price + a small annual cap, not
// market value). Partial coverage: CA is the canonical, most consequential
// case; other acquisition-value states (a handful, e.g. portions of a few
// others' homestead rules) aren't modeled here — everything else defaults
// to "assessed_ratio" as the honest middle ground (US property tax
// assessments are usually *some* fraction of market value, not literal
// market value the way BC's are).
const ACQUISITION_VALUE_STATES = new Set(["CA"]);

export function assessmentBasisForState(state: string): Assessment["assessmentBasis"] {
  return ACQUISITION_VALUE_STATES.has(state.toUpperCase()) ? "acquisition_value" : "assessed_ratio";
}

// ---------------------------------------------------------------------------
// Lite bundle — budget-aware bulk enrichment
// ---------------------------------------------------------------------------

export interface USPropertyLiteBundle {
  record: RentCastPropertyRecord | null;
  avm: RentCastAvm | null;
  meta: USPropertyBundle["meta"];
}

/**
 * Record + AVM only — no rent, no active-listing lookup. Built for
 * src/lib/pipeline/us-enrich.ts's budget-aware bulk enrichment of already-
 * discovered US Discover listings (src/lib/pipeline/us-discover.ts): the
 * active listing is already known (it's the Listing being enriched, sourced
 * from the same city-wide /listings/sale sweep), and the rent estimate is
 * skippable — enrichment prioritizes assessed value/taxes/yearBuilt/comps,
 * and every skipped call is quota headroom preserved (see this file's
 * module doc for the 45/mo free-tier constraint). Two requests per address
 * on a cache miss instead of getUSProperty()'s four.
 *
 * Uses the exact same cache keys as getUSProperty() (cachedRentcastCall,
 * `rentcast:property:*` / `rentcast:avm:*`), so a later getUSProperty() call
 * for the same address gets a cache hit on both these fields and only pays
 * for the rent/listing fields it's still missing — never a duplicate spend.
 */
export async function getUSPropertyLite(
  address: string,
  city: string,
  state: string
): Promise<USPropertyLiteBundle> {
  const addrKey = normalizeAddressKey(address, city, state);
  const fullAddress = `${address}, ${city}, ${state}`;

  const [propRes, avmRes] = await Promise.all([
    cachedRentcastCall<RawPropertyRecord[]>({
      cacheKey: `rentcast:property:${addrKey}`,
      ttlSeconds: TTL_PROPERTY_SECONDS,
      path: "/properties",
      params: { address: fullAddress, limit: 1 },
    }),
    cachedRentcastCall<RawAvm>({
      cacheKey: `rentcast:avm:${addrKey}`,
      ttlSeconds: TTL_AVM_SECONDS,
      path: "/avm/value",
      params: { address: fullAddress },
    }),
  ]);

  let quotaExhausted = false;
  let cacheHits = 0;
  let liveCalls = 0;
  const errors: string[] = [];

  function tally<T>(res: CachedCallResult<T>, label: string) {
    if (res.cacheHit) cacheHits++;
    else if (res.quotaBlocked) quotaExhausted = true;
    else liveCalls++;
    if (res.error) errors.push(`${label}: ${res.error}`);
  }
  tally(propRes, "property");
  tally(avmRes, "avm");

  const propRaw = Array.isArray(propRes.data) ? propRes.data[0] : undefined;

  return {
    record: mapPropertyRecord(propRaw),
    avm: mapAvm(avmRes.data ?? undefined),
    meta: { quotaExhausted, cacheHits, liveCalls, errors },
  };
}
