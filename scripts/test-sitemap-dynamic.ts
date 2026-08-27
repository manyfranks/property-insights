/**
 * scripts/test-sitemap-dynamic.ts
 *
 * Focused test for the two KV-derived sitemap children that moved off
 * build-time static files onto dynamic routes (2026-08-27 split — see
 * scripts/generate-sitemap.ts's "property/discover moved to dynamic
 * routes" header section):
 *   - src/app/sitemap-property.xml/route.ts
 *   - src/app/sitemap-discover.xml/route.ts
 * both backed by src/lib/sitemap-listing-entries.ts.
 *
 * Imports the two routes' GET handlers IN-PROCESS (same pattern
 * scripts/test-canary-local.ts and scripts/test-listings-degraded.ts use —
 * no dev server, no HTTP round trip) against REAL, live-configured KV, and
 * asserts:
 *   1. Each response is a valid, well-formed <urlset> with the right
 *      Content-Type.
 *   2. sitemap-property.xml contains /property/ <loc>s, sitemap-discover.xml
 *      contains /discover/ <loc>s.
 *   3. The property URL count matches the live KV distinct-slug count
 *      exactly (computed independently via requireAllListings +
 *      src/lib/sitemap-listing-entries.ts's own dedup helper) and is well
 *      over 100 — not a trivial/truncated result.
 *   4. lastmod values are real per-record listing.enrichedAt timestamps,
 *      not this request's own wall-clock time — mirrors
 *      scripts/test-sitemap-lastmod.ts's build-stamp regression check, but
 *      applied at request time against a live route instead of a build
 *      artifact.
 *   5. Degraded-mode contract: pointed at unreachable KV, both routes
 *      answer 503 + Retry-After with NO urlset body — never a 200 with an
 *      empty or partial sitemap. Mirrors src/app/api/sitemap/route.ts's
 *      contract exactly (see that file, and the two routes' own headers).
 *
 * Needs live KV. Run with .env.local loaded, e.g.:
 *   U=$(grep '^KV_REST_API_URL=' .env.local|cut -d= -f2-|tr -d '"')
 *   T=$(grep '^KV_REST_API_TOKEN=' .env.local|cut -d= -f2-|tr -d '"')
 *   KV_REST_API_URL="$U" KV_REST_API_TOKEN="$T" npx tsx scripts/test-sitemap-dynamic.ts
 * (loadEnvLocal() below also picks up .env.local directly, so plain
 * `npx tsx scripts/test-sitemap-dynamic.ts` works too when run from the repo
 * root with a populated .env.local.)
 *
 * Read-only: only calls requireAllListings/readAllListings (GET reads), and
 * the degraded-mode section only overrides KV_REST_API_URL to an
 * unreachable address — it never writes to KV, production or otherwise.
 *
 * Usage: npx tsx scripts/test-sitemap-dynamic.ts
 */
import { loadEnvLocal } from "./lib/ingest-shared";
loadEnvLocal();

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
if (!KV_URL || !KV_TOKEN) {
  console.error(
    "Missing KV_REST_API_URL or KV_REST_API_TOKEN — this test needs real live KV, not the static dev seed " +
      "(a seed-based run would trivially pass the URL-count check against itself and prove nothing)."
  );
  process.exit(1);
}

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed++;
    console.log(`  [PASS] ${label}`);
  } else {
    failed++;
    console.log(`  [FAIL] ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// W3C datetime (the sitemap protocol's required lastmod format), same
// pattern scripts/test-sitemap-lastmod.ts checks against.
const W3C_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function parseUrlset(xml: string): { loc: string; lastmod: string | null }[] {
  const blocks = xml.match(/<url>[\s\S]*?<\/url>/g) ?? [];
  return blocks.map((block) => {
    const locMatch = block.match(/<loc>(.*?)<\/loc>/);
    const lastmodMatch = block.match(/<lastmod>(.*?)<\/lastmod>/);
    if (!locMatch) throw new Error(`Malformed <url> block (no <loc>): ${block}`);
    return { loc: locMatch[1], lastmod: lastmodMatch ? lastmodMatch[1] : null };
  });
}

async function main() {
  console.log("[test-sitemap-dynamic] 1/2 — live KV, happy path\n");

  const { requireAllListings } = await import("../src/lib/kv/listings");
  const { distinctPropertySlugs, distinctCitySlugs } = await import("../src/lib/sitemap-listing-entries");
  const { BASE_URL } = await import("../src/lib/seo");

  const liveListings = await requireAllListings({ context: "test-sitemap-dynamic baseline" });
  const expectedPropertySlugs = distinctPropertySlugs(liveListings);
  const expectedCitySlugs = distinctCitySlugs(liveListings);
  console.log(
    `[test-sitemap-dynamic] baseline from live KV: ${liveListings.length} listings, ` +
      `${expectedPropertySlugs.length} distinct property slugs, ${expectedCitySlugs.length} distinct city slugs\n`
  );

  const { GET: propertyGET } = await import("../src/app/sitemap-property.xml/route");
  const { GET: discoverGET } = await import("../src/app/sitemap-discover.xml/route");

  // --- sitemap-property.xml -------------------------------------------------
  {
    const requestStart = Date.now();
    const res = await propertyGET();
    const requestEnd = Date.now();
    const body = await res.text();

    check("GET /sitemap-property.xml returns 200", res.status === 200, String(res.status));
    check(
      "Content-Type is application/xml",
      (res.headers.get("Content-Type") ?? "").includes("application/xml"),
      res.headers.get("Content-Type") ?? "none"
    );
    check("body is a well-formed <urlset>", body.includes("<urlset") && body.includes("</urlset>"));
    check("body is NOT a <sitemapindex>", !body.includes("<sitemapindex"));

    const entries = parseUrlset(body);
    check("contains /property/ <loc> entries", entries.some((e) => e.loc.includes("/property/")));
    check(
      "every <loc> is a /property/ URL under BASE_URL",
      entries.every((e) => e.loc.startsWith(`${BASE_URL}/property/`)),
      entries.find((e) => !e.loc.startsWith(`${BASE_URL}/property/`))?.loc ?? ""
    );
    check(
      "property URL count is well over 100 (not trivial/truncated)",
      entries.length > 100,
      String(entries.length)
    );
    check(
      "property URL count matches the live KV distinct-slug count exactly",
      entries.length === expectedPropertySlugs.length,
      `got ${entries.length}, expected ${expectedPropertySlugs.length}`
    );

    // lastmod: real per-record enrichedAt, never this request's own
    // wall-clock time. Pad generously — same rationale as
    // test-sitemap-lastmod.ts's build-window check.
    const windowLo = requestStart - 60_000;
    const windowHi = requestEnd + 60_000;
    let withLastmod = 0;
    let inWindow = 0;
    let malformed = 0;
    for (const e of entries) {
      if (e.lastmod === null) continue;
      withLastmod++;
      if (!W3C_DATETIME.test(e.lastmod)) malformed++;
      const epoch = Date.parse(e.lastmod);
      if (epoch >= windowLo && epoch <= windowHi) inWindow++;
    }
    check("at least one property URL carries a real lastmod", withLastmod > 0, String(withLastmod));
    check("no property lastmod is malformed W3C datetime", malformed === 0, `${malformed} malformed`);
    check(
      "no property lastmod falls inside this request's own wall-clock window (not a request-time stamp)",
      inWindow === 0,
      `${inWindow}/${withLastmod} fell inside ${new Date(windowLo).toISOString()}..${new Date(windowHi).toISOString()}`
    );
    console.log(
      `[test-sitemap-dynamic] sitemap-property.xml: ${entries.length} URLs, ${withLastmod} with lastmod\n`
    );
  }

  // --- sitemap-discover.xml -------------------------------------------------
  {
    const requestStart = Date.now();
    const res = await discoverGET();
    const requestEnd = Date.now();
    const body = await res.text();

    check("GET /sitemap-discover.xml returns 200", res.status === 200, String(res.status));
    check(
      "Content-Type is application/xml",
      (res.headers.get("Content-Type") ?? "").includes("application/xml"),
      res.headers.get("Content-Type") ?? "none"
    );
    check("body is a well-formed <urlset>", body.includes("<urlset") && body.includes("</urlset>"));

    const entries = parseUrlset(body);
    check("contains /discover/ <loc> entries", entries.some((e) => e.loc.includes("/discover/")));
    check(
      "every <loc> is a /discover/ URL under BASE_URL",
      entries.every((e) => e.loc.startsWith(`${BASE_URL}/discover/`)),
      entries.find((e) => !e.loc.startsWith(`${BASE_URL}/discover/`))?.loc ?? ""
    );
    check(
      "discover URL count matches the live KV distinct-city-slug count exactly",
      entries.length === expectedCitySlugs.length,
      `got ${entries.length}, expected ${expectedCitySlugs.length}`
    );

    const windowLo = requestStart - 60_000;
    const windowHi = requestEnd + 60_000;
    let withLastmod = 0;
    let inWindow = 0;
    let malformed = 0;
    for (const e of entries) {
      if (e.lastmod === null) continue;
      withLastmod++;
      if (!W3C_DATETIME.test(e.lastmod)) malformed++;
      const epoch = Date.parse(e.lastmod);
      if (epoch >= windowLo && epoch <= windowHi) inWindow++;
    }
    check("no discover lastmod is malformed W3C datetime", malformed === 0, `${malformed} malformed`);
    check(
      "no discover lastmod falls inside this request's own wall-clock window (not a request-time stamp)",
      inWindow === 0,
      `${inWindow}/${withLastmod} fell inside ${new Date(windowLo).toISOString()}..${new Date(windowHi).toISOString()}`
    );
    console.log(`[test-sitemap-dynamic] sitemap-discover.xml: ${entries.length} URLs, ${withLastmod} with lastmod\n`);
  }

  // ===========================================================================
  console.log("[test-sitemap-dynamic] 2/2 — degraded KV must answer 503, never an empty/partial 200\n");
  // ===========================================================================
  {
    // Point at an address that refuses instantly (unreachable, not merely
    // slow) — a configured-but-unreadable KV, the exact case
    // ListingsStoreUnavailableError exists for. requireAllListings/
    // readAllListings read process.env lazily per call, so overriding here
    // (after the happy-path section above already ran) is enough; nothing
    // needs to be re-imported.
    process.env.KV_REST_API_URL = "http://127.0.0.1:1";
    process.env.KV_REST_API_TOKEN = "fake-token-for-degraded-test";

    const propRes = await propertyGET();
    const propBody = await propRes.text();
    console.log(`  sitemap-property.xml under unreachable KV -> HTTP ${propRes.status}`);
    check("GET /sitemap-property.xml answers 503, not 200", propRes.status === 503, String(propRes.status));
    check("the 503 body contains no <url> or <urlset> at all", !propBody.includes("<url"));
    check("the 503 sets Retry-After", propRes.headers.get("Retry-After") !== null);
    check(
      "the 503 is not cacheable",
      (propRes.headers.get("Cache-Control") ?? "").includes("no-store"),
      propRes.headers.get("Cache-Control") ?? "none"
    );

    const discRes = await discoverGET();
    const discBody = await discRes.text();
    console.log(`  sitemap-discover.xml under unreachable KV -> HTTP ${discRes.status}`);
    check("GET /sitemap-discover.xml answers 503, not 200", discRes.status === 503, String(discRes.status));
    check("the 503 body contains no <url> or <urlset> at all", !discBody.includes("<url"));
    check("the 503 sets Retry-After", discRes.headers.get("Retry-After") !== null);
    check(
      "the 503 is not cacheable",
      (discRes.headers.get("Cache-Control") ?? "").includes("no-store"),
      discRes.headers.get("Cache-Control") ?? "none"
    );

    // Restore, in case anything runs after main() in the same process.
    process.env.KV_REST_API_URL = KV_URL;
    process.env.KV_REST_API_TOKEN = KV_TOKEN;
  }

  console.log(`\n[test-sitemap-dynamic] ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
  console.log("[test-sitemap-dynamic] PASSED");
}

main().catch((err) => {
  console.error("[test-sitemap-dynamic] crashed:", err);
  process.exit(1);
});
