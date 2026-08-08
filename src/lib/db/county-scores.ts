/**
 * db/county-scores.ts
 *
 * County Investment Scorecard — a composite 0-100 screening score per US
 * county, blending gross rental yield, 5-year home-price appreciation,
 * FEMA disaster risk, rental vacancy, and days-on-market into one ranked
 * number for src/app/us/rankings/investment/.
 *
 * Reads the same `regional_econ` long-format table as db/regional-econ.ts
 * (see that file's header for the table's shape and geography split) but
 * aggregates across ALL US counties in one pass instead of one county at a
 * time, so it lives in its own module rather than growing
 * getCountyMarketPanel into an every-county query.
 *
 * Component metrics (all sourced from regional_econ, see each field's doc
 * comment below for source/vintage):
 *   - grossYield        = (fmr_2br * 12) / median_home_value
 *   - appreciation5yr    = annualized CAGR of fhfa `hpi`, latest year vs. the
 *                          closest year on record at least 4 years earlier
 *                          (mirrors regional-econ.ts's hpiTrend5y window,
 *                          but annualized here since the scorecard needs a
 *                          true compound rate, not a raw multi-year ratio)
 *   - riskScore          = fema_risk_score, as-is (0-100, higher = riskier)
 *   - vacancyRate        = census_acs vacancy_rate, as-is
 *   - medianDom          = realtor_com_via_fred median_dom, latest month on
 *                          record (nullable — FRED's coverage is ~945 of
 *                          3,144 counties)
 *
 * A county is included in the scored set only if grossYield, appreciation5yr,
 * and riskScore can all be computed (the three "required" components per the
 * product spec). vacancyRate and medianDom are optional: a county missing
 * either one still scores, with that component's percentile pinned to 0.50
 * (neutral — neither helps nor hurts the composite) rather than being
 * dropped or skewing the weight distribution. The spec only calls this out
 * explicitly for medianDom ("neutral 50th percentile when null"), but the
 * same treatment is applied to vacancyRate for consistency — ACS vacancy
 * coverage is near-universal, so in practice this branch rarely fires, but
 * a null there shouldn't silently zero out 10% of the score either.
 *
 * Caching: unstable_cache (Next's persistent Data Cache), not a bare
 * module-level memo — this app runs on Vercel, where a module-level
 * `let cache` only survives for the lifetime of one serverless instance and
 * offers no cross-invocation guarantee. unstable_cache is keyed and
 * revalidated (24h, matching HUD FMR/FHFA HPI's annual cadence) independent
 * of instance lifecycle, which is what an aggregate this heavy (one query
 * scanning every US county across 6 metrics) actually needs. No
 * `experimental.cacheComponents` / dynamicIO flag is set in next.config.ts,
 * so unstable_cache (rather than a "use cache" directive) is the supported
 * caching primitive here.
 */

import { unstable_cache } from "next/cache";
import { sql, dbAvailable } from "@/lib/db";
import { US_COUNTIES, type UsCounty } from "@/lib/us-counties";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CountyInvestmentScore {
  fips: string;
  county: string;
  countySlug: string;
  state: string; // USPS
  stateName: string;
  stateSlug: string;

  /** Composite 0-100 score, higher = stronger screen-in signal. Rounded to 1 decimal. */
  score: number;

  /** (fmr_2br * 12) / median_home_value, as a ratio (0.072 = 7.2%). */
  grossYield: number;
  /** Annualized FHFA HPI CAGR over the trailing ~5 years on record, as a ratio. */
  appreciation5yr: number;
  /** FEMA National Risk Index composite score, 0-100, higher = riskier. */
  riskScore: number;
  /** Census ACS rental vacancy rate, as a ratio. Null if ACS has no row for this county. */
  vacancyRate: number | null;
  /** realtor.com (via FRED) median days-on-market, latest month on record. Null if uncovered. */
  medianDom: number | null;

  /** Raw inputs the ratios above were computed from, for display. */
  medianHomeValue: number;
  fmr2br: number;

  /** metric -> year (median_dom also has a month) the value above was recorded for. */
  vintages: {
    medianHomeValue: number;
    fmr2br: number;
    vacancyRate: number | null;
    hpiLatestYear: number;
    hpiOlderYear: number;
    femaRiskScore: number;
    medianDom: { year: number; month: number } | null;
  };
}

// ---------------------------------------------------------------------------
// Internal: raw fetch + per-county aggregation
// ---------------------------------------------------------------------------

interface MetricPoint {
  year: number;
  month: number | null;
  value: number;
}

/** geo_fips -> metric -> points, sorted year desc (month desc within a year). */
function groupRows(rows: Row[]): Map<string, Map<string, MetricPoint[]>> {
  const byFips = new Map<string, Map<string, MetricPoint[]>>();
  for (const r of rows) {
    const fips = String(r.geo_fips);
    const metric = String(r.metric);
    const point: MetricPoint = {
      year: Number(r.year),
      month: r.month == null ? null : Number(r.month),
      value: Number(r.value),
    };
    let byMetric = byFips.get(fips);
    if (!byMetric) {
      byMetric = new Map();
      byFips.set(fips, byMetric);
    }
    const list = byMetric.get(metric) || [];
    list.push(point);
    byMetric.set(metric, list);
  }
  for (const byMetric of byFips.values()) {
    for (const list of byMetric.values()) {
      list.sort((a, b) => b.year - a.year || (b.month ?? -1) - (a.month ?? -1));
    }
  }
  return byFips;
}

/** Latest (highest year/month) point for a metric, or null if absent. */
function latest(byMetric: Map<string, MetricPoint[]>, metric: string): MetricPoint | null {
  const list = byMetric.get(metric);
  return list && list.length > 0 ? list[0] : null;
}

/** Annualized CAGR from the latest hpi point vs. the closest point at least
 * 4 years earlier (a "5-year" window on annual data spans ~4-5 actual
 * years). Null if there's no qualifying older point, or the older value
 * isn't positive. */
function hpiCagr(hpiSeries: MetricPoint[]): { cagr: number; latestYear: number; olderYear: number } | null {
  if (hpiSeries.length === 0) return null;
  const latestPoint = hpiSeries[0];
  const target = latestPoint.year - 4;
  const older = hpiSeries.find((p) => p.year <= target) ?? null;
  if (!older || older.value <= 0) return null;
  const span = latestPoint.year - older.year;
  if (span <= 0) return null;
  const cagr = Math.pow(latestPoint.value / older.value, 1 / span) - 1;
  return { cagr, latestYear: latestPoint.year, olderYear: older.year };
}

// ---------------------------------------------------------------------------
// Percentile ranking
// ---------------------------------------------------------------------------

/** Percentile rank (0-1) of each entry's value within the set, using average
 * rank for ties (standard "mean rank" percentile — a value tied with others
 * gets the midpoint of the tied block's rank range, so identical inputs
 * always produce identical percentiles). A single-entry set maps to 0.5
 * (neither top nor bottom — there's nothing to rank against). */
function percentileRanks(values: number[]): number[] {
  const n = values.length;
  const result = new Array<number>(n);
  if (n === 0) return result;
  if (n === 1) {
    result[0] = 0.5;
    return result;
  }
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  let k = 0;
  while (k < n) {
    let j = k;
    while (j + 1 < n && order[j + 1].v === order[k].v) j++;
    const avgRank = (k + j) / 2; // 0-indexed
    const pct = avgRank / (n - 1);
    for (let m = k; m <= j; m++) result[order[m].i] = pct;
    k = j + 1;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Core computation (uncached — wrapped by the exported, cached function below)
// ---------------------------------------------------------------------------

async function computeCountyInvestmentScores(): Promise<CountyInvestmentScore[]> {
  if (!dbAvailable()) return [];
  const db = sql();

  const rows = (await db`
    SELECT geo_fips, metric, year, month, value
    FROM regional_econ
    WHERE geo_level = 'county'
      AND metric IN ('median_home_value', 'fmr_2br', 'vacancy_rate', 'fema_risk_score', 'median_dom', 'hpi')
  `) as Row[];

  if (rows.length === 0) return [];

  const byFips = groupRows(rows);
  const countyByFips = new Map<string, UsCounty>(US_COUNTIES.map((c) => [c.fips, c]));

  // Pass 1: pull raw components, keep only counties with yield + appreciation + risk.
  interface Candidate {
    county: UsCounty;
    grossYield: number;
    appreciation5yr: number;
    riskScore: number;
    vacancyRate: number | null;
    medianDom: number | null;
    medianHomeValue: number;
    fmr2br: number;
    vintages: CountyInvestmentScore["vintages"];
  }
  const candidates: Candidate[] = [];

  for (const [fips, byMetric] of byFips.entries()) {
    const county = countyByFips.get(fips);
    if (!county) continue; // not in the registry (shouldn't happen — registry is built from this same table)

    const homeValuePoint = latest(byMetric, "median_home_value");
    const fmrPoint = latest(byMetric, "fmr_2br");
    const riskPoint = latest(byMetric, "fema_risk_score");
    const hpiSeries = byMetric.get("hpi") || [];
    const appreciation = hpiCagr(hpiSeries);

    if (!homeValuePoint || homeValuePoint.value <= 0) continue;
    if (!fmrPoint) continue;
    if (!riskPoint) continue;
    if (!appreciation) continue;

    const grossYield = (fmrPoint.value * 12) / homeValuePoint.value;

    const vacancyPoint = latest(byMetric, "vacancy_rate");
    const domPoint = latest(byMetric, "median_dom");

    candidates.push({
      county,
      grossYield,
      appreciation5yr: appreciation.cagr,
      riskScore: riskPoint.value,
      vacancyRate: vacancyPoint ? vacancyPoint.value : null,
      medianDom: domPoint ? domPoint.value : null,
      medianHomeValue: homeValuePoint.value,
      fmr2br: fmrPoint.value,
      vintages: {
        medianHomeValue: homeValuePoint.year,
        fmr2br: fmrPoint.year,
        vacancyRate: vacancyPoint ? vacancyPoint.year : null,
        hpiLatestYear: appreciation.latestYear,
        hpiOlderYear: appreciation.olderYear,
        femaRiskScore: riskPoint.year,
        medianDom: domPoint ? { year: domPoint.year, month: domPoint.month ?? 0 } : null,
      },
    });
  }

  // Pass 2: percentile-normalize each component across the candidate set.
  const yieldPct = percentileRanks(candidates.map((c) => c.grossYield));
  const apprPct = percentileRanks(candidates.map((c) => c.appreciation5yr));
  const riskPct = percentileRanks(candidates.map((c) => c.riskScore)); // higher raw score = higher pct = riskier

  const vacIndices: number[] = [];
  const vacValues: number[] = [];
  candidates.forEach((c, i) => {
    if (c.vacancyRate != null) {
      vacIndices.push(i);
      vacValues.push(c.vacancyRate);
    }
  });
  const vacPctRaw = percentileRanks(vacValues);
  const vacPct = new Array<number>(candidates.length).fill(0.5);
  vacIndices.forEach((idx, k) => (vacPct[idx] = vacPctRaw[k]));

  const domIndices: number[] = [];
  const domValues: number[] = [];
  candidates.forEach((c, i) => {
    if (c.medianDom != null) {
      domIndices.push(i);
      domValues.push(c.medianDom);
    }
  });
  const domPctRaw = percentileRanks(domValues);
  const domPct = new Array<number>(candidates.length).fill(0.5);
  domIndices.forEach((idx, k) => (domPct[idx] = domPctRaw[k]));

  const WEIGHTS = { yield: 0.35, appreciation: 0.25, risk: 0.2, vacancy: 0.1, dom: 0.1 };

  const results: CountyInvestmentScore[] = candidates.map((c, i) => {
    const composite =
      WEIGHTS.yield * yieldPct[i] +
      WEIGHTS.appreciation * apprPct[i] +
      WEIGHTS.risk * (1 - riskPct[i]) + // inverted: lower risk -> higher score
      WEIGHTS.vacancy * (1 - vacPct[i]) + // inverted: lower vacancy -> higher score
      WEIGHTS.dom * (1 - domPct[i]); // inverted: fewer days on market -> higher score

    return {
      fips: c.county.fips,
      county: c.county.county,
      countySlug: c.county.countySlug,
      state: c.county.state,
      stateName: c.county.stateName,
      stateSlug: c.county.stateSlug,
      score: Math.round(composite * 1000) / 10, // 0-100, 1 decimal
      grossYield: c.grossYield,
      appreciation5yr: c.appreciation5yr,
      riskScore: c.riskScore,
      vacancyRate: c.vacancyRate,
      medianDom: c.medianDom,
      medianHomeValue: c.medianHomeValue,
      fmr2br: c.fmr2br,
      vintages: c.vintages,
    };
  });

  results.sort((a, b) => b.score - a.score);
  return results;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const getCountyInvestmentScoresCached = unstable_cache(
  computeCountyInvestmentScores,
  ["county-investment-scores-v1"],
  { revalidate: 86400 } // 24h — matches HUD FMR / FHFA HPI's annual refresh cadence
);

/**
 * Every US county with a computable score (yield + appreciation + risk all
 * present), sorted best-to-worst by composite score. Backs the national
 * /us/rankings/investment table (which slices its own top-100) and is the
 * source array for getStateInvestmentScores below.
 *
 * Returns [] if the DB isn't configured — callers should treat that as "no
 * data available" (e.g. notFound() or an empty-state), not an error.
 */
export async function getCountyInvestmentScores(): Promise<CountyInvestmentScore[]> {
  return getCountyInvestmentScoresCached();
}

/**
 * Same computation as getCountyInvestmentScores, but bypassing
 * unstable_cache entirely — a direct DB query every call. unstable_cache
 * requires a live Next.js request/build context (it throws "incrementalCache
 * missing" outside one), so this is the entry point for one-off scripts and
 * ad-hoc verification (`npx tsx -e '...'`) run outside the Next.js runtime.
 * App code should use getCountyInvestmentScores, not this.
 */
export const getCountyInvestmentScoresUncached = computeCountyInvestmentScores;

/**
 * Every scored county in one state, sorted best-to-worst. Implemented as a
 * plain filter over getCountyInvestmentScores()'s full (cached) result
 * rather than a separate scoped DB query: the state page needs ALL of a
 * state's counties (not just its top slice), the full aggregate is already
 * being computed and cached for the national page, and a state has at most
 * a few hundred counties to filter — cheaper than a second heavy query with
 * its own cache entry per state.
 */
export async function getStateInvestmentScores(stateSlug: string): Promise<CountyInvestmentScore[]> {
  const all = await getCountyInvestmentScores();
  return all.filter((c) => c.stateSlug === stateSlug);
}
