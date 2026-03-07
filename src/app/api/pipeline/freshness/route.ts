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

export const maxDuration = 300; // Allow up to 5 min for ScraperAPI MLS checks

/**
 * Check if a realtor.ca listing URL is still live.
 * Returns: "live" | "dead" | "unknown"
 *
 * Realtor.ca is a SPA — HEAD requests often return 403,
 * and GET always returns 200 (even for delisted listings).
 * Instead we check the MLS number via the realtor.ca API.
 */
const API_URL = "https://api2.realtor.ca/Listing.svc/PropertySearch_Post";

/**
 * Check a single MLS number against the realtor.ca API.
 * Uses ScraperAPI to bypass Cloudflare when SCRAPER_API_KEY is set.
 */
async function checkMls(mlsNumber: string): Promise<"live" | "dead" | "unknown"> {
  if (!mlsNumber) return "unknown";

  try {
    const params = new URLSearchParams({
      ZoomLevel: "1",
      LatitudeMax: "90",
      LatitudeMin: "-90",
      LongitudeMax: "180",
      LongitudeMin: "-180",
      CurrentPage: "1",
      RecordsPerPage: "1",
      PropertySearchTypeId: "1",
      TransactionTypeId: "2",
      ReferenceNumber: mlsNumber,
    });

    const scraperApiKey = process.env.SCRAPER_API_KEY;
    let res: Response;

    if (scraperApiKey) {
      const targetUrl = encodeURIComponent(API_URL);
      res = await fetch(`http://api.scraperapi.com?api_key=${scraperApiKey}&url=${targetUrl}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
        signal: AbortSignal.timeout(15000),
      });
    } else {
      res = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: "https://www.realtor.ca",
          Referer: "https://www.realtor.ca/",
        },
        body: params.toString(),
        signal: AbortSignal.timeout(10000),
      });
    }

    if (!res.ok) return "unknown";

    const data = await res.json();
    const count = data.Paging?.TotalRecords ?? data.Results?.length ?? -1;
    return count > 0 ? "live" : "dead";
  } catch {
    return "unknown";
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

  // Check listings via MLS API in parallel batches of 10
  const batchSize = 10;
  const results: { address: string; city: string; province: string; url: string; mlsNumber: string; status: "live" | "dead" | "unknown" }[] = [];

  for (let i = 0; i < listings.length; i += batchSize) {
    const batch = listings.slice(i, i + batchSize);
    const statuses = await Promise.all(batch.map((l) => checkMls(l.mlsNumber || "")));

    for (let j = 0; j < batch.length; j++) {
      results.push({
        address: batch[j].address,
        city: batch[j].city,
        province: batch[j].province,
        url: batch[j].url,
        mlsNumber: batch[j].mlsNumber || "",
        status: statuses[j],
      });
    }
  }

  const live = results.filter((r) => r.status === "live");
  const dead = results.filter((r) => r.status === "dead");
  const unknown = results.filter((r) => r.status === "unknown");

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
    unknown: unknown.length,
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
    unknownListings: unknown.map((u) => ({
      address: u.address,
      mlsNumber: u.mlsNumber,
    })),
    checkedAt: new Date().toISOString(),
  });
}
