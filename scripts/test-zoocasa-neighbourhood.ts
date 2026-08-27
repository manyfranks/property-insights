/**
 * scripts/test-zoocasa-neighbourhood.ts
 *
 * Regression test for src/lib/zoocasa-neighbourhood.ts's cron-hardening pass:
 *   - per-city `target` alignment (early-stop the neighbourhood fan-out once
 *     `target * headroom` distinct URLs are collected, instead of always
 *     chasing the flat `maxUrls` ceiling)
 *   - the `deadlineMs` soft time budget (partial-but-logged, never silent,
 *     never conflated with a genuine structural failure)
 *   - the untouched invariants: throw on structural failure (404, or a page
 *     that parses but has no "…Latest Listings" block), 3-segment detail
 *     paths only, city/province scoping.
 *
 * Uses LIVE fetches against zoocasa.com for the discovery-shape assertions
 * (no credentials needed — this is the same ungated path the POC validated),
 * plus one fetch-mocked case to deterministically exercise the "page parses
 * fine but has no Latest Listings block" throw without depending on finding
 * a live page in that state.
 *
 * Run: npx tsx scripts/test-zoocasa-neighbourhood.ts
 */

import { discoverListingUrls } from "../src/lib/zoocasa-neighbourhood";

let failed = false;

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`ASSERTION FAILED: ${msg}`);
    failed = true;
  } else {
    console.log(`  OK: ${msg}`);
  }
}

/** Wraps global.fetch to count outbound requests while `fn` runs, then restores it. */
async function withFetchCounter<T>(fn: () => Promise<T>): Promise<{ result: T; requestCount: number }> {
  const originalFetch = global.fetch;
  let requestCount = 0;
  global.fetch = ((...args: Parameters<typeof fetch>) => {
    requestCount++;
    return originalFetch(...args);
  }) as typeof fetch;
  try {
    const result = await fn();
    return { result, requestCount };
  } finally {
    global.fetch = originalFetch;
  }
}

function pathSegments(url: string): string[] {
  return new URL(url).pathname.split("/").filter(Boolean);
}

async function testDiscoveryShapeAndVolume() {
  console.log("\n--- discoverListingUrls: volume + URL shape (live) ---");

  const CASES: Array<{ city: string; province: string }> = [
    { city: "Calgary", province: "ab" },
    { city: "Vancouver", province: "bc" },
  ];

  for (const { city, province } of CASES) {
    const t0 = Date.now();
    const { result: urls, requestCount } = await withFetchCounter(() =>
      discoverListingUrls(city, province, { concurrency: 5 })
    );
    const ms = Date.now() - t0;

    console.log(
      `  ${city}, ${province.toUpperCase()}: ${urls.length} distinct URL(s), ${requestCount} request(s), ${ms}ms`
    );

    assert(urls.length >= 25, `${city}: distinct URL count (${urls.length}) >= 25`);

    const expectedPrefix = `${city.toLowerCase()}-${province.toLowerCase()}-real-estate`;
    const wrongPrefix = urls.filter((u) => !new URL(u.url).pathname.startsWith(`/${expectedPrefix}/`));
    assert(
      wrongPrefix.length === 0,
      `${city}: all ${urls.length} URLs are city-prefixed with "/${expectedPrefix}/" ` +
        `(found ${wrongPrefix.length} mismatched)`
    );

    const wrongShape = urls.filter((u) => pathSegments(u.url).length !== 3);
    assert(
      wrongShape.length === 0,
      `${city}: all ${urls.length} URLs are 3-segment detail paths (found ${wrongShape.length} with ` +
        `!= 3 segments, e.g. ${wrongShape[0]?.url ?? "n/a"})`
    );

    const twoSegment = urls.filter((u) => pathSegments(u.url).length === 2);
    assert(
      twoSegment.length === 0,
      `${city}: none of the returned URLs are the bare 2-segment neighbourhood-page shape`
    );
  }
}

async function testStructuralFailureThrows404() {
  console.log("\n--- discoverListingUrls: 404 / nonsense city throws (live) ---");

  const bogusCity = "zzz-nonexistent-city-9182736";
  const bogusProvince = "zz";
  try {
    const urls = await discoverListingUrls(bogusCity, bogusProvince);
    assert(false, `expected a throw for a nonsense city/province, got ${urls.length} URL(s) instead`);
  } catch (err) {
    assert(
      err instanceof Error && err.message.length > 0,
      `nonsense city/province threw (not a silent [] return): ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

async function testStructuralFailureThrowsMissingLatestListingsBlock() {
  console.log("\n--- discoverListingUrls: page parses but has no Latest Listings block throws (mocked) ---");

  const originalFetch = global.fetch;
  global.fetch = (async () => {
    // A page that parses fine (valid __NEXT_DATA__, valid internalLinks
    // blocks) but where NO block's title ends with "Latest Listings" — the
    // exact shape-drift scenario the file's getInternalLinks/findBlockBySuffix
    // guard is built to catch. Constructed synthetically (rather than found
    // live) because we can't cheaply guarantee a live page sits in this
    // exact state on demand.
    const nextData = {
      props: {
        pageProps: {
          props: {
            internalLinks: [
              {
                title: "Somewhere Neighbourhoods",
                links: [{ label: "Downtown", link: "/somewhere-on-real-estate/downtown" }],
              },
            ],
          },
        },
      },
    };
    const html =
      `<html><body><script id="__NEXT_DATA__" type="application/json">` +
      `${JSON.stringify(nextData)}</script></body></html>`;
    return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
  }) as typeof fetch;

  try {
    const urls = await discoverListingUrls("Somewhere", "on");
    assert(false, `expected a throw for a missing Latest Listings block, got ${urls.length} URL(s) instead`);
  } catch (err) {
    assert(
      err instanceof Error && /latest listings/i.test(err.message),
      `missing-Latest-Listings-block page threw with a relevant message: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  } finally {
    global.fetch = originalFetch;
  }
}

async function testTargetAwareEarlyStop() {
  console.log("\n--- discoverListingUrls: small `target` stops early (live) ---");

  const SMALL_TARGET = 3;
  const t0 = Date.now();
  const { result: urls, requestCount } = await withFetchCounter(() =>
    discoverListingUrls("Calgary", "ab", { concurrency: 5, target: SMALL_TARGET })
  );
  const ms = Date.now() - t0;

  console.log(
    `  target=${SMALL_TARGET}: ${urls.length} URL(s), ${requestCount} request(s), ${ms}ms`
  );

  assert(urls.length > 0, `target=${SMALL_TARGET} still returns at least one URL`);
  // Generous upper bound: whatever the internal headroom multiplier is, a
  // target of 3 must not balloon anywhere near the flat maxUrls default (60)
  // or the ~174 distinct URLs Calgary yields on an unrestricted crawl.
  assert(
    urls.length <= SMALL_TARGET * 5,
    `target=${SMALL_TARGET} result size (${urls.length}) stays roughly target-scaled (<= ${SMALL_TARGET * 5})`
  );
  // The city page's own "Latest Listings" block alone typically already
  // satisfies a target this small, so this should not have fanned out into
  // more than a couple of neighbourhood pages — a world away from the dozens
  // of neighbourhood-page requests an unrestricted crawl makes.
  assert(
    requestCount <= 5,
    `target=${SMALL_TARGET} made a small, bounded number of requests (${requestCount} <= 5) — ` +
      `did not crawl all neighbourhood pages`
  );
}

async function main() {
  console.log("=".repeat(70));
  console.log("zoocasa-neighbourhood regression suite");
  console.log("=".repeat(70));

  await testDiscoveryShapeAndVolume();
  await testStructuralFailureThrows404();
  await testStructuralFailureThrowsMissingLatestListingsBlock();
  await testTargetAwareEarlyStop();

  console.log("\n" + "=".repeat(70));
  if (failed) {
    console.error("RESULT: FAILED — one or more assertions did not hold. See above.");
    process.exit(1);
  } else {
    console.log("RESULT: PASSED — all assertions held.");
  }
}

main().catch((err) => {
  console.error("\nFATAL ERROR (unhandled):");
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
