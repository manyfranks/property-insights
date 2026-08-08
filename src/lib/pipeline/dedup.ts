/**
 * pipeline/dedup.ts
 *
 * Tracks which MLS numbers have already been surfaced in daily picks.
 * Once an MLS number enters the seen set, it is never returned again —
 * even if the listing gets relisted and DOM resets to 0 on realtor.ca.
 *
 * STORAGE:
 *   - Primary: Vercel KV REST API (Redis Set per city, no package dependency)
 *   - Fallback: In-memory Map (resets on cold start — fine for local dev)
 *
 * KV SETUP:
 *   In Vercel Dashboard → Storage → Create KV Database → Link to project.
 *   This auto-populates KV_REST_API_URL and KV_REST_API_TOKEN in your env.
 *
 * KEY SCHEMA:
 *   seen:{city_slug}  →  Redis Set of MLS number strings
 *   e.g.  "seen:victoria"  →  { "994304", "1007315", "993120", ... }
 */

// ---------------------------------------------------------------------------
// In-memory fallback (local dev / KV not configured)
// ---------------------------------------------------------------------------

const memoryStore = new Map<string, Set<string>>();

function memKey(city: string): string {
  return city.toLowerCase().replace(/\s+/g, "-");
}

// ---------------------------------------------------------------------------
// Vercel KV REST helpers
// ---------------------------------------------------------------------------

function kvUrl(): string | null {
  return process.env.KV_REST_API_URL || null;
}

function kvToken(): string | null {
  return process.env.KV_REST_API_TOKEN || null;
}

function kvHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${kvToken()}`,
    "Content-Type": "application/json",
  };
}

/**
 * Execute a Redis command via Vercel KV REST API.
 * The Upstash-compatible REST interface accepts: POST /[cmd]/[arg1]/[arg2]/...
 */
async function kvExec(args: string[]): Promise<unknown> {
  const url = kvUrl();
  if (!url) throw new Error("KV not configured");

  const path = args.map((a) => encodeURIComponent(a)).join("/");
  const res = await fetch(`${url}/${path}`, {
    method: "GET",
    headers: kvHeaders(),
  });

  if (!res.ok) {
    throw new Error(`KV error ${res.status}: ${await res.text()}`);
  }
  const body = await res.json();
  return body.result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check whether an MLS number has already been seen for a city.
 */
export async function isSeen(city: string, mlsNumber: string): Promise<boolean> {
  const key = memKey(city);

  if (kvUrl() && kvToken()) {
    try {
      const result = await kvExec(["SISMEMBER", `seen:${key}`, mlsNumber]);
      return result === 1;
    } catch {
      // KV failed — fall through to memory
    }
  }

  return memoryStore.get(key)?.has(mlsNumber) ?? false;
}

/**
 * Mark MLS numbers as seen for a city.
 * Call this after surfacing picks — not before.
 */
export async function markSeen(city: string, mlsNumbers: string[]): Promise<void> {
  if (mlsNumbers.length === 0) return;
  const key = memKey(city);

  if (kvUrl() && kvToken()) {
    try {
      // SADD key member [member ...] via REST: POST /sadd/key/m1/m2/...
      const url = kvUrl()!;
      const args = ["sadd", `seen:${key}`, ...mlsNumbers];
      const path = args.map((a) => encodeURIComponent(a)).join("/");
      await fetch(`${url}/${path}`, {
        method: "GET",
        headers: kvHeaders(),
      });
      return;
    } catch {
      // KV failed — fall through to memory
    }
  }

  // Memory fallback
  if (!memoryStore.has(key)) memoryStore.set(key, new Set());
  const store = memoryStore.get(key)!;
  for (const mls of mlsNumbers) store.add(mls);
}

/**
 * Return all seen MLS numbers for a city (useful for admin/debug endpoints).
 */
export async function getSeenSet(city: string): Promise<string[]> {
  const key = memKey(city);

  if (kvUrl() && kvToken()) {
    try {
      const result = await kvExec(["SMEMBERS", `seen:${key}`]);
      return Array.isArray(result) ? result : [];
    } catch {
      // fall through
    }
  }

  return [...(memoryStore.get(key) ?? [])];
}

/**
 * Clear all seen MLS numbers for a city.
 * Use this when you want to re-surface the full inventory (e.g. monthly refresh).
 */
export async function clearSeen(city: string): Promise<void> {
  const key = memKey(city);

  if (kvUrl() && kvToken()) {
    try {
      await kvExec(["DEL", `seen:${key}`]);
      return;
    } catch {
      // fall through
    }
  }

  memoryStore.delete(key);
}

/**
 * Filter a list of MLS numbers down to only those not yet seen.
 * Batch-efficient version of isSeen().
 */
export async function filterUnseen(
  city: string,
  mlsNumbers: string[]
): Promise<string[]> {
  if (mlsNumbers.length === 0) return [];
  const seen = await getSeenSet(city);
  const seenSet = new Set(seen);
  return mlsNumbers.filter((m) => !seenSet.has(m));
}

// ---------------------------------------------------------------------------
// US listing address-normalization dedup
//
// The CA pipeline above dedups on a stable MLS number, but US Discover
// listings (src/lib/pipeline/us-discover.ts) have no MLS-equivalent — the
// merge step there keys on a literal `${address}|${city}|${province}`
// string (lowercased, no other normalization; see writeAllListings' caller
// around us-discover.ts's `newKeys`/`kept` merge). That's why the same
// Austin property was seeded twice under "6804 N Capital Of Tx Hwy" and
// "6804 N Capital Of Texas Hwy" — RentCast/realtor data returned the same
// parcel with a differently-abbreviated street name across two refresh
// runs, and a literal string key sees those as two different addresses.
//
// normalizeUsAddress() below produces a canonical dedup key for exactly
// this class of bug: directional words (North/N), common USPS street-type
// abbreviations (Highway/Hwy, Boulevard/Blvd, ...), and the "Texas"/"Tx"
// spelling-out seen in real Austin data (e.g. "Capital of Texas Highway",
// commonly abbreviated "Capital of Tx Hwy" by both TxDOT signage and
// several listing sources) all collapse to the same token before the parts
// are rejoined. It intentionally does NOT touch unit/suite numbers or
// street numbers — only word-level abbreviation variance, the specific
// failure mode observed here.
//
// HOOKUP NOTE (not applied — us-discover.ts is out of this module's
// scope): the merge in us-discover.ts around
//   const newKeys = new Set(allNew.map((l) => `${l.address}|${l.city}|${l.province}`.toLowerCase()));
//   const kept = existing.filter((l) => !newKeys.has(`${l.address}|${l.city}|${l.province}`.toLowerCase()));
// should build both `newKeys` and the `kept` filter's probe key from
// `buildUsListingDedupKey(l.address, l.city, l.province)` (exported below)
// instead of the raw lowercased address. That's a one-line swap at each of
// those two call sites — left to a follow-up change since us-discover.ts is
// outside this task's scope.
// ---------------------------------------------------------------------------

/** Directional words that appear as standalone tokens in US street addresses. */
const US_ADDRESS_DIRECTIONAL_ABBREVS: [RegExp, string][] = [
  [/\bNORTHEAST\b/g, "NE"],
  [/\bNORTHWEST\b/g, "NW"],
  [/\bSOUTHEAST\b/g, "SE"],
  [/\bSOUTHWEST\b/g, "SW"],
  [/\bNORTH\b/g, "N"],
  [/\bSOUTH\b/g, "S"],
  [/\bEAST\b/g, "E"],
  [/\bWEST\b/g, "W"],
];

/** Common USPS Publication 28 street-suffix abbreviations (superset of the
 * list in miami-dade.ts's STREET_TYPE_ABBREVS — this one also covers
 * generic dedup needs beyond Miami's quadrant format). */
const US_ADDRESS_STREET_TYPE_ABBREVS: [RegExp, string][] = [
  [/\bSTREET\b/g, "ST"],
  [/\bAVENUE\b/g, "AVE"],
  [/\bBOULEVARD\b/g, "BLVD"],
  [/\bDRIVE\b/g, "DR"],
  [/\bCOURT\b/g, "CT"],
  [/\bROAD\b/g, "RD"],
  [/\bPLACE\b/g, "PL"],
  [/\bTERRACE\b/g, "TER"],
  [/\bLANE\b/g, "LN"],
  [/\bCIRCLE\b/g, "CIR"],
  [/\bTRAIL\b/g, "TRL"],
  [/\bPARKWAY\b/g, "PKWY"],
  [/\bHIGHWAY\b/g, "HWY"],
  [/\bSQUARE\b/g, "SQ"],
  [/\bLOOP\b/g, "LOOP"],
  [/\bCOVE\b/g, "CV"],
  [/\bCRESCENT\b/g, "CRES"],
  [/\bCROSSING\b/g, "XING"],
];

/** Words that appear spelled out in some listing sources' street names and
 * abbreviated in others, beyond the standard USPS suffix/directional sets
 * above — e.g. Austin's "Capital of Texas Highway" vs "Capital of Tx
 * Highway" (confirmed duplicate in cached KV data, see module doc). */
const US_ADDRESS_MISC_WORD_ABBREVS: [RegExp, string][] = [[/\bTEXAS\b/g, "TX"]];

/**
 * Canonicalize a US street address for dedup comparison — NOT for display.
 * Uppercases, strips punctuation, collapses whitespace, and folds common
 * directional/street-type/misc word variants to one spelling so listings
 * that differ only in how a source abbreviated a word collide on the same
 * key. Street numbers and unit numbers are left as-is (this targets word
 * abbreviation drift, not numbering variance).
 */
export function normalizeUsAddress(address: string): string {
  let s = address.trim().toUpperCase().replace(/[.,]/g, "").replace(/\s+/g, " ");
  for (const [pat, repl] of US_ADDRESS_DIRECTIONAL_ABBREVS) s = s.replace(pat, repl);
  for (const [pat, repl] of US_ADDRESS_STREET_TYPE_ABBREVS) s = s.replace(pat, repl);
  for (const [pat, repl] of US_ADDRESS_MISC_WORD_ABBREVS) s = s.replace(pat, repl);
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Stable dedup key for a US listing — mirrors the shape of us-discover.ts's
 * inline `${address}|${city}|${province}` key, but with the address side
 * run through normalizeUsAddress() so word-abbreviation variance (see
 * module doc) doesn't produce two keys for the same property. City/province
 * are still just lowercased/trimmed — no known bug there today.
 */
export function buildUsListingDedupKey(address: string, city: string, province: string): string {
  return `${normalizeUsAddress(address)}|${city.trim().toUpperCase()}|${province.trim().toUpperCase()}`;
}
