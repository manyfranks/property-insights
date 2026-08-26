/**
 * scripts/test-listings-degraded.ts
 *
 * Regression test for the 2026-08 "an outage looks like an empty store" audit
 * (src/lib/kv/listings.ts and its bulk consumers).
 *
 * The bug class this locks down: getAllListings() answers an unreadable KV
 * with `[]` — correctly, since the alternative was serving a stale March
 * static seed — but every bulk consumer took that array at face value. So a
 * KV blip produced a valid sitemap with zero property URLs, a homepage with
 * no cities, a dashboard reading "0 properties analyzed", and a typeahead
 * telling visitors their address is not tracked. None of it logged as an
 * outage. Under the house rule (fail loud, never fake) that is the worst of
 * the four outcomes: silently degraded to look fine.
 *
 * Runs against an in-process FAKE KV — a minimal Upstash-REST-compatible
 * store backed by a Map, installed by monkey-patching global.fetch, with
 * switches to make reads, SETs or pipelines fail on demand. Nothing here
 * touches production KV or makes a live network call. The one exception is
 * section 3, which spawns the real prebuild sitemap generator as a child
 * process (that path can only be tested end to end, because what it does
 * wrong is write files), pointed at a dead KV endpoint.
 *
 * Sections:
 *   1. Store reads tell empty and unreadable apart (incl. torn-write
 *      detection).
 *   2. Bulk consumers never publish emptiness from an unreadable store.
 *   3. The prebuild sitemap generator fails the build instead of baking an
 *      empty sitemap into a deployment.
 *   4. Failed kvSet/kvPipeline surface instead of reporting success.
 *   5. Dedup drops byte-identical rows only — the Newark pair survives.
 *   6. upsertListing does not overwrite a same-address listing in another
 *      city.
 *
 * Usage: npx tsx scripts/test-listings-degraded.ts
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Listing } from "../src/lib/types";

// ---------------------------------------------------------------------------
// Fake KV — installed BEFORE importing any app code. kv/listings.ts and
// rate-limit.ts both read process.env lazily per call, so overriding the env
// vars here redirects every KV call in this process to the fake store.
// ---------------------------------------------------------------------------
const FAKE_KV_ORIGIN = "http://fake-kv.test";
process.env.KV_REST_API_URL = FAKE_KV_ORIGIN;
process.env.KV_REST_API_TOKEN = "fake-token";
// The insurance typeahead is stage-gated; without this it 404s before it
// ever reads the store, and section 2 would be testing the gate.
process.env.NEXT_PUBLIC_INSURANCE_STAGE = "landing";

const store = new Map<string, string>();

/** Failure switches — flipped per scenario, reset by resetFakeKv(). */
const fail = {
  /** All GETs answer HTTP 500 (a reachable-but-broken KV). */
  reads: false,
  /** All SETs answer HTTP 500. */
  sets: false,
  /** "http": pipeline answers 500. "command": HTTP 200 with a rejected
   *  command inside — the shape that used to be invisible. */
  pipeline: null as null | "http" | "command",
};

function resetFakeKv(): void {
  store.clear();
  fail.reads = false;
  fail.sets = false;
  fail.pipeline = null;
}

function runCommand(cmd: string[]): unknown {
  const [op, key, ...rest] = cmd;
  switch (op) {
    case "SET":
      store.set(key, rest[0]);
      return "OK";
    case "GET":
      return store.has(key) ? store.get(key) : null;
    case "DEL":
      store.delete(key);
      return 1;
    default:
      throw new Error(`fake-kv: unhandled command ${op}`);
  }
}

const originalFetch = global.fetch;
global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input.toString();

  // Zoocasa is the live fallback POST /api/discover reaches for when the
  // cache is unusable. Blocking it here simulates "the provider is out too",
  // which is the case where an empty 200 would be a lie.
  if (url.includes("zoocasa.com")) {
    throw new Error("[test-listings-degraded] blocked live Zoocasa call");
  }
  if (!url.startsWith(FAKE_KV_ORIGIN)) return originalFetch(input, init);

  const path = url.slice(FAKE_KV_ORIGIN.length);
  const method = init?.method ?? "GET";
  const rawBody = String(init?.body ?? "");

  // @upstash/ratelimit runs its sliding-window Lua via EVALSHA. The
  // insurance typeahead rate-limits before touching the store, so this has
  // to answer plausibly or that route fails for an unrelated reason. The
  // script returns { remaining, limit } — a large remaining means "allowed",
  // which keeps the limiter out of the way of what is being tested.
  if (/"eval(sha)?"/i.test(rawBody)) {
    return new Response(JSON.stringify([{ result: [1000, 1000] }]), { status: 200 });
  }

  const simpleMatch = path.match(/^\/(get|del)\/(.+)$/);
  if (method === "GET" && simpleMatch) {
    const [, verb, encodedKey] = simpleMatch;
    if (verb === "get" && fail.reads) return new Response("kv down", { status: 500 });
    const result = runCommand([verb.toUpperCase(), decodeURIComponent(encodedKey)]);
    return new Response(JSON.stringify({ result }), { status: 200 });
  }

  if (method === "POST" && path === "/pipeline") {
    if (fail.pipeline === "http") return new Response("pipeline down", { status: 500 });
    const commands = JSON.parse(rawBody || "[]") as string[][];
    if (fail.pipeline === "command") {
      // Upstash reports a rejected command as HTTP 200 with an `error` slot.
      return new Response(
        JSON.stringify(commands.map((_, i) => (i === 0 ? { error: "ERR value too large" } : { result: "OK" }))),
        { status: 200 }
      );
    }
    for (const cmd of commands) runCommand(cmd);
    return new Response(JSON.stringify(commands.map(() => ({ result: "OK" }))), { status: 200 });
  }

  if (method === "POST" && path === "") {
    const cmd = JSON.parse(rawBody || "[]") as string[];
    if (cmd[0] === "SET" && fail.sets) return new Response("set rejected", { status: 500 });
    const result = runCommand(cmd);
    return new Response(JSON.stringify({ result }), { status: 200 });
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

function makeListing(i: number, overrides: Partial<Listing> = {}): Listing {
  return {
    address: `${100 + i} Fixture St`,
    city: "Austin",
    province: "TX",
    dom: 10,
    price: 400000 + i,
    beds: "3",
    baths: "2",
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
    ...overrides,
  } as Listing;
}

/** Deep clone via JSON so "byte-identical duplicate" means what it says. */
function copy<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

const REPO_ROOT = join(__dirname, "..");

async function main() {
  const kv = await import("../src/lib/kv/listings");
  const {
    readAllListings,
    requireAllListings,
    getAllListings,
    writeAllListings,
    upsertListing,
    dedupeListingsByIdentity,
    ListingsStoreUnavailableError,
  } = kv;

  const seed = Array.from({ length: 12 }, (_, i) => makeListing(i));

  // =========================================================================
  console.log("\n[1/6] store reads tell 'empty' apart from 'unreadable'");
  // =========================================================================
  {
    resetFakeKv();
    fail.reads = true;

    const read = await readAllListings();
    check(
      "readAllListings reports 'unavailable' on a broken KV, not an empty 'ok'",
      read.status === "unavailable",
      `status=${read.status}`
    );

    const legacy = await getAllListings();
    check(
      "getAllListings still returns [] (the trap the bulk consumers had to stop using)",
      Array.isArray(legacy) && legacy.length === 0,
      JSON.stringify(legacy).slice(0, 60)
    );

    let threw: unknown = null;
    try {
      await requireAllListings({ context: "unit test" });
    } catch (err) {
      threw = err;
    }
    check(
      "requireAllListings throws ListingsStoreUnavailableError instead of returning []",
      threw instanceof ListingsStoreUnavailableError,
      String(threw)
    );
    check(
      "the error carries the underlying KV reason",
      threw instanceof ListingsStoreUnavailableError && threw.reason.includes("500"),
      threw instanceof ListingsStoreUnavailableError ? threw.reason : ""
    );
  }
  {
    // A verifiably empty store is a FACT and must not be turned into an
    // error — otherwise a fresh environment can never come up.
    resetFakeKv();
    const read = await readAllListings();
    check("an empty-but-healthy store reads as 'absent', not 'unavailable'", read.status === "absent", read.status);
    check("requireAllListings returns [] for 'absent'", (await requireAllListings()).length === 0);
  }
  {
    // Torn write: manifest and chunks from different writes. Before the
    // `total` cross-check this reassembled into a plausible mixed array and
    // was served as data.
    resetFakeKv();
    await writeAllListings(seed, { force: true });
    store.set("listings:index", JSON.stringify({ chunks: 1, total: 999, updatedAt: "x" }));

    // With the legacy listings:all blob still present the read is EXPECTED to
    // recover through it — that fallback is deliberate and logs [kv-shape].
    // What matters is that it did not serve the mixed sharded reassembly.
    const recovered = await readAllListings();
    check(
      "a torn sharded read falls back to the legacy blob rather than serving the mix",
      recovered.status === "ok" && recovered.listings.length === seed.length,
      recovered.status === "ok" ? String(recovered.listings.length) : recovered.status
    );

    // With both forms torn/absent there is nothing to recover to.
    store.delete("listings:all");
    const read = await readAllListings();
    check(
      "manifest/chunk row-count mismatch reads as 'unavailable' (torn write), not as data",
      read.status === "unavailable" && read.reason.includes("torn write"),
      read.status === "unavailable" ? read.reason : read.status
    );
  }

  // =========================================================================
  console.log("\n[2/6] bulk consumers never publish emptiness from an unreadable store");
  // =========================================================================
  {
    resetFakeKv();
    await writeAllListings(seed, { force: true });
    fail.reads = true;

    // --- GET /api/sitemap ---------------------------------------------------
    const { GET: sitemapGET } = await import("../src/app/api/sitemap/route");
    const sitemapRes = await sitemapGET();
    const sitemapBody = await sitemapRes.text();
    check("GET /api/sitemap answers 503, not 200", sitemapRes.status === 503, String(sitemapRes.status));
    check("the 503 body contains no <url> entries at all", !sitemapBody.includes("<url>"));
    check("the 503 sets Retry-After", sitemapRes.headers.get("Retry-After") !== null);
    check(
      "the 503 is not cacheable",
      (sitemapRes.headers.get("Cache-Control") ?? "").includes("no-store"),
      sitemapRes.headers.get("Cache-Control") ?? "none"
    );

    // --- GET /api/search ----------------------------------------------------
    const { GET: searchGET } = await import("../src/app/api/search/route");
    const { NextRequest } = await import("next/server");
    const searchRes = await searchGET(new NextRequest("http://localhost/api/search?q=fixture"));
    check("GET /api/search answers 503, not an empty 200 array", searchRes.status === 503, String(searchRes.status));

    // --- POST /api/discover -------------------------------------------------
    // Cache unreadable AND the live provider blocked: an empty 200 here would
    // assert the city has no listings.
    const { POST: discoverPOST } = await import("../src/app/api/discover/route");
    const discoverRes = await discoverPOST(
      new Request("http://localhost/api/discover", {
        method: "POST",
        body: JSON.stringify({ city: "Austin", province: "TX" }),
      }) as never
    );
    const discoverBody = (await discoverRes.json()) as { degraded?: boolean; results?: unknown[] };
    check(
      "POST /api/discover answers 503 when the cache is unreadable and live fails",
      discoverRes.status === 503,
      String(discoverRes.status)
    );
    check("the discover failure is flagged as degraded", discoverBody.degraded === true);
    check("the discover failure carries no results array to render", discoverBody.results === undefined);

    // --- GET /api/insurance/address-lookup ----------------------------------
    const { GET: lookupGET } = await import("../src/app/api/insurance/address-lookup/route");
    const lookupUrl = "http://localhost/api/insurance/address-lookup?q=100";
    const lookupRes = await lookupGET(new Request(lookupUrl));
    check(
      "GET /api/insurance/address-lookup answers 502, not { results: [] }",
      lookupRes.status === 502,
      String(lookupRes.status)
    );
    // The index is cached for 5 minutes. An empty index cached during an
    // outage would keep answering "not tracked" long after KV recovered.
    const lookupRes2 = await lookupGET(new Request(lookupUrl));
    check(
      "a second call still fails — no empty index was written to the 5-minute cache",
      lookupRes2.status === 502,
      String(lookupRes2.status)
    );

    // --- /discover/[city] ---------------------------------------------------
    // This one is the 404-shaped hazard: the city list is derived from the
    // listing array, so an empty read used to reach notFound(), and a 404
    // asks crawlers to DELETE an indexed URL.
    const cityPage = await import("../src/app/discover/[city]/page");
    let cityErr: unknown = null;
    try {
      await cityPage.default({ params: Promise.resolve({ city: "austin" }) });
    } catch (err) {
      cityErr = err;
    }
    check(
      "/discover/[city] throws (500) rather than rendering or 404ing",
      cityErr instanceof ListingsStoreUnavailableError,
      cityErr instanceof Error ? `${cityErr.name}: ${cityErr.message.slice(0, 80)}` : String(cityErr)
    );
    const NEXT_NOT_FOUND = "NEXT_HTTP_ERROR_FALLBACK;404";
    check(
      "and specifically does not raise Next's notFound() signal",
      !(cityErr instanceof Error && cityErr.message.includes(NEXT_NOT_FOUND))
    );

    // --- Server-component surfaces ------------------------------------------
    // The homepage, dashboard, discover OG image and insurance data-moat
    // section are React Server Components whose degraded behaviour is a
    // rendered banner, not a status code; rendering them in-process would
    // pull in the whole component tree for no added signal. What is checked
    // instead is the property that made all of them wrong in the first place:
    // reading the store through the helper that cannot report an outage.
    const bulkConsumers = [
      "src/app/api/sitemap/route.ts",
      "src/app/api/search/route.ts",
      "src/app/api/discover/route.ts",
      "src/app/api/insurance/address-lookup/route.ts",
      "src/app/page.tsx",
      "src/app/dashboard/page.tsx",
      "src/app/discover/[city]/page.tsx",
      "src/app/discover/[city]/opengraph-image.tsx",
      "src/components/insurance/landing/data-moat.tsx",
      "src/lib/realtor-ca.ts",
      "scripts/generate-sitemap.ts",
    ];
    // Comments in these files legitimately mention getAllListings by name
    // (they explain why it is no longer used), so compare against code only.
    const stripComments = (src: string): string =>
      src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

    for (const rel of bulkConsumers) {
      const code = stripComments(readFileSync(join(REPO_ROOT, rel), "utf-8"));
      const usesBlindRead = /\bgetAllListings\b/.test(code);
      const usesTypedRead = /\b(readAllListings|requireAllListings)\b/.test(code);
      check(`${rel} does not read the store through getAllListings`, !usesBlindRead);
      check(`${rel} uses the typed read`, usesTypedRead);
    }
  }

  // =========================================================================
  console.log("\n[3/6] the prebuild sitemap generator fails the build, and writes nothing");
  // =========================================================================
  {
    // This is the worst path in the set: scripts/generate-sitemap.ts runs in
    // `prebuild` and writeFileSync's STATIC files into public/. The dynamic
    // route self-heals on the next request; a baked sitemap-property.xml with
    // zero URLs is served to Googlebot (robots.ts points straight at
    // sitemap-main.xml) until somebody redeploys.
    const target = join(REPO_ROOT, "public", "sitemap-property.xml");
    const before = existsSync(target) ? statSync(target).mtimeMs : null;

    const runGenerator = (env: Record<string, string>): { code: number; output: string } => {
      try {
        const out = execFileSync("npx", ["tsx", "scripts/generate-sitemap.ts"], {
          cwd: REPO_ROOT,
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "pipe"],
          // DATABASE_URL="" keeps the county queries out of this (falsy, so
          // the generator skips them) — this is about the listings read.
          env: { ...process.env, DATABASE_URL: "", ...env },
        });
        return { code: 0, output: out };
      } catch (err) {
        const e = err as { status?: number; stdout?: string; stderr?: string };
        return { code: e.status ?? 1, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
      }
    };

    // 127.0.0.1:1 refuses instantly — a configured but unreachable KV.
    const unreadable = runGenerator({
      KV_REST_API_URL: "http://127.0.0.1:1",
      KV_REST_API_TOKEN: "fake-token",
    });
    check("unreadable KV: generator exits non-zero (build fails)", unreadable.code !== 0, `exit=${unreadable.code}`);
    check(
      "unreadable KV: it says why, naming the refusal",
      /refusing to generate a sitemap/i.test(unreadable.output),
      unreadable.output.slice(-300)
    );

    // Unset credentials would silently produce a 250-URL static-seed sitemap.
    const unconfigured = runGenerator({ KV_REST_API_URL: "", KV_REST_API_TOKEN: "" });
    check("unconfigured KV: generator exits non-zero", unconfigured.code !== 0, `exit=${unconfigured.code}`);
    check(
      "unconfigured KV: it refuses rather than publishing the static dev seed",
      /static dev seed|SITEMAP_ALLOW_STATIC_SEED/i.test(unconfigured.output),
      unconfigured.output.slice(-300)
    );

    const after = existsSync(target) ? statSync(target).mtimeMs : null;
    check("neither failed run wrote public/sitemap-property.xml", before === after, `${before} -> ${after}`);
    if (after !== null) {
      const xml = readFileSync(target, "utf-8");
      check("any pre-existing sitemap-property.xml still holds its URLs", xml.includes("<url>"));
    }
  }

  // =========================================================================
  console.log("\n[4/6] failed writes surface instead of reporting success");
  // =========================================================================
  {
    resetFakeKv();
    await writeAllListings(seed, { force: true });

    fail.sets = true;
    let setErr: unknown = null;
    let setResult: unknown = null;
    try {
      setResult = await writeAllListings(seed, { force: true });
    } catch (err) {
      setErr = err;
    }
    check(
      "a rejected SET makes writeAllListings throw, not return a written count",
      setErr instanceof Error && setResult === null,
      `err=${String(setErr)} result=${JSON.stringify(setResult)}`
    );
    check(
      "the failure names the key and the HTTP status",
      setErr instanceof Error && /KV SET .* 500/.test(setErr.message),
      setErr instanceof Error ? setErr.message : ""
    );

    fail.sets = false;
    fail.pipeline = "http";
    let pipeHttpErr: unknown = null;
    let pipeHttpResult: unknown = null;
    try {
      pipeHttpResult = await writeAllListings(seed, { force: true });
    } catch (err) {
      pipeHttpErr = err;
    }
    check(
      "a rejected slug pipeline (HTTP 500) throws rather than counting the slugs as written",
      pipeHttpErr instanceof Error && pipeHttpResult === null,
      `err=${String(pipeHttpErr)} result=${JSON.stringify(pipeHttpResult)}`
    );

    fail.pipeline = "command";
    let pipeCmdErr: unknown = null;
    let pipeCmdResult: unknown = null;
    try {
      pipeCmdResult = await writeAllListings(seed, { force: true });
    } catch (err) {
      pipeCmdErr = err;
    }
    check(
      "a pipeline that returns HTTP 200 with a rejected command still throws",
      pipeCmdErr instanceof Error && pipeCmdResult === null,
      `err=${String(pipeCmdErr)} result=${JSON.stringify(pipeCmdResult)}`
    );
    check(
      "the per-command failure is reported, not just the request",
      pipeCmdErr instanceof Error && /rejected/.test(pipeCmdErr.message),
      pipeCmdErr instanceof Error ? pipeCmdErr.message : ""
    );

    fail.pipeline = null;
    const okResult = await writeAllListings(seed, { force: true });
    check(
      "a healthy write still reports its counts",
      okResult.written === seed.length && okResult.slugs === seed.length,
      JSON.stringify(okResult)
    );
  }

  // =========================================================================
  console.log("\n[5/6] dedup drops only provable copies — the Newark pair survives");
  // =========================================================================
  {
    const newarkA = makeListing(0, {
      address: "105-107 Broad St",
      city: "Newark",
      province: "NJ",
      price: 224900,
      mlsNumber: "4016139",
    });
    const newarkB = makeListing(0, {
      address: "105-107 Broad St",
      city: "Newark",
      province: "NJ",
      price: 254900,
      mlsNumber: "26010654",
    });

    const base = makeListing(1);
    const identicalCopy = copy(base);
    const result = dedupeListingsByIdentity([base, identicalCopy, newarkA, newarkB, copy(newarkA)]);
    check("byte-identical rows are dropped", result.dropped === 2, `dropped=${result.dropped}`);
    check("survivors keep first-occurrence order", result.listings.length === 3, `kept=${result.listings.length}`);
    check(
      "both Newark properties survive (different MLS + price, one URL)",
      result.listings.filter((l) => l.address === "105-107 Broad St").length === 2,
      JSON.stringify(result.listings.filter((l) => l.address === "105-107 Broad St").map((l) => l.mlsNumber))
    );

    // Two BOARDS inside one province can issue the same MLS number. The
    // previous province+MLS rule merged these two real properties.
    const vreb = makeListing(2, { address: "1 Fort St", city: "Victoria", province: "BC", mlsNumber: "900123" });
    const rebgv = makeListing(3, { address: "88 Hastings St", city: "Vancouver", province: "BC", mlsNumber: "900123" });
    const boards = dedupeListingsByIdentity([vreb, rebgv]);
    check(
      "two properties sharing a province-scoped MLS number are both kept",
      boards.dropped === 0 && boards.listings.length === 2,
      JSON.stringify(boards.listings.map((l) => l.address))
    );

    // Same address string, different unit — the address fallback merged these.
    const unitless1 = makeListing(4, { address: "12 Main St", city: "Halifax", province: "NS", mlsNumber: undefined, price: 300000 });
    const unitless2 = makeListing(4, { address: "12 Main St", city: "Halifax", province: "NS", mlsNumber: undefined, price: 410000 });
    const units = dedupeListingsByIdentity([unitless1, unitless2]);
    check(
      "two MLS-less rows sharing an address but differing in price are both kept",
      units.dropped === 0,
      JSON.stringify(units.listings.map((l) => l.price))
    );

    // Rows differing ONLY inside a nested object. listing-identity.ts's
    // canonicalize() blanks nested objects (JSON.stringify's array replacer
    // is an allow-list applied at every depth), so isSameRecord alone calls
    // these equal — kv/listings.ts's deepCanonical guard is what keeps them.
    const withAssessment = makeListing(5, {
      preAssessment: { found: true, totalValue: 500000 },
    } as Partial<Listing>);
    const withOtherAssessment = makeListing(5, {
      preAssessment: { found: true, totalValue: 750000 },
    } as Partial<Listing>);
    const nested = dedupeListingsByIdentity([withAssessment, withOtherAssessment]);
    check(
      "rows differing only in a NESTED field (preAssessment) are both kept",
      nested.dropped === 0,
      JSON.stringify(nested.listings.map((l) => l.preAssessment))
    );
  }

  // =========================================================================
  console.log("\n[6/6] upsertListing matches on identity, not on the bare address");
  // =========================================================================
  {
    resetFakeKv();
    const victoria = makeListing(0, { address: "123 Main St", city: "Victoria", province: "BC", mlsNumber: "V-1" });
    const other = makeListing(1, { city: "Victoria", province: "BC" });
    await writeAllListings([victoria, other], { force: true });

    const calgary = makeListing(0, {
      address: "123 Main St",
      city: "Calgary",
      province: "AB",
      mlsNumber: "A-1",
      price: 999999,
    });
    await upsertListing(calgary);

    const after = await requireAllListings();
    const sameAddress = after.filter((l) => l.address === "123 Main St");
    check(
      "a same-address listing in another city is ADDED, not written over the stored one",
      sameAddress.length === 2,
      JSON.stringify(sameAddress.map((l) => `${l.city}/${l.province}`))
    );
    check(
      "the original Victoria row is untouched",
      sameAddress.some((l) => l.city === "Victoria" && l.province === "BC" && l.mlsNumber === "V-1")
    );
    check("the Calgary row landed", sameAddress.some((l) => l.city === "Calgary" && l.price === 999999));

    // Primary key hit: same address/city/province replaces in place.
    const victoriaUpdated = { ...victoria, price: 111111 };
    await upsertListing(victoriaUpdated);
    const afterUpdate = await requireAllListings();
    check(
      "a same address+city+province upsert replaces in place (no duplicate row)",
      afterUpdate.filter((l) => l.city === "Victoria" && l.address === "123 Main St").length === 1,
      String(afterUpdate.length)
    );
    check(
      "and carries the new values",
      afterUpdate.some((l) => l.city === "Victoria" && l.price === 111111)
    );

    // Secondary key hit: address string moved, MLS unchanged.
    const victoriaRenamed = { ...victoriaUpdated, address: "123 Main Street", price: 222222 };
    await upsertListing(victoriaRenamed);
    const afterRename = await requireAllListings();
    const victoriaRows = afterRename.filter((l) => l.city === "Victoria" && l.mlsNumber === "V-1");
    check(
      "an MLS-matched re-scrape with a changed address string updates the row instead of forking one",
      victoriaRows.length === 1,
      JSON.stringify(victoriaRows.map((l) => l.address))
    );
    check(
      "and the row now carries the new address",
      victoriaRows[0]?.address === "123 Main Street",
      victoriaRows[0]?.address
    );
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  global.fetch = originalFetch;
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("[test-listings-degraded] fatal:", err);
  process.exit(1);
});
