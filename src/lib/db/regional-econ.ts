/**
 * db/regional-econ.ts
 *
 * Reader for regional economic & housing indicators (regional_econ table),
 * backed by Neon Postgres. Two geographies live side by side in the same
 * table (distinguished by geo_level/geo_fips prefix, never mixed):
 *
 *   - US counties (geo_level='county', geo_fips="US-SSCCC"), populated by
 *     scripts/ingest-us-*.ts (Census ACS, FHFA HPI, HUD FMR, FEMA NRI,
 *     realtor.com median-DOM via FRED).
 *   - CA CMAs (geo_level='cma', geo_fips="CA-CMA-{code}", where {code} is
 *     the Statistics Canada Standard Geographical Classification CMA/CA
 *     code — the same numbering StatCan's WDS and CMHC's own RMS tables
 *     use), populated by scripts/ingest-ca-nhpi.ts (StatCan New Housing
 *     Price Index, monthly) and scripts/ingest-ca-cmhc-rent.ts (CMHC Rental
 *     Market Survey average rent by bedroom count, annual).
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

export interface CountyMedianDom {
  days: number;
  year: number;
  month: number;
  /** "same_month" = the requested calendar month's most recent occurrence
   * (seasonality-correct — DOM has a strong seasonal pattern, so "July last
   * year" is a better baseline for a listing seen in July than whatever the
   * single most-recent data point happens to be). "latest" = no same-month
   * observation existed, fell back to the most recent month on record for
   * the county regardless of calendar alignment. */
  baseline: "same_month" | "latest";
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

/**
 * County median days-on-market (realtor.com via FRED, scripts/ingest-us-dom.ts)
 * — the baseline the relative-DOM signal (src/lib/pipeline/us-discover.ts's
 * scoreUSListing) divides a listing's own DOM by.
 *
 * `month` (1-12, calendar month) is optional context for which baseline to
 * prefer: given a month, this looks for that same calendar month's most
 * recent year on record first (baseline: "same_month") — DOM is seasonal
 * (slower in winter, faster in spring/summer), so "this same month last
 * year" is a materially better comparison than an arbitrary "most recent
 * data point" which could be 6 months off-season. Falls back to the single
 * latest month on record (baseline: "latest") if no same-month row exists,
 * or if `month` wasn't passed at all. Returns null if the DB isn't
 * configured or the county has no median_dom rows (county not covered by
 * FRED's MEDDAYONMAR series — not every county has one, see
 * scripts/ingest-us-dom.ts's hit-rate report).
 */
export async function getCountyMedianDom(countyFips: string, month?: number): Promise<CountyMedianDom | null> {
  if (!dbAvailable()) return null;

  const geoFips = normalizeCountyFips(countyFips);
  const db = sql();

  const rows = (await db`
    SELECT year, month, value
    FROM regional_econ
    WHERE geo_fips = ${geoFips}
      AND metric = 'median_dom'
    ORDER BY year DESC, month DESC
  `) as Row[];

  if (rows.length === 0) return null;

  if (month != null) {
    const sameMonth = rows.find((r) => Number(r.month) === month);
    if (sameMonth && sameMonth.value != null) {
      return { days: Number(sameMonth.value), year: Number(sameMonth.year), month: Number(sameMonth.month), baseline: "same_month" };
    }
  }

  const latest = rows[0];
  if (latest.value == null || latest.month == null) return null;
  return { days: Number(latest.value), year: Number(latest.year), month: Number(latest.month), baseline: "latest" };
}

// ---------------------------------------------------------------------------
// CA CMA registry — the "which Census Metropolitan Area does this listing's
// city belong to" lookup shared by both CA ingest scripts and the property
// page's Investor Yield / Market Momentum cards. Codes are Statistics
// Canada's Standard Geographical Classification CMA/CA codes (verified live
// against the WDS getCubeMetadata response for productId 18100205 — each
// code below is that response's geography member's classificationCode, not
// an internal cube memberId, so it's stable across StatCan cubes and matches
// CMHC's own CMA numbering in its Rental Market Survey tables).
//
// Ottawa-Gatineau (505) is a cross-provincial CMA that both StatCan's NHPI
// cube and CMHC's RMS tables split into "Qué. part" / "Ont. part" rows — our
// Ottawa listings are all Ontario-side, so both ingest scripts pull the
// Ontario-part figures but store them under the single unified CMA code 505
// (the CMA our Ottawa listings actually belong to), not a synthetic
// province-split code.
// ---------------------------------------------------------------------------

export interface CaCmaTarget {
  /** Statistics Canada SGC CMA/CA code, e.g. 935 for Victoria. */
  code: number;
  /** Display name used in card copy, e.g. "Victoria" (Ottawa-Gatineau is the
   * one exception — kept as the full hyphenated CMA name since "Ottawa" on
   * its own would misrepresent the cross-provincial geography the rent/NHPI
   * figures actually describe). */
  name: string;
  /** Listing.city values (as returned by src/lib/zoocasa.ts) that belong to
   * this CMA — the namesake city plus any metro-sibling municipality the CA
   * pipeline currently covers. Narrower than zoocasa.ts's CITY_SIBLINGS
   * (that list exists for a different purpose — fetch-layer province-wide-
   * fallback detection — and includes many municipalities this product
   * doesn't fetch listings for at all). */
  cities: string[];
}

export const CA_CMA_TARGETS: CaCmaTarget[] = [
  { code: 935, name: "Victoria", cities: ["Victoria", "Saanich", "Langford"] },
  { code: 933, name: "Vancouver", cities: ["Vancouver", "Surrey"] },
  { code: 825, name: "Calgary", cities: ["Calgary"] },
  { code: 835, name: "Edmonton", cities: ["Edmonton"] },
  { code: 535, name: "Toronto", cities: ["Toronto"] },
  { code: 537, name: "Hamilton", cities: ["Hamilton"] },
  { code: 505, name: "Ottawa-Gatineau", cities: ["Ottawa"] },
  { code: 602, name: "Winnipeg", cities: ["Winnipeg"] },
];

function normalizeCaCmaFips(code: number | string): string {
  return `CA-CMA-${code}`;
}

/** metric name for a CMHC average-rent row at a given bedroom count — shared
 * by scripts/ingest-ca-cmhc-rent.ts (writer) and getCmaRent (reader) so the
 * two can never drift apart. 0 = studio, 3 = "3 Bedroom +" (CMHC's own top
 * bucket — there's no separate 4BR+ series in the RMS tables). */
export function cmaRentMetric(beds: number): string {
  if (beds <= 0) return "cmhc_rent_studio";
  if (beds >= 3) return "cmhc_rent_3br";
  return `cmhc_rent_${beds}br`;
}

/**
 * Resolves a CA listing's city to its CMA — the geography key both CA cards
 * (Investor Yield, Market Momentum) look up market context for. Returns null
 * for cities outside CA_CMA_TARGETS (no CMA context available; callers
 * should hide the cards, not show an empty/misleading one).
 */
export function getCmaFipsForCity(city: string): { fips: string; cmaName: string; cmaCode: number } | null {
  const cityLower = city.trim().toLowerCase();
  for (const target of CA_CMA_TARGETS) {
    if (target.cities.some((c) => c.toLowerCase() === cityLower)) {
      return { fips: normalizeCaCmaFips(target.code), cmaName: target.name, cmaCode: target.code };
    }
  }
  return null;
}

export interface CmaMomentum {
  cmaFips: string;
  nhpiLatest: number;
  /** Calendar month/year the latest NHPI reading is for. */
  nhpiVintage: { year: number; month: number };
  /** (latest / value-12-months-earlier) - 1. Null when there's no
   * observation exactly 12 months before the latest one (a gap in the
   * ingested series). */
  trend12moPct: number | null;
  /** Same as trend12moPct but 36 months back. */
  trend36moPct: number | null;
}

/**
 * CMA-level New Housing Price Index momentum (scripts/ingest-ca-nhpi.ts,
 * StatCan table 18-10-0205-01 "Total (house and land)" series). NHPI tracks
 * *new construction* pricing, not resale comparables — the Market Momentum
 * card's copy is expected to disclose that distinction, not this function.
 *
 * Returns null when the DB isn't configured or the CMA has no nhpi rows on
 * record (no ingest has run for it, or getCmaFipsForCity returned null
 * upstream).
 */
export async function getCmaMomentum(cmaFips: string): Promise<CmaMomentum | null> {
  if (!dbAvailable()) return null;
  const db = sql();

  const rows = (await db`
    SELECT year, month, value
    FROM regional_econ
    WHERE geo_fips = ${cmaFips} AND metric = 'nhpi'
    ORDER BY year DESC, month DESC
  `) as Row[];
  if (rows.length === 0) return null;

  const series = rows
    .filter((r) => r.month != null && r.value != null)
    .map((r) => {
      const year = Number(r.year);
      const month = Number(r.month);
      return { year, month, value: Number(r.value), key: year * 12 + month };
    })
    .sort((a, b) => b.key - a.key);
  if (series.length === 0) return null;

  const latest = series[0];
  const findOffset = (months: number) => series.find((p) => p.key === latest.key - months) ?? null;
  const p12 = findOffset(12);
  const p36 = findOffset(36);

  return {
    cmaFips,
    nhpiLatest: latest.value,
    nhpiVintage: { year: latest.year, month: latest.month },
    trend12moPct: p12 && p12.value > 0 ? latest.value / p12.value - 1 : null,
    trend36moPct: p36 && p36.value > 0 ? latest.value / p36.value - 1 : null,
  };
}

export interface CmaRent {
  monthlyRent: number;
  /** Survey year the rent figure was published for (CMHC's October RMS). */
  vintage: number;
}

/**
 * CMA-level CMHC average rent for a given bedroom count
 * (scripts/ingest-ca-cmhc-rent.ts, CMHC Rental Market Survey "Turnover
 * units" figures — the rent charged when a unit is newly re-rented, i.e.
 * the closest published proxy for what a new landlord could actually charge
 * today, as opposed to "Non-turnover units" which reflects sitting tenants'
 * often below-market rent).
 *
 * Returns null when the DB isn't configured or the CMA/bedroom-count
 * combination has no row on record.
 */
export async function getCmaRent(cmaFips: string, beds: number): Promise<CmaRent | null> {
  if (!dbAvailable()) return null;
  const db = sql();
  const metric = cmaRentMetric(beds);

  const rows = (await db`
    SELECT year, value
    FROM regional_econ
    WHERE geo_fips = ${cmaFips} AND metric = ${metric}
    ORDER BY year DESC
    LIMIT 1
  `) as Row[];
  if (rows.length === 0) return null;
  const row = rows[0];
  if (row.value == null) return null;

  return { monthlyRent: Number(row.value), vintage: Number(row.year) };
}
