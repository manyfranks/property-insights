/**
 * Backtest: Sold comparables matching across all KV listings.
 *
 * Run:  npx tsx scripts/test-comparables.ts
 *
 * Fetches sold data once per city, runs matching for every listing,
 * and reports: confidence tiers, data gaps, implied values vs our offers.
 *
 * Optional flags:
 *   --skip-detail     Skip detail page enrichment (faster, search-level only)
 *   --city=langford   Run for a single city only
 *   --limit=5         Max listings per city
 */

import { readFileSync } from "fs";
import { resolve } from "path";

// Load .env.local manually (no dotenv dependency)
try {
  const envFile = readFileSync(resolve(process.cwd(), ".env.local"), "utf-8");
  for (const line of envFile.split("\n")) {
    const match = line.match(/^([A-Z_]+)=(.+)$/);
    if (match) process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
} catch {}

import { fetchSoldListings, ZoocasaSoldRaw } from "../src/lib/zoocasa";
import { matchComparables, normalizePropertyType } from "../src/lib/comparables";
import { Listing } from "../src/lib/types";
import { fmt } from "../src/lib/utils";

// ---------------------------------------------------------------------------
// Parse CLI flags
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const skipDetail = args.includes("--skip-detail");
const cityFlag = args.find((a) => a.startsWith("--city="))?.split("=")[1];
const limitFlag = parseInt(args.find((a) => a.startsWith("--limit="))?.split("=")[1] || "0");

// ---------------------------------------------------------------------------
// KV fetch (direct REST, no Next.js)
// ---------------------------------------------------------------------------

async function fetchKvListings(): Promise<Listing[]> {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    console.error("KV_REST_API_URL and KV_REST_API_TOKEN required. Set in .env.local");
    process.exit(1);
  }

  const res = await fetch(`${url}/get/listings:all`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`KV fetch failed: ${res.status}`);
  const data = await res.json();
  return (typeof data.result === "string" ? JSON.parse(data.result) : data.result) as Listing[];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface CityStats {
  city: string;
  province: string;
  poolSize: number;
  typeBreakdown: Record<string, number>;
  listingCount: number;
  results: {
    address: string;
    confidence: string;
    matchedCount: number;
    medianSoldToList: number | null;
    medianPpsf: number | null;
    impliedValue: number | null;
    ourOffer: number | null;
    divergence: string | null;
    dataGaps: string[];
    topComps: string[];
  }[];
}

async function main() {
  console.log("=== Comparables Backtest ===");
  console.log(`Detail enrichment: ${skipDetail ? "SKIPPED" : "ENABLED"}`);
  if (cityFlag) console.log(`City filter: ${cityFlag}`);
  if (limitFlag) console.log(`Limit per city: ${limitFlag}`);
  console.log();

  // Load all listings from KV
  const allListings = await fetchKvListings();
  console.log(`Loaded ${allListings.length} listings from KV\n`);

  // Group by city+province
  const cityGroups = new Map<string, Listing[]>();
  for (const l of allListings) {
    const key = `${l.city.toLowerCase()}|${l.province.toLowerCase()}`;
    if (cityFlag && !key.startsWith(cityFlag.toLowerCase())) continue;
    const group = cityGroups.get(key) || [];
    group.push(l);
    cityGroups.set(key, group);
  }

  const allStats: CityStats[] = [];
  const confidenceTotals = { high: 0, medium: 0, low: 0, none: 0 };
  let totalListings = 0;

  for (const [key, listings] of cityGroups) {
    const [city, province] = key.split("|");
    const cityName = listings[0].city;
    const provName = listings[0].province;

    console.log(`\n${"═".repeat(70)}`);
    console.log(`  ${cityName}, ${provName} (${listings.length} listings)`);
    console.log(`${"═".repeat(70)}`);

    // Fetch sold pool once per city
    let soldPool: ZoocasaSoldRaw[];
    try {
      soldPool = await fetchSoldListings(cityName, provName);
      console.log(`  Sold pool: ${soldPool.length} listings`);
    } catch (err) {
      console.log(`  SOLD FETCH FAILED: ${err instanceof Error ? err.message : err}`);
      continue;
    }

    // Type breakdown in pool
    const typeBreakdown: Record<string, number> = {};
    for (const s of soldPool) {
      const t = normalizePropertyType(s.property_type);
      typeBreakdown[t] = (typeBreakdown[t] || 0) + 1;
    }
    console.log(`  Types: ${JSON.stringify(typeBreakdown)}`);

    // Date range
    const dates = soldPool.map((s) => s.sold_at?.slice(0, 10)).filter(Boolean).sort();
    if (dates.length) {
      console.log(`  Sold dates: ${dates[0]} to ${dates[dates.length - 1]}`);
    }

    const cityStats: CityStats = {
      city: cityName,
      province: provName,
      poolSize: soldPool.length,
      typeBreakdown,
      listingCount: 0,
      results: [],
    };

    const subset = limitFlag ? listings.slice(0, limitFlag) : listings;

    for (const listing of subset) {
      totalListings++;
      cityStats.listingCount++;

      console.log(`\n  ── ${listing.address} ──`);
      console.log(`     ${listing.beds}bd/${listing.baths}ba ${listing.sqft || "?"}sqft | List: ${fmt(listing.price)} | DOM: ${listing.dom}`);

      const result = await matchComparables(listing, soldPool, {
        skipDetailEnrichment: skipDetail,
      });

      confidenceTotals[result.confidence]++;

      const ourOffer = listing.preOffer?.final_offer || null;
      let divergence: string | null = null;
      if (ourOffer && result.impliedValue) {
        const pct = ((result.impliedValue - ourOffer) / ourOffer) * 100;
        divergence = `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
      }

      // Display
      const confColor = {
        high: "\x1b[32m",    // green
        medium: "\x1b[33m",  // yellow
        low: "\x1b[90m",     // grey
        none: "\x1b[31m",    // red
      }[result.confidence];
      console.log(`     ${confColor}Confidence: ${result.confidence.toUpperCase()}\x1b[0m | Matched: ${result.matchedCount}/${soldPool.length}`);

      if (result.medianSoldToList) {
        console.log(`     Median sold/list: ${(result.medianSoldToList * 100).toFixed(1)}%`);
      }
      if (result.medianPricePerSqft) {
        console.log(`     Median $/sqft: $${result.medianPricePerSqft}`);
      }
      if (result.impliedValue) {
        console.log(`     Implied value: ${fmt(result.impliedValue)}`);
      }
      if (ourOffer) {
        console.log(`     Our offer: ${fmt(ourOffer)}${divergence ? ` | Comp divergence: ${divergence}` : ""}`);
      }
      if (result.dataGaps.length) {
        console.log(`     Gaps: ${result.dataGaps.join(" · ")}`);
      }

      // Show top comps
      const topComps: string[] = [];
      for (const c of result.comparables) {
        const line = `${c.address} | ${c.bedrooms}bd ${c.sqft || "?"}sqft | ${fmt(c.soldPrice)} (${(c.soldToListRatio * 100).toFixed(1)}%) | ${c.distanceKm}km | sim=${c.similarityScore}${c.enriched ? ` | era=${c.eraBucket || "?"}` : ""}`;
        topComps.push(line);
        console.log(`       ${c.matchTier === "strong" ? "●" : c.matchTier === "moderate" ? "◐" : "○"} ${line}`);
      }

      cityStats.results.push({
        address: listing.address,
        confidence: result.confidence,
        matchedCount: result.matchedCount,
        medianSoldToList: result.medianSoldToList,
        medianPpsf: result.medianPricePerSqft,
        impliedValue: result.impliedValue,
        ourOffer,
        divergence,
        dataGaps: result.dataGaps,
        topComps,
      });

      // Throttle to avoid hammering Zoocasa (detail fetches)
      if (!skipDetail) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    allStats.push(cityStats);
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------

  console.log(`\n\n${"═".repeat(70)}`);
  console.log("  BACKTEST SUMMARY");
  console.log(`${"═".repeat(70)}`);
  console.log(`  Total listings tested: ${totalListings}`);
  console.log(`  Cities: ${allStats.length}`);
  console.log();
  console.log("  Confidence distribution:");
  console.log(`    HIGH:   ${confidenceTotals.high} (${((confidenceTotals.high / totalListings) * 100).toFixed(1)}%)`);
  console.log(`    MEDIUM: ${confidenceTotals.medium} (${((confidenceTotals.medium / totalListings) * 100).toFixed(1)}%)`);
  console.log(`    LOW:    ${confidenceTotals.low} (${((confidenceTotals.low / totalListings) * 100).toFixed(1)}%)`);
  console.log(`    NONE:   ${confidenceTotals.none} (${((confidenceTotals.none / totalListings) * 100).toFixed(1)}%)`);
  console.log();

  // Per-city summary
  console.log("  Per-city breakdown:");
  for (const s of allStats) {
    const conf = { high: 0, medium: 0, low: 0, none: 0 };
    for (const r of s.results) conf[r.confidence as keyof typeof conf]++;
    console.log(`    ${s.city}, ${s.province}: pool=${s.poolSize} | H=${conf.high} M=${conf.medium} L=${conf.low} N=${conf.none}`);
  }

  // Divergence flags
  console.log();
  console.log("  Divergence flags (comp-implied vs our offer, >15%):");
  let divergenceCount = 0;
  for (const s of allStats) {
    for (const r of s.results) {
      if (r.divergence) {
        const pct = parseFloat(r.divergence);
        if (Math.abs(pct) > 15) {
          divergenceCount++;
          console.log(`    ⚠ ${r.address}: ${r.divergence} (implied=${r.impliedValue ? fmt(r.impliedValue) : "?"}, offer=${r.ourOffer ? fmt(r.ourOffer) : "?"})`);
        }
      }
    }
  }
  if (divergenceCount === 0) console.log("    None");

  // Data gap frequency
  console.log();
  console.log("  Most common data gaps:");
  const gapCounts: Record<string, number> = {};
  for (const s of allStats) {
    for (const r of s.results) {
      for (const g of r.dataGaps) {
        gapCounts[g] = (gapCounts[g] || 0) + 1;
      }
    }
  }
  const sortedGaps = Object.entries(gapCounts).sort((a, b) => b[1] - a[1]);
  for (const [gap, count] of sortedGaps.slice(0, 10)) {
    console.log(`    ${count}× ${gap}`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
