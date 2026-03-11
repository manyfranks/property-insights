/**
 * One-time bootstrap: re-enrich all KV listings with full async assessments.
 *
 * Uses the production enrichListing pipeline (async assessment, comparables,
 * scoring, offer model, LLM narrative). No timeout constraint — runs locally.
 *
 * Tags all listings with source + enrichedAt so the daily cron recognizes them.
 *
 * Usage: npx tsx scripts/bootstrap-enrich.ts [--skip-enriched] [--city=X]
 *
 * Requires KV_REST_API_URL, KV_REST_API_TOKEN, OPENROUTER_API_KEY in .env.local
 */

import { readFileSync } from "fs";

// Load .env.local
const envContent = readFileSync(".env.local", "utf-8");
for (const line of envContent.split("\n")) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, "");
}

import { getAllListings, writeAllListings } from "../src/lib/kv/listings";
import { enrichListing } from "../src/lib/pipeline/enrich";
import { fetchSoldListings, ZoocasaSoldRaw } from "../src/lib/zoocasa";
import { Listing } from "../src/lib/types";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const args = process.argv.slice(2);
const skipEnriched = args.includes("--skip-enriched");
const cityFilter = args.find((a) => a.startsWith("--city="))?.split("=")[1];

async function main() {
  console.log("=== Bootstrap Enrichment (full async pipeline) ===\n");

  const listings = await getAllListings();
  console.log(`Loaded ${listings.length} listings from KV`);
  if (cityFilter) console.log(`Filtering to city: ${cityFilter}`);
  if (skipEnriched) console.log(`Skipping already-enriched listings`);

  // Group by city|province for sold pool fetching
  const byCityKey = new Map<string, Listing[]>();
  for (const l of listings) {
    const key = `${l.city.toLowerCase()}|${l.province.toLowerCase()}`;
    if (!byCityKey.has(key)) byCityKey.set(key, []);
    byCityKey.get(key)!.push(l);
  }

  // Fetch sold pools per city (parallel)
  console.log(`\nFetching sold pools for ${byCityKey.size} cities...`);
  const soldPools = new Map<string, ZoocasaSoldRaw[]>();
  const poolEntries = await Promise.allSettled(
    [...byCityKey.keys()].map(async (key) => {
      const [city, province] = key.split("|");
      const pool = await fetchSoldListings(city, province);
      return { key, city, pool };
    })
  );
  for (const entry of poolEntries) {
    if (entry.status === "fulfilled") {
      soldPools.set(entry.value.key, entry.value.pool);
      console.log(`  ${entry.value.city}: ${entry.value.pool.length} sold`);
    } else {
      console.log(`  failed: ${entry.reason}`);
    }
  }

  // Enrich each listing
  let enriched = 0;
  let skipped = 0;
  let failed = 0;
  const startTime = Date.now();

  for (let i = 0; i < listings.length; i++) {
    const listing = listings[i];

    if (cityFilter && listing.city.toLowerCase() !== cityFilter.toLowerCase()) {
      skipped++;
      continue;
    }

    if (skipEnriched && listing.preNarrative && listing.enrichedAt) {
      skipped++;
      continue;
    }

    const cityKey = `${listing.city.toLowerCase()}|${listing.province.toLowerCase()}`;
    const pool = soldPools.get(cityKey);
    const source = listing.source || (
      ["victoria", "saanich", "langford", "vancouver", "surrey", "calgary", "edmonton", "toronto", "hamilton", "ottawa"]
        .includes(listing.city.toLowerCase()) ? "cron" : "user"
    );

    console.log(`\n[${i + 1}/${listings.length}] ${listing.address}, ${listing.city} (${source})`);

    try {
      // Strip pre-computed fields for clean re-enrichment
      const clean = { ...listing };
      delete (clean as unknown as Record<string, unknown>).preScore;
      delete (clean as unknown as Record<string, unknown>).preTier;
      delete (clean as unknown as Record<string, unknown>).preSignals;
      delete (clean as unknown as Record<string, unknown>).preNarrative;
      delete (clean as unknown as Record<string, unknown>).preOffer;
      delete (clean as unknown as Record<string, unknown>).preAssessment;
      delete (clean as unknown as Record<string, unknown>).preComparables;
      delete (clean as unknown as Record<string, unknown>).assessmentNote;

      // Full pipeline: async assessment, comparables, scoring, offer, LLM
      const result = await enrichListing(clean, {
        soldPool: pool,
        // User-sourced listings always get LLM (even WATCH)
        ...(source === "user" ? { forceLlm: true } : {}),
      });

      result.source = source;
      result.enrichedAt = new Date().toISOString();
      listings[i] = result;
      enriched++;

      console.log(`  ✓ ${result.preTier} (${result.preScore}pts) | ${result.preAssessment ? "assessed" : "no assessment"} | comps: ${result.preComparables?.confidence || "none"}`);

      // Rate limit: 2s between listings to avoid hammering BC Assessment / LLM
      await sleep(2000);
    } catch (err) {
      console.log(`  ✗ FAILED: ${err instanceof Error ? err.message : String(err)}`);
      // Tag source/enrichedAt even on failure so cron doesn't destroy it
      listings[i].source = source;
      listings[i].enrichedAt = listings[i].enrichedAt || new Date().toISOString();
      failed++;
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log(`\n=== Writing ${listings.length} listings to KV ===`);
  const writeResult = await writeAllListings(listings);
  console.log(`Written: ${writeResult.written} listings, ${writeResult.slugs} slug entries`);

  // Summary
  console.log(`\n=== Summary (${elapsed}s) ===`);
  console.log(`Enriched: ${enriched}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Failed: ${failed}`);

  const byTier = new Map<string, number>();
  const bySource = { cron: 0, user: 0 };
  for (const l of listings) {
    byTier.set(l.preTier || "none", (byTier.get(l.preTier || "none") || 0) + 1);
    if (l.source === "user") bySource.user++;
    else bySource.cron++;
  }
  console.log(`\nBy tier: ${[...byTier].map(([t, c]) => `${t}=${c}`).join(", ")}`);
  console.log(`By source: cron=${bySource.cron}, user=${bySource.user}`);
}

main().catch((err) => {
  console.error("Bootstrap failed:", err);
  process.exit(1);
});
