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
 * PRELOADED_LISTINGS (src/lib/data/listings.ts) is a *dev seed*, not an
 * outage mask. Two separate conditions now have to hold before it is
 * served: KV must be unconfigured, AND the process must be able to prove it
 * is not a production deployment (see the [seed-gate] block below). When KV
 * *is* configured and a read fails — or when credentials are missing
 * somewhere the seed is not permitted — this module reports that failure
 * (loudly, and as a distinct state) instead of quietly handing back a
 * 250-row March 2026 snapshot that shares almost nothing with the ~2,300
 * listings actually in the store. See getAllListings / getListingBySlug
 * below for why that distinction is load-bearing.
 */

import { Listing } from "../types";
import { slugify } from "../utils";
import { canonicalize, isSameRecord, listingKey, listingMlsKey } from "../listing-identity";

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

// ---------------------------------------------------------------------------
// [seed-gate] When may the static dev seed stand in for the real store?
//
// kvAvailable() answers "are credentials present", which is a different
// question from "is it safe to serve a March 2026 snapshot here". A
// production deploy whose KV credentials were omitted, rotated, or scoped to
// the wrong database fails kvAvailable() in exactly the same way a laptop
// with no .env.local does, and the old code answered both by returning
// PRELOADED_LISTINGS as a perfectly healthy `ok`. That is this branch's own
// headline failure — stale pages plus false 404s — reachable through a
// config regression instead of a code one: 250 rows served as live data,
// every real property URL resolving to `absent` (404) out of
// getListingBySlug because the seed overlaps the live store almost nowhere,
// and nothing anywhere saying the system is degraded.
//
// So the seed is opt-in by environment, and the test is written to fail
// SAFE: it must positively recognize a non-production context before
// allowing the seed, and refuses anything it does not recognize. Note this
// is the opposite polarity from isProductionDeployment() in
// src/config/insurance-kernel/execution-mode.ts, which treats unknown tiers
// AS production. Both rules resolve the unknown case the same way — behave
// as though this is production — they just start from opposite defaults,
// because that one asks "may I do the live thing" and this one asks "may I
// do the fake thing".
//
// The rule, in order:
//
//   1. LISTINGS_ALLOW_STATIC_SEED=1 — explicit operator opt-in, honoured
//      anywhere, always with a warning. Deliberately mirrors the
//      SITEMAP_ALLOW_STATIC_SEED escape hatch scripts/generate-sitemap.ts
//      already uses: one convention, one string to grep for.
//   2. VERCEL_ENV, when set, is authoritative. Vercel sets
//      NODE_ENV=production on preview builds too, so NODE_ENV alone cannot
//      tell a preview from production. Only "development" (`vercel dev`)
//      permits the seed. "preview" does NOT: a preview deployment is a real
//      deployment that real people and crawlers reach, and a preview
//      quietly serving the seed is how a wrong belief about the store gets
//      promoted to production. Any other tier value is unrecognized and
//      therefore refused.
//   3. With no VERCEL_ENV, only NODE_ENV="development" (`next dev`) or
//      "test" permits it. An unset/empty NODE_ENV is REFUSED — that is a
//      bare `node`/`tsx` process, which is as likely to be an ops script
//      pointed at production as it is a laptop. The ones that legitimately
//      want the seed have rule 1.
//
// A refusal is not a crash: it resolves the same `unavailable` state a KV
// outage does, so every consumer's existing degraded path (503 + Retry-After
// on the render surfaces, abort-before-write on the cron paths) applies
// unchanged. The one thing that no longer happens is silent success.
// ---------------------------------------------------------------------------

function staticSeedGate(): { allowed: boolean; why: string } {
  if (process.env.LISTINGS_ALLOW_STATIC_SEED === "1") {
    return { allowed: true, why: "LISTINGS_ALLOW_STATIC_SEED=1 is set explicitly" };
  }

  const tier = process.env.VERCEL_ENV;
  if (tier) {
    if (tier === "development") return { allowed: true, why: 'VERCEL_ENV="development"' };
    return {
      allowed: false,
      why: `VERCEL_ENV="${tier}" is a deployed environment (only "development" may serve the seed)`,
    };
  }

  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv === "development" || nodeEnv === "test") {
    return { allowed: true, why: `NODE_ENV="${nodeEnv}" with no VERCEL_ENV` };
  }

  return {
    allowed: false,
    why:
      `NODE_ENV=${nodeEnv ? `"${nodeEnv}"` : "(unset)"} with no VERCEL_ENV — not a recognized ` +
      `non-production environment`,
  };
}

/**
 * The single `unavailable` reason used everywhere a refused seed turns into
 * a degraded read, so the log line, the health stamp and the reason a route
 * surfaces to a caller all say the same thing.
 */
function seedRefusedReason(why: string): string {
  return (
    `KV_REST_API_URL/KV_REST_API_TOKEN are not configured, and the static dev seed is not permitted ` +
    `here (${why}). Set the KV credentials, or set LISTINGS_ALLOW_STATIC_SEED=1 to knowingly serve the ` +
    `250-row March 2026 snapshot instead of live data.`
  );
}

function kvHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${kvToken()}`,
    "Content-Type": "application/json",
  };
}

// ---------------------------------------------------------------------------
// [kv-null-conflation] Upstash answers a GET for a key that does not exist
// with HTTP 200 and body {"result":null} — verified against the live
// instance:
//
//   GET /get/listings:by-slug:definitely-not-a-real-slug-xyz -> 200 {"result":null}
//
// The old `Promise<unknown>` shape flattened that into the same `null` this
// function returned for a failed fetch, and two separate bugs lived in the
// gap:
//
//   1. "KV is down" was indistinguishable from "that listing does not
//      exist," so a transient blip reached the property page as a 404. A
//      404 tells Google to drop the URL — this site has already lost 409+
//      property URLs that way — while a 500 tells it to come back later.
//      kvRead therefore reports two states, and inside `ok`, `value === null`
//      means one thing only: the key is not there.
//
//   2. Because the missing-key answer is a *successful* 200, Next's data
//      cache stored it for the whole `revalidate: 300` window. Any listing
//      created inside that window by the on-demand /api/assess flow
//      (upsertListing) kept 404ing until the entry aged out — the confirmed
//      mechanism behind the 22:37:22Z /property/867-walfred-rd report. The
//      fix keeps the 300s cache exactly where it earns its keep (positive
//      reads, which is nearly every page render — see the sharded-storage
//      block below for the ~10MB-per-render incident that cache prevents)
//      and refuses to *serve* a cached null: a negative is re-checked once,
//      uncached, before anyone is allowed to call it absence. The extra
//      round trip lands only on reads that were already going to miss.
// ---------------------------------------------------------------------------
type KvRead =
  | { status: "ok"; value: unknown }
  | { status: "unavailable"; reason: string };

class KvUnavailableError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "KvUnavailableError";
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function kvFetchOnce(url: string, key: string, fresh: boolean): Promise<KvRead> {
  let res: Response;
  try {
    res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
      method: "GET",
      headers: kvHeaders(),
      // Discover can tolerate 5 min; assessment-result handoffs cannot.
      ...(fresh ? { cache: "no-store" as const } : { next: { revalidate: 300 } }),
    });
  } catch (err) {
    return { status: "unavailable", reason: `KV GET ${key} failed: ${errText(err)}` };
  }

  if (!res.ok) {
    return { status: "unavailable", reason: `KV GET ${key} returned HTTP ${res.status}` };
  }

  try {
    const body = (await res.json()) as { result?: unknown };
    return { status: "ok", value: body.result ?? null };
  } catch (err) {
    return { status: "unavailable", reason: `KV GET ${key} returned an unparseable body: ${errText(err)}` };
  }
}

async function kvRead(key: string, opts?: { fresh?: boolean }): Promise<KvRead> {
  const url = kvUrl();
  if (!url) return { status: "unavailable", reason: "KV_REST_API_URL is not configured" };

  const fresh = opts?.fresh === true;
  const first = await kvFetchOnce(url, key, fresh);
  if (fresh || first.status !== "ok" || first.value !== null) return first;

  // Point (2) above: never let a cached negative outlive the write that
  // filled the key. Confirm it against KV itself before returning it.
  return kvFetchOnce(url, key, true);
}

/**
 * `kvRead` for the callers that legitimately treat any read failure as "no
 * value" behind their own try/catch (the metadata keys, the orphan-chunk
 * cleanup). It THROWS on unavailability rather than returning null, so no
 * future caller can silently re-create the conflation described above by
 * reaching for the convenient-looking helper.
 */
async function kvGet(key: string, opts?: { fresh?: boolean }): Promise<unknown> {
  const read = await kvRead(key, opts);
  if (read.status !== "ok") throw new KvUnavailableError(read.reason);
  return read.value;
}

// ---------------------------------------------------------------------------
// [kv-write-silence] Why the write primitives throw instead of returning a
// boolean.
//
// kvSet and kvPipeline used to answer a rejected write with `false`, and
// every single call site discarded that value — the chunk writes, the
// listings:index manifest, the by-slug pipeline, listings:meta, and
// setMetaValue. A write that failed halfway therefore returned
// `{ written: 2316, slugs: 2316 }` to its caller and logged nothing at all:
// chunks written but no manifest, or a manifest published over chunks that
// never landed. The store ends up internally inconsistent and the only
// evidence is a page that renders wrong days later.
//
// Under the fail-loud rule a partially-applied write is exactly the state
// that must not be reported as success, so these now throw KvWriteError.
// The throw propagates out of writeAllListings / upsertListing /
// setMetaValue to the cron or request that asked for the write, which is
// the only caller with enough context to decide whether to retry. Nothing
// downgrades a write failure to a log line.
//
// Note the asymmetry with kvDel: deletes here are genuinely best-effort
// storage hygiene (orphaned trailing chunk keys, stale slug keys) and their
// failure cannot corrupt a read, so kvDel keeps its boolean and its
// already-documented ignore-the-result call sites.
// ---------------------------------------------------------------------------
export class KvWriteError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "KvWriteError";
  }
}

async function kvSet(key: string, value: unknown, exSeconds?: number): Promise<void> {
  const url = kvUrl();
  if (!url) throw new KvWriteError(`KV SET ${key} failed: KV_REST_API_URL is not configured`);

  const serialized = JSON.stringify(value);

  // Use POST for large payloads (GET URL path has length limits)
  const args: string[] = ["SET", key, serialized];
  if (exSeconds) args.push("EX", String(exSeconds));

  let res: Response;
  try {
    res = await fetch(`${url}`, {
      method: "POST",
      headers: kvHeaders(),
      body: JSON.stringify(args),
    });
  } catch (err) {
    throw new KvWriteError(`KV SET ${key} failed: ${errText(err)}`);
  }

  if (!res.ok) throw new KvWriteError(`KV SET ${key} returned HTTP ${res.status}`);
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
 *
 * Throws on failure — see the [kv-write-silence] block above. Three distinct
 * failures are checked, because Upstash reports them differently: a rejected
 * *request* comes back as a non-2xx; a rejected *command* inside an accepted
 * pipeline comes back as HTTP 200 with `{"error": "..."}` in that command's
 * slot of the result array; and a body that is not one-result-per-command at
 * all means the response is not the thing this function is about to
 * interpret. All three quietly lose a batch of 50 by-slug keys while the
 * caller counts them as written, so none of them may be inferred from
 * `res.ok`.
 */
async function kvPipeline(commands: [string, ...string[]][]): Promise<void> {
  const url = kvUrl();
  if (!url) throw new KvWriteError("KV pipeline failed: KV_REST_API_URL is not configured");

  // Upstash pipeline: POST array of commands
  let res: Response;
  try {
    res = await fetch(`${url}/pipeline`, {
      method: "POST",
      headers: kvHeaders(),
      body: JSON.stringify(commands),
    });
  } catch (err) {
    throw new KvWriteError(`KV pipeline of ${commands.length} command(s) failed: ${errText(err)}`);
  }

  if (!res.ok) {
    throw new KvWriteError(`KV pipeline of ${commands.length} command(s) returned HTTP ${res.status}`);
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    throw new KvWriteError(`KV pipeline of ${commands.length} command(s) returned an unparseable body: ${errText(err)}`);
  }

  // Upstash answers a pipeline with exactly one result per submitted
  // command, in submission order. Anything else means the body is not the
  // thing the per-command check below is written to read, and this function
  // has no way to find out which commands landed:
  //
  //   - A NON-ARRAY body (an HTML error page from a proxy, a bare
  //     `{"error": ...}` envelope, a stub that answers `{"result":"OK"}`)
  //     used to fall straight past the `if (Array.isArray(body))` guard and
  //     be reported as a fully successful pipeline. That is precisely the
  //     silent write loss this function was rewritten to stop, surviving in
  //     the one branch the rewrite did not look at.
  //   - A SHORT array means commands went unacknowledged. Upstash does not
  //     say which, so every key in the batch has to be treated as unwritten.
  //
  // Both are raised as write failures rather than tolerated, because the
  // caller (writeAllListings) reports these slugs as written and the store
  // then disagrees with its own index with nothing in the log to say so.
  if (!Array.isArray(body)) {
    throw new KvWriteError(
      `KV pipeline of ${commands.length} command(s) returned HTTP 200 with a ${
        body === null ? "null" : typeof body
      } body instead of a per-command result array — cannot confirm any command was applied.`
    );
  }

  if (body.length !== commands.length) {
    throw new KvWriteError(
      `KV pipeline submitted ${commands.length} command(s) but got ${body.length} result(s) back — ` +
        `${commands.length - body.length} command(s) went unacknowledged. Treating the whole batch as ` +
        `unwritten: there is no way to tell which keys landed.`
    );
  }

  const failed = body
    .map((r, i) => ({ i, error: (r as { error?: unknown } | null)?.error }))
    .filter((r) => r.error != null);
  if (failed.length > 0) {
    const sample = failed.slice(0, 3).map((f) => `#${f.i}: ${String(f.error)}`).join("; ");
    throw new KvWriteError(
      `KV pipeline: ${failed.length} of ${commands.length} command(s) were rejected — ${sample}` +
        (failed.length > 3 ? ", ..." : "")
    );
  }
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

/**
 * The sharded-storage manifest.
 *
 * `total` is not decoration: it is the only cross-key integrity signal this
 * key schema has. writeShardedStorage stamps the row count it believed it
 * was writing, and readShardedListings refuses to serve a reassembly whose
 * length disagrees. That is what turns a torn write (some chunk keys new,
 * some still old, under an unchanged manifest) from a silently wrong array
 * into an `unavailable` the consumers already know how to surface.
 *
 * --- Why not generation-scoped chunk keys ---------------------------------
 *
 * The durable fix for torn writes is to write generation N's rows to
 * `{prefix}:chunk:{gen}:{i}`, publish a manifest naming that generation
 * (making the manifest SET a true atomic commit, since old readers keep
 * resolving old keys), and garbage-collect the previous generation
 * afterwards. It is not done here, for one concrete reason:
 *
 *   The manifest is read through `next: { revalidate: 300 }` (see
 *   kvFetchOnce). Next's fetch cache is shared per deployment and there is
 *   no way for a cron write to invalidate it, so for up to five minutes
 *   after every write some render paths still hold the PREVIOUS manifest.
 *   Under the current in-place key names those renders resolve fine (the
 *   keys still exist, holding newer rows). Under generation-scoped keys
 *   they would point at a generation that GC has just deleted, and every
 *   such render would 503 for up to five minutes after each write. That
 *   trades a rare torn write for a guaranteed post-write outage window.
 *
 * Landing it safely would require, at minimum: (a) retaining generation
 * N-1 until at least the manifest cache TTL has expired — i.e. GC by age,
 * not by "one write later" — which roughly doubles stored bytes (~10MB ->
 * ~20MB today); (b) an orphan sweep for generations abandoned by a crashed
 * write, since nothing would name them any more; (c) a manifest-shape
 * migration with a fallback read of un-generationed `{prefix}:chunk:{i}`
 * for the existing store; and (d) a matching change to the legacy
 * `{prefix}:all` blob, which is a single key and can never participate in
 * the swap, so it stays non-atomic regardless. That is a larger, riskier
 * change than the audit this file is being repaired under, so it is
 * deliberately deferred and the `total` cross-check above is the detection
 * this schema can carry today.
 */
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

  // --- Ordering ----------------------------------------------------------
  //
  // Three steps, in this order, and the order is the whole safety argument:
  //
  //   1. Write every chunk key. The manifest still names the OLD chunk
  //      count, so nothing has been published yet.
  //   2. Publish the manifest. This is the single key that decides what a
  //      reader sees, so it is the closest thing this key schema has to a
  //      commit point.
  //   3. Only then delete trailing chunk keys the new, smaller manifest no
  //      longer claims.
  //
  // Step 3 used to run before step 2, which meant a shrinking write deleted
  // chunk:5 while the still-live old manifest was promising six chunks —
  // readShardedListings would (correctly) call that `unavailable` for the
  // duration of the write. Deleting after the swap only ever touches keys
  // no reachable manifest points at.
  //
  // What this ordering does NOT buy is atomicity. If step 1 throws partway
  // (see [kv-write-silence]) some chunk keys hold new data and some hold
  // old, under an unchanged manifest, and a reader reassembles a mix. That
  // is why the failure below is logged as [kv-torn-write] with instructions
  // rather than swallowed, and why readShardedListings cross-checks the
  // reassembled row count against the manifest's `total` — a mixed read
  // almost always disagrees on length, and disagreement is reported as
  // `unavailable`, not served. A genuinely atomic swap needs
  // generation-scoped chunk keys; see the note on ListingsIndex for why
  // that is deliberately not done here.
  try {
    await Promise.all(chunks.map((chunk, i) => kvSet(`${keyPrefix}:chunk:${i}`, chunk)));
  } catch (err) {
    console.error(
      `[kv-torn-write] ${keyPrefix}:chunk:* write failed partway (${errText(err)}). The manifest was NOT ` +
        `updated, so some chunk keys may now hold new rows under an old manifest. Re-run the write to ` +
        `converge; readListingsStore will report the store unavailable until then if the row count disagrees.`
    );
    throw err;
  }

  const index: ListingsIndex = {
    chunks: chunks.length,
    total: listings.length,
    updatedAt: new Date().toISOString(),
  };
  await kvSet(`${keyPrefix}:index`, index);

  if (prevChunkCount > chunks.length) {
    await Promise.all(
      Array.from({ length: prevChunkCount - chunks.length }, (_, k) =>
        kvDel(`${keyPrefix}:chunk:${chunks.length + k}`)
      )
    );
  }

  return chunks.length;
}

/**
 * The three states every store read has to keep apart. `absent` means the
 * store verifiably holds nothing (the keys are not there, and KV said so
 * over a healthy connection); `unavailable` means we do not know what the
 * store holds. Collapsing those two is what turned a KV blip into a 404 —
 * see the [kv-null-conflation] block above.
 */
export type ListingsStoreRead =
  | { status: "ok"; listings: Listing[] }
  | { status: "absent" }
  | { status: "unavailable"; reason: string };

/**
 * Read + reassemble the sharded listings:chunk:* keys per the
 * listings:index manifest. `absent` is reserved for "no manifest key at
 * all" (the pre-sharding store, or a fresh namespace) so callers can try
 * the legacy listings:all blob; anything else that goes wrong — a failed
 * fetch, an unparseable manifest, a chunk the manifest promised that isn't
 * there, a chunk that doesn't reassemble into Listing[] — is `unavailable`
 * and carries the reason, because none of those mean the store is empty.
 * See writeShardedStorage's doc comment re: `keyPrefix`.
 */
async function readShardedListings(keyPrefix = "listings"): Promise<ListingsStoreRead> {
  const rawIndex = await kvRead(`${keyPrefix}:index`);
  if (rawIndex.status === "unavailable") return rawIndex;
  if (rawIndex.value == null) return { status: "absent" };

  let index: Partial<ListingsIndex> | null;
  try {
    index = unwrapJson(rawIndex.value) as Partial<ListingsIndex> | null;
  } catch (err) {
    return { status: "unavailable", reason: `${keyPrefix}:index is unparseable: ${errText(err)}` };
  }
  if (!index || typeof index.chunks !== "number") {
    return { status: "unavailable", reason: `${keyPrefix}:index is not a { chunks, total, updatedAt } manifest` };
  }
  if (index.chunks <= 0) return { status: "ok", listings: [] }; // legitimately empty store

  const rawChunks = await Promise.all(
    Array.from({ length: index.chunks }, (_, i) => kvRead(`${keyPrefix}:chunk:${i}`))
  );

  const merged: Listing[] = [];
  for (let i = 0; i < rawChunks.length; i++) {
    const rc = rawChunks[i];
    if (rc.status === "unavailable") return rc;
    if (rc.value == null) {
      return {
        status: "unavailable",
        reason: `${keyPrefix}:chunk:${i} is missing although the manifest claims ${index.chunks} chunk(s)`,
      };
    }
    let unwrapped: unknown;
    try {
      unwrapped = unwrapJson(rc.value);
    } catch (err) {
      return { status: "unavailable", reason: `${keyPrefix}:chunk:${i} is unparseable: ${errText(err)}` };
    }
    if (!Array.isArray(unwrapped)) {
      return { status: "unavailable", reason: `${keyPrefix}:chunk:${i} is not an array` };
    }
    merged.push(...(unwrapped as Listing[]));
  }

  if (!isValidListingArray(merged)) {
    return { status: "unavailable", reason: `${keyPrefix}:chunk:* did not reassemble into a Listing[]` };
  }

  // Cross-key integrity check — see ListingsIndex's doc comment. A manifest
  // whose `total` disagrees with what the chunks actually reassemble to
  // means the two are from different writes (a torn write, or a chunk key
  // rewritten out of band), and a mixed array is exactly the
  // wrong-but-plausible data the fail-loud rule ranks worst. Older manifests
  // predating the field are tolerated: only a numeric `total` is checked.
  if (typeof index.total === "number" && index.total !== merged.length) {
    return {
      status: "unavailable",
      reason:
        `${keyPrefix}:index claims ${index.total} listing(s) but ${keyPrefix}:chunk:* reassembled to ` +
        `${merged.length} — manifest and chunks are from different writes (torn write); refusing to serve the mix`,
    };
  }

  return { status: "ok", listings: merged };
}

/**
 * Authoritative whole-store read: sharded form first, legacy listings:all
 * blob second, and a truthful answer either way. Everything that must not
 * mistake an outage for data goes through here — getListingBySlug, the
 * floor guard, upsertListing, removeListings — while getAllListings is the
 * one caller that flattens the result back to a plain array for the render-
 * path callers that predate this distinction.
 *
 * EXPORTED (2026-08 audit). It used to be module-private, which left bulk
 * consumers — the sitemap route, the prebuild sitemap generator, discover,
 * the homepage, dashboard, search, the insurance typeahead — with only
 * getAllListings' flattened `Listing[]`, where an outage and an empty store
 * are the same empty array. They compensated by reaching for
 * getListingsStoreHealth(), which is process-global module state: between a
 * consumer's getAllListings() call and its health check, any concurrent
 * request on the same lambda can overwrite the stamp, so it can report
 * healthy for a read that was not. That race makes it unusable as a
 * consumer's primary signal. This function returns the status for THAT
 * read, on the stack, with nothing shared — so it is the signal consumers
 * use. getListingsStoreHealth stays exported and stamped for what it is
 * actually good at: out-of-band disclosure (canary, ops dashboard) about an
 * instance's most recent read.
 */
export async function readListingsStore(opts?: { keyPrefix?: string }): Promise<ListingsStoreRead> {
  const keyPrefix = opts?.keyPrefix ?? "listings";
  const sharded = await readShardedListings(keyPrefix);
  if (sharded.status === "ok") return sharded;
  if (sharded.status === "unavailable") {
    console.error(
      `[kv-shape] sharded ${keyPrefix}:chunk:* read failed — trying the legacy ${keyPrefix}:all blob: ${sharded.reason}`
    );
  }

  const legacy = await kvRead(`${keyPrefix}:all`);
  if (legacy.status === "unavailable") {
    return {
      status: "unavailable",
      reason: sharded.status === "unavailable" ? `${sharded.reason}; ${legacy.reason}` : legacy.reason,
    };
  }

  if (legacy.value == null) {
    // Both forms of the store are gone. That only means "empty" if the
    // sharded read also said "not there" over a healthy connection.
    return sharded.status === "absent"
      ? { status: "absent" }
      : { status: "unavailable", reason: sharded.reason };
  }

  try {
    const raw = unwrapJson(legacy.value);
    if (isValidListingArray(raw)) return { status: "ok", listings: raw };
    return { status: "unavailable", reason: `${keyPrefix}:all is not a valid Listing[]` };
  } catch (err) {
    return { status: "unavailable", reason: `${keyPrefix}:all is unreadable: ${errText(err)}` };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Store health
//
// getAllListings' signature (Promise<Listing[]>) has no room to say "this
// array is not the store," and ~15 render-path callers depend on it. So the
// degraded state is published out-of-band instead: every read stamps what
// it actually got, and anything that wants to surface degraded mode (a
// canary route, an ops dashboard, a banner) can ask. In-process and
// per-instance — a serverless lambda that never took a bad read reports
// healthy, which is true *for that instance*. It is a disclosure channel,
// not a cluster-wide health check.
//
// WHAT IT IS NOT (2026-08 audit): a consumer's decision signal. `lastStoreRead`
// is process-global mutable module state, and a Node lambda serves many
// requests concurrently. Between a consumer's `await getAllListings()` and
// its `getListingsStoreHealth()` call, any other in-flight request on the
// same instance can overwrite the stamp — so the health object a consumer
// reads may describe some other request's read, in either direction: a
// healthy stamp over a failed read (the dangerous one — the consumer
// publishes an empty sitemap believing it verified the store) or a degraded
// stamp over a good one. A consumer that must know about ITS OWN read calls
// readAllListings/requireAllListings, which return the status on the stack
// where nothing can race it. This stays exported and stamped for the
// out-of-band uses above, which are inherently approximate and fine with it.
// ---------------------------------------------------------------------------
export interface ListingsStoreHealth {
  /** True when the last read did not return live KV data. */
  degraded: boolean;
  /** Where the last returned array actually came from. */
  source: "kv" | "static-seed" | "empty" | "unavailable" | "unknown";
  reason: string | null;
  /** ISO timestamp of the last read, or null if none has happened yet. */
  at: string | null;
}

let lastStoreRead: ListingsStoreHealth = {
  degraded: false,
  source: "unknown",
  reason: null,
  at: null,
};

function noteStoreRead(source: ListingsStoreHealth["source"], reason: string | null): void {
  lastStoreRead = { degraded: source !== "kv", source, reason, at: new Date().toISOString() };
}

export function getListingsStoreHealth(): ListingsStoreHealth {
  return { ...lastStoreRead };
}

/**
 * Get all listings from KV.
 *
 * What this does NOT do any more: hand back the 250-row March 2026
 * PRELOADED_LISTINGS snapshot when a *configured* KV fails to read. That
 * fallback made an outage look like a small, healthy store — the seed
 * overlaps the ~2,300 real listings almost nowhere, so every by-slug lookup
 * missed and every property page 404'd, with nothing in the logs saying the
 * system was degraded. Under the fail-loud rule a wrong-but-plausible array
 * is the worst of the four outcomes, so a failed read now returns an empty
 * array plus a [kv-degraded] error line plus a health stamp
 * (getListingsStoreHealth) — visibly broken beats quietly wrong. The static
 * seed survives only for the case it was actually written for: KV not
 * configured at all AND a provably non-production process (see [seed-gate]
 * above) — i.e. local dev, where there is no live store to be stale
 * against. Unconfigured KV anywhere else is `unavailable`, not a seed.
 *
 * Callers that must not act on a guess do not use this function at all —
 * see readListingsStore and getListingBySlug.
 *
 * `opts.keyPrefix` (default "listings") lets scripts/test-listings-store.ts
 * exercise this exact function against an isolated test namespace instead
 * of real data — see writeShardedStorage's doc comment. No production
 * caller passes this.
 */
export async function getAllListings(opts?: { keyPrefix?: string }): Promise<Listing[]> {
  const read = await readAllListings({ keyPrefix: opts?.keyPrefix });

  if (read.status === "unavailable") {
    console.error(
      `[kv-degraded] returning 0 listings rather than the stale static seed — treat any empty ` +
        `page/sitemap/digest from this request as an outage, not as data. Bulk consumers should call ` +
        `readAllListings/requireAllListings instead, which cannot lose this distinction.`
    );
    return [];
  }

  return read.status === "ok" ? read.listings : [];
}

/**
 * getAllListings' answer, with the one bit getAllListings' signature cannot
 * carry: whether the array is the store or the residue of a failed read.
 *
 * This is what every BULK consumer should call — the sitemap route and the
 * prebuild sitemap generator, discover, the homepage, dashboard, search, the
 * insurance address typeahead. All of them used to call getAllListings and
 * render `[]` as though zero listings were a fact, which during a KV outage
 * meant publishing a valid, well-formed sitemap containing zero property
 * URLs. That does not merely fail to help: it instructs Google to drop every
 * indexed property page, which is the exact loss this branch exists to stop.
 *
 * Same three states as readListingsStore, plus the two behaviours the render
 * path depends on and readListingsStore deliberately does not have (because
 * the write paths also call it, and a seed served to a writer would be
 * written over the real store):
 *
 *   - KV unconfigured still yields the static PRELOADED_LISTINGS seed,
 *     loudly, as `ok` — but only where the [seed-gate] rule can prove this
 *     is not a production deployment. There is no live store to be stale
 *     against in local dev, and failing local dev buys nothing; in
 *     production the same missing credentials are a config regression and
 *     resolve `unavailable` instead, because 250 stale rows presented as
 *     healthy live data is the worst outcome available.
 *   - The read is stamped into getListingsStoreHealth, so the out-of-band
 *     disclosure channel keeps working for callers that use it.
 */
export async function readAllListings(opts?: { keyPrefix?: string }): Promise<ListingsStoreRead> {
  const keyPrefix = opts?.keyPrefix ?? "listings";

  if (!kvAvailable()) {
    const gate = staticSeedGate();
    if (!gate.allowed) {
      const reason = seedRefusedReason(gate.why);
      console.error(`[kv-degraded] ${reason}`);
      noteStoreRead("unavailable", reason);
      return { status: "unavailable", reason };
    }
    const { PRELOADED_LISTINGS } = await import("../data/listings");
    console.warn(
      `[kv-fallback] KV is not configured — serving the ${PRELOADED_LISTINGS.length}-listing static seed ` +
        `(src/lib/data/listings.ts, a March 2026 snapshot), NOT live data. Permitted here because ` +
        `${gate.why}.`
    );
    noteStoreRead("static-seed", `KV_REST_API_URL/KV_REST_API_TOKEN not configured; seed allowed (${gate.why})`);
    return { status: "ok", listings: PRELOADED_LISTINGS };
  }

  const read = await readListingsStore({ keyPrefix });

  if (read.status === "ok") {
    noteStoreRead("kv", null);
    return read;
  }

  if (read.status === "absent") {
    const reason = `${keyPrefix}:index and ${keyPrefix}:all are both missing — the store is empty`;
    console.error(`[kv-degraded] ${reason}.`);
    noteStoreRead("empty", reason);
    return read;
  }

  console.error(`[kv-degraded] listings store unreadable: ${read.reason}.`);
  noteStoreRead("unavailable", read.reason);
  return read;
}

/**
 * Thrown by requireAllListings. Consumers catch this specific type to answer
 * with a retryable failure (500/503, `Retry-After`) rather than an empty
 * success — a distinction crawlers act on and users can see.
 */
export class ListingsStoreUnavailableError extends Error {
  readonly reason: string;
  constructor(reason: string, context?: string) {
    super(
      `${context ? `${context}: ` : ""}the listings store could not be read (${reason}). ` +
        `Refusing to continue with an empty listing set — an empty result here is indistinguishable ` +
        `from "we have no properties", which is not what happened.`
    );
    this.name = "ListingsStoreUnavailableError";
    this.reason = reason;
  }
}

/**
 * readAllListings for consumers whose only honest degraded behaviour is to
 * fail: they either have the real listing set or they must not produce
 * output at all. Returns the rows on `ok`, returns `[]` on `absent` (a
 * verifiably empty store IS a fact and may be rendered as one), and throws
 * ListingsStoreUnavailableError on `unavailable`.
 *
 * `context` is prepended to the error message so the log line names the
 * surface that refused ("sitemap", "prebuild sitemap generator", ...)
 * instead of just the KV reason.
 */
export async function requireAllListings(opts?: {
  keyPrefix?: string;
  context?: string;
}): Promise<Listing[]> {
  const read = await readAllListings({ keyPrefix: opts?.keyPrefix });
  if (read.status === "unavailable") {
    throw new ListingsStoreUnavailableError(read.reason, opts?.context);
  }
  return read.status === "ok" ? read.listings : [];
}

/**
 * The three answers a slug lookup can honestly give. `absent` is the only
 * one a caller may render as a 404: it means KV answered, over a healthy
 * connection, that nothing is stored under this slug. `unavailable` means
 * the store could not be read, and every consumer is expected to surface
 * that as a retryable failure (500/503) — a 404 emitted from an outage asks
 * search engines to delete a page that exists, which is how this site lost
 * 409+ property URLs.
 */
export type ListingLookup =
  | { status: "found"; listing: Listing }
  | { status: "absent" }
  | { status: "unavailable"; reason: string };

function coerceListing(value: unknown): Listing | null {
  let parsed: unknown = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  if (parsed && typeof parsed === "object" && typeof (parsed as Listing).address === "string") {
    return parsed as Listing;
  }
  return null;
}

/**
 * Get a single listing by slug. See getAllListings re: `opts.keyPrefix`.
 *
 * Returns a three-state ListingLookup rather than `Listing | null`: the old
 * null meant both "no such listing" and "the read failed," and the property
 * page turned the second one into a 404. See ListingLookup above.
 *
 * The by-slug key can legitimately lag the full store (the per-slug pipeline
 * and the chunk write are separate round trips, and purgeStaleSlugKeys can
 * remove one), so a miss there still consults the whole store — but only the
 * whole store's own read status decides between `absent` and `unavailable`.
 *
 * Unconfigured KV goes through the same [seed-gate] rule readAllListings
 * uses, and this is the surface where getting it wrong hurts most: the seed
 * holds 250 of ~2,300 addresses, so a production deploy missing its
 * credentials answered `absent` — a 404, the response that asks Google to
 * delete the URL — for something like 89% of the site. Where the seed is not
 * permitted this now returns `unavailable`, which the property page renders
 * as a retryable 503.
 */
export async function getListingBySlug(
  slug: string,
  opts?: { keyPrefix?: string; fresh?: boolean }
): Promise<ListingLookup> {
  const keyPrefix = opts?.keyPrefix ?? "listings";

  if (!kvAvailable()) {
    const gate = staticSeedGate();
    if (!gate.allowed) {
      const reason = seedRefusedReason(gate.why);
      console.error(`[kv-degraded] slug lookup "${slug}" refused: ${reason}`);
      return { status: "unavailable", reason };
    }
    const { PRELOADED_LISTINGS } = await import("../data/listings");
    const seeded = PRELOADED_LISTINGS.find((l) => slugify(l.address) === slug);
    return seeded ? { status: "found", listing: seeded } : { status: "absent" };
  }

  const read = await kvRead(`${keyPrefix}:by-slug:${slug}`, { fresh: opts?.fresh });
  if (read.status === "ok" && read.value != null) {
    const listing = coerceListing(read.value);
    if (listing) return { status: "found", listing };
    console.error(
      `[kv-shape] ${keyPrefix}:by-slug:${slug} is not a Listing — falling back to the full store`
    );
  }

  const full = await readListingsStore({ keyPrefix });
  if (full.status === "unavailable") {
    const reason =
      read.status === "unavailable" ? `${read.reason}; ${full.reason}` : full.reason;
    console.error(`[kv-degraded] slug lookup "${slug}" could not be resolved: ${reason}`);
    return { status: "unavailable", reason };
  }

  const match =
    full.status === "ok" ? full.listings.find((l) => slugify(l.address) === slug) : undefined;
  return match ? { status: "found", listing: match } : { status: "absent" };
}

/**
 * Get listings filtered by city.
 */
export async function getListingsByCity(city: string): Promise<Listing[]> {
  const all = await getAllListings();
  return all.filter((l) => l.city === city);
}

// ---------------------------------------------------------------------------
// [dup-rows] Write-path dedup.
//
// The live store held 2,316 rows for 2,223 distinct address slugs. Canonical-
// JSON comparison of all 61 duplicate-slug groups found that 92 of the 93
// excess rows were byte-for-byte identical copies of another row — same MLS
// number, price, city, analysis. Exactly one group held two genuinely
// different properties: 105-107 Broad St, Newark NJ, MLS 4016139 @ $224,900
// and MLS 26010654 @ $254,900, which slugify to the same URL.
//
// So this is a write-path identity bug, not a URL-identity bug: callers
// build their replacement array by concatenating (`[...kept, ...fresh]`) and
// nothing ever asked whether two rows were the same record. The per-slug
// keys hid it — those are last-write-wins, so a duplicate pair collapsed to
// one key while both rows stayed in the array, inflating every full-store
// read and every chunk.
//
// WHAT CHANGED (2026-08 audit). The first version of this deduper keyed on
// province + MLS number, falling back to province + city + address. Both
// halves can merge two different properties:
//
//   - MLS numbers are unique only within the ISSUING BOARD, and a province
//     spans several — BC alone has VREB, REBGV and FVREB. Two boards can
//     hand out the same digits, and province-scoping does nothing about
//     that. The rule was written to protect the Newark pair and it does,
//     but it buys that by taking a risk of exactly the same shape one level
//     up.
//   - The address fallback merges any two rows sharing an address string,
//     which is unsafe for a multi-unit building whose unit designator was
//     dropped upstream — the two units then differ in no compared field.
//
// Neither risk needs taking, because of what the store actually contains:
// all 93 excess rows are accounted for, 92 of them byte-identical to a
// survivor. Exact equality removes those 92 with zero judgement calls and
// cannot, by construction, remove anything else — a dropped row carries no
// field the survivor lacks. So identity here is now `isSameRecord` from
// src/lib/listing-identity.ts (read its doc comment: it is the one test in
// the codebase allowed to authorize a delete, and it is deliberately
// stricter than the keys used for retention and upsert).
//
// The cost of the stricter rule is that a re-scrape which changed one field
// no longer collapses into the stored row at dedup time. That is the right
// place to lose it: following one property across a changed field is a
// MATCH problem, not a DELETE problem, and it is handled where a match can
// be made deliberately — upsertListing's listingKey/listingMlsKey lookup
// below, and the retention map in the refresh cron. Dedup's only job is to
// remove provable copies.
//
// First occurrence wins and holds its position, which keeps array order —
// and therefore the chunk split — deterministic across writes. With exact
// equality "first wins" and "last wins" select identical bytes, so unlike
// the previous rule this is a free choice rather than a data decision.
// ---------------------------------------------------------------------------

export interface DedupeResult {
  listings: Listing[];
  /** How many rows were dropped as duplicates of another row. */
  dropped: number;
}

/**
 * Recursive, key-order-independent serialization — every level, not just the
 * top one.
 *
 * This exists because of a hole in listing-identity.ts's `canonicalize`,
 * which is `JSON.stringify(l, Object.keys(l).sort())`. Passing an array as
 * JSON.stringify's second argument makes it a PROPERTY ALLOW-LIST that the
 * spec applies at EVERY nesting depth, not a key ordering for the top level.
 * A Listing's nested objects — `preAssessment`, `preOffer` — have child keys
 * ("found", "totalValue", "finalOffer", ...) that are not themselves
 * top-level Listing key names, so they are filtered out entirely and every
 * nested object serializes as `{}`. Verified:
 *
 *   canonicalize({address:"1 A St", preAssessment:{found:true,  totalValue:100}})
 *   canonicalize({address:"1 A St", preAssessment:{found:false, totalValue:999}})
 *   -> both '{"address":"1 A St","preAssessment":{}}'
 *
 * So two rows carrying different assessments or different modelled offers
 * compare equal under `isSameRecord`. That is a soundness gap in a test
 * whose entire contract is "only ever removes a row that carries no
 * information the survivor lacks," and dedup is the one caller allowed to
 * delete on it.
 *
 * listing-identity.ts is a settled shared contract this file does not own,
 * so it is not patched here. Instead the drop condition below is the
 * CONJUNCTION of that contract and this full-depth comparison: strictly
 * stricter than isSameRecord alone, so every row dropped is still one
 * isSameRecord approves, and the nested fields it cannot see are compared
 * anyway. Fixing canonicalize upstream would make this redundant, not wrong.
 */
function deepCanonical(value: unknown): string {
  if (value === undefined) return "null"; // array-hole semantics, matching JSON
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(deepCanonical).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined) // JSON drops undefined-valued keys
    .sort()
    .map((k) => `${JSON.stringify(k)}:${deepCanonical(obj[k])}`)
    .join(",")}}`;
}

/**
 * Collapse rows that are PROVABLY the same record (see the [dup-rows] block
 * above). Exported so the one-off repair pass over the existing store can
 * reuse this exact rule instead of re-deriving a second, subtly different
 * one.
 *
 * One pass, keyed on the two comparisons together, so the O(n^2) pairwise
 * form isn't needed on a 2,300-row array. `isSameRecord` is then called on
 * the pair that is actually about to collapse — it is the authorizing test,
 * and calling it keeps it load-bearing rather than decorative: if a future
 * change to listing-identity.ts ever made it disagree with full-depth
 * equality, the row is KEPT and the disagreement is logged instead of a row
 * being deleted on a rule nobody re-read.
 */
export function dedupeListingsByIdentity(listings: Listing[]): DedupeResult {
  const seen = new Map<string, Listing>();
  const kept: Listing[] = [];

  for (const l of listings) {
    // Contract key first, full-depth key second — see deepCanonical.
    // Length-prefixed rather than delimiter-joined: any printable
    // separator can legitimately occur inside a JSON string, and a NUL
    // (which cannot) turns this source file into `binary data` for
    // grep, `file` and most editors. A length prefix is unambiguous
    // and keeps the file plain text.
    const contractKey = canonicalize(l);
    const key = `${contractKey.length}:${contractKey}${deepCanonical(l)}`;
    const survivor = seen.get(key);

    if (survivor && isSameRecord(survivor, l)) continue; // provable duplicate

    if (survivor) {
      console.error(
        `[dup-rows] identity contract drift: two rows are byte-identical at every depth but ` +
          `isSameRecord() says they differ ("${l.address}", ${l.city} ${l.province}). Keeping both — ` +
          `a delete is only allowed on a rule that still holds. Check src/lib/listing-identity.ts.`
      );
    } else {
      seen.set(key, l);
    }
    kept.push(l);
  }

  return { listings: kept, dropped: listings.length - kept.length };
}

/**
 * Rows that survive dedup as distinct records but still slugify to one URL
 * (the Newark pair). Only one of them can own listings:by-slug:{slug}, so the
 * other is unreachable at /property/{slug} — a real gap that needs a legacy-
 * redirect/URL-disambiguation design, not a silent collapse. Until then it at
 * least gets logged on every write instead of being invisible.
 */
function logSlugCollisions(listings: Listing[]): void {
  const bySlug = new Map<string, number>();
  for (const l of listings) {
    const slug = slugify(l.address);
    bySlug.set(slug, (bySlug.get(slug) ?? 0) + 1);
  }
  const collisions = [...bySlug.entries()].filter(([, n]) => n > 1);
  if (collisions.length === 0) return;

  const sample = collisions.slice(0, 5).map(([slug, n]) => `${slug} (${n})`).join(", ");
  console.warn(
    `[dup-rows] ${collisions.length} slug(s) are shared by distinct records — only the last one written ` +
      `is reachable at /property/{slug}: ${sample}${collisions.length > 5 ? ", ..." : ""}`
  );
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

  // Dedup before the guard, so the guard sizes the write that will actually
  // land, and before chunking, so duplicates never reach storage. See the
  // [dup-rows] block above.
  const { listings: unique, dropped } = dedupeListingsByIdentity(listings);
  if (dropped > 0) {
    console.warn(
      `[dup-rows] writeAllListings dropped ${dropped} duplicate record(s) of ${listings.length} ` +
        `submitted (writing ${unique.length}) — each was identical to a surviving row in every field, ` +
        `so nothing was lost. Rows that merely look alike are all still here.`
    );
  }
  logSlugCollisions(unique);

  if (!opts?.force) {
    // Size-check against what is actually stored. This read used to go
    // through getAllListings, which meant a degraded read arrived here as
    // the 250-row static seed and quietly became the baseline — the guard
    // would then wave through a write that shrank a 2,300-row store to 120.
    // readListingsStore cannot lie about that, so an unreadable store now
    // refuses the write outright: with no baseline there is no way to tell a
    // legitimate replacement from the wipe this guard exists to stop.
    const current = await readListingsStore({ keyPrefix });
    if (current.status === "unavailable") {
      const reason =
        `refusing write: cannot read the current store to size-check this write (${current.reason}). ` +
        `Pass { force: true } only if you are certain this replacement is complete.`;
      console.error(`[pipeline-guard] ${reason}`);
      return { written: 0, slugs: 0, refused: true, refusedReason: reason };
    }

    // A genuinely fresh/empty store has nothing to protect, hence the < 5
    // floor on the baseline itself.
    const currentCount = current.status === "ok" ? current.listings.length : 0;
    if (currentCount >= 5 && unique.length < currentCount * FLOOR_GUARD_MIN_RATIO) {
      const reason =
        `refusing write: new array (${unique.length}) is < ${FLOOR_GUARD_MIN_RATIO * 100}% ` +
        `of current stored count (${currentCount}). Pass { force: true } if this shrink is intentional.`;
      console.error(`[pipeline-guard] ${reason}`);
      return { written: 0, slugs: 0, refused: true, refusedReason: reason };
    }
  }

  // Write the full array — both the legacy single blob (back-compat for
  // standalone scripts that read listings:all raw, e.g. flush-city.ts,
  // diag-cedar.ts) and the sharded chunks the app itself now reads from.
  await Promise.all([kvSet(`${keyPrefix}:all`, unique), writeShardedStorage(unique, keyPrefix)]);

  // Batch slug writes via pipeline (chunks of 50 to avoid oversized payloads)
  const CHUNK_SIZE = 50;
  let slugs = 0;
  for (let i = 0; i < unique.length; i += CHUNK_SIZE) {
    const chunk = unique.slice(i, i + CHUNK_SIZE);
    const commands: [string, ...string[]][] = chunk.map((l) => [
      "SET",
      `${keyPrefix}:by-slug:${slugify(l.address)}`,
      JSON.stringify(l),
    ]);
    await kvPipeline(commands);
    slugs += chunk.length;
  }

  // Write metadata
  const cities = [...new Set(unique.map((l) => l.city))];
  await kvSet(`${keyPrefix}:meta`, {
    count: unique.length,
    cities,
    updatedAt: new Date().toISOString(),
  });

  return { written: unique.length, slugs };
}

// ---------------------------------------------------------------------------
// [mls-corroboration] The secondary (MLS) upsert match, and why it needs a
// second opinion before it is allowed to replace a row.
//
// listingMlsKey() is province-scoped, and a province spans several issuing
// boards (BC alone has VREB, REBGV and FVREB). MLS numbers are unique inside
// a BOARD, not inside a province, so "same province, same digits" is a live
// collision risk between two unrelated properties — and upsertListing's use
// of the match is `all[idx] = listing`, which means the collision does not
// merely mis-link the rows, it destroys one of them. A forked duplicate row
// is recoverable by a later dedup or a human; an overwritten property is
// gone, and it is gone from the only copy. The previous code's own comment
// said this fallback was "never used alone" while the line underneath used
// it exactly that way.
//
// The fallback still has to exist, because the case it was written for is
// real and narrow: the same property re-scraped with a rewritten address
// string ("867 Walfred Rd" -> "867 Walfred Road"), a difference
// listing-identity.ts's norm() deliberately does NOT normalize away (guessing
// street-type equivalences merges rows on a hunch). So the match is kept and
// corroborated instead. An MLS candidate is accepted only if it also agrees
// on:
//
//   - the CITY (province already agrees — it is half of the MLS key), and
//   - the exact multiset of NUMERIC tokens in the address: street number,
//     unit number, both halves of a range like "105-107", all of them, and
//   - at least one shared ALPHABETIC address token (in practice the street
//     name).
//
// That corroboration is deliberately asymmetric. The variation it must
// tolerate lives entirely in the street-TYPE word (Rd/Road, St/Street,
// Ave/Avenue) plus punctuation and case, none of which touch the digits or
// the street name — so the legitimate re-scrape still matches. The variation
// it must exclude is a different property that merely shares MLS digits, and
// that property would have to sit in the same city AND carry an identical
// set of address numbers AND share a street-name word before it could reach
// the overwrite. A dropped or added unit designator ("867 Walfred Rd" vs
// "Unit 5 - 867 Walfred Rd") changes the digit multiset, so those two rows
// stay separate — which is the answer the [dup-rows] audit wanted for
// multi-unit buildings anyway.
//
// Every rejection direction ends in "append a new row", never "overwrite
// something else", and every one of them logs. AMBIGUITY IS ALSO NOT A
// MATCH: if two or more stored rows corroborate, this returns -1. Two rows
// that both look like this property means the store already disagrees with
// itself, and picking one to overwrite would resolve that disagreement by
// deleting the evidence.
// ---------------------------------------------------------------------------

/** Casefold + strip diacritics. Mirrors listing-identity.ts's norm() up to
 *  the point where that function also collapses punctuation to spaces. */
function foldForMatch(value: string | undefined | null): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function matchTokens(value: string | undefined | null): string[] {
  return foldForMatch(value)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Do these two rows agree on enough of their address to be the same property
 * under a different address string? See [mls-corroboration] above for why
 * these three tests and not others.
 */
function addressCorroborates(stored: Listing, incoming: Listing): boolean {
  if (matchTokens(stored.city).join(" ") !== matchTokens(incoming.city).join(" ")) return false;

  const a = matchTokens(stored.address);
  const b = matchTokens(incoming.address);

  const digitsA = a.filter((t) => /^[0-9]+$/.test(t)).sort();
  const digitsB = b.filter((t) => /^[0-9]+$/.test(t)).sort();
  if (digitsA.length !== digitsB.length || digitsA.some((d, i) => d !== digitsB[i])) return false;

  const wordsB = new Set(b.filter((t) => /[a-z]/.test(t)));
  return a.some((t) => /[a-z]/.test(t) && wordsB.has(t));
}

/**
 * Index of the one stored row this listing may replace on its MLS number, or
 * -1 when there is no such row, when the only MLS matches are uncorroborated
 * (a cross-board reuse), or when more than one row corroborates. -1 means the
 * caller appends.
 */
function findCorroboratedMlsMatch(all: Listing[], listing: Listing): number {
  const mlsKey = listingMlsKey(listing);
  if (!mlsKey) return -1;

  const candidates: number[] = [];
  all.forEach((l, i) => {
    if (listingMlsKey(l) === mlsKey) candidates.push(i);
  });
  if (candidates.length === 0) return -1;

  const where = `"${listing.address}" (${listing.city} ${listing.province}, MLS ${listing.mlsNumber})`;
  const corroborated = candidates.filter((i) => addressCorroborates(all[i], listing));

  if (corroborated.length === 1) {
    const i = corroborated[0];
    console.warn(
      `[listing-upsert] ${where} matched stored row "${all[i].address}" on MLS rather than on address — ` +
        `same city and the same address numbers, so this is the same property with a rewritten address ` +
        `string. Updating that row in place.`
    );
    return i;
  }

  if (corroborated.length > 1) {
    console.error(
      `[listing-upsert] AMBIGUOUS MLS match for ${where}: ${corroborated.length} stored rows corroborate it ` +
        `(${corroborated.map((i) => `"${all[i].address}"`).join(", ")}). Refusing to overwrite any of them ` +
        `and adding this row instead — the store already disagrees with itself here and needs a human.`
    );
    return -1;
  }

  console.warn(
    `[listing-upsert] MLS ${listing.mlsNumber} is already held by ${candidates.length} stored row(s) ` +
      `(${candidates.map((i) => `"${all[i].address}" in ${all[i].city}`).join(", ")}) that do NOT corroborate ` +
      `${where} — a cross-board MLS reuse inside ${listing.province}, a different unit at the same street ` +
      `number, or a re-listing in another city, but not a row this may replace. Adding a new row; ` +
      `overwriting one of those would have destroyed a different property.`
  );
  return -1;
}

/**
 * Add or update a single listing in KV.
 * Reads the full list, upserts on the shared listing identity (see the
 * key-selection comment in the body), writes back the array + the single
 * slug key + meta. Does NOT rewrite all 250 slug keys (that's only needed
 * for bulk operations like writeAllListings).
 */
export async function upsertListing(listing: Listing): Promise<void> {
  // This function rewrites listings:all and every chunk from whatever array
  // it reads back, and it does NOT go through writeAllListings' floor guard.
  // So a degraded read here is not a cosmetic problem: an empty (or static-
  // seed) array plus this one listing, written back over the real store,
  // destroys it. There is no safe way to merge into a store you could not
  // read, so refuse loudly and let the caller (POST /api/assess) fail.
  const current = await readListingsStore();
  if (current.status === "unavailable") {
    throw new Error(
      `upsertListing refused for "${listing.address}": the listings store is unreadable ` +
        `(${current.reason}). Writing on top of an unread store would replace every stored listing.`
    );
  }

  const all = current.status === "ok" ? [...current.listings] : [];

  // --- Which stored row does this replace? --------------------------------
  //
  // This used to be `all.findIndex((l) => l.address === listing.address)` —
  // the bare address string, with no city or province in it. Addresses are
  // not unique across a country: a user assessment of "123 Main St,
  // Calgary" would find and overwrite the stored "123 Main St, Victoria",
  // silently replacing a live BC listing with an Alberta one. That is the
  // same address-only identity bug that let one dead verdict delete two
  // properties in the refresh cron, which is why identity now lives in one
  // shared module instead of being re-derived per call site.
  //
  // Order matters and is not interchangeable (see listing-identity.ts):
  //
  //   1. listingKey — normalized address + city + province. PRIMARY, because
  //      the full locality tuple cannot merge two distinct properties.
  //   2. listingMlsKey — province-scoped provider record id. SECONDARY only,
  //      consulted when no primary match exists, so a re-scrape whose
  //      address string moved ("867 Walfred Rd" -> "867 Walfred Road")
  //      updates its row instead of forking a second one. It is never
  //      DECISIVE on its own: MLS numbers are unique per issuing board, not
  //      per province, so an MLS hit must be corroborated by the city and
  //      the address's numeric tokens before it may replace a row, and an
  //      ambiguous hit appends rather than overwrites. That rule and its
  //      reasoning live in findCorroboratedMlsMatch / [mls-corroboration]
  //      directly above this function.
  const primaryKey = listingKey(listing);
  let idx = all.findIndex((l) => listingKey(l) === primaryKey);

  if (idx < 0) {
    idx = findCorroboratedMlsMatch(all, listing);
  }

  if (idx >= 0) {
    all[idx] = listing;
  } else {
    all.push(listing);
  }

  // Same identity rule as writeAllListings ([dup-rows] above). Note this can
  // only remove provable byte-for-byte copies now, so it is no longer what
  // keeps a moved address from forking a row — the corroborated MLS fallback
  // above is. Rows this upsert deliberately appended rather than overwrote
  // (an uncorroborated or ambiguous MLS hit) differ in at least their address
  // or city, so this pass cannot quietly collapse them either.
  const { listings: deduped, dropped } = dedupeListingsByIdentity(all);
  if (dropped > 0) {
    console.warn(
      `[dup-rows] upsertListing("${listing.address}") collapsed ${dropped} duplicate record(s) while ` +
        `rewriting the store (${all.length} -> ${deduped.length}).`
    );
  }
  all.length = 0;
  all.push(...deduped);

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
  // force:true below bypasses the floor guard, so this path has to do its
  // own check that the array it filtered is the real store and not the
  // residue of a failed read.
  const current = await readListingsStore();
  if (current.status === "unavailable") {
    throw new Error(
      `removeListings refused: the listings store is unreadable (${current.reason}) — a forced write ` +
        `derived from an unread store would replace it wholesale.`
    );
  }
  const all = current.status === "ok" ? current.listings : [];
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
    // -----------------------------------------------------------------
    // [meta-encoding] Unwrap the extra JSON layer setMetaValue adds.
    //
    // setMetaValue hands an ALREADY-STRING value to kvSet, and kvSet
    // JSON.stringify()s everything it is given — correct for the listing
    // arrays it was written for, but for a string it stores a
    // JSON-encoded string. Reading it back therefore yields the encoded
    // form (`"{\"ema\":2}"`, quotes and escapes included), not the
    // value that was written, and every caller then parsed one layer too
    // few:
    //
    //   canary baseline   JSON.parse -> a STRING, not the state object.
    //                     `prev.samples` undefined, so `undefined < 3`
    //                     skipped the cold-start guard, and
    //                     `count < prev.ema * ratio` was `count < NaN`
    //                     — permanently false. The drop detector could
    //                     never fire, and stored `{"ema":null,
    //                     "samples":null}` back. Observed in production.
    //   us-discover       Number('"1787..."') -> NaN -> getLastRefresh
    //                     returns null -> every metro reads as due on
    //                     every run, re-sweeping the whole set and
    //                     burning RentCast quota the cadence gate exists
    //                     to conserve.
    //   city-metadata     JSON.parse -> a string, Array.isArray false, so
    //                     slow-fill activation silently never persisted.
    //
    // All three degraded to a plausible-looking value rather than an
    // error, which is exactly what this repo's fail-loud rule forbids.
    // Fixed on READ rather than on write so existing keys — including the
    // NaN-poisoned canary baselines already in production — keep
    // resolving; those land in the cold-start branch and re-seed
    // themselves. unwrapJson is the same helper listings:all uses against
    // this identical double-encoding hazard.
    // -----------------------------------------------------------------
    if (raw == null) return null;
    if (typeof raw !== "string") return JSON.stringify(raw);

    // Exactly ONE layer, not unwrapJson's greedy loop: setMetaValue adds
    // exactly one, and unwrapping further corrupts real values. unwrapJson
    // would take the plain string "hello" -> `"hello"` -> throw on the
    // second JSON.parse, and would take the string "1787" all the way down
    // to a number. Peel one layer when the stored text is a JSON string
    // literal (what kvSet produces for a string), and otherwise hand back
    // the text untouched — which is also what a value written before this
    // helper existed, or by a raw REST call, needs.
    try {
      const once = JSON.parse(raw);
      if (typeof once === "string") return once;
    } catch {
      // Not JSON at all — a plain legacy value. Use it as written.
    }
    return raw;
  } catch {
    // Fall through
  }
  return null;
}

/**
 * Persist a metadata value. Same signature as before; what changed is that a
 * KV rejection now REJECTS this promise (via kvSet — see
 * [kv-write-silence]) instead of being discarded. These values gate real
 * behaviour — `us-discover:last-refresh:{city}` is what stops a metro being
 * re-swept and spending RentCast quota, and the canary's streak counters
 * decide whether an alert fires — so a write that silently didn't land is a
 * scheduling bug waiting to be blamed on something else. Callers that
 * genuinely can proceed without the stamp should catch and say so.
 */
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
      return {
        ...(raw as { count: number; cities: string[]; updatedAt: string }),
        source: "kv",
      };
    }
  } catch {
    // Fall through
  }

  return null;
}
