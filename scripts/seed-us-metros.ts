/**
 * Mass US Discover seeding with an explicit, owner-designated RentCast key.
 *
 * Usage:
 *   npx tsx scripts/seed-us-metros.ts --key=RENTCAST_API_KEY_3 --max=48 --commit
 *
 * Every sweep is one /listings/sale request. Spend is counted against the
 * designated key's OWN quota namespace (rentcast:{ns}:YYYY-MM where ns is
 * derived from the key name) — the production counter (rentcast:quota:*)
 * is never touched by this script, and its before/after values are printed
 * as proof. A full per-metro ledger prints as it runs. Hard-stops at --max.
 *
 * Order: the 3 original Discover metros first (restore), then the
 * US_METRO_FILL_QUEUE in rank order. Each swept metro is stamped
 * (last-refresh) and appended to the KV active-metro list so the cron takes
 * over maintenance afterward under its reserve-gated production budget.
 * Writes go through the floor-guarded merge path (additive, no force).
 */
import { loadEnvLocal } from "./lib/ingest-shared";
loadEnvLocal();

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"] as const;
  })
);

const KEY_NAME = args.get("key");
const MAX = Number(args.get("max") ?? 48);
const COMMIT = args.get("commit") === "true";

async function main() {
  if (!KEY_NAME) throw new Error("--key=<ENV_VAR_NAME> is required (e.g. --key=RENTCAST_API_KEY_3)");
  const apiKey = process.env[KEY_NAME];
  if (!apiKey) throw new Error(`env var ${KEY_NAME} not found`);
  if (!Number.isFinite(MAX) || MAX < 1) throw new Error("--max must be a positive number");
  const quotaNamespace = `quota-${KEY_NAME.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  const { getRentcastQuotaStatus } = await import("../src/lib/rentcast");
  const { fetchUSCityListings } = await import("../src/lib/pipeline/us-discover");
  const { US_DISCOVER_CITIES, US_METRO_FILL_QUEUE, getActiveUSDiscoverCities, activateNextQueuedMetro } = await import(
    "../src/lib/data/city-metadata"
  );
  const { getAllListings, writeAllListings, setMetaValue } = await import("../src/lib/kv/listings");
  const { buildUsListingDedupKey } = await import("../src/lib/pipeline/dedup");

  const prodBefore = await getRentcastQuotaStatus();
  console.log(`[seed] designated key: ${KEY_NAME} | namespace: ${quotaNamespace} | max sweeps: ${MAX} | commit: ${COMMIT}`);
  console.log(`[seed] PRODUCTION key counter before: ${prodBefore.used}/${prodBefore.limit} (must be unchanged at exit)`);

  // Restore originals first, then queue order; skip anything already active.
  const active = new Set((await getActiveUSDiscoverCities()).map((c) => c.slug));
  const plan = [
    ...US_DISCOVER_CITIES.filter((c) => !active.has(c.slug)),
    ...US_DISCOVER_CITIES.filter((c) => active.has(c.slug)), // originals re-sweep even if "active" (their data was wiped)
    ...US_METRO_FILL_QUEUE.filter((c) => !active.has(c.slug) && !US_DISCOVER_CITIES.some((o) => o.slug === c.slug)),
  ];
  // de-dupe plan by slug, preserve order
  const seen = new Set<string>();
  const ordered = plan.filter((c) => (seen.has(c.slug) ? false : (seen.add(c.slug), true)));

  console.log(`[seed] plan: up to ${Math.min(MAX, ordered.length)} metros of ${ordered.length} candidates`);
  let spent = 0;
  const ledger: { metro: string; fetched: number; stored: number; spentAfter: number }[] = [];
  const newListings: import("../src/lib/types").Listing[] = [];
  const sweptSlugs: string[] = [];

  for (const cfg of ordered) {
    if (spent >= MAX) break;
    const res = await fetchUSCityListings(cfg, { apiKeyOverride: apiKey, quotaNamespace });
    spent++; // one request per sweep (cache misses only; hits don't spend but count conservatively)
    ledger.push({ metro: `${cfg.name}, ${cfg.state}`, fetched: res.fetchedCount, stored: res.listings.length, spentAfter: spent });
    console.log(
      `[seed] ${String(spent).padStart(2)}/${MAX} ${cfg.name}, ${cfg.state}: fetched ${res.fetchedCount}, keeping ${res.listings.length}${res.droppedArtifacts ? ` (dropped ${res.droppedArtifacts} artifacts)` : ""}`
    );
    if (res.listings.length > 0) {
      newListings.push(...res.listings);
      sweptSlugs.push(cfg.slug);
    }
  }

  console.log(`\n[seed] sweeps done: ${spent} spent | ${newListings.length} listings across ${sweptSlugs.length} metros`);

  if (!COMMIT) {
    console.log("[seed] DRY RUN — no KV writes. Re-run with --commit to persist.");
  } else {
    const existing = await getAllListings();
    const newKeys = new Set(newListings.map((l) => buildUsListingDedupKey(l.address, l.city, l.province)));
    const kept = existing.filter((l) => !newKeys.has(buildUsListingDedupKey(l.address, l.city, l.province)));
    const merged = [...kept, ...newListings];
    const result = await writeAllListings(merged);
    if (result.refused) throw new Error(`floor guard refused: ${result.refusedReason}`);
    console.log(`[seed] KV write: ${result.written} listings (${kept.length} kept + ${newListings.length} new)`);

    // Round-trip verify
    const check = await getAllListings();
    if (!Array.isArray(check) || check.length !== merged.length) {
      throw new Error(`round-trip mismatch: wrote ${merged.length}, read ${Array.isArray(check) ? check.length : typeof check}`);
    }
    console.log(`[seed] round-trip verified: ${check.length} listings`);

    // Stamp refreshes + activate swept metros so cron maintenance takes over
    const now = String(Date.now());
    for (const slug of sweptSlugs) {
      await setMetaValue(`us-discover:last-refresh:${slug}`, now);
    }
    // Activate queue metros up to what we swept (activateNextQueuedMetro is
    // order-preserving; call until every swept slug is active)
    let guard = 0;
    while (guard++ < 100) {
      const activeNow = new Set((await getActiveUSDiscoverCities()).map((c) => c.slug));
      const missing = sweptSlugs.filter((s) => !activeNow.has(s));
      if (missing.length === 0) break;
      const next = await activateNextQueuedMetro();
      if (!next) break;
    }
    console.log(`[seed] active metros stamped: ${sweptSlugs.length}`);
  }

  const prodAfter = await getRentcastQuotaStatus();
  console.log(`\n[seed] PRODUCTION key counter after: ${prodAfter.used}/${prodAfter.limit} ${prodAfter.used === prodBefore.used ? "(UNCHANGED — proof)" : "(!!! CHANGED — investigate)"}`);
  console.log(`[seed] ledger:`);
  for (const row of ledger) console.log(`  ${row.metro.padEnd(28)} fetched ${String(row.fetched).padStart(3)} stored ${String(row.stored).padStart(3)} (spend ${row.spentAfter})`);
  if (prodAfter.used !== prodBefore.used) process.exit(1);
}

main().catch((err) => {
  console.error("[seed] FAILED:", err);
  process.exit(1);
});
