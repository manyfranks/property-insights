/**
 * GET /api/pipeline/freshness
 *
 * Checks all stored listings for freshness by checking Zoocasa.
 * A 404 or missingAddress redirect = listing is sold/delisted = dead.
 *
 * Strategy:
 * - Fetches all listings from KV
 * - Checks each against Zoocasa (batched with concurrency limit)
 * - Dead listings are auto-pruned from KV
 * - Also detects and prunes duplicate addresses
 *
 * Designed to be called by Vercel Cron (weekly) or manually.
 */

import { NextResponse } from "next/server";
import { getAllListings, removeListings } from "@/lib/kv/listings";
import { checkFreshness } from "@/lib/zoocasa";

export const maxDuration = 60;

/** Check listings in batches with concurrency limit */
async function checkBatch(
  listings: { address: string; city: string; province: string }[],
  concurrency: number
): Promise<Map<string, "live" | "dead" | "unknown">> {
  const results = new Map<string, "live" | "dead" | "unknown">();
  const queue = [...listings];

  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;
      const status = await checkFreshness(item.address, item.city, item.province);
      results.set(item.address, status);
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function GET(request: Request) {
  // Verify cron secret — always required
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const listings = await getAllListings();

  // Check for duplicates
  const addressCount = new Map<string, number>();
  for (const l of listings) {
    addressCount.set(l.address, (addressCount.get(l.address) ?? 0) + 1);
  }
  const duplicates = Array.from(addressCount.entries())
    .filter(([, count]) => count > 1)
    .map(([address, count]) => ({ address, count }));

  // Check freshness — batch up to 40 listings per run to stay within 60s
  // Rotate through listings based on the current week
  const weekNum = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
  const batchSize = 40;
  const batchStart = (weekNum * batchSize) % listings.length;
  const toCheck: typeof listings = [];
  for (let i = 0; i < Math.min(batchSize, listings.length); i++) {
    toCheck.push(listings[(batchStart + i) % listings.length]);
  }

  const freshnessMap = await checkBatch(toCheck, 6);

  const results = listings.map((l) => ({
    address: l.address,
    city: l.city,
    province: l.province,
    url: l.url,
    mlsNumber: l.mlsNumber || "",
    status: freshnessMap.get(l.address) ?? ("unchecked" as const),
  }));

  const live = results.filter((r) => r.status === "live");
  const dead = results.filter((r) => r.status === "dead");
  const unknown = results.filter((r) => r.status === "unknown");
  const unchecked = results.filter((r) => r.status === "unchecked");

  // Auto-prune dead listings from KV
  let pruned = 0;
  if (dead.length > 0) {
    try {
      pruned = await removeListings(dead.map((d) => d.address));
    } catch {
      // KV not available or write failed
    }
  }

  // Auto-prune duplicates (keep first occurrence)
  let dedupPruned = 0;
  if (duplicates.length > 0) {
    const seen = new Set<string>();
    const hasDupes = listings.some((l) => {
      if (seen.has(l.address)) return true;
      seen.add(l.address);
      return false;
    });
    if (hasDupes) {
      try {
        const unique = listings.filter(
          (l, i) => listings.findIndex((x) => x.address === l.address) === i
        );
        const { writeAllListings } = await import("@/lib/kv/listings");
        await writeAllListings(unique);
        dedupPruned = listings.length - unique.length;
      } catch {
        // KV not available
      }
    }
  }

  return NextResponse.json({
    total: listings.length,
    checked: toCheck.length,
    live: live.length,
    dead: dead.length,
    unknown: unknown.length,
    unchecked: unchecked.length,
    duplicates: duplicates.length,
    pruned,
    dedupPruned,
    deadListings: dead.map((d) => ({
      address: d.address,
      city: d.city,
      province: d.province,
      url: d.url,
      mlsNumber: d.mlsNumber,
    })),
    duplicateListings: duplicates,
    checkedAt: new Date().toISOString(),
  });
}
