/**
 * One-shot budget-aware enrichment run for the already-seeded US Discover
 * listings (Austin/Miami/Phoenix — see US_DISCOVER_CITIES in
 * src/lib/data/city-metadata.ts). Reads whatever's already in KV (seeded by
 * refreshUSDiscover()'s /listings/sale sweep), picks the top N
 * (US_ENRICH_TOP_N, default 3) listings per city by preScore, and runs
 * enrichUSListing() against each — 2 RentCast requests/listing on a cache
 * miss (record + AVM via getUSPropertyLite; the rent call is skipped
 * entirely to save quota — see us-enrich.ts's module doc), quota-guarded
 * exactly like every other RentCast caller in this codebase (rentcast.ts's
 * cachedRentcastCall).
 *
 * This does NOT re-run the /listings/sale city sweep (refreshUSDiscover()
 * does that, gated by US_DISCOVER_REFRESH_DAYS) — it only enriches listings
 * already sitting in KV, so a re-run within the cadence window costs
 * nothing extra beyond the enrichment calls themselves.
 *
 * Usage:
 *   npx tsx scripts/enrich-us-listings.ts [--top=3] [--cities=austin,miami,phoenix] [--dry-run]
 *
 * --dry-run prints the same report but skips the final writeAllListings.
 * NOTE: this does NOT avoid RentCast spend — the record/AVM calls inside
 * enrichUSCityListings() still happen (and get cached) on a dry run; only
 * the KV write is skipped. Re-running without --dry-run immediately after
 * a dry run costs ~0 additional RentCast requests (cache hits on the same
 * addresses) and persists the same results.
 */

import { loadEnvLocal } from "./lib/ingest-shared";
loadEnvLocal();

async function main() {
  const { getAllListings, writeAllListings } = await import("../src/lib/kv/listings");
  const { US_DISCOVER_CITIES } = await import("../src/lib/data/city-metadata");
  const { enrichUSCityListings, usEnrichTopN } = await import("../src/lib/pipeline/us-enrich");
  const { getRentcastQuotaStatus } = await import("../src/lib/rentcast");
  const { fmt } = await import("../src/lib/utils");

  const topArg = process.argv.find((a) => a.startsWith("--top="));
  const top = topArg ? Number(topArg.split("=")[1]) : usEnrichTopN();

  const citiesArg = process.argv.find((a) => a.startsWith("--cities="));
  const citySlugFilter = citiesArg ? new Set(citiesArg.split("=")[1].split(",")) : null;

  const dryRun = process.argv.includes("--dry-run");

  const cities = citySlugFilter ? US_DISCOVER_CITIES.filter((c) => citySlugFilter.has(c.slug)) : US_DISCOVER_CITIES;

  const quotaBefore = await getRentcastQuotaStatus();
  console.log(`RentCast quota before: ${quotaBefore.used}/${quotaBefore.limit} (persisted in KV: ${quotaBefore.persistedInKv})`);
  console.log(`Enriching top ${top} listing(s) per city across ${cities.map((c) => c.name).join(", ")}...${dryRun ? " [DRY RUN — no KV write]" : ""}\n`);

  const all = await getAllListings();

  let totalAttempted = 0;
  let totalSucceeded = 0;

  interface Row {
    city: string;
    address: string;
    status: string;
    assessed: string;
    yearBuilt: string;
    taxes: string;
    narrativeChars: number;
  }
  const rows: Row[] = [];

  for (const cfg of cities) {
    const cityListings = all.filter((l) => l.city === cfg.name && l.province === cfg.state);
    if (cityListings.length === 0) {
      console.log(`${cfg.name}, ${cfg.state}: no listings in KV — run the US Discover refresh first. Skipping.`);
      continue;
    }

    const result = await enrichUSCityListings(cityListings, cfg, { top });
    totalAttempted += result.attempted;
    totalSucceeded += result.succeeded;

    // Merge enriched listings back into the full array.
    const byAddr = new Map(result.listings.map((l) => [l.address, l]));
    for (let i = 0; i < all.length; i++) {
      if (all[i].city === cfg.name && all[i].province === cfg.state) {
        const updated = byAddr.get(all[i].address);
        if (updated) all[i] = updated;
      }
    }

    for (const d of result.details) {
      rows.push({
        city: `${cfg.name}, ${cfg.state}`,
        address: d.listing.address,
        status: d.enriched ? "enriched" : `SKIPPED (${d.reason})`,
        assessed: d.assessedValue != null ? `Y (${fmt(d.assessedValue)})` : "N",
        yearBuilt: d.listing.yearBuilt || "—",
        taxes: d.listing.taxes ? `$${d.listing.taxes}` : "—",
        narrativeChars: d.narrativeChars,
      });
    }

    if (result.quotaStoppedEarly) {
      console.log(`  [${cfg.name}] RentCast quota exhausted mid-run — stopped enriching gracefully, remaining candidates stay sparse.`);
    }
    if (result.attempted === 0) {
      console.log(`  [${cfg.name}] Nothing attempted (0 candidates or quota already exhausted before this city).`);
    }
    if (result.succeeded < result.attempted) {
      console.log(`  [${cfg.name}] ${result.attempted - result.succeeded} of ${result.attempted} attempted listing(s) returned no usable RentCast record/AVM (e.g. new construction or an unindexed condo unit).`);
    }
  }

  console.log("\n--- Enrichment results ---");
  console.log(
    `${"STATUS".padEnd(22)} ${"CITY".padEnd(15)} ${"ADDRESS".padEnd(30)} ${"ASSESSED".padEnd(20)} ${"BUILT".padEnd(7)} ${"TAXES".padEnd(9)} NARRATIVE`
  );
  for (const r of rows) {
    console.log(
      `${r.status.padEnd(22)} ${r.city.padEnd(15)} ${r.address.padEnd(30)} ${r.assessed.padEnd(20)} ${r.yearBuilt.padEnd(7)} ${r.taxes.padEnd(9)} ${r.narrativeChars}chars`
    );
  }

  const quotaAfter = await getRentcastQuotaStatus();
  console.log(`\nRentCast quota after: ${quotaAfter.used}/${quotaAfter.limit} (spent ${quotaAfter.used - quotaBefore.used} this run)`);
  console.log(`Attempted: ${totalAttempted}, Succeeded: ${totalSucceeded}`);

  if (dryRun) {
    console.log("\n[DRY RUN] Not writing to KV.");
    return;
  }

  if (totalSucceeded > 0) {
    await writeAllListings(all);
    console.log("\nWrote updated listings to KV.");
  } else {
    console.log("\nNothing enriched — no KV write needed.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
