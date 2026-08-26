/**
 * scripts/test-us-discover-store-guard.ts
 *
 * Regression test for the 2026-08 audit finding that US Discover read the
 * listings store through the lossy API.
 *
 * THE BUG: refreshUSDiscover() ended its run with
 *
 *     const existing = await getAllListings();
 *     const kept     = existing.filter(...not re-fetched this run...);
 *     await writeAllListings([...kept, ...deduped]);
 *
 * getAllListings() flattens an unreadable store to `[]` — deliberately, so a
 * KV outage can never be mistaken for real data — and reports the
 * degradation only out-of-band, through the process-global
 * getListingsStoreHealth() stamp that a concurrent request on the same warm
 * lambda can overwrite. So a transient read failure made `kept` empty and the
 * write payload this run's ~60 new US rows and nothing else, which would have
 * dropped every CA listing too: rows the sweep never even looked at.
 *
 * writeAllListings()'s floor guard would almost certainly have refused that
 * payload, but a backstop catching a bug is the exact pattern this branch
 * removed everywhere else, and by the time it fires the run has already spent
 * its RentCast quota — 50 successful requests for the whole month — building
 * something that gets thrown away.
 *
 * WHAT IS CHECKED: with the store unreadable, refreshUSDiscover() throws
 * before any RentCast call, before any cadence stamp, and without writing
 * anything; and once the store reads again, the same call proceeds normally.
 * The fake fetch below throws loudly if anything ever reaches
 * api.rentcast.io, so "no quota was spent" is enforced rather than asserted.
 *
 * Runs entirely against an in-process fake KV (a Map behind a monkey-patched
 * global.fetch). Nothing here touches production KV or makes a live network
 * call.
 *
 * Usage: npx tsx scripts/test-us-discover-store-guard.ts
 */

// Marks this file as a module rather than a global script, so its top-level
// `main`/`check`/`store` bindings do not collide with the other scripts/*.ts
// under the shared tsconfig. Every app import below is deliberately dynamic:
// the fake fetch has to be installed before any of it loads.
export {};

// ---------------------------------------------------------------------------
// Fake KV — installed BEFORE importing any app code. kv/listings.ts and
// rentcast.ts read process.env lazily per call, so overriding the env vars
// here redirects every KV call in this process to the fake store.
// ---------------------------------------------------------------------------
const FAKE_KV_ORIGIN = "http://fake-kv.test";
process.env.KV_REST_API_URL = FAKE_KV_ORIGIN;
process.env.KV_REST_API_TOKEN = "fake-token";

const store = new Map<string, string>();
const counters = new Map<string, number>();

/** Flipped per scenario: every GET answers HTTP 500 (a reachable but broken KV). */
let readsFail = false;
/** Set if anything tried to reach RentCast — quota spend must not happen. */
let rentcastCallAttempted = false;
/** Every key this run wrote, so "the guard wrote nothing" is checkable. */
const keysWritten: string[] = [];

function runCommand(cmd: string[]): unknown {
  const [op, key, ...rest] = cmd;
  switch (op) {
    case "SET":
      store.set(key, rest[0]);
      keysWritten.push(key);
      return "OK";
    case "GET":
      return store.has(key) ? store.get(key) : null;
    case "INCR": {
      const n = (counters.get(key) ?? Number(store.get(key)) ?? 0) + 1;
      counters.set(key, n);
      store.set(key, String(n));
      return n;
    }
    case "DECR": {
      const n = (counters.get(key) ?? Number(store.get(key)) ?? 0) - 1;
      counters.set(key, n);
      store.set(key, String(n));
      return n;
    }
    case "DEL":
      store.delete(key);
      return 1;
    case "EXPIRE":
      return 1;
    default:
      throw new Error(`fake-kv: unhandled command ${op}`);
  }
}

const originalFetch = global.fetch;
global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input.toString();

  if (url.includes("api.rentcast.io")) {
    rentcastCallAttempted = true;
    throw new Error(
      `[test-us-discover-store-guard] BLOCKED a live RentCast call: ${url} — the store guard must abort ` +
        `before the network, not after it`
    );
  }
  if (!url.startsWith(FAKE_KV_ORIGIN)) {
    throw new Error(`[test-us-discover-store-guard] BLOCKED an unexpected live call: ${url}`);
  }

  const path = url.slice(FAKE_KV_ORIGIN.length);
  const method = init?.method ?? "GET";

  const simpleMatch = path.match(/^\/(get|incr|decr|del)\/(.+)$/);
  if (method === "GET" && simpleMatch) {
    const [, verb, encodedKey] = simpleMatch;
    if (verb === "get" && readsFail) return new Response("kv down", { status: 500 });
    const opMap: Record<string, string> = { get: "GET", incr: "INCR", decr: "DECR", del: "DEL" };
    const result = runCommand([opMap[verb], decodeURIComponent(encodedKey)]);
    return new Response(JSON.stringify({ result }), { status: 200 });
  }

  if (method === "GET" && path.startsWith("/scan/")) {
    return new Response(JSON.stringify({ result: ["0", []] }), { status: 200 });
  }

  // Upstash answers a pipeline with one result per submitted command.
  if (method === "POST" && path === "/pipeline") {
    const commands = JSON.parse(String(init?.body ?? "[]")) as string[][];
    return new Response(JSON.stringify(commands.map((cmd) => ({ result: runCommand(cmd) }))), { status: 200 });
  }

  if (method === "POST" && path === "") {
    const cmd = JSON.parse(String(init?.body ?? "[]")) as string[];
    return new Response(JSON.stringify({ result: runCommand(cmd) }), { status: 200 });
  }

  throw new Error(`fake-kv: unhandled request ${method} ${path}`);
}) as typeof fetch;

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------
let failures = 0;
function check(label: string, pass: boolean, detail?: string): void {
  if (pass) {
    console.log(`  OK   ${label}`);
  } else {
    failures++;
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function makeListing(i: number, overrides: Record<string, unknown> = {}) {
  return {
    address: `${100 + i} Fixture St`,
    city: "Victoria",
    province: "BC",
    dom: 10,
    price: 400000 + i,
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
    url: `https://example.invalid/${i}`,
    mlsNumber: `MLS${i}`,
    source: "cron",
    ...overrides,
  };
}

async function main() {
  const { writeAllListings, readListingsStore } = await import("../src/lib/kv/listings");
  const { refreshUSDiscover } = await import("../src/lib/pipeline/us-discover");

  // A store that looks like production's: CA rows this US sweep will never
  // re-fetch, i.e. exactly the rows the bug would have discarded.
  const caListings = Array.from({ length: 20 }, (_, i) => makeListing(i));
  await writeAllListings(caListings as never, { force: true });

  console.log("\n[1/2] an unreadable store aborts the run before any RentCast spend");
  {
    keysWritten.length = 0;
    rentcastCallAttempted = false;
    readsFail = true;

    let threw: unknown = null;
    let result: unknown = null;
    try {
      result = await refreshUSDiscover();
    } catch (err) {
      threw = err;
    }

    check(
      "refreshUSDiscover throws instead of returning a result built on an unreadable store",
      threw instanceof Error && result === null,
      `err=${String(threw)} result=${JSON.stringify(result)}`
    );
    check(
      "the failure says the store is unreadable and names the guard",
      threw instanceof Error && /pipeline-guard/.test(threw.message) && /unreadable/i.test(threw.message),
      threw instanceof Error ? threw.message : ""
    );
    check(
      "no RentCast request was attempted (the month's quota is untouched)",
      !rentcastCallAttempted,
      "a live RentCast call was made — the abort happened after the spend, not before it"
    );
    check(
      "nothing was written — no listings keys, no last-refresh cadence stamps",
      keysWritten.length === 0,
      JSON.stringify(keysWritten.slice(0, 8))
    );

    readsFail = false;
    const survived = await readListingsStore();
    check(
      "every CA listing is still in the store",
      survived.status === "ok" && survived.listings.length === caListings.length,
      survived.status === "ok" ? `${survived.listings.length} rows` : survived.status
    );
  }

  console.log("\n[2/2] a readable store lets the run proceed (the guard is not a blanket refusal)");
  {
    // Park the RentCast quota at the reserve so every metro skips on the
    // cadence/reserve gates rather than on the store guard: the point is
    // that a healthy store gets past the pre-flight at all.
    const now = new Date();
    const quotaKey = `rentcast:quota:${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const limit = Number(process.env.RENTCAST_MONTHLY_QUOTA) || 50;
    const reserve = Number(process.env.US_DISCOVER_QUOTA_RESERVE) || 10;
    store.set(quotaKey, String(limit - reserve));
    counters.set(quotaKey, limit - reserve);

    rentcastCallAttempted = false;
    let threw: unknown = null;
    let result: Awaited<ReturnType<typeof refreshUSDiscover>> | null = null;
    try {
      result = await refreshUSDiscover();
    } catch (err) {
      threw = err;
    }

    check("a readable store does not trip the guard", threw === null, String(threw));
    check("every metro skipped on the quota reserve, nothing fetched", result?.totalListings === 0, JSON.stringify(result?.totalListings));
    check("still no RentCast call", !rentcastCallAttempted);

    const after = await readListingsStore();
    check(
      "the CA listings are still intact",
      after.status === "ok" && after.listings.length === caListings.length,
      after.status === "ok" ? `${after.listings.length} rows` : after.status
    );
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  global.fetch = originalFetch;
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("[test-us-discover-store-guard] fatal:", err);
  process.exit(1);
});
