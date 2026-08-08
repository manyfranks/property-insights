/**
 * scripts/reseed-us-discover.ts
 *
 * Full reseed of the 3 US Discover metros (Austin/TX, Miami/FL, Phoenix/AZ)
 * through the FIXED pipeline (rentcast.ts TTL alignment + us-discover.ts
 * freshness gate — see those files' doc comments). The current KV state for
 * these cities was seeded ad hoc (last-refresh meta shows "never" despite
 * listings existing — a manual/dev seed, not the real cadence-gated cron
 * path), so this does a clean full-city replace rather than an incremental
 * patch:
 *
 *   1. Snapshot "before" counts per city (cron-sourced listings only —
 *      user-searched addresses in these cities, source:"user", are real
 *      /assess history and are left untouched).
 *   2. Purge those cron-sourced listings for the 3 cities via a single
 *      writeAllListings() call through the app's own store (NEVER a raw REST
 *      write — see kv/listings.ts's module doc on the past incident), then
 *      round-trip verify via getAllListings().
 *   3. refreshUSDiscover() — exactly 3 RentCast requests (1 city-wide
 *      /listings/sale call per metro; none are skipped since their
 *      last-refresh meta is "never"). Runs the NEW freshness gate
 *      (isLikelyPlaceholderArtifact in us-discover.ts) and primes the
 *      per-address listing cache with the NEW longer TTL
 *      (listingCacheTtlSeconds — refresh cadence + 1 day buffer) so every
 *      seeded listing is a guaranteed cache hit for /assess until the next
 *      sweep.
 *   4. Re-run scripts/enrich-us-from-assessors.ts --commit (free — county
 *      open-data, zero RentCast quota) to re-attach yearBuilt/lotSize/taxes/
 *      preAssessment from county assessor records.
 *   5. Snapshot "after" counts, round-trip verify again, print a full
 *      before/after/dropped report plus quota spent.
 *
 * Usage: npx tsx scripts/reseed-us-discover.ts
 */
import { loadEnvLocal } from "./lib/ingest-shared";
import { execFileSync } from "node:child_process";

loadEnvLocal();

const US_CITIES: { name: string; state: string }[] = [
  { name: "Austin", state: "TX" },
  { name: "Miami", state: "FL" },
  { name: "Phoenix", state: "AZ" },
];

function cityCounts(listings: import("../src/lib/types").Listing[]) {
  const counts: Record<string, number> = {};
  for (const cfg of US_CITIES) {
    counts[`${cfg.name}, ${cfg.state}`] = listings.filter(
      (l) => l.city === cfg.name && l.province === cfg.state && l.source === "cron"
    ).length;
  }
  return counts;
}

async function main() {
  const { getAllListings, writeAllListings } = await import("../src/lib/kv/listings");
  const { refreshUSDiscover } = await import("../src/lib/pipeline/us-discover");
  const { getRentcastQuotaStatus } = await import("../src/lib/rentcast");

  const quotaBefore = await getRentcastQuotaStatus();
  console.log("Quota before reseed:", quotaBefore);

  const before = await getAllListings();
  const beforeCounts = cityCounts(before);
  console.log("\n=== BEFORE (cron-sourced, per city) ===");
  console.log(beforeCounts);
  console.log(`Total listings in KV before: ${before.length}`);

  // Step 2 — purge cron-sourced listings for the 3 target cities. Leaves
  // everything else (CA listings, other US cities/states, any user-sourced
  // /assess history in these 3 cities) untouched.
  const isTargetCron = (l: (typeof before)[number]) =>
    l.source === "cron" && US_CITIES.some((c) => l.city === c.name && l.province === c.state);
  const kept = before.filter((l) => !isTargetCron(l));
  const purged = before.length - kept.length;
  console.log(`\nPurging ${purged} cron-sourced listings from the 3 target cities...`);
  const { written } = await writeAllListings(kept);
  const afterPurge = await getAllListings();
  if (!Array.isArray(afterPurge) || afterPurge.length !== written) {
    throw new Error(
      `round-trip verification FAILED after purge: expected ${written}, got ${
        Array.isArray(afterPurge) ? afterPurge.length : typeof afterPurge
      }`
    );
  }
  console.log(`Purge OK — round-trip verified: ${afterPurge.length} listings in KV.`);

  // Step 3 — 3 RentCast requests (1 per city; none skipped, all last-refresh
  // meta reads "never").
  console.log("\n=== Running refreshUSDiscover() — 3 RentCast requests ===");
  const refreshResult = await refreshUSDiscover();
  console.log(JSON.stringify(refreshResult, null, 2));

  const quotaAfterRefresh = await getRentcastQuotaStatus();
  console.log("\nQuota after refresh:", quotaAfterRefresh);

  // Step 4 — free county-assessor enrichment, re-attach assessed values.
  console.log("\n=== Running scripts/enrich-us-from-assessors.ts --commit (free) ===");
  try {
    const output = execFileSync("npx", ["tsx", "scripts/enrich-us-from-assessors.ts", "--commit"], {
      encoding: "utf-8",
      stdio: "pipe",
      maxBuffer: 20 * 1024 * 1024,
    });
    console.log(output);
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    console.error("enrich-us-from-assessors failed:", e.stdout, e.stderr, e.message);
  }

  // Step 5 — after snapshot + round-trip verify.
  const after = await getAllListings();
  const afterCounts = cityCounts(after);
  console.log("\n=== AFTER (cron-sourced, per city) ===");
  console.log(afterCounts);
  console.log(`Total listings in KV after: ${after.length}`);

  const cedar = after.find((l) => l.address === "12400 Cedar St" && l.city === "Austin");
  console.log("\n12400 Cedar St disposition:", cedar ? "PRESENT (survived freshness gate)" : "ABSENT (dropped or not re-discovered)");
  if (cedar) console.log(JSON.stringify({ address: cedar.address, dom: cedar.dom, price: cedar.price, source: cedar.source }, null, 2));

  const quotaFinal = await getRentcastQuotaStatus();
  console.log("\nFinal quota status:", quotaFinal);

  console.log("\n=== SUMMARY ===");
  for (const cfg of US_CITIES) {
    const key = `${cfg.name}, ${cfg.state}`;
    console.log(`${key}: before=${beforeCounts[key]} after=${afterCounts[key]}`);
  }
}

main().catch((err) => {
  console.error("[reseed-us-discover] fatal:", err);
  process.exit(1);
});
