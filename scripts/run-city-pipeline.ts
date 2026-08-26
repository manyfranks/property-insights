/**
 * Runs the CA cron pipeline's fetch/enrich/write stages (src/app/api/pipeline
 * /refresh/route.ts) for a SINGLE city, locally, with no serverless time
 * budget. Built for onboarding a brand-new city (Winnipeg — see
 * src/app/api/pipeline/refresh/route.ts's CITIES entry) where the cron's own
 * 300s maxDuration would otherwise have to share time across all 11 cities
 * on its first-ever run for that city.
 *
 * Deliberately a trimmed mirror of the route's per-city logic, not a shared
 * import from it: the route isn't structured as a reusable per-city
 * function (its 9 phases operate across all cities at once for the global
 * freshness-check parallelism), and refactoring it to extract one wasn't in
 * scope here — see the route's own phase comments for the full-fleet
 * version this approximates.
 *
 * Usage:
 *   npx tsx scripts/run-city-pipeline.ts "Winnipeg" "MB" 300000 650000 25
 *          city              province  minPrice maxPrice target
 */
import { readFileSync } from "fs";
const envContent = readFileSync(".env.local", "utf-8");
for (const line of envContent.split("\n")) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, "");
}

import { searchListings, fetchDetailByUrl, fetchSoldListings } from "../src/lib/zoocasa";
import { getAllListings, writeAllListings, getListingBySlug, purgeStaleSlugKeys } from "../src/lib/kv/listings";
import { enrichListing } from "../src/lib/pipeline/enrich";
import { slugify } from "../src/lib/utils";
import { Listing } from "../src/lib/types";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const [city, province, minPriceStr, maxPriceStr, targetStr] = process.argv.slice(2);
  if (!city || !province) {
    console.error('Usage: npx tsx scripts/run-city-pipeline.ts "City" "PROV" [minPrice] [maxPrice] [target]');
    process.exit(1);
  }
  const minPrice = Number(minPriceStr) || 0;
  const maxPrice = Number(maxPriceStr) || 10_000_000;
  const target = Number(targetStr) || 25;

  console.log(`=== Single-city pipeline: ${city}, ${province} (target ${target}, $${minPrice}-$${maxPrice}) ===\n`);

  // Phase 1: search (default + oldest-first, dedup) — mirrors refresh route.
  //
  // Retried up to 5x on an empty result: Zoocasa's subdivision-scoped search
  // intermittently hits the documented province-wide-fallback regression
  // (zoocasa.ts's citiesMatch doc comment) and returns 0 candidates on some
  // requests even though the market has real inventory — the production
  // cron already tolerates this via its two-search-variant dedup plus daily
  // reruns; a one-time onboarding script needs an explicit retry instead
  // since there's no "tomorrow's run" to fall back on.
  let candidates: Listing[] = [];
  let defaultResults: Listing[] = [];
  let oldestResults: Listing[] = [];
  for (let attempt = 1; attempt <= 5 && candidates.length === 0; attempt++) {
    [defaultResults, oldestResults] = await Promise.all([
      searchListings(city, province, { type: "house", beds: 3, minPrice, maxPrice }),
      searchListings(city, province, { type: "house", beds: 3, minPrice, maxPrice, sortBy: "days-desc" }),
    ]);
    const seen = new Set<string>();
    for (const l of [...defaultResults, ...oldestResults]) {
      const key = l.mlsNumber || l.address;
      if (!seen.has(key)) {
        seen.add(key);
        candidates.push(l);
      }
    }
    if (candidates.length === 0) {
      console.log(`  attempt ${attempt}/5: 0 candidates (likely the province-wide-fallback regression) — retrying...`);
      await sleep(2000);
    }
  }
  console.log(`Search: ${defaultResults.length} default + ${oldestResults.length} oldest-first -> ${candidates.length} unique candidates`);
  if (candidates.length === 0) {
    console.error("No candidates found after 5 attempts — aborting without writing anything.");
    process.exit(1);
  }
  candidates.sort((a, b) => b.dom - a.dom);

  // Phase 2: detail fetch, up to target (+5 buffer, capped at 30 — mirrors route).
  //
  // Winnipeg-specific finding (live probe, 2026-08-08): Zoocasa's SEARCH
  // index returns real, correctly-scoped Winnipeg listings, but every
  // sampled Winnipeg listing's DETAIL page 307-redirects to the homepage
  // (confirmed via x-debug-address-route: redirected on Zoocasa's own edge
  // response headers — a routing gap on Zoocasa's side between their search
  // index and their address-route resolver for this market, not something
  // fixable by URL construction on our end; 10/10 sampled listings failed
  // identically across repeated live checks). fetchDetailByUrl(candidate.url)
  // is tried first (more robust than fetchDetail's slug-guessing — it hits
  // the literal search-result URL rather than reconstructing one), but on
  // failure this falls back to the CANDIDATE itself (already a shape-valid
  // Listing from searchListings — see zoocasa.ts's listingShapeIssues) rather
  // than skipping the listing outright. The candidate is missing description/
  // taxes/yearBuilt/lotSize (search results never carry those — only detail
  // pages do), so keyword-based motivation signals won't fire and those
  // property-fact fields render "N/A" — the same graceful-degradation shape
  // the property page already has for any listing with sparse data, not a
  // new failure mode.
  const toFetch = candidates.slice(0, Math.min(target + 5, 30));
  const detailed: Listing[] = [];
  let detailFetchFailures = 0;
  console.log(`\nFetching detail for ${toFetch.length} candidates...`);
  for (const candidate of toFetch) {
    if (detailed.length >= target) break;
    try {
      if (!candidate.url) throw new Error("no url on search result");
      const detail = await fetchDetailByUrl(candidate.url);
      const listing = detail.listing;
      if (!listing.url && candidate.url) listing.url = candidate.url;
      if (!listing.mlsNumber && candidate.mlsNumber) listing.mlsNumber = candidate.mlsNumber;
      if (!listing.address && candidate.address) listing.address = candidate.address;
      detailed.push(listing);
      console.log(`  [${detailed.length}/${target}] ${listing.address} — $${listing.price.toLocaleString()}, ${listing.dom}d (detail)`);
      await sleep(500);
    } catch (err) {
      detailFetchFailures++;
      console.log(`  detail fetch failed for ${candidate.address} (${err instanceof Error ? err.message : err}) — using search-result data`);
      detailed.push(candidate);
      console.log(`  [${detailed.length}/${target}] ${candidate.address} — $${candidate.price.toLocaleString()}, ${candidate.dom}d (search-only)`);
    }
  }
  if (detailFetchFailures > 0) {
    console.log(`\nNote: ${detailFetchFailures}/${toFetch.length} listings used search-result data only (detail page unreachable).`);
  }

  // Prefer 1500+ sqft, relax if it would drop us below target (mirrors route).
  let filtered = detailed.filter((l) => {
    const sqft = parseInt(l.sqft) || 0;
    return sqft === 0 || sqft >= 1500;
  });
  if (filtered.length < target) filtered = detailed;
  filtered.sort((a, b) => b.dom - a.dom);
  const picked = filtered.slice(0, target);
  console.log(`\nPicked ${picked.length} listings for enrichment.`);

  // Phase 3: sold pool for comparables.
  console.log(`\nFetching sold pool for ${city}, ${province}...`);
  const soldPool = await fetchSoldListings(city, province).catch(() => []);
  console.log(`  ${soldPool.length} sold listings`);

  // Phase 4: enrich (full async pipeline — assessment, scoring, offer, LLM narrative).
  console.log(`\nEnriching ${picked.length} listings...`);
  const enriched: Listing[] = [];
  for (let i = 0; i < picked.length; i++) {
    const listing = picked[i];
    try {
      const result = await enrichListing(listing, { soldPool });
      result.source = "cron";
      result.enrichedAt = new Date().toISOString();
      enriched.push(result);
      console.log(`  [${i + 1}/${picked.length}] ${result.address}: tier=${result.preTier} score=${result.preScore}`);
    } catch (err) {
      console.log(`  [${i + 1}/${picked.length}] enrich failed for ${listing.address}: ${err instanceof Error ? err.message : err} — falling back to deterministic`);
      const result = await enrichListing(listing, { skipLlm: true, soldPool });
      result.source = "cron";
      result.enrichedAt = new Date().toISOString();
      enriched.push(result);
    }
    await sleep(1200);
  }

  // Phase 5: merge with existing KV listings (replace this city's slice, keep everyone else) + write.
  console.log(`\nMerging with existing KV listings...`);
  const existing = await getAllListings();
  const cityLower = city.toLowerCase();
  const others = existing.filter((l) => l.city.toLowerCase() !== cityLower);
  const allListings = [...others, ...enriched];
  console.log(`  ${existing.length} existing total, ${existing.length - others.length} old ${city} listings replaced, ${allListings.length} total after merge`);

  const validSlugs = new Set(allListings.map((l) => slugify(l.address)));
  const purged = await purgeStaleSlugKeys(validSlugs);
  const result = await writeAllListings(allListings);
  console.log(`  KV write: ${result.written} listings, ${result.slugs} slugs, ${purged} purged`);

  // Verify: round-trip read back one of the newly-written listings.
  if (enriched.length > 0) {
    const sampleSlug = slugify(enriched[0].address);
    const lookup = await getListingBySlug(sampleSlug);
    const readBack = lookup.status === "found" ? lookup.listing : null;
    console.log(`\nRound-trip verify (slug "${sampleSlug}", status=${lookup.status}):`);
    if (readBack && readBack.city.toLowerCase() === cityLower && readBack.preNarrative) {
      console.log(`  OK — found, city=${readBack.city}, province=${readBack.province}, tier=${readBack.preTier}, narrative present (${readBack.preNarrative.length} chars)`);
    } else {
      console.log(`  MISMATCH — readBack=${JSON.stringify(readBack ? { city: readBack.city, province: readBack.province, hasNarrative: !!readBack.preNarrative } : null)}`);
    }
  }

  console.log(`\n=== Done: ${enriched.length} ${city} listings enriched and written to KV ===`);
}

main().catch((err) => {
  console.error("run-city-pipeline failed:", err);
  process.exit(1);
});
