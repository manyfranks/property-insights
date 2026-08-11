/**
 * scripts/test-pipeline-guard.ts
 *
 * Fixture-level regression test for the 2026-08-09 KV-wipe incident fixes
 * (src/lib/kv/listings.ts's floor guard, src/lib/pipeline/us-discover.ts's
 * quota-reserve gate). Runs against an in-process FAKE KV — a minimal
 * Upstash-REST-compatible store backed by a plain Map, installed by
 * monkey-patching global.fetch — so this never touches production KV or
 * makes a single live network call (RentCast included: the fake fetch
 * throws loudly if anything ever tries to reach api.rentcast.io, as a
 * defense-in-depth check that the quota-reserve gate really does stop
 * before the network, not just before the KV write).
 *
 * Scenarios (per the incident response spec):
 *   1. Floor guard trips on a <40% write (refused, store left untouched).
 *   2. Empty-fetch scenario preserves the store (writing [] is refused the
 *      same way — this is the mechanism a Zoocasa/RentCast outage now
 *      relies on instead of a destructive full-replace).
 *   3. Quota-reserve skip works (US Discover refresh skips every active
 *      metro without spending quota or stamping last-refresh when headroom
 *      is at/below the reserve).
 *   4. Force bypass still works (an intentional shrink with { force: true }
 *      writes through).
 *
 * Usage: npx tsx scripts/test-pipeline-guard.ts
 */
import { readFileSync } from "fs";
const envContent = readFileSync(".env.local", "utf-8");
for (const line of envContent.split("\n")) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, "");
}

// ---------------------------------------------------------------------------
// Fake KV — installed BEFORE importing any app code that reads
// KV_REST_API_URL at call time (kv/listings.ts and rentcast.ts both read
// process.env lazily per-call, not at import time, so overriding the env
// vars here is enough to redirect every KV call in this process to the
// fake store below instead of production).
// ---------------------------------------------------------------------------
const FAKE_KV_ORIGIN = "http://fake-kv.test";
process.env.KV_REST_API_URL = FAKE_KV_ORIGIN;
process.env.KV_REST_API_TOKEN = "fake-token";

const fakeStore = new Map<string, string>();
const fakeCounters = new Map<string, number>();

function runCommand(cmd: string[]): unknown {
  const [op, key, ...rest] = cmd;
  switch (op) {
    case "SET":
      fakeStore.set(key, rest[0]);
      return "OK";
    case "GET":
      return fakeStore.has(key) ? fakeStore.get(key) : null;
    case "INCR": {
      const n = (fakeCounters.get(key) ?? Number(fakeStore.get(key)) ?? 0) + 1;
      fakeCounters.set(key, n);
      fakeStore.set(key, String(n));
      return n;
    }
    case "DECR": {
      const n = (fakeCounters.get(key) ?? Number(fakeStore.get(key)) ?? 0) - 1;
      fakeCounters.set(key, n);
      fakeStore.set(key, String(n));
      return n;
    }
    case "DEL":
      fakeStore.delete(key);
      return 1;
    case "EXPIRE":
      return 1;
    default:
      throw new Error(`fake-kv: unhandled command ${op}`);
  }
}

let realCallAttempted = false;

const originalFetch = global.fetch;
global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input.toString();

  if (url.includes("api.rentcast.io")) {
    realCallAttempted = true;
    throw new Error(`[test-pipeline-guard] BLOCKED a live RentCast call: ${url} — this must never happen under quota-reserve`);
  }

  if (!url.startsWith(FAKE_KV_ORIGIN)) {
    // Anything else (LLM calls etc.) — pass through untouched, though none
    // of the code paths exercised here should hit any.
    return originalFetch(input, init);
  }

  const path = url.slice(FAKE_KV_ORIGIN.length);
  const method = init?.method ?? "GET";

  // GET /get/:key, /incr/:key, /decr/:key, /del/:key
  const simpleMatch = path.match(/^\/(get|incr|decr|del)\/([^/]+)$/);
  if (method === "GET" && simpleMatch) {
    const [, verb, encodedKey] = simpleMatch;
    const key = decodeURIComponent(encodedKey);
    const opMap: Record<string, string> = { get: "GET", incr: "INCR", decr: "DECR", del: "DEL" };
    const result = runCommand([opMap[verb], key]);
    return new Response(JSON.stringify({ result }), { status: 200 });
  }

  // GET /scan/:cursor/match/:pattern/count/:n — no keys to purge in this
  // fake store's tests, always report scan-complete with zero matches.
  if (method === "GET" && path.startsWith("/scan/")) {
    return new Response(JSON.stringify({ result: ["0", []] }), { status: 200 });
  }

  // POST /pipeline — array of commands, batched.
  if (method === "POST" && path === "/pipeline") {
    const commands = JSON.parse(String(init?.body ?? "[]")) as string[][];
    for (const cmd of commands) runCommand(cmd);
    return new Response(JSON.stringify({ result: "OK" }), { status: 200 });
  }

  // POST / (bare) — single command as a JSON array body, e.g.
  // ["SET", key, value, "EX", ttl] or ["GET", key] or ["KEYS", pattern].
  if (method === "POST" && path === "") {
    const cmd = JSON.parse(String(init?.body ?? "[]")) as string[];
    const result = runCommand(cmd);
    return new Response(JSON.stringify({ result }), { status: 200 });
  }

  throw new Error(`fake-kv: unhandled request ${method} ${path}`);
}) as typeof fetch;

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------
let pass = 0;
let fail = 0;
function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    pass++;
    console.log(`  PASS: ${name}`);
  } else {
    fail++;
    console.log(`  FAIL: ${name}${detail ? " — " + detail : ""}`);
  }
}

function makeListing(i: number, overrides: Record<string, unknown> = {}) {
  return {
    address: `${i} Test St`,
    city: "Austin",
    province: "TX",
    dom: 10,
    price: 400000,
    beds: 3,
    baths: 2,
    sqft: "1800",
    yearBuilt: "2000",
    taxes: "5000",
    lotSize: "5000",
    priceReduced: false,
    hasSuite: false,
    estateKeywords: false,
    description: "",
    notes: "",
    cluster: "",
    url: `https://example.com/${i}`,
    mlsNumber: `MLS${i}`,
    source: "cron",
    enrichedAt: new Date().toISOString(),
    ...overrides,
  };
}

async function main() {
  const { writeAllListings, getAllListings } = await import("../src/lib/kv/listings");

  console.log("=== Scenario 1: floor guard trips on a <40% write ===");
  {
    fakeStore.clear();
    const existing = Array.from({ length: 20 }, (_, i) => makeListing(i));
    // Setup write uses force: true — an empty fake store falls back to the
    // real 250-item PRELOADED_LISTINGS static data (getAllListings' normal
    // degrade-gracefully behavior), so an unforced 20-item seed write would
    // itself get refused as "20 < 40% of 250". That fallback-vs-guard
    // interaction is real static-data behavior, not something this test is
    // about — force past it here, then test the guard for real below
    // against the now-real 20-item fake-KV baseline.
    await writeAllListings(existing as never, { force: true });
    const before = await getAllListings();
    check("seeded 20 listings", before.length === 20, `got ${before.length}`);

    // 5/20 = 25% < 40% floor — must be refused.
    const shrunk = existing.slice(0, 5);
    const result = await writeAllListings(shrunk as never);
    check("write refused", result.refused === true, JSON.stringify(result));
    check("refusal reason logged", !!result.refusedReason);

    const after = await getAllListings();
    check("store left untouched at 20", after.length === 20, `got ${after.length}`);
  }

  console.log("\n=== Scenario 2: empty-fetch scenario preserves the store ===");
  {
    // Same store (20 listings) — simulate a stage whose fetch degraded to
    // zero results attempting a naive full-replace with [].
    const result = await writeAllListings([] as never);
    check("empty write refused", result.refused === true, JSON.stringify(result));
    const after = await getAllListings();
    check("store still 20 after empty-write attempt", after.length === 20, `got ${after.length}`);
  }

  console.log("\n=== Scenario 3: force bypass still works ===");
  {
    const existing = await getAllListings();
    const shrunk = existing.slice(0, 3);
    const result = await writeAllListings(shrunk as never, { force: true });
    check("forced write NOT refused", !result.refused, JSON.stringify(result));
    check("forced write applied", result.written === 3, `got ${result.written}`);
    const after = await getAllListings();
    check("store now 3 (forced shrink honored)", after.length === 3, `got ${after.length}`);
  }

  console.log("\n=== Scenario 4: quota-reserve skip works (US Discover) ===");
  {
    // Reset store to something non-trivial and unrelated to US Discover's
    // own merge so this scenario's assertions are about scheduling, not
    // content.
    fakeStore.clear();
    fakeCounters.clear();
    const caListings = Array.from({ length: 10 }, (_, i) => makeListing(i, { province: "BC", city: "Victoria" }));
    await writeAllListings(caListings as never, { force: true });

    // Quota key format: rentcast:quota:YYYY-MM (quotaKey() in rentcast.ts).
    const now = new Date();
    const quotaKey = `rentcast:quota:${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const limit = Number(process.env.RENTCAST_MONTHLY_QUOTA) || 50;
    const reserve = Number(process.env.US_DISCOVER_QUOTA_RESERVE) || 10;
    // Headroom = limit - used. Set used so headroom == reserve exactly
    // (<=  reserve must skip, per quotaReserve()'s doc comment).
    fakeStore.set(quotaKey, String(limit - reserve));
    fakeCounters.set(quotaKey, limit - reserve);

    const { refreshUSDiscover } = await import("../src/lib/pipeline/us-discover");
    const before = await getAllListings();
    const result = await refreshUSDiscover();

    check("no real RentCast call was attempted", !realCallAttempted, "a live call was made — quota-reserve gate failed to stop it");
    check("all cities skipped", result.cities.every((c) => c.skipped), JSON.stringify(result.cities));
    check(
      "skip reason cites quota reserve guard",
      result.cities.every((c) => (c.skipReason ?? "").includes("quota reserve guard")),
      JSON.stringify(result.cities.map((c) => c.skipReason))
    );
    check("no metro activated this cycle", result.activatedMetro == null, JSON.stringify(result.activatedMetro));
    check("totalListings is 0 (nothing fetched)", result.totalListings === 0);

    const after = await getAllListings();
    check("CA listings from before are untouched", after.length === before.length, `before=${before.length} after=${after.length}`);

    // No last-refresh meta should have been stamped for any city — a
    // reserve-skip must leave the cadence gate exactly as it found it.
    const lastRefreshKeysWritten = [...fakeStore.keys()].filter((k) => k.startsWith("us-discover:last-refresh:"));
    check("no last-refresh meta written on reserve-skip", lastRefreshKeysWritten.length === 0, JSON.stringify(lastRefreshKeysWritten));
  }

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  global.fetch = originalFetch;
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[test-pipeline-guard] fatal:", err);
  process.exit(1);
});
