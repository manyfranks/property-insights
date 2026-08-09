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
import { refreshUSDiscover } from "@/lib/pipeline/us-discover";
import { slugify } from "@/lib/utils";
import { Listing } from "@/lib/types";
import { isUSState } from "@/lib/assessment/us";

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
  // Added 2026-08 — live coverage probe confirmed real Winnipeg inventory
  // (19 valid house listings on a clean run; Zoocasa returns province="MB"
  // correctly). Price band set from that probe's observed range (~$250K-
  // $670K for 3-bed houses). Note: Winnipeg searches intermittently hit the
  // documented province-wide-fallback regression (see zoocasa.ts's
  // citiesMatch doc comment) and return 0 candidates on some requests — the
  // two-search-variant dedup above plus daily reruns already tolerate this
  // for other cities, so no special-casing needed here.
  { city: "Winnipeg", province: "MB", minPrice: 300000, maxPrice: 650000, target: 25 },
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

    // -----------------------------------------------------------------------
    // [pipeline-guard] Preserve-on-empty/failed-fetch (Part 2b fix).
    //
    // ROOT CAUSE (proven 2026-08-09, see also kv/listings.ts's floor guard
    // and Phase 8 below): previously, a city whose Zoocasa search returned
    // zero candidates — or whose search promise rejected outright — was
    // simply `continue`d past with zero listings, discarding EVERY
    // previously-stored listing for that city even though nothing about
    // them was actually confirmed dead. There is no code path that
    // freshness-checks or re-adds a listing that isn't re-matched against
    // THIS run's candidates, so a single flaky/rate-limited/empty search
    // (the codebase's own CITIES comment above documents Zoocasa's known
    // "province-wide-fallback regression... returns 0 candidates on some
    // requests" as a tolerated, real occurrence) silently zeroed that
    // city's contribution to `allListings`. Combined with Phase 8's old
    // full-replace write, this is what took CA from 136 -> 53 listings on
    // 2026-08-09: most cities returned far below their candidate target
    // that run. Fix: on empty/failed search, fall back to the existing
    // cron-sourced listings for that exact city+province, unmodified
    // (unverified freshness this cycle, but far better than deleting them
    // outright) — logged loudly so a real, sustained Zoocasa outage is
    // still visible in the cron's own log output.
    // -----------------------------------------------------------------------
    const preservedListings: Listing[] = [];

    for (const [resultIdx, result] of searchResults.entries()) {
      if (result.status === "rejected") {
        const cfg = CITIES[resultIdx];
        log.push(`[pipeline-guard] Search failed for ${cfg?.city ?? "unknown"}: ${result.reason} — preserving existing listings`);
        if (cfg) {
          const preserved = existingListings.filter(
            (l) => l.source === "cron" && l.city === cfg.city && l.province === cfg.province
          );
          preservedListings.push(...preserved);
          summary.push({ city: cfg.city, province: cfg.province, existing: preserved.length, new: 0, total: preserved.length });
        }
        continue;
      }
      const { cfg, candidates } = result.value;
      if (candidates.length === 0) {
        const preserved = existingListings.filter(
          (l) => l.source === "cron" && l.city === cfg.city && l.province === cfg.province
        );
        log.push(`[pipeline-guard] ${cfg.city}: no candidates this run — preserving ${preserved.length} existing listing(s)`);
        preservedListings.push(...preserved);
        summary.push({ city: cfg.city, province: cfg.province, existing: preserved.length, new: 0, total: preserved.length });
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

    // [pipeline-guard] Fold in listings preserved above from cities whose
    // search failed/returned empty this run (see the Phase 2 comment).
    if (preservedListings.length > 0) {
      allListings.push(...preservedListings);
      for (const p of preservedListings) citiesClaimedAddresses.add(p.address.toLowerCase());
      log.push(`[pipeline-guard] folded in ${preservedListings.length} preserved listing(s) from empty/failed searches`);
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
    //
    // ROOT CAUSE OF THE 2026-08-09 US-LISTING WIPE (proven via live KV
    // inspection): this used to be `writeAllListings(allListings)` —
    // `allListings` at this point is built ENTIRELY from Phase 1-4's fresh
    // CA search results plus Phase 5's `source === "user"` carry-forward.
    // It structurally cannot contain a previously-stored US listing: US
    // Discover listings are tagged `source: "cron"` (see
    // pipeline/us-discover.ts), not "user", so Phase 5's carry-forward
    // filter always excludes them. A bare `writeAllListings(allListings)`
    // is therefore a full replace of listings:all with a CA-only array —
    // it silently discarded every US listing on every single run,
    // regardless of whether Phase 9 (refreshUSDiscover, below) went on to
    // repair it that cycle. On 2026-08-09 Phase 9 could NOT repair it
    // (RentCast quota was already exhausted before this run — see that
    // phase's comment) so the wipe was never undone: listings:all went
    // from ~280 (136 CA + 144 US) to 53 (0 US) in one cron tick.
    //
    // FIX: country-aware merge-write. CA listings are fully rebuilt by this
    // run (that's this pipeline's whole job); everything else (US listings,
    // any future third country) is untouched data this pipeline has no
    // business overwriting, so carry it forward unconditionally.
    // -----------------------------------------------------------------------
    const writeStart = Date.now();
    const nonCaExisting = existingListings.filter((l) => isUSState(l.province));
    const writePayload = [...nonCaExisting, ...allListings];
    // Slug purge must cover the FULL write payload (CA + preserved non-CA),
    // not just this run's CA output — otherwise the purge itself deletes
    // listings:by-slug:* entries for listings we just decided to keep in
    // listings:all, leaving the two stores inconsistent.
    const validSlugs = new Set(writePayload.map((l) => slugify(l.address)));
    const purged = await purgeStaleSlugKeys(validSlugs);
    const result = await writeAllListings(writePayload);
    if (result.refused) {
      log.push(`[pipeline-guard] KV write REFUSED: ${result.refusedReason} — listings:all left untouched this run`);
    } else {
      log.push(
        `KV write: ${result.written} listings (${allListings.length} CA + ${nonCaExisting.length} preserved non-CA), ` +
          `${result.slugs} slugs, ${purged} purged in ${Date.now() - writeStart}ms (${elapsed()}ms total)`
      );
    }

    const reportedListings = result.refused ? existingListings : writePayload;
    const totalListings = reportedListings.length;
    const byProvince = new Map<string, number>();
    const bySource = { cron: 0, user: 0 };
    for (const l of reportedListings) {
      byProvince.set(l.province, (byProvince.get(l.province) || 0) + 1);
      if (l.source === "user") bySource.user++;
      else bySource.cron++;
    }

    // -----------------------------------------------------------------------
    // Phase 9: US Discover refresh (RentCast, quota-guarded — see
    // src/lib/pipeline/us-discover.ts). Runs after the CA refresh has
    // already written its results to KV so a US failure can never undo or
    // block the CA update; isolated in its own try/catch for the same
    // reason — a RentCast outage or quota exhaustion here must not turn
    // this whole cron run into a 500.
    //
    // 2026-08-09 INCIDENT NOTE: before the Phase 8 fix above, this ordering
    // guarantee was false in practice — Phase 8's old full-replace write
    // ALREADY discarded every US listing before this phase ran, and
    // refreshUSDiscover()'s own merge-write only fires when it fetches at
    // least one new US listing (see its `if (allNew.length > 0)` guard in
    // us-discover.ts). On 2026-08-09, RentCast quota was already at 45/45
    // before this phase ran (verified: the `rentcast:discover:*` sweep
    // caches for all 3 configured metros are absent from KV even though
    // their `us-discover:last-refresh:*` meta got stamped at this exact
    // cron's run time — see us-discover.ts's setLastRefresh fix below for
    // why a quota-blocked attempt used to stamp anyway), so every city's
    // fetch returned zero listings, `allNew` stayed empty, and Phase 9
    // silently did nothing to repair Phase 8's damage. With Phase 8 now
    // preserving non-CA listings unconditionally, this phase is back to
    // being a pure enrichment/backfill on top of an already-intact store —
    // its own failure or quota exhaustion no longer has any destructive
    // potential regardless of this phase's outcome.
    // -----------------------------------------------------------------------
    let usDiscover: Awaited<ReturnType<typeof refreshUSDiscover>> | { error: string } | null = null;
    try {
      usDiscover = await refreshUSDiscover();
      log.push(
        `[us-discover] ${usDiscover.totalListings} listings across ${usDiscover.cities.length} cities, ` +
          `quota ${usDiscover.quotaAfter.used}/${usDiscover.quotaAfter.limit} (${elapsed()}ms total)`
      );
      for (const c of usDiscover.cities) {
        log.push(
          `[us-discover] ${c.city}, ${c.state}: ${
            c.skipped ? `skipped (${c.skipReason})` : `${c.scored} scored (${c.skipReason ?? "ok"})`
          }`
        );
      }
      if (usDiscover.activatedMetro) {
        log.push(`[us-discover] slow-fill activated: ${usDiscover.activatedMetro.city}, ${usDiscover.activatedMetro.state}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      usDiscover = { error: message };
      log.push(`[us-discover] failed: ${message}`);
    }

    return NextResponse.json({
      success: true,
      totalListings,
      totalTimeMs: elapsed(),
      byProvince: Object.fromEntries(byProvince),
      bySource,
      cities: summary,
      usDiscover,
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
