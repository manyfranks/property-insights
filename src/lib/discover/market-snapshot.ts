/**
 * market-snapshot.ts
 *
 * Computes a server-side, purely-factual market snapshot for a
 * /discover/[city] page from that city's own live AnalysisResult array —
 * no fabricated commentary, no static per-city copy. Every number here
 * derives from listing.dom, assessment.totalValue, and offer.inTargetRange
 * on the analyses actually rendered on the page.
 *
 * Fail-visible per repo philosophy: when an input a stat needs is missing
 * for this city (e.g. zero listings have an assessment on file), the stat
 * is OMITTED from `stats` and from the intro sentence rather than shown as
 * a fake 0 or "—" placeholder. `assessmentCoverageLimited` flags that case
 * so the caller can render an explicit disclosure note instead.
 */

import { AnalysisResult } from "../types";
import { pct } from "../utils";

export interface MarketSnapshotStat {
  key: string;
  label: string;
  value: string;
}

export interface MarketSnapshot {
  listingCount: number;
  medianDom: number | null;
  avgDom: number | null;
  assessedCount: number;
  aboveAssessedCount: number | null;
  shareAboveAssessedPct: number | null; // 0-1 fraction, null when assessedCount === 0
  avgGapPct: number | null; // signed fraction (positive = above assessed on average)
  inRangeCount: number;
  /** True when zero listings in this city have an assessment on file — the
   * caller should render a short coverage-limited disclosure. */
  assessmentCoverageLimited: boolean;
  /** Stat tiles ready to render, with omitted stats already excluded. */
  stats: MarketSnapshotStat[];
  /** Purely factual, template-assembled intro sentence(s) — no adjectives
   * about market direction, only arithmetic on the numbers above. */
  intro: string;
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function mean(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((sum, n) => sum + n, 0) / nums.length;
}

export function computeMarketSnapshot(
  cityName: string,
  analyses: AnalysisResult[]
): MarketSnapshot {
  const listingCount = analyses.length;

  const domValues = analyses
    .map((a) => a.listing.dom)
    .filter((d): d is number => typeof d === "number" && Number.isFinite(d) && d >= 0);
  const avgDomRaw = mean(domValues);
  const avgDom = avgDomRaw != null ? Math.round(avgDomRaw) : null;
  const medianDom = median(domValues);

  const assessed = analyses.filter(
    (a) => a.assessment?.found && (a.assessment.totalValue ?? 0) > 0
  );
  const assessedCount = assessed.length;
  const assessmentCoverageLimited = assessedCount === 0;

  let aboveAssessedCount: number | null = null;
  let shareAboveAssessedPct: number | null = null;
  let avgGapPct: number | null = null;

  if (assessedCount > 0) {
    aboveAssessedCount = assessed.filter(
      (a) => a.listing.price > a.assessment!.totalValue
    ).length;
    shareAboveAssessedPct = aboveAssessedCount / assessedCount;
    avgGapPct = mean(
      assessed.map((a) => (a.listing.price - a.assessment!.totalValue) / a.assessment!.totalValue)
    );
  }

  const inRangeCount = analyses.filter((a) => a.offer?.inTargetRange).length;

  // -------------------------------------------------------------------
  // Stat tiles — only push a stat whose inputs actually exist.
  // -------------------------------------------------------------------
  const stats: MarketSnapshotStat[] = [
    { key: "listings", label: "Listings Tracked", value: String(listingCount) },
  ];
  if (medianDom != null) {
    stats.push({ key: "median-dom", label: "Median DOM", value: String(medianDom) });
  }
  if (avgDom != null) {
    stats.push({ key: "avg-dom", label: "Avg DOM", value: String(avgDom) });
  }
  if (shareAboveAssessedPct != null && aboveAssessedCount != null) {
    stats.push({
      key: "above-assessed",
      label: "Above Assessed Value",
      value: `${aboveAssessedCount}/${assessedCount} (${pct(shareAboveAssessedPct)})`,
    });
  }
  if (avgGapPct != null) {
    stats.push({
      key: "avg-gap",
      label: "Avg Asking vs. Assessed",
      value: `${avgGapPct >= 0 ? "+" : "-"}${pct(Math.abs(avgGapPct))}`,
    });
  }
  stats.push({ key: "in-range", label: "Offer In Range", value: String(inRangeCount) });

  // -------------------------------------------------------------------
  // Intro sentence — arithmetic-only, no commentary on market direction.
  // -------------------------------------------------------------------
  const sentences: string[] = [];

  const domClause =
    medianDom != null
      ? ` with a median ${medianDom} day${medianDom === 1 ? "" : "s"} on market` +
        (avgDom != null ? ` (average ${avgDom})` : "")
      : "";
  sentences.push(
    `We track ${listingCount} active listing${listingCount === 1 ? "" : "s"} in ${cityName} right now${domClause}.`
  );

  if (assessedCount > 0 && aboveAssessedCount != null && shareAboveAssessedPct != null) {
    const gapClause =
      avgGapPct != null
        ? `, averaging ${pct(Math.abs(avgGapPct))} ${avgGapPct >= 0 ? "above" : "below"} assessment`
        : "";
    sentences.push(
      `Of the ${assessedCount} with a government-assessed value on file, ${aboveAssessedCount} (${pct(shareAboveAssessedPct)}) are listed above that assessed value${gapClause}.`
    );
  } else {
    sentences.push(
      `Assessment coverage is limited in this market, so we can't compute an assessed-value comparison for these listings yet.`
    );
  }

  sentences.push(
    `${inRangeCount} of ${listingCount} ${inRangeCount === 1 ? "has" : "have"} a modeled offer price within our target range.`
  );

  return {
    listingCount,
    medianDom,
    avgDom,
    assessedCount,
    aboveAssessedCount,
    shareAboveAssessedPct,
    avgGapPct,
    inRangeCount,
    assessmentCoverageLimited,
    stats,
    intro: sentences.join(" "),
  };
}
