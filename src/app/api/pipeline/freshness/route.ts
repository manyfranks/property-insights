/**
 * GET /api/pipeline/freshness
 *
 * Checks all stored listings for freshness by cross-referencing
 * against live realtor.ca city searches via ScraperAPI.
 *
 * Strategy:
 * - Groups listings by city
 * - For each city, does a PropertySearch_Post via ScraperAPI
 * - Any stored listing whose MLS number is NOT in live results = dead
 * - Also detects and prunes duplicate addresses
 *
 * Designed to be called by Vercel Cron (weekly) or manually.
 */

import { NextResponse } from "next/server";
import { getAllListings, removeListings } from "@/lib/kv/listings";
import { CITY_BOUNDS, CityBounds } from "@/lib/data/city-bounds";

export const maxDuration = 60;

const API_URL = "https://api2.realtor.ca/Listing.svc/PropertySearch_Post";

/**
 * Fetch all live MLS numbers for a city via ScraperAPI.
 */
async function fetchLiveMlsForCity(
  bounds: CityBounds
): Promise<Set<string>> {
  const scraperApiKey = process.env.SCRAPER_API_KEY;
  const mlsSet = new Set<string>();

  const params = new URLSearchParams({
    ZoomLevel: "11",
    LatitudeMax: bounds.latMax.toString(),
    LatitudeMin: bounds.latMin.toString(),
    LongitudeMax: bounds.lngMax.toString(),
    LongitudeMin: bounds.lngMin.toString(),
    CurrentPage: "1",
    RecordsPerPage: "200",
    PropertySearchTypeId: "1",
    TransactionTypeId: "2",
    PropertyTypeGroupID: "1",
    SortBy: "6",
    SortOrder: "D",
  });

  try {
    let res: Response;
    if (scraperApiKey) {
      const targetUrl = encodeURIComponent(API_URL);
      res = await fetch(
        `http://api.scraperapi.com?api_key=${scraperApiKey}&url=${targetUrl}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString(),
          signal: AbortSignal.timeout(20000),
        }
      );
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

    if (!res.ok) return mlsSet;

    const data = await res.json();
    const results = data.Results || [];
    for (const r of results) {
      if (r.MlsNumber) mlsSet.add(r.MlsNumber);
    }
  } catch {
    // API error — return empty set (will mark as "unknown")
  }

  return mlsSet;
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

  // Group listings by city slug (matching CITY_BOUNDS keys)
  const cityKeys = Object.keys(CITY_BOUNDS);
  const cityToListings = new Map<string, typeof listings>();

  for (const l of listings) {
    const key = cityKeys.find(
      (k) => k.toLowerCase() === l.city.toLowerCase()
    );
    if (key) {
      const arr = cityToListings.get(key) || [];
      arr.push(l);
      cityToListings.set(key, arr);
    }
  }

  // Only check up to 6 cities per run to stay within 60s timeout.
  // Rotate based on the current week number so all cities get checked over time.
  const allCities = Array.from(cityToListings.keys()).sort();
  const weekNum = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
  const batchStart = (weekNum * 6) % allCities.length;
  const citiesToCheck = [];
  for (let i = 0; i < Math.min(6, allCities.length); i++) {
    citiesToCheck.push(allCities[(batchStart + i) % allCities.length]);
  }

  // For checked cities, fetch live MLS numbers and cross-reference
  const results: {
    address: string;
    city: string;
    province: string;
    url: string;
    mlsNumber: string;
    status: "live" | "dead" | "unknown";
  }[] = [];

  const cityResults: { city: string; liveMls: number; checked: number; dead: number }[] = [];

  // Mark unchecked cities as unknown
  for (const [cityKey, cityListings] of cityToListings) {
    if (!citiesToCheck.includes(cityKey)) {
      for (const l of cityListings) {
        results.push({
          address: l.address, city: l.city, province: l.province,
          url: l.url, mlsNumber: l.mlsNumber || "", status: "unknown",
        });
      }
    }
  }

  for (const [cityKey, cityListings] of cityToListings) {
    if (!citiesToCheck.includes(cityKey)) continue;
    const bounds = CITY_BOUNDS[cityKey];
    const liveMls = await fetchLiveMlsForCity(bounds);

    let deadCount = 0;
    for (const l of cityListings) {
      let status: "live" | "dead" | "unknown";

      if (liveMls.size === 0) {
        // API call failed for this city — can't determine status
        status = "unknown";
      } else if (!l.mlsNumber) {
        status = "unknown";
      } else if (liveMls.has(l.mlsNumber)) {
        status = "live";
      } else {
        // MLS not in live results — could be dead OR just not in top 200
        // Mark as "dead" only if the city returned a reasonable number of results
        status = liveMls.size >= 20 ? "dead" : "unknown";
        if (status === "dead") deadCount++;
      }

      results.push({
        address: l.address,
        city: l.city,
        province: l.province,
        url: l.url,
        mlsNumber: l.mlsNumber || "",
        status,
      });
    }

    cityResults.push({
      city: cityKey,
      liveMls: liveMls.size,
      checked: cityListings.length,
      dead: deadCount,
    });
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
    live: live.length,
    dead: dead.length,
    unknown: unknown.length,
    duplicates: duplicates.length,
    pruned,
    dedupPruned,
    citiesChecked: citiesToCheck,
    cityResults,
    deadListings: dead.map((d) => ({
      address: d.address,
      city: d.city,
      province: d.province,
      url: d.url,
      mlsNumber: d.mlsNumber,
    })),
    duplicateListings: duplicates,
    unknownListings: unknown.slice(0, 20).map((u) => ({
      address: u.address,
      mlsNumber: u.mlsNumber,
    })),
    checkedAt: new Date().toISOString(),
  });
}
