/**
 * GET /api/pipeline/freshness
 *
 * Checks all preloaded listings for freshness:
 * - HEAD request to each listing URL to detect 404 (delisted/sold)
 * - Reports stale listings that should be removed
 * - Reports duplicate addresses
 *
 * Designed to be called by Vercel Cron (weekly) or manually.
 *
 * RESPONSE:
 * {
 *   total, live, dead, duplicates,
 *   deadListings: [{ address, city, province, url }],
 *   duplicateListings: [{ address, count }],
 *   checkedAt
 * }
 */

import { NextResponse } from "next/server";
import { getAllListings, removeListings } from "@/lib/kv/listings";

export const maxDuration = 60; // Allow up to 60s for all HEAD requests

async function checkUrl(url: string): Promise<number> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
    });
    return res.status;
  } catch {
    return 0; // Network error / timeout
  }
}

export async function GET() {
  const listings = await getAllListings();

  // Check for duplicates
  const addressCount = new Map<string, number>();
  for (const l of listings) {
    addressCount.set(l.address, (addressCount.get(l.address) ?? 0) + 1);
  }
  const duplicates = Array.from(addressCount.entries())
    .filter(([, count]) => count > 1)
    .map(([address, count]) => ({ address, count }));

  // Check listing URLs in parallel batches
  const batchSize = 10;
  const results: { address: string; city: string; province: string; url: string; status: number }[] = [];

  for (let i = 0; i < listings.length; i += batchSize) {
    const batch = listings.slice(i, i + batchSize);
    const statuses = await Promise.all(batch.map((l) => checkUrl(l.url)));

    for (let j = 0; j < batch.length; j++) {
      results.push({
        address: batch[j].address,
        city: batch[j].city,
        province: batch[j].province,
        url: batch[j].url,
        status: statuses[j],
      });
    }
  }

  const live = results.filter((r) => r.status === 200);
  const dead = results.filter((r) => r.status === 404);
  const errors = results.filter((r) => r.status !== 200 && r.status !== 404);

  // Auto-prune dead listings from KV
  let pruned = 0;
  if (dead.length > 0) {
    try {
      pruned = await removeListings(dead.map((d) => d.address));
    } catch {
      // KV not available or write failed — report but don't crash
    }
  }

  // Auto-prune duplicates (keep first occurrence)
  let dedupPruned = 0;
  if (duplicates.length > 0) {
    const dupeAddresses: string[] = [];
    const seen = new Set<string>();
    for (const l of listings) {
      if (seen.has(l.address)) {
        dupeAddresses.push(l.address);
      } else {
        seen.add(l.address);
      }
    }
    if (dupeAddresses.length > 0) {
      try {
        // Remove duplicates then re-add unique set
        const unique = listings.filter((l, i) =>
          listings.findIndex((x) => x.address === l.address) === i
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
    live: live.length,
    dead: dead.length,
    errors: errors.length,
    duplicates: duplicates.length,
    pruned,
    dedupPruned,
    deadListings: dead.map((d) => ({
      address: d.address,
      city: d.city,
      province: d.province,
      url: d.url,
    })),
    duplicateListings: duplicates,
    errorListings: errors.map((e) => ({
      address: e.address,
      status: e.status,
    })),
    checkedAt: new Date().toISOString(),
  });
}
