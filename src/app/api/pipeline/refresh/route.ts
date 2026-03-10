/**
 * /api/pipeline/refresh
 *
 * Daily cron job that:
 * 1. Refreshes listings from Zoocasa for each configured city
 * 2. Checks existing listings for freshness (dead = sold/delisted)
 * 3. Backfills dead listing slots with new candidates
 * 4. Carries forward user-requested listings (source: "user") with freshness check
 * 5. Fetches details and enriches new listings
 * 6. Re-enriches stale user listings (>7 days old)
 * 7. Writes enriched data to KV
 *
 * Vercel Cron: daily 2pm UTC (0 14 * * *)
 */

import { NextResponse } from "next/server";
import { searchListings, fetchDetail, checkFreshness, fetchSoldListings, ZoocasaSoldRaw } from "@/lib/zoocasa";
import { getAllListings, writeAllListings, purgeStaleSlugKeys } from "@/lib/kv/listings";
import { enrichListing } from "@/lib/pipeline/enrich";
import { slugify } from "@/lib/utils";
import { Listing } from "@/lib/types";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

interface CityConfig {
  city: string;
  province: string;
  minPrice: number;
  maxPrice: number;
  target: number;
}

const CITIES: CityConfig[] = [
  { city: "Victoria", province: "BC", minPrice: 900000, maxPrice: 1300000, target: 25 },
  { city: "Saanich", province: "BC", minPrice: 900000, maxPrice: 1300000, target: 25 },
  { city: "Langford", province: "BC", minPrice: 900000, maxPrice: 1300000, target: 25 },
  { city: "Vancouver", province: "BC", minPrice: 1000000, maxPrice: 1800000, target: 25 },
  { city: "Surrey", province: "BC", minPrice: 1000000, maxPrice: 1800000, target: 25 },
  { city: "Calgary", province: "AB", minPrice: 500000, maxPrice: 900000, target: 25 },
  { city: "Edmonton", province: "AB", minPrice: 500000, maxPrice: 900000, target: 25 },
  { city: "Toronto", province: "ON", minPrice: 1000000, maxPrice: 1800000, target: 25 },
  { city: "Hamilton", province: "ON", minPrice: 600000, maxPrice: 1000000, target: 25 },
  { city: "Ottawa", province: "ON", minPrice: 600000, maxPrice: 1000000, target: 25 },
];

// Fields to strip before re-enrichment
const PRE_FIELDS: (keyof Listing)[] = [
  "preScore", "preTier", "preSignals", "preNarrative", "preOffer", "assessmentNote",
  "preAssessment", "preComparables",
];

// User listings older than this get re-enriched with fresh data
const STALE_DAYS = 7;

function stripPrecomputed(listing: Listing): Listing {
  const clean = { ...listing };
  for (const f of PRE_FIELDS) {
    delete (clean as unknown as Record<string, unknown>)[f];
  }
  return clean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isStale(listing: Listing): boolean {
  if (!listing.enrichedAt) return true; // No timestamp = legacy, re-enrich
  const age = Date.now() - new Date(listing.enrichedAt).getTime();
  return age > STALE_DAYS * 24 * 60 * 60 * 1000;
}

export async function GET(request: Request) {
  // Verify cron secret if configured; skip auth if not set (Vercel cron infra handles security)
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const startTime = Date.now();
  const log: string[] = [];
  const summary: { city: string; province: string; existing: number; new: number; total: number }[] = [];

  try {
    // Load existing listings from KV
    const existingListings = await getAllListings();
    const existingByMls = new Map<string, Listing>();
    const existingByAddress = new Map<string, Listing>();
    for (const l of existingListings) {
      if (l.mlsNumber) existingByMls.set(l.mlsNumber, l);
      existingByAddress.set(l.address.toLowerCase(), l);
    }
    log.push(`Loaded ${existingListings.length} existing listings`);

    // -----------------------------------------------------------------------
    // Step 1: Search + detail fetch per city
    // -----------------------------------------------------------------------
    const allListings: Listing[] = [];
    // Track all addresses claimed by CITIES loop (to avoid double-counting user listings)
    const citiesClaimedAddresses = new Set<string>();

    for (const cfg of CITIES) {
      const cityStart = Date.now();

      // Search: default + oldest-first
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

        const seen = new Set<string>();
        for (const l of [...defaultResults, ...oldestResults]) {
          const key = l.mlsNumber || l.address;
          if (!seen.has(key)) {
            seen.add(key);
            candidates.push(l);
          }
        }
      } catch (err) {
        log.push(`${cfg.city}: search failed — ${err}`);
        summary.push({ city: cfg.city, province: cfg.province, existing: 0, new: 0, total: 0 });
        continue;
      }

      if (candidates.length === 0) {
        log.push(`${cfg.city}: no candidates`);
        summary.push({ city: cfg.city, province: cfg.province, existing: 0, new: 0, total: 0 });
        continue;
      }

      // Sort by DOM desc, take top candidates
      candidates.sort((a, b) => b.dom - a.dom);

      // Separate: existing (already in KV with enrichment) vs new (need detail fetch)
      const kept: Listing[] = [];
      const needsDetail: Listing[] = [];

      for (const candidate of candidates) {
        const existingMls = candidate.mlsNumber ? existingByMls.get(candidate.mlsNumber) : null;
        const existingAddr = existingByAddress.get(candidate.address.toLowerCase());
        const existing = existingMls || existingAddr;

        if (existing && existing.preNarrative) {
          // Update DOM (it changes daily) but keep pre-computed data
          kept.push({ ...existing, dom: candidate.dom, source: "cron" });
        } else {
          needsDetail.push(candidate);
        }
      }

      // Freshness check: verify kept listings are still live on Zoocasa
      if (kept.length > 0) {
        const freshnessStart = Date.now();
        const freshnessQueue = [...kept];
        const deadAddresses = new Set<string>();

        async function freshnessWorker() {
          while (freshnessQueue.length > 0) {
            const item = freshnessQueue.shift();
            if (!item) break;
            const slug = item.url?.replace("https://www.zoocasa.com", "").split("/").pop() || "";
            const status = await checkFreshness(item.address, item.city, item.province, slug || undefined);
            if (status === "dead") deadAddresses.add(item.address);
          }
        }

        const workers = Array.from({ length: Math.min(6, kept.length) }, () => freshnessWorker());
        await Promise.all(workers);

        if (deadAddresses.size > 0) {
          const before = kept.length;
          const alive = kept.filter((l) => !deadAddresses.has(l.address));
          kept.length = 0;
          kept.push(...alive);
          log.push(`${cfg.city}: pruned ${before - kept.length} dead listings in ${Date.now() - freshnessStart}ms`);
        }
      }

      // How many new ones do we need to fill the target?
      const needed = Math.max(0, cfg.target - kept.length);
      const toFetch = needsDetail.slice(0, Math.min(needed + 5, 30)); // fetch a few extra in case some fail

      // Fetch details for new listings
      const detailed: Listing[] = [];
      for (const candidate of toFetch) {
        if (kept.length + detailed.length >= cfg.target) break;

        try {
          const urlPath = candidate.url?.replace("https://www.zoocasa.com", "") || "";
          const slug = urlPath.split("/").pop() || "";
          if (!slug) continue;

          const detail = await fetchDetail(candidate.address, cfg.city, cfg.province, slug);
          const listing = stripPrecomputed(detail.listing);

          if (!listing.url && candidate.url) listing.url = candidate.url;
          if (!listing.mlsNumber && candidate.mlsNumber) listing.mlsNumber = candidate.mlsNumber;
          if (!listing.address && candidate.address) listing.address = candidate.address;

          detailed.push(listing);
          await sleep(1500);
        } catch {
          // Skip failed detail fetches
        }
      }

      // Filter: prefer 1500+ sqft, relax if needed
      let filtered = detailed.filter((l) => {
        const sqft = parseInt(l.sqft) || 0;
        return sqft === 0 || sqft >= 1500;
      });
      if (kept.length + filtered.length < cfg.target) {
        filtered = detailed;
      }

      // Combine kept + new, sort by DOM, take target
      const combined = [...kept, ...filtered];
      combined.sort((a, b) => b.dom - a.dom);
      const picked = combined.slice(0, cfg.target);

      // Track claimed addresses
      for (const p of picked) {
        citiesClaimedAddresses.add(p.address.toLowerCase());
      }

      allListings.push(...picked);
      const newCount = picked.filter(p => !p.preNarrative).length;
      summary.push({
        city: cfg.city,
        province: cfg.province,
        existing: picked.length - newCount,
        new: newCount,
        total: picked.length,
      });
      log.push(`${cfg.city}: ${picked.length} listings (${newCount} new) in ${Date.now() - cityStart}ms`);
    }

    // -----------------------------------------------------------------------
    // Step 1.5: Carry forward user-sourced listings
    // -----------------------------------------------------------------------
    const userListings = existingListings.filter(
      (l) => l.source === "user" && !citiesClaimedAddresses.has(l.address.toLowerCase())
    );

    if (userListings.length > 0) {
      const userStart = Date.now();
      const freshnessQueue = [...userListings];
      const deadAddresses = new Set<string>();

      async function userFreshnessWorker() {
        while (freshnessQueue.length > 0) {
          const item = freshnessQueue.shift();
          if (!item) break;
          const slug = item.url?.replace("https://www.zoocasa.com", "").split("/").pop() || "";
          const status = await checkFreshness(item.address, item.city, item.province, slug || undefined);
          if (status === "dead") deadAddresses.add(item.address);
        }
      }

      const workers = Array.from({ length: Math.min(6, userListings.length) }, () => userFreshnessWorker());
      await Promise.all(workers);

      const alive = userListings.filter((l) => !deadAddresses.has(l.address));
      allListings.push(...alive);

      log.push(
        `User listings: ${userListings.length} found, ${deadAddresses.size} dead, ${alive.length} carried forward in ${Date.now() - userStart}ms`
      );
    } else {
      log.push("User listings: none to carry forward");
    }

    // -----------------------------------------------------------------------
    // Step 1.6: Fetch sold pools per city (for comparables) — parallel
    // -----------------------------------------------------------------------
    const soldPools = new Map<string, ZoocasaSoldRaw[]>();
    const elapsed = Date.now() - startTime;
    log.push(`Steps 1-1.5 done in ${elapsed}ms`);

    if (elapsed < 200_000) {
      // Collect unique city|province keys from all listings (CITIES + user)
      const allCityKeys = new Set<string>();
      for (const cfg of CITIES) {
        allCityKeys.add(`${cfg.city.toLowerCase()}|${cfg.province.toLowerCase()}`);
      }
      for (const l of allListings) {
        if (l.source === "user") {
          allCityKeys.add(`${l.city.toLowerCase()}|${l.province.toLowerCase()}`);
        }
      }

      // Fetch all sold pools in parallel
      const poolEntries = await Promise.allSettled(
        [...allCityKeys].map(async (key) => {
          const [city, province] = key.split("|");
          const pool = await fetchSoldListings(city, province);
          return { key, city, pool };
        })
      );

      for (const entry of poolEntries) {
        if (entry.status === "fulfilled") {
          soldPools.set(entry.value.key, entry.value.pool);
          log.push(`Sold pool ${entry.value.city}: ${entry.value.pool.length} listings`);
        } else {
          log.push(`Sold pool fetch failed: ${entry.reason}`);
        }
      }
      log.push(`Sold pools fetched in ${Date.now() - startTime - elapsed}ms`);
    } else {
      log.push(`Skipping sold pools — time budget tight (${elapsed}ms elapsed)`);
    }

    // -----------------------------------------------------------------------
    // Step 2: Enrich new + re-enrich stale listings
    // -----------------------------------------------------------------------
    const enrichStart = Date.now();
    let enrichedCount = 0;
    let reEnrichedCount = 0;

    for (let i = 0; i < allListings.length; i++) {
      const listing = allListings[i];
      const isUserStale = listing.source === "user" && isStale(listing);
      const needsEnrich = !listing.preNarrative || isUserStale;

      if (!needsEnrich) continue;

      // Check time budget: leave 40s for batched KV write + purge
      if (Date.now() - startTime > 240_000) {
        log.push(`Time budget reached, skipping enrichment for remaining listings`);
        // Give unenriched listings a deterministic narrative
        for (let j = i; j < allListings.length; j++) {
          const jListing = allListings[j];
          const jNeedsEnrich = !jListing.preNarrative || (jListing.source === "user" && isStale(jListing));
          if (jNeedsEnrich) {
            const pool = soldPools.get(`${jListing.city.toLowerCase()}|${jListing.province.toLowerCase()}`);
            allListings[j] = await enrichListing(stripPrecomputed(jListing), { skipLlm: true, soldPool: pool });
            allListings[j].source = jListing.source || "cron";
            allListings[j].enrichedAt = new Date().toISOString();
            enrichedCount++;
          }
        }
        break;
      }

      const pool = soldPools.get(`${listing.city.toLowerCase()}|${listing.province.toLowerCase()}`);
      const listingToEnrich = isUserStale ? stripPrecomputed(listing) : listing;
      // User listings always get LLM (they were originally created with forceLlm)
      const useForceLlm = listing.source === "user";

      try {
        allListings[i] = await enrichListing(listingToEnrich, {
          soldPool: pool,
          ...(useForceLlm ? { forceLlm: true } : {}),
        });
        allListings[i].source = listing.source || "cron";
        allListings[i].enrichedAt = new Date().toISOString();
        enrichedCount++;
        if (isUserStale) reEnrichedCount++;
        // Rate limit LLM calls
        if (allListings[i].preTier !== "WATCH" || useForceLlm) {
          await sleep(1500);
        }
      } catch (err) {
        log.push(`Enrich failed for ${listing.address}: ${err}`);
        // Fall back to deterministic
        allListings[i] = await enrichListing(listingToEnrich, { skipLlm: true, soldPool: pool });
        allListings[i].source = listing.source || "cron";
        allListings[i].enrichedAt = new Date().toISOString();
        enrichedCount++;
      }
    }

    // Tag source/enrichedAt on legacy listings that predate these fields
    const now = new Date().toISOString();
    for (let i = 0; i < allListings.length; i++) {
      if (!allListings[i].enrichedAt) allListings[i].enrichedAt = now;
      if (!allListings[i].source) allListings[i].source = "cron";
    }

    log.push(`Enriched ${enrichedCount} listings (${reEnrichedCount} user re-enriched) in ${Date.now() - enrichStart}ms`);

    // -----------------------------------------------------------------------
    // Step 3: Write to KV
    // -----------------------------------------------------------------------
    const writeStart = Date.now();
    const validSlugs = new Set(allListings.map((l) => slugify(l.address)));
    const purged = await purgeStaleSlugKeys(validSlugs);
    const result = await writeAllListings(allListings);
    log.push(`KV write: ${result.written} listings, ${result.slugs} slugs, ${purged} stale purged in ${Date.now() - writeStart}ms`);

    const totalTime = Date.now() - startTime;
    const totalListings = allListings.length;
    const byProvince = new Map<string, number>();
    const bySource = { cron: 0, user: 0 };
    for (const l of allListings) {
      byProvince.set(l.province, (byProvince.get(l.province) || 0) + 1);
      if (l.source === "user") bySource.user++;
      else bySource.cron++;
    }

    return NextResponse.json({
      success: true,
      totalListings,
      totalTimeMs: totalTime,
      byProvince: Object.fromEntries(byProvince),
      bySource,
      cities: summary,
      log,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: String(err),
        log,
        totalTimeMs: Date.now() - startTime,
      },
      { status: 500 }
    );
  }
}
