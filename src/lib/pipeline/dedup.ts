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
