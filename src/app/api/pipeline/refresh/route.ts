/**
 * /api/pipeline/refresh
 *
 * Semi-daily cron job that:
 * 1. Refreshes listings from Zoocasa for each city
 * 2. Fetches details for new listings
 * 3. Pre-computes scores, offers, and narratives
 * 4. Writes enriched data to KV
 *
 * Vercel Cron: 7am + 4pm PT (0 14,23 * * *)
 */

import { NextResponse } from "next/server";
import { searchListings, fetchDetail } from "@/lib/zoocasa";
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
];

function stripPrecomputed(listing: Listing): Listing {
  const clean = { ...listing };
  for (const f of PRE_FIELDS) {
    delete (clean as Record<string, unknown>)[f];
  }
  return clean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function GET(request: Request) {
  // Verify cron secret — always required
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
          kept.push({ ...existing, dom: candidate.dom });
        } else {
          needsDetail.push(candidate);
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
    // Step 2: Enrich new listings (no pre-computed data)
    // -----------------------------------------------------------------------
    const enrichStart = Date.now();
    let enriched = 0;

    for (let i = 0; i < allListings.length; i++) {
      if (allListings[i].preNarrative) continue; // Already enriched

      // Check time budget: leave 30s for KV write
      if (Date.now() - startTime > 250_000) {
        log.push(`Time budget reached, skipping enrichment for remaining ${allListings.length - i} listings`);
        // Give unenriched listings a deterministic narrative
        for (let j = i; j < allListings.length; j++) {
          if (!allListings[j].preNarrative) {
            allListings[j] = await enrichListing(allListings[j], { skipLlm: true });
            enriched++;
          }
        }
        break;
      }

      try {
        allListings[i] = await enrichListing(allListings[i]);
        enriched++;
        // Rate limit LLM calls
        if (allListings[i].preTier !== "WATCH") {
          await sleep(1500);
        }
      } catch (err) {
        log.push(`Enrich failed for ${allListings[i].address}: ${err}`);
        // Fall back to deterministic
        allListings[i] = await enrichListing(allListings[i], { skipLlm: true });
        enriched++;
      }
    }

    log.push(`Enriched ${enriched} listings in ${Date.now() - enrichStart}ms`);

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
    for (const l of allListings) {
      byProvince.set(l.province, (byProvince.get(l.province) || 0) + 1);
    }

    return NextResponse.json({
      success: true,
      totalListings,
      totalTimeMs: totalTime,
      byProvince: Object.fromEntries(byProvince),
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
