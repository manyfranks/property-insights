/**
 * kv/listings.ts
 *
 * Read/write listings from Vercel KV (Upstash Redis REST API).
 *
 * KEY SCHEMA:
 *   listings:all         → JSON array of all Listing objects (LEGACY — kept
 *                           in sync on every write for back-compat with
 *                           standalone admin/diagnostic scripts that read it
 *                           via raw REST, e.g. scripts/diag-cedar.ts,
 *                           scripts/flush-city.ts. Nothing in the app's own
 *                           page-render path reads this key anymore.)
 *   listings:index        → { chunks, total, updatedAt } — sharded-storage
 *                           manifest (see "Sharded storage" section below)
 *   listings:chunk:{0..N} → JSON array — a contiguous slice of the full
 *                           listings array, each kept under ~1.5MB so it
 *                           stays inside Next's/Upstash's 2MB cacheable-
 *                           response ceiling (the whole reason this file
 *                           was sharded — see that section for why)
 *   listings:by-slug:{s} → JSON of single Listing (for fast property page lookups)
 *   listings:meta        → { count, updatedAt, cities }
 *
 * Falls back to static PRELOADED_LISTINGS when KV is unavailable (local dev).
 */

import { Listing } from "../types";
import { slugify } from "../utils";

// ---------------------------------------------------------------------------
// KV helpers (same pattern as dedup.ts)
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
  return {
    Authorization: `Bearer ${kvToken()}`,
    "Content-Type": "application/json",
  };
}

async function kvGet(key: string): Promise<unknown> {
  const url = kvUrl();
  if (!url) return null;

  const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    method: "GET",
    headers: kvHeaders(),
    next: { revalidate: 300 }, // Cache for 5 min in Next.js
  });

  if (!res.ok) return null;
  const body = await res.json();
  return body.result;
}

async function kvSet(key: string, value: unknown, exSeconds?: number): Promise<boolean> {
  const url = kvUrl();
  if (!url) return false;

  const serialized = JSON.stringify(value);

  // Use POST for large payloads (GET URL path has length limits)
  const args: string[] = ["SET", key, serialized];
  if (exSeconds) args.push("EX", String(exSeconds));

  const res = await fetch(`${url}`, {
    method: "POST",
    headers: kvHeaders(),
    body: JSON.stringify(args),
  });

  return res.ok;
}

async function kvDel(key: string): Promise<boolean> {
  const url = kvUrl();
  if (!url) return false;

  const res = await fetch(`${url}/del/${encodeURIComponent(key)}`, {
    method: "GET",
    headers: kvHeaders(),
  });

  return res.ok;
}

/**
 * Batch multiple SET commands in a single HTTP request via Upstash pipeline.
 * Dramatically faster than sequential kvSet calls for bulk operations.
 */
async function kvPipeline(commands: [string, ...string[]][]): Promise<boolean> {
  const url = kvUrl();
  if (!url) return false;

  // Upstash pipeline: POST array of commands
  const res = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: kvHeaders(),
    body: JSON.stringify(commands),
  });

  return res.ok;
}

// ---------------------------------------------------------------------------
// Sharded storage
//
// listings:all crossed 2MB (9.9MB / 2,322 listings as of 2026-08) — past
// Upstash/Next's cacheable-response ceiling, so kvGet("listings:all")'s
// `next: { revalidate: 300 }` fetch was silently never cached and every
// page render paid a full ~10MB KV round trip. Fix: split the array into
// several listings:chunk:{i} keys, each capped well under 2MB, tracked by a
// listings:index manifest ({ chunks, total, updatedAt }). getAllListings
// reads the manifest, fetches all chunks in parallel (each individually
// cacheable), and reassembles — same public shape, much cheaper per-render
// cost. listings:all is still written on every mutation (see writeShardedStorage's
// callers) purely for back-compat with standalone scripts that read it raw;
// nothing in the app itself reads that key anymore.
// ---------------------------------------------------------------------------
const STORAGE_CHUNK_TARGET_BYTES = 1_500_000; // ~1.5MB of *estimated cached-response* bytes — see estimateCachedResponseBytes
/** Exported for scripts/test-listings-store.ts only — not used elsewhere. */
export { STORAGE_CHUNK_TARGET_BYTES };

function isValidListingArray(raw: unknown): raw is Listing[] {
  return (
    Array.isArray(raw) &&
    raw.every((l) => l && typeof l === "object" && typeof (l as Listing).address === "string")
  );
}

/**
 * Tolerate double-encoded values (a raw REST SET once stored a
 * JSON-string-of-JSON and took the site down): unwrap string layers until
 * we reach the real value. Does not catch JSON.parse errors — a malformed
 * string should propagate so the caller's try/catch can fall back safely.
 */
function unwrapJson(raw: unknown, maxDepth = 3): unknown {
  let val = raw;
  for (let depth = 0; typeof val === "string" && depth < maxDepth; depth++) {
    val = JSON.parse(val);
  }
  return val;
}

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

/**
 * Upstash's REST GET response wraps the stored string value in a JSON
 * envelope (`{"result":"<value>"}`), which means the value's own quotes
 * and backslashes — and a JSON-encoded listing is full of both, from every
 * key name and string field — get escaped a second time. That escaped
 * envelope is the actual HTTP response body Next's fetch cache measures
 * against its 2MB ceiling, not the raw stored byte length. Measured on the
 * real dataset: ~1.5MB of raw stringified listings inflates to ~2.16MB
 * once enveloped (a ~1.44x factor) — enough to blow straight through a
 * naive 1.5MB-raw chunk target and reproduce the exact bug this file was
 * sharded to fix. So chunk sizing must budget for the escaped size, not
 * the raw one.
 */
/** Exported for scripts/test-listings-store.ts only — not used elsewhere. */
export function estimateCachedResponseBytes(json: string): number {
  let extra = 0;
  for (let i = 0; i < json.length; i++) {
    const c = json.charCodeAt(i);
    if (c === 34 /* " */ || c === 92 /* \ */) extra++;
    else if (c < 0x20) extra += 5; // control chars escape to \u00XX (6 chars, +5 over the 1 raw byte)
  }
  return byteLength(json) + extra;
}

/**
 * Deterministic split of a listings array into byte-capped chunks. Splits
 * on STORAGE_CHUNK_TARGET_BYTES of estimated *cached-response* size (see
 * estimateCachedResponseBytes), not a fixed record count and not raw
 * stringified size, so chunk count adapts automatically as the average
 * listing grows (e.g. new pre-computed fields) instead of silently
 * drifting back over the 2MB ceiling.
 */
/** Exported for scripts/test-listings-store.ts only — not used elsewhere. */
export function buildStorageChunks(listings: Listing[]): Listing[][] {
  const chunks: Listing[][] = [];
  let current: Listing[] = [];
  let currentBytes = 0;

  for (const l of listings) {
    const size = estimateCachedResponseBytes(JSON.stringify(l));
    if (current.length > 0 && currentBytes + size > STORAGE_CHUNK_TARGET_BYTES) {
      chunks.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(l);
    currentBytes += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

interface ListingsIndex {
  chunks: number;
  total: number;
  updatedAt: string;
}

/**
 * Write the sharded chunk keys + manifest for the given full listings
 * array. Cheap relative to the per-slug pipeline (O(chunks) ≈ 7 SETs, not
 * O(listings)) so it's safe to call on every mutation, including the
 * single-listing upsertListing path.
 *
 * `keyPrefix` defaults to "listings" (the real production key schema) —
 * it exists solely so scripts/test-listings-store.ts can round-trip
 * through this exact code path against a fully isolated key namespace
 * (e.g. "test-listings") without ever touching real listings:* data in
 * the shared KV instance. No production caller passes a non-default value.
 */
async function writeShardedStorage(listings: Listing[], keyPrefix = "listings"): Promise<number> {
  const chunks = buildStorageChunks(listings);

  // Best-effort: if a previous, larger write left more chunks than we need
  // now, delete the now-orphaned trailing keys. Not load-bearing for
  // correctness — getAllListings only ever reads `index.chunks` worth of
  // keys — just storage hygiene, so a failure here is silently ignored.
  let prevChunkCount = 0;
  try {
    const prevIndex = unwrapJson(await kvGet(`${keyPrefix}:index`)) as Partial<ListingsIndex> | null;
    if (prevIndex && typeof prevIndex.chunks === "number") {
      prevChunkCount = prevIndex.chunks;
    }
  } catch {
    // ignore — worst case a stale chunk key lingers unread
  }

  await Promise.all(chunks.map((chunk, i) => kvSet(`${keyPrefix}:chunk:${i}`, chunk)));

  if (prevChunkCount > chunks.length) {
    await Promise.all(
      Array.from({ length: prevChunkCount - chunks.length }, (_, k) =>
        kvDel(`${keyPrefix}:chunk:${chunks.length + k}`)
      )
    );
  }

  const index: ListingsIndex = {
    chunks: chunks.length,
    total: listings.length,
    updatedAt: new Date().toISOString(),
  };
  await kvSet(`${keyPrefix}:index`, index);

  return chunks.length;
}

/**
 * Read + reassemble the sharded listings:chunk:* keys per the
 * listings:index manifest. Returns null (not []) whenever the sharded form
 * isn't present or isn't trustworthy, so callers can fall back to the
 * legacy listings:all blob — never confuse "no sharded data yet" with "the
 * store is empty." See writeShardedStorage's doc comment re: `keyPrefix`.
 */
async function readShardedListings(keyPrefix = "listings"): Promise<Listing[] | null> {
  const rawIndex = await kvGet(`${keyPrefix}:index`);
  if (rawIndex == null) return null;

  const index = unwrapJson(rawIndex) as Partial<ListingsIndex> | null;
  if (!index || typeof index.chunks !== "number") return null;
  if (index.chunks <= 0) return []; // legitimately empty store

  const rawChunks = await Promise.all(
    Array.from({ length: index.chunks }, (_, i) => kvGet(`${keyPrefix}:chunk:${i}`))
  );

  const merged: Listing[] = [];
  for (const rc of rawChunks) {
    const unwrapped = unwrapJson(rc);
    if (!Array.isArray(unwrapped)) return null; // corrupt/missing chunk — abort, let caller fall back
    merged.push(...(unwrapped as Listing[]));
  }

  if (!isValidListingArray(merged)) return null;
  return merged;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get all listings from KV. Falls back to static data.
 *
 * `opts.keyPrefix` (default "listings") lets scripts/test-listings-store.ts
 * exercise this exact function against an isolated test namespace instead
 * of real data — see writeShardedStorage's doc comment. No production
 * caller passes this.
 */
export async function getAllListings(opts?: { keyPrefix?: string }): Promise<Listing[]> {
  const keyPrefix = opts?.keyPrefix ?? "listings";

  if (!kvAvailable()) {
    const { PRELOADED_LISTINGS } = await import("../data/listings");
    return PRELOADED_LISTINGS;
  }

  try {
    const sharded = await readShardedListings(keyPrefix);
    if (sharded) return sharded;
  } catch (err) {
    console.error("[kv-shape] sharded listings:chunk:* read failed — falling back to legacy listings:all blob:", err);
  }

  try {
    const raw = unwrapJson(await kvGet(`${keyPrefix}:all`));
    if (isValidListingArray(raw)) {
      return raw;
    }
    console.error(`[kv-shape] ${keyPrefix}:all is not a valid Listing[] — falling back to static data`);
  } catch (err) {
    console.error(`[kv-shape] ${keyPrefix}:all unreadable — falling back to static data:`, err);
  }

  // Fallback to static
  const { PRELOADED_LISTINGS } = await import("../data/listings");
  return PRELOADED_LISTINGS;
}

/**
 * Get a single listing by slug. See getAllListings re: `opts.keyPrefix`.
 */
export async function getListingBySlug(slug: string, opts?: { keyPrefix?: string }): Promise<Listing | null> {
  const keyPrefix = opts?.keyPrefix ?? "listings";

  if (!kvAvailable()) {
    const { PRELOADED_LISTINGS } = await import("../data/listings");
    return PRELOADED_LISTINGS.find((l) => slugify(l.address) === slug) ?? null;
  }

  try {
    const raw = await kvGet(`${keyPrefix}:by-slug:${slug}`);
    if (raw && typeof raw === "string") {
      return JSON.parse(raw) as Listing;
    }
    if (raw && typeof raw === "object") {
      return raw as Listing;
    }
  } catch {
    // Fall through
  }

  // Fallback: search in full list
  const all = await getAllListings({ keyPrefix });
  return all.find((l) => slugify(l.address) === slug) ?? null;
}

/**
 * Get listings filtered by city.
 */
export async function getListingsByCity(city: string): Promise<Listing[]> {
  const all = await getAllListings();
  return all.filter((l) => l.city === city);
}

// ---------------------------------------------------------------------------
// Floor guard — circuit breaker against every future variant of the 2026-08
// wipe incident (root cause: src/app/api/pipeline/refresh/route.ts Phase 8
// full-replacing listings:all with only the current CA run's output,
// silently discarding every previously-stored US listing that wasn't
// re-fetched this cycle — see that file's Phase 8 comment for the full
// mechanism). No single call site can be trusted to always compute a
// complete replacement array, so this is the last line of defense: refuse
// any write that would shrink the store below FLOOR_GUARD_MIN_RATIO of its
// current size, unless the caller explicitly opts out via `force` (used by
// callers whose whole job IS deliberate shrinkage — see removeListings
// below and reseed/dedupe scripts).
// ---------------------------------------------------------------------------
const FLOOR_GUARD_MIN_RATIO = 0.4;

export interface WriteAllListingsResult {
  written: number;
  slugs: number;
  /** True when the floor guard refused the write — `written`/`slugs` are 0
   * and listings:all was left untouched. */
  refused?: boolean;
  refusedReason?: string;
}

/**
 * Write all listings to KV. Also creates per-slug index entries.
 * Uses Upstash pipeline to batch slug writes (250+ individual SETs → single HTTP request).
 *
 * `force: true` bypasses the floor guard below — pass it only when the
 * caller's entire purpose is a deliberate, known-large removal (e.g.
 * removeListings here, or a one-off admin/reseed script that just purged a
 * scope on purpose). Every other caller — especially the two automated
 * cron write paths (pipeline/refresh/route.ts, pipeline/us-discover.ts) —
 * should leave this false so a bug that silently produces a near-empty or
 * partial array gets refused instead of destructively written.
 */
export async function writeAllListings(
  listings: Listing[],
  opts?: { force?: boolean; keyPrefix?: string }
): Promise<WriteAllListingsResult> {
  if (!kvAvailable()) {
    throw new Error("KV not configured — cannot write listings");
  }

  // See getAllListings re: keyPrefix — defaults to "listings" (production)
  // for every real caller; scripts/test-listings-store.ts is the only
  // caller that overrides it, to round-trip against an isolated namespace.
  const keyPrefix = opts?.keyPrefix ?? "listings";

  if (!opts?.force) {
    // Best-effort current count — a failed/degraded read here (falls back
    // to static PRELOADED_LISTINGS, tiny) must never itself become a false
    // "shrink" trigger, so treat a suspiciously small current count (< 5,
    // consistent with the static fallback or a genuinely fresh store) as
    // "nothing to protect yet" rather than blocking the very first write.
    const current = await getAllListings({ keyPrefix });
    if (current.length >= 5 && listings.length < current.length * FLOOR_GUARD_MIN_RATIO) {
      const reason =
        `refusing write: new array (${listings.length}) is < ${FLOOR_GUARD_MIN_RATIO * 100}% ` +
        `of current stored count (${current.length}). Pass { force: true } if this shrink is intentional.`;
      console.error(`[pipeline-guard] ${reason}`);
      return { written: 0, slugs: 0, refused: true, refusedReason: reason };
    }
  }

  // Write the full array — both the legacy single blob (back-compat for
  // standalone scripts that read listings:all raw, e.g. flush-city.ts,
  // diag-cedar.ts) and the sharded chunks the app itself now reads from.
  await Promise.all([kvSet(`${keyPrefix}:all`, listings), writeShardedStorage(listings, keyPrefix)]);

  // Batch slug writes via pipeline (chunks of 50 to avoid oversized payloads)
  const CHUNK_SIZE = 50;
  let slugs = 0;
  for (let i = 0; i < listings.length; i += CHUNK_SIZE) {
    const chunk = listings.slice(i, i + CHUNK_SIZE);
    const commands: [string, ...string[]][] = chunk.map((l) => [
      "SET",
      `${keyPrefix}:by-slug:${slugify(l.address)}`,
      JSON.stringify(l),
    ]);
    await kvPipeline(commands);
    slugs += chunk.length;
  }

  // Write metadata
  const cities = [...new Set(listings.map((l) => l.city))];
  await kvSet(`${keyPrefix}:meta`, {
    count: listings.length,
    cities,
    updatedAt: new Date().toISOString(),
  });

  return { written: listings.length, slugs };
}

/**
 * Add or update a single listing in KV.
 * Reads the full list, upserts by address, writes back the array +
 * the single slug key + meta. Does NOT rewrite all 250 slug keys
 * (that's only needed for bulk operations like writeAllListings).
 */
export async function upsertListing(listing: Listing): Promise<void> {
  const all = await getAllListings();
  const idx = all.findIndex((l) => l.address === listing.address);
  if (idx >= 0) {
    all[idx] = listing;
  } else {
    all.push(listing);
  }

  const slug = slugify(listing.address);
  const cities = [...new Set(all.map((l) => l.city))];

  // Still cheap: legacy blob + single slug key + meta + a full re-shard
  // (O(chunks) ≈ 7 SETs, not O(listings) — nowhere near the 250+ slug
  // rewrite writeAllListings does, which is exactly what this function
  // exists to avoid paying on every single-property assess).
  await Promise.all([
    kvSet("listings:all", all),
    kvSet(`listings:by-slug:${slug}`, listing),
    kvSet("listings:meta", {
      count: all.length,
      cities,
      updatedAt: new Date().toISOString(),
    }),
    writeShardedStorage(all),
  ]);
}

/**
 * Remove listings by address. Returns count removed.
 */
export async function removeListings(addresses: string[]): Promise<number> {
  const addrSet = new Set(addresses.map((a) => a.toLowerCase()));
  const all = await getAllListings();
  const filtered = all.filter((l) => !addrSet.has(l.address.toLowerCase()));
  const removed = all.length - filtered.length;

  if (removed > 0) {
    // force: true — deliberate, targeted removal by explicit address list;
    // exempt from the floor guard (see writeAllListings' doc comment).
    await writeAllListings(filtered, { force: true });

    // Clean up slug entries for removed listings
    for (const l of all) {
      if (addrSet.has(l.address.toLowerCase())) {
        await kvDel(`listings:by-slug:${slugify(l.address)}`);
      }
    }
  }

  return removed;
}

/**
 * Delete all listings:by-slug:* keys that aren't in the provided valid slugs set.
 * Uses SCAN to iterate through keys without loading them all at once.
 */
export async function purgeStaleSlugKeys(validSlugs: Set<string>): Promise<number> {
  if (!kvAvailable()) return 0;

  let cursor = "0";
  let purged = 0;

  do {
    const url = kvUrl()!;
    const res = await fetch(
      `${url}/scan/${encodeURIComponent(cursor)}/match/${encodeURIComponent("listings:by-slug:*")}/count/100`,
      { method: "GET", headers: kvHeaders() }
    );
    if (!res.ok) break;

    const body = await res.json();
    const [nextCursor, keys] = body.result as [string, string[]];
    cursor = nextCursor;

    for (const key of keys) {
      const slug = key.replace("listings:by-slug:", "");
      if (!validSlugs.has(slug)) {
        await kvDel(key);
        purged++;
      }
    }
  } while (cursor !== "0");

  return purged;
}

// ---------------------------------------------------------------------------
// Generic metadata key/value helpers
//
// Small values outside the listings:* key schema above — used by
// src/lib/pipeline/us-discover.ts to persist a per-city last-refresh
// timestamp ("us-discover:last-refresh:{citySlug}") so the cadence gate
// (US_DISCOVER_REFRESH_DAYS) survives across cron runs / cold starts.
// Reuses this file's own kvGet/kvSet primitives; falls back to an
// in-process Map when KV isn't configured — same degrade-not-disable
// philosophy as rentcast.ts's quota guard (non-persistent locally, real
// cross-request persistence once KV is linked in Vercel).
// ---------------------------------------------------------------------------

const memMeta = new Map<string, string>();

export async function getMetaValue(key: string): Promise<string | null> {
  if (!kvAvailable()) return memMeta.get(key) ?? null;

  try {
    const raw = await kvGet(key);
    if (typeof raw === "string") return raw;
    if (raw != null) return JSON.stringify(raw);
  } catch {
    // Fall through
  }
  return null;
}

export async function setMetaValue(key: string, value: string): Promise<void> {
  if (!kvAvailable()) {
    memMeta.set(key, value);
    return;
  }
  await kvSet(key, value);
}

/**
 * Get metadata about stored listings.
 */
export async function getListingsMeta(): Promise<{
  count: number;
  cities: string[];
  updatedAt: string;
  source: "kv" | "static";
} | null> {
  if (!kvAvailable()) {
    const { PRELOADED_LISTINGS } = await import("../data/listings");
    return {
      count: PRELOADED_LISTINGS.length,
      cities: [...new Set(PRELOADED_LISTINGS.map((l) => l.city))],
      updatedAt: "static",
      source: "static",
    };
  }

  try {
    const raw = await kvGet("listings:meta");
    if (raw && typeof raw === "string") {
      return { ...JSON.parse(raw), source: "kv" };
    }
    if (raw && typeof raw === "object") {
      return { ...(raw as any), source: "kv" };
    }
  } catch {
    // Fall through
  }

  return null;
}
