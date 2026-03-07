/**
 * Flush stale KV data and re-seed from Zoocasa.
 *
 * Usage: npx tsx scripts/seed-zoocasa.ts
 *
 * Requires KV_REST_API_URL and KV_REST_API_TOKEN in .env.local
 */

import { readFileSync, writeFileSync } from "fs";
import path from "path";

// Load .env.local
const envContent = readFileSync(".env.local", "utf-8");
for (const line of envContent.split("\n")) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, "");
}

import { searchListings, fetchDetail } from "../src/lib/zoocasa";
import { writeAllListings, purgeStaleSlugKeys } from "../src/lib/kv/listings";
import { clearSeen } from "../src/lib/pipeline/dedup";
import { lookupAB } from "../src/lib/assessment/ab";
import { slugify } from "../src/lib/utils";
import { Listing } from "../src/lib/types";

// ---------------------------------------------------------------------------
// City configs
// ---------------------------------------------------------------------------

interface CityConfig {
  city: string;
  province: string;
  minPrice: number;
  maxPrice: number;
  target: number;
}

const CITIES: CityConfig[] = [
  // BC
  { city: "Victoria", province: "BC", minPrice: 900000, maxPrice: 1300000, target: 25 },
  { city: "Saanich", province: "BC", minPrice: 900000, maxPrice: 1300000, target: 25 },
  { city: "Langford", province: "BC", minPrice: 900000, maxPrice: 1300000, target: 25 },
  { city: "Vancouver", province: "BC", minPrice: 1000000, maxPrice: 1800000, target: 25 },
  { city: "Surrey", province: "BC", minPrice: 1000000, maxPrice: 1800000, target: 25 },
  // AB
  { city: "Calgary", province: "AB", minPrice: 500000, maxPrice: 900000, target: 25 },
  { city: "Edmonton", province: "AB", minPrice: 500000, maxPrice: 900000, target: 25 },
  // ON
  { city: "Toronto", province: "ON", minPrice: 1000000, maxPrice: 1800000, target: 25 },
  { city: "Hamilton", province: "ON", minPrice: 600000, maxPrice: 1000000, target: 25 },
  { city: "Ottawa", province: "ON", minPrice: 600000, maxPrice: 1000000, target: 25 },
];

// Pre-computed fields to strip from listings
const PRE_FIELDS: (keyof Listing)[] = [
  "preScore", "preTier", "preSignals", "preNarrative", "preOffer", "assessmentNote",
];

function stripPrecomputed(listing: Listing): Listing {
  const clean = { ...listing };
  for (const f of PRE_FIELDS) {
    delete (clean as Record<string, unknown>)[f];
  }
  return clean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== Zoocasa Flush & Re-Seed ===\n");

  const allListings: Listing[] = [];
  const summary: { city: string; province: string; count: number }[] = [];

  for (const cfg of CITIES) {
    console.log(`\n--- ${cfg.city}, ${cfg.province} ($${(cfg.minPrice / 1000).toFixed(0)}K–$${(cfg.maxPrice / 1000).toFixed(0)}K) ---`);

    // Search with default sort + oldest-first
    let candidates: Listing[] = [];
    try {
      const [defaultResults, oldestResults] = await Promise.all([
        searchListings(cfg.city, cfg.province, {
          type: "house",
          beds: 3,
          minPrice: cfg.minPrice,
          maxPrice: cfg.maxPrice,
        }),
        searchListings(cfg.city, cfg.province, {
          type: "house",
          beds: 3,
          minPrice: cfg.minPrice,
          maxPrice: cfg.maxPrice,
          sortBy: "days-desc",
        }),
      ]);

      // Merge + dedup
      const seen = new Set<string>();
      for (const l of [...defaultResults, ...oldestResults]) {
        const key = l.mlsNumber || l.address;
        if (!seen.has(key)) {
          seen.add(key);
          candidates.push(l);
        }
      }
      console.log(`  Search: ${candidates.length} candidates`);
    } catch (err) {
      console.error(`  Search failed: ${err}`);
      summary.push({ city: cfg.city, province: cfg.province, count: 0 });
      continue;
    }

    if (candidates.length === 0) {
      console.log("  No results, skipping");
      summary.push({ city: cfg.city, province: cfg.province, count: 0 });
      continue;
    }

    // Take top 30 by DOM desc for detail fetch (need extras to hit target=25 after filtering)
    candidates.sort((a, b) => b.dom - a.dom);
    const toFetch = candidates.slice(0, 30);

    // Fetch details
    const detailed: Listing[] = [];
    for (const candidate of toFetch) {
      try {
        // Extract slug from URL path
        const urlPath = candidate.url?.replace("https://www.zoocasa.com", "") || "";
        const slug = urlPath.split("/").pop() || "";

        if (!slug) {
          console.log(`  Skip (no slug): ${candidate.address}`);
          continue;
        }

        const detail = await fetchDetail(candidate.address, cfg.city, cfg.province, slug);
        const listing = stripPrecomputed(detail.listing);

        // Use search URL if detail didn't produce one
        if (!listing.url && candidate.url) {
          listing.url = candidate.url;
        }

        // Carry over MLS from search if missing
        if (!listing.mlsNumber && candidate.mlsNumber) {
          listing.mlsNumber = candidate.mlsNumber;
        }

        // Use search address if detail didn't resolve one
        if (!listing.address && candidate.address) {
          listing.address = candidate.address;
        }

        detailed.push(listing);
        console.log(`  Detail: ${listing.address} | $${listing.price.toLocaleString()} | ${listing.dom}d | ${listing.sqft || "?"}sqft`);

        await sleep(1500);
      } catch (err) {
        console.log(`  Detail failed for ${candidate.address}: ${err}`);
      }
    }

    // Filter: prefer 1500+ sqft, relax if < target
    let filtered = detailed.filter((l) => {
      const sqft = parseInt(l.sqft) || 0;
      return sqft === 0 || sqft >= 1500;
    });
    if (filtered.length < cfg.target) {
      filtered = detailed; // relax sqft filter
    }

    // Sort by DOM desc (motivated sellers), take target count
    filtered.sort((a, b) => b.dom - a.dom);
    const picked = filtered.slice(0, cfg.target);

    // Pre-warm AB assessments
    if (cfg.province === "AB") {
      for (const l of picked) {
        try {
          const assessment = await lookupAB(l.address);
          if (assessment) {
            console.log(`  Assessment: ${l.address} → $${assessment.totalValue.toLocaleString()}`);
          }
        } catch {
          // Non-fatal
        }
      }
    }

    allListings.push(...picked);
    summary.push({ city: cfg.city, province: cfg.province, count: picked.length });
    console.log(`  Picked: ${picked.length} listings`);
  }

  console.log(`\n=== Flushing KV ===`);

  // Clear seen sets for all cities
  const allCities = [...new Set(CITIES.map((c) => c.city))];
  for (const city of allCities) {
    await clearSeen(city);
    console.log(`  Cleared seen:${city.toLowerCase().replace(/\s+/g, "-")}`);
  }

  // Purge stale slug keys from old listings
  const validSlugs = new Set(allListings.map((l) => slugify(l.address)));
  console.log(`\n=== Purging stale slug keys ===`);
  const purged = await purgeStaleSlugKeys(validSlugs);
  console.log(`  Purged ${purged} stale slug entries`);

  // Write all listings (this overwrites listings:all and all slug indexes)
  console.log(`\n=== Writing ${allListings.length} listings to KV ===`);
  const result = await writeAllListings(allListings);
  console.log(`  Written: ${result.written} listings, ${result.slugs} slug entries`);

  // Regenerate static listings.ts
  console.log(`\n=== Regenerating src/lib/data/listings.ts ===`);
  const listingsPath = path.join(__dirname, "../src/lib/data/listings.ts");
  const listingsCode = `import { Listing } from "../types";\n\nexport const PRELOADED_LISTINGS: Listing[] = ${JSON.stringify(allListings, null, 2)};\n`;
  writeFileSync(listingsPath, listingsCode);
  console.log(`  Wrote ${allListings.length} listings to static file`);

  // Print summary
  console.log(`\n=== Summary ===`);
  console.log(`Total: ${allListings.length} listings`);
  for (const s of summary) {
    console.log(`  ${s.city}, ${s.province}: ${s.count}`);
  }

  // Province breakdown
  const byProv = new Map<string, number>();
  for (const l of allListings) {
    byProv.set(l.province, (byProv.get(l.province) || 0) + 1);
  }
  console.log(`\nBy province:`);
  for (const [prov, count] of byProv) {
    console.log(`  ${prov}: ${count}`);
  }
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
