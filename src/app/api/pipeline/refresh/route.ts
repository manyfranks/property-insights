/**
 * /api/pipeline/refresh
 *
 * Daily cron job that:
 * 1. Searches all cities in parallel
 * 2. Matches existing KV listings, batches freshness checks globally
 * 3. Backfills dead slots with new candidates
 * 4. Carries forward user-requested listings (source: "user")
 * 5. Enriches new + re-enriches stale user listings
 * 6. Writes enriched data to KV
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
  if (!listing.enrichedAt) return true;
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
  const elapsed = () => Date.now() - startTime;
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
    log.push(`Loaded ${existingListings.length} existing listings (${elapsed()}ms)`);

    // -----------------------------------------------------------------------
    // Phase 1: Search ALL cities in parallel
    // -----------------------------------------------------------------------
    type CitySearchResult = { cfg: CityConfig; candidates: Listing[] };
    const searchResults = await Promise.allSettled(
      CITIES.map(async (cfg): Promise<CitySearchResult> => {
        const [defaultResults, oldestResults] = await Promise.all([
          searchListings(cfg.city, cfg.province, {
            type: "house", beds: 3, minPrice: cfg.minPrice, maxPrice: cfg.maxPrice,
          }),
          searchListings(cfg.city, cfg.province, {
            type: "house", beds: 3, minPrice: cfg.minPrice, maxPrice: cfg.maxPrice, sortBy: "days-desc",
          }),
        ]);
        const seen = new Set<string>();
        const candidates: Listing[] = [];
        for (const l of [...defaultResults, ...oldestResults]) {
          const key = l.mlsNumber || l.address;
          if (!seen.has(key)) { seen.add(key); candidates.push(l); }
        }
        return { cfg, candidates };
      })
    );

    log.push(`Phase 1 search done (${elapsed()}ms)`);

    // -----------------------------------------------------------------------
    // Phase 2: Match existing, collect freshness queue
    // -----------------------------------------------------------------------
    // Per-city buckets for kept and needsDetail
    interface CityBucket {
      cfg: CityConfig;
      kept: Listing[];
      needsDetail: Listing[];
    }
    const cityBuckets: CityBucket[] = [];
    // Global freshness queue: all kept listings across all cities
    const freshnessQueue: { listing: Listing; cityIdx: number }[] = [];

    for (const result of searchResults) {
      if (result.status === "rejected") {
        log.push(`Search failed: ${result.reason}`);
        continue;
      }
      const { cfg, candidates } = result.value;
      if (candidates.length === 0) {
        log.push(`${cfg.city}: no candidates`);
        summary.push({ city: cfg.city, province: cfg.province, existing: 0, new: 0, total: 0 });
        continue;
      }

      candidates.sort((a, b) => b.dom - a.dom);
      const kept: Listing[] = [];
      const needsDetail: Listing[] = [];

      for (const candidate of candidates) {
        const existingMls = candidate.mlsNumber ? existingByMls.get(candidate.mlsNumber) : null;
        const existingAddr = existingByAddress.get(candidate.address.toLowerCase());
        const existing = existingMls || existingAddr;

        if (existing && existing.preNarrative) {
          kept.push({ ...existing, dom: candidate.dom, source: "cron" });
        } else {
          needsDetail.push(candidate);
        }
      }

      const cityIdx = cityBuckets.length;
      cityBuckets.push({ cfg, kept, needsDetail });

      // Add all kept listings to global freshness queue
      for (const l of kept) {
        freshnessQueue.push({ listing: l, cityIdx });
      }
    }

    log.push(`Phase 2 match done: ${freshnessQueue.length} kept need freshness, ${cityBuckets.reduce((s, b) => s + b.needsDetail.length, 0)} need detail (${elapsed()}ms)`);

    // -----------------------------------------------------------------------
    // Phase 3: Batch freshness check ALL kept listings (20 parallel workers)
    // -----------------------------------------------------------------------
    const deadAddresses = new Set<string>();
    if (freshnessQueue.length > 0) {
      const queue = [...freshnessQueue];
      async function freshnessWorker() {
        while (queue.length > 0) {
          const item = queue.shift();
          if (!item) break;
          const l = item.listing;
          const slug = l.url?.replace("https://www.zoocasa.com", "").split("/").pop() || "";
          const status = await checkFreshness(l.address, l.city, l.province, slug || undefined);
          if (status === "dead") deadAddresses.add(l.address);
        }
      }
      const workerCount = Math.min(20, freshnessQueue.length);
      await Promise.all(Array.from({ length: workerCount }, () => freshnessWorker()));

      if (deadAddresses.size > 0) {
        for (const bucket of cityBuckets) {
          bucket.kept = bucket.kept.filter((l) => !deadAddresses.has(l.address));
        }
      }
    }

    log.push(`Phase 3 freshness done: ${deadAddresses.size} dead pruned (${elapsed()}ms)`);

    // -----------------------------------------------------------------------
    // Phase 4: Detail fetches + assembly per city
    // -----------------------------------------------------------------------
    const allListings: Listing[] = [];
    const citiesClaimedAddresses = new Set<string>();

    for (const bucket of cityBuckets) {
      const { cfg, kept, needsDetail } = bucket;

      // How many new ones to fill target?
      const needed = Math.max(0, cfg.target - kept.length);
      const toFetch = needsDetail.slice(0, Math.min(needed + 5, 30));

      const detailed: Listing[] = [];

      // Skip detail fetches if time is very tight
      if (elapsed() < 180_000) {
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
            await sleep(500);
          } catch {
            // Skip failed detail fetches
          }
        }
      } else {
        log.push(`${cfg.city}: skipping detail fetches — time budget (${elapsed()}ms)`);
      }

      // Filter: prefer 1500+ sqft, relax if needed
      let filtered = detailed.filter((l) => {
        const sqft = parseInt(l.sqft) || 0;
        return sqft === 0 || sqft >= 1500;
      });
      if (kept.length + filtered.length < cfg.target) {
        filtered = detailed;
      }

      const combined = [...kept, ...filtered];
      combined.sort((a, b) => b.dom - a.dom);
      const picked = combined.slice(0, cfg.target);

      for (const p of picked) {
        citiesClaimedAddresses.add(p.address.toLowerCase());
      }

      allListings.push(...picked);
      const newCount = picked.filter(p => !p.preNarrative).length;
      summary.push({
        city: cfg.city, province: cfg.province,
        existing: picked.length - newCount, new: newCount, total: picked.length,
      });
      log.push(`${cfg.city}: ${picked.length} (${newCount} new)`);
    }

    log.push(`Phase 4 detail done: ${allListings.length} CITIES listings (${elapsed()}ms)`);

    // -----------------------------------------------------------------------
    // Phase 5: Carry forward user-sourced listings
    // -----------------------------------------------------------------------
    const userListings = existingListings.filter(
      (l) => l.source === "user" && !citiesClaimedAddresses.has(l.address.toLowerCase())
    );

    if (userListings.length > 0) {
      // Freshness check user listings
      const userQueue = [...userListings];
      const userDead = new Set<string>();

      async function userFreshnessWorker() {
        while (userQueue.length > 0) {
          const item = userQueue.shift();
          if (!item) break;
          const slug = item.url?.replace("https://www.zoocasa.com", "").split("/").pop() || "";
          const status = await checkFreshness(item.address, item.city, item.province, slug || undefined);
          if (status === "dead") userDead.add(item.address);
        }
      }

      const workers = Array.from({ length: Math.min(6, userListings.length) }, () => userFreshnessWorker());
      await Promise.all(workers);

      const alive = userListings.filter((l) => !userDead.has(l.address));
      allListings.push(...alive);
      log.push(`User listings: ${userListings.length} found, ${userDead.size} dead, ${alive.length} carried forward (${elapsed()}ms)`);
    } else {
      log.push("User listings: none to carry forward");
    }

    // -----------------------------------------------------------------------
    // Phase 6: Fetch sold pools (parallel, skip if tight)
    // -----------------------------------------------------------------------
    const soldPools = new Map<string, ZoocasaSoldRaw[]>();

    if (elapsed() < 200_000) {
      const allCityKeys = new Set<string>();
      for (const cfg of CITIES) {
        allCityKeys.add(`${cfg.city.toLowerCase()}|${cfg.province.toLowerCase()}`);
      }
      for (const l of allListings) {
        if (l.source === "user") {
          allCityKeys.add(`${l.city.toLowerCase()}|${l.province.toLowerCase()}`);
        }
      }

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
        }
      }
      log.push(`Sold pools: ${soldPools.size} fetched (${elapsed()}ms)`);
    } else {
      log.push(`Sold pools: skipped — time budget (${elapsed()}ms)`);
    }

    // -----------------------------------------------------------------------
    // Phase 7: Enrich new + re-enrich stale user listings
    // -----------------------------------------------------------------------
    const enrichStart = Date.now();
    let enrichedCount = 0;
    let reEnrichedCount = 0;

    for (let i = 0; i < allListings.length; i++) {
      const listing = allListings[i];
      const isUserStale = listing.source === "user" && isStale(listing);
      const needsEnrich = !listing.preNarrative || isUserStale;

      if (!needsEnrich) continue;

      // Check time budget: leave 40s for KV write + purge
      if (elapsed() > 240_000) {
        log.push(`Time budget reached at ${elapsed()}ms, deterministic fallback for remaining`);
        for (let j = i; j < allListings.length; j++) {
          const jListing = allListings[j];
          const jNeedsEnrich = !jListing.preNarrative || (jListing.source === "user" && isStale(jListing));
          if (jNeedsEnrich) {
            const pool = soldPools.get(`${jListing.city.toLowerCase()}|${jListing.province.toLowerCase()}`);
            allListings[j] = await enrichListing(stripPrecomputed(jListing), { skipLlm: true, soldPool: pool, syncAssessmentOnly: true });
            allListings[j].source = jListing.source || "cron";
            allListings[j].enrichedAt = new Date().toISOString();
            enrichedCount++;
          }
        }
        break;
      }

      const pool = soldPools.get(`${listing.city.toLowerCase()}|${listing.province.toLowerCase()}`);
      const listingToEnrich = isUserStale ? stripPrecomputed(listing) : listing;
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
        if (allListings[i].preTier !== "WATCH" || useForceLlm) {
          await sleep(1500);
        }
      } catch (err) {
        log.push(`Enrich failed for ${listing.address}: ${err}`);
        allListings[i] = await enrichListing(listingToEnrich, { skipLlm: true, soldPool: pool });
        allListings[i].source = listing.source || "cron";
        allListings[i].enrichedAt = new Date().toISOString();
        enrichedCount++;
      }
    }

    // Tag legacy listings
    const now = new Date().toISOString();
    for (let i = 0; i < allListings.length; i++) {
      if (!allListings[i].enrichedAt) allListings[i].enrichedAt = now;
      if (!allListings[i].source) allListings[i].source = "cron";
    }

    log.push(`Enriched ${enrichedCount} (${reEnrichedCount} user re-enriched) in ${Date.now() - enrichStart}ms (${elapsed()}ms total)`);

    // -----------------------------------------------------------------------
    // Phase 8: Write to KV
    // -----------------------------------------------------------------------
    const writeStart = Date.now();
    const validSlugs = new Set(allListings.map((l) => slugify(l.address)));
    const purged = await purgeStaleSlugKeys(validSlugs);
    const result = await writeAllListings(allListings);
    log.push(`KV write: ${result.written} listings, ${result.slugs} slugs, ${purged} purged in ${Date.now() - writeStart}ms (${elapsed()}ms total)`);

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
      totalTimeMs: elapsed(),
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
        totalTimeMs: elapsed(),
      },
      { status: 500 }
    );
  }
}
