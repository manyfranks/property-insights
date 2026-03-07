/**
 * pipeline/city-run.ts
 *
 * Main per-city pipeline orchestrator.
 *
 * PIPELINE STAGES:
 *   1. FETCH      — Two API calls (oldest + cheapest) via fetcher.ts
 *   2. FILTER     — Hard exclusions + profile price/type gate via exclusions.ts
 *   3. DEDUP      — Remove MLS numbers already surfaced in previous runs (KV)
 *   4. SCORE      — Language-first scoring with DOM multiplier via scorer.ts
 *   5. RANK       — Sort by score descending
 *   6. TOP-N      — Return top N picks (default: 5)
 *   7. MARK SEEN  — Write picked MLS numbers to KV so they never repeat
 *
 * USAGE:
 *   const result = await runCityPipeline("Victoria", "BC", { limit: 5 });
 */

import { CITY_BOUNDS } from "../data/city-bounds";
import { fetchCandidates } from "./fetcher";
import { checkExclusion, FilterProfile, PROFILES, ProfileName } from "./exclusions";
import { scoreV3, ScoreV3Result } from "./scorer";
import { filterUnseen, markSeen } from "./dedup";
import { Listing } from "../types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PipelineOptions {
  /** Filter profile to apply. Defaults to SFH_BUYER. */
  profile?: ProfileName;

  /** Max number of picks to return. Defaults to 5. */
  limit?: number;

  /**
   * If true, don't write to the seen store and don't read from it.
   * Useful for previewing results without consuming picks.
   */
  dryRun?: boolean;
}

export interface PickedListing {
  listing: Listing;
  score: ScoreV3Result;
  /** Why this listing made the top picks (human summary) */
  summary: string;
}

export interface PipelineResult {
  city: string;
  province: string;
  profile: ProfileName;
  runAt: string;   // ISO timestamp

  picks: PickedListing[];

  // Diagnostic counts (useful for monitoring)
  stats: {
    fetched: number;
    afterExclusion: number;
    afterDedup: number;
    scored: number;
    returned: number;
    internalDuplicates: number;
    exclusionReasons: Record<string, number>;
  };

  /** True if KV dedup was active (false = in-memory only, will reset on cold start) */
  dedupPersisted: boolean;

  /** Warning messages (non-fatal) */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Pick summary generator (deterministic, no LLM)
// ---------------------------------------------------------------------------

function buildSummary(listing: Listing, score: ScoreV3Result): string {
  const parts: string[] = [];

  if (score.tier === "HOT") parts.push("🔴 HOT pick.");
  else if (score.tier === "WARM") parts.push("🟡 WARM pick.");
  else parts.push("🔵 WATCH.");

  if (score.signals.length > 0) {
    parts.push(`Key signals: ${score.signals.slice(0, 3).join(", ")}.`);
  }

  if (listing.dom > 90) {
    parts.push(`${listing.dom} DOM — seller has been waiting ${Math.floor(listing.dom / 30)} months.`);
  } else if (listing.dom > 0) {
    parts.push(`${listing.dom} DOM.`);
  } else {
    parts.push("Recently listed or relisted.");
  }

  if (listing.price > 0) {
    parts.push(`Listed at $${listing.price.toLocaleString()}.`);
  }

  if (score.domMultiplier > 1.0) {
    parts.push(`DOM added ${Math.round((score.domMultiplier - 1) * 100)}% score boost.`);
  }

  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

export async function runCityPipeline(
  city: string,
  province: string,
  options: PipelineOptions = {}
): Promise<PipelineResult> {
  const runAt = new Date().toISOString();
  const profileName: ProfileName = options.profile ?? "SFH_BUYER";
  const profile: FilterProfile = PROFILES[profileName];
  const limit = options.limit ?? 5;
  const dryRun = options.dryRun ?? false;
  const warnings: string[] = [];

  // --- Validate city ---
  const bounds = CITY_BOUNDS[city];
  if (!bounds) {
    throw new Error(`Unknown city: "${city}". Add it to CITY_BOUNDS in city-bounds.ts.`);
  }

  // --- Stage 1: Fetch ---
  let fetchResult;
  try {
    fetchResult = await fetchCandidates(city, province, bounds, profile);
  } catch (err) {
    throw new Error(`Fetch failed for ${city}: ${err instanceof Error ? err.message : String(err)}`);
  }

  const { listings: candidates, internalDuplicates } = fetchResult;
  const exclusionReasons: Record<string, number> = {};

  // --- Stage 2: Filter (hard exclusions + profile gate) ---
  const afterFilter: Listing[] = [];
  for (const listing of candidates) {
    const { excluded, reason } = checkExclusion(listing, profile);
    if (excluded) {
      const key = reason?.split(":")[0] ?? "Unknown";
      exclusionReasons[key] = (exclusionReasons[key] ?? 0) + 1;
    } else {
      afterFilter.push(listing);
    }
  }

  // --- Stage 3: Dedup against seen store ---
  let afterDedup: Listing[] = afterFilter;
  let dedupPersisted = false;

  if (!dryRun && afterFilter.length > 0) {
    try {
      const mlsNumbers = afterFilter
        .map((l) => l.mlsNumber)
        .filter(Boolean) as string[];

      const unseenMls = await filterUnseen(city, mlsNumbers);
      const unseenSet = new Set(unseenMls);
      afterDedup = afterFilter.filter(
        (l) => !l.mlsNumber || unseenSet.has(l.mlsNumber)
      );

      dedupPersisted = Boolean(process.env.KV_REST_API_URL);
    } catch {
      warnings.push("Dedup store unavailable — all candidates treated as new.");
      afterDedup = afterFilter;
    }
  } else if (dryRun) {
    warnings.push("Dry run — dedup skipped, seen store not updated.");
  }

  // --- Stage 4: Score ---
  const scored = afterDedup.map((listing) => ({
    listing,
    score: scoreV3(listing),
  }));

  // --- Stage 5: Rank by score ---
  scored.sort((a, b) => b.score.total - a.score.total);

  // --- Stage 6: Top N ---
  const topN = scored.slice(0, limit);

  // --- Stage 7: Mark seen ---
  if (!dryRun && topN.length > 0) {
    const pickedMls = topN
      .map((p) => p.listing.mlsNumber)
      .filter(Boolean) as string[];

    try {
      await markSeen(city, pickedMls);
    } catch {
      warnings.push("Could not write to seen store — picks may repeat on next run.");
    }
  }

  // --- Build picks ---
  const picks: PickedListing[] = topN.map(({ listing, score }) => ({
    listing,
    score,
    summary: buildSummary(listing, score),
  }));

  return {
    city,
    province,
    profile: profileName,
    runAt,
    picks,
    stats: {
      fetched: candidates.length,
      afterExclusion: afterFilter.length,
      afterDedup: afterDedup.length,
      scored: scored.length,
      returned: picks.length,
      internalDuplicates,
      exclusionReasons,
    },
    dedupPersisted,
    warnings,
  };
}
