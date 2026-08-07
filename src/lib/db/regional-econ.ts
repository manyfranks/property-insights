/**
 * db/regional-econ.ts
 *
 * Reader for US county-level regional economic & housing indicators
 * (regional_econ table), populated by scripts/ingest-us-*.ts (Census ACS,
 * FHFA HPI, HUD FMR, FEMA NRI). Backed by Neon Postgres.
 *
 * Follows db/user-events.ts's conventions: dbAvailable() guard on every
 * export, defensive row typing (no throwing on a missing DATABASE_URL —
 * callers get null/empty results and can fall back to other data sources).
 */

import { sql, dbAvailable } from "@/lib/db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** metric name -> the most recent year a value is on record for, e.g.
 * { median_home_value: 2024, hpi: 2025, fmr_2br: 2026 } */
export type MetricVintages = Record<string, number>;

export interface CountyMarketPanel {
  /** normalized "US-SSCCC" form */
  countyFips: string;

  medianHomeValue: number | null;
  medianHomeValueMoe: number | null;
  medianGrossRent: number | null;
  medianGrossRentMoe: number | null;
  vacancyRate: number | null;
  vacancyRateMoe: number | null;
  medianHouseholdIncome: number | null;
  medianHouseholdIncomeMoe: number | null;

  fmrStudio: number | null;
  fmr1br: number | null;
  fmr2br: number | null;
  fmr3br: number | null;
  fmr4br: number | null;

  /** FHFA All-Transactions HPI, most recent year on record */
  hpiLatest: number | null;
  /** (latest / value ~5 years prior) - 1, as a ratio (0.18 = +18%). Null if
   * there isn't a data point at least 4 years before the latest one. */
  hpiTrend5y: number | null;

  femaRiskScore: number | null;
  femaEalScore: number | null;
  /** fema_<hazard>_score metric name (without the "fema_" prefix or "_score"
   * suffix, e.g. "wfir", "hrcn") -> value */
  femaHazardScores: Record<string, number>;

  /** metric name -> year the value shown above was recorded for */
  vintages: MetricVintages;
}

export interface AcsCountyMedian {
  value: number;
  year: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Accepts either a bare 5-digit county FIPS ("06075") or the stored
 * "US-SSCCC" form and always returns the latter. */
function normalizeCountyFips(countyFips: string): string {
  const trimmed = countyFips.trim().toUpperCase();
  if (trimmed.startsWith("US-")) return trimmed;
  return `US-${trimmed}`;
}

interface MetricRow {
  metric: string;
  year: number;
  value: number;
}

/** Latest (highest-year) row per metric, plus the full per-metric year series
 * (needed for hpi's 5-year trend, which needs more than just the latest point). */
function groupByMetric(rows: MetricRow[]): Map<string, MetricRow[]> {
  const byMetric = new Map<string, MetricRow[]>();
  for (const r of rows) {
    const list = byMetric.get(r.metric) || [];
    list.push(r);
    byMetric.set(r.metric, list);
  }
  for (const list of byMetric.values()) list.sort((a, b) => b.year - a.year);
  return byMetric;
}

function latestValue(byMetric: Map<string, MetricRow[]>, metric: string): number | null {
  const list = byMetric.get(metric);
  return list && list.length > 0 ? list[0].value : null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Full market panel for a US county: ACS demographics, HUD FMR by bedroom
 * count, FHFA HPI level + 5-year trend, FEMA NRI risk scores.
 *
 * Returns null if the DB isn't configured or no rows exist for the county
 * (callers should treat that as "no US county data available", not an error).
 */
export async function getCountyMarketPanel(countyFips: string): Promise<CountyMarketPanel | null> {
  if (!dbAvailable()) return null;

  const geoFips = normalizeCountyFips(countyFips);
  const db = sql();

  const rows = (await db`
    SELECT metric, year, value
    FROM regional_econ
    WHERE geo_fips = ${geoFips}
    ORDER BY metric, year DESC
  `) as Row[];

  if (rows.length === 0) return null;

  const byMetric = groupByMetric(
    rows.map((r) => ({ metric: String(r.metric), year: Number(r.year), value: Number(r.value) }))
  );

  // --- FHFA HPI 5-year trend: latest value vs. the closest year that is at
  // least 4 years before the latest (a "5-year" window measured on annual
  // data is inherently ~4-5 years apart, not necessarily an exact 5). ---
  const hpiSeries = byMetric.get("hpi") || [];
  let hpiTrend5y: number | null = null;
  if (hpiSeries.length > 0) {
    const latest = hpiSeries[0];
    const target = latest.year - 5;
    // closest year <= target, i.e. at least ~5 years back
    const older = hpiSeries.find((p) => p.year <= target) ?? null;
    if (older && older.value > 0) {
      hpiTrend5y = latest.value / older.value - 1;
    }
  }

  // --- FEMA per-hazard scores: every metric matching fema_<hazard>_score
  // other than the two composites. ---
  const femaHazardScores: Record<string, number> = {};
  for (const [metric, list] of byMetric.entries()) {
    if (!metric.startsWith("fema_") || !metric.endsWith("_score")) continue;
    if (metric === "fema_risk_score" || metric === "fema_eal_score") continue;
    const hazardKey = metric.slice("fema_".length, metric.length - "_score".length);
    if (list.length > 0) femaHazardScores[hazardKey] = list[0].value;
  }

  // --- vintages: latest year used, per metric actually present ---
  const vintages: MetricVintages = {};
  for (const [metric, list] of byMetric.entries()) {
    if (list.length > 0) vintages[metric] = list[0].year;
  }

  return {
    countyFips: geoFips,

    medianHomeValue: latestValue(byMetric, "median_home_value"),
    medianHomeValueMoe: latestValue(byMetric, "median_home_value_moe"),
    medianGrossRent: latestValue(byMetric, "median_gross_rent"),
    medianGrossRentMoe: latestValue(byMetric, "median_gross_rent_moe"),
    vacancyRate: latestValue(byMetric, "vacancy_rate"),
    vacancyRateMoe: latestValue(byMetric, "vacancy_rate_moe"),
    medianHouseholdIncome: latestValue(byMetric, "median_household_income"),
    medianHouseholdIncomeMoe: latestValue(byMetric, "median_household_income_moe"),

    fmrStudio: latestValue(byMetric, "fmr_studio"),
    fmr1br: latestValue(byMetric, "fmr_1br"),
    fmr2br: latestValue(byMetric, "fmr_2br"),
    fmr3br: latestValue(byMetric, "fmr_3br"),
    fmr4br: latestValue(byMetric, "fmr_4br"),

    hpiLatest: latestValue(byMetric, "hpi"),
    hpiTrend5y,

    femaRiskScore: latestValue(byMetric, "fema_risk_score"),
    femaEalScore: latestValue(byMetric, "fema_eal_score"),
    femaHazardScores,

    vintages,
  };
}

/**
 * ACS median home value for a county, for use as an assessment-value
 * fallback when no local assessment record exists (mirrors how the BC
 * adapter falls back to an area median — see src/lib/assessment/bc.ts).
 *
 * Returns null if the DB isn't configured or no ACS median_home_value row
 * exists for the county.
 */
export async function getAcsCountyMedian(countyFips: string): Promise<AcsCountyMedian | null> {
  if (!dbAvailable()) return null;

  const geoFips = normalizeCountyFips(countyFips);
  const db = sql();

  const rows = (await db`
    SELECT year, value
    FROM regional_econ
    WHERE geo_fips = ${geoFips}
      AND metric = 'median_home_value'
      AND source = 'census_acs'
    ORDER BY year DESC
    LIMIT 1
  `) as Row[];

  if (rows.length === 0) return null;
  const row = rows[0];
  if (row.value == null) return null;

  return { value: Number(row.value), year: Number(row.year) };
}
