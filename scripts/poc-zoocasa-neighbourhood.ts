/**
 * POC: prove neighbourhood-page fan-out recovers real, current, city-scoped
 * Zoocasa listing inventory now that the city search page's own
 * `props.pageProps.props.listings` feed is gated to a frozen, province-wide,
 * ~27-row sample (byte-identical across cities in the same province).
 *
 * No auth, no login — plain unauthenticated HTTP against publicly-served pages.
 *
 * Run: npx tsx scripts/poc-zoocasa-neighbourhood.ts
 */

import { discoverListingUrls, fetchNeighbourhoodListings } from "../src/lib/zoocasa-neighbourhood";

const CITIES: Array<{ city: string; province: string }> = [
  { city: "Calgary", province: "ab" },
  { city: "Victoria", province: "bc" },
];

const MIN_EXPECTED = 25;

let failed = false;

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`ASSERTION FAILED: ${msg}`);
    failed = true;
  } else {
    console.log(`  OK: ${msg}`);
  }
}

async function main() {
  console.log("=".repeat(70));
  console.log("Step 1: discoverListingUrls — distinct detail URLs per city");
  console.log("=".repeat(70));

  const discoveryResults: Record<string, Awaited<ReturnType<typeof discoverListingUrls>>> = {};

  for (const { city, province } of CITIES) {
    console.log(`\n--- ${city}, ${province.toUpperCase()} ---`);
    const t0 = Date.now();
    const urls = await discoverListingUrls(city, province, { maxUrls: 200, concurrency: 5 });
    const ms = Date.now() - t0;

    const distinctNeighbourhoods = new Set(urls.map((u) => u.neighbourhood));
    console.log(`  distinct detail URLs found: ${urls.length}`);
    console.log(`  distinct neighbourhoods represented: ${distinctNeighbourhoods.size}`);
    console.log(`  time: ${ms}ms`);
    console.log(`  sample (first 5):`);
    for (const u of urls.slice(0, 5)) {
      console.log(`    - [${u.neighbourhood}] ${u.label} -> ${u.url}`);
    }

    assert(urls.length > MIN_EXPECTED, `${city} distinct URL count (${urls.length}) > ${MIN_EXPECTED}`);

    discoveryResults[city] = urls;
  }

  console.log("\n" + "=".repeat(70));
  console.log("Step 2: fetchNeighbourhoodListings (limit: 5) — verify correctly scoped");
  console.log("=".repeat(70));

  for (const { city, province } of CITIES) {
    console.log(`\n--- ${city}, ${province.toUpperCase()} ---`);
    const t0 = Date.now();
    const listings = await fetchNeighbourhoodListings(city, province, { limit: 5, concurrency: 5 });
    const ms = Date.now() - t0;

    console.log(`  fetched ${listings.length} listing(s) in ${ms}ms`);
    for (const l of listings) {
      console.log(`    - ${l.address}, ${l.city}, ${l.province} — $${l.price}`);
    }

    assert(listings.length > 0, `${city} fetchNeighbourhoodListings returned at least 1 listing`);

    const wrongCity = listings.filter(
      (l) => l.city.toLowerCase() !== city.toLowerCase()
    );
    assert(
      wrongCity.length === 0,
      `${city}: all ${listings.length} listings are city-scoped to "${city}" (found ${wrongCity.length} mismatched: ${wrongCity
        .map((l) => `${l.address} in ${l.city}`)
        .join(", ")})`
    );

    const wrongProvince = listings.filter(
      (l) => l.province.toLowerCase() !== province.toLowerCase()
    );
    assert(
      wrongProvince.length === 0,
      `${city}: all listings are province-scoped to "${province}" (found ${wrongProvince.length} mismatched)`
    );
  }

  console.log("\n" + "=".repeat(70));
  console.log("Step 3: request-cost summary (decides cron feasibility)");
  console.log("=".repeat(70));

  for (const { city } of CITIES) {
    const urls = discoveryResults[city];
    const neighbourhoods = new Set(urls.map((u) => u.neighbourhood)).size;
    // 1 city-page request + up to `neighbourhoods` neighbourhood-page requests
    // (upper bound — discoverListingUrls dedupes neighbourhood page URLs, so the
    // actual HTTP fetch count is <= 1 + count(unique neighbourhood page URLs queued),
    // which is >= the distinct-neighbourhoods-represented figure below).
    console.log(
      `  ${city}: ~${1 + neighbourhoods} HTTP requests to assemble ${urls.length} distinct listing URLs ` +
        `(1 city page + up to ${neighbourhoods} neighbourhood pages)`
    );
  }

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
