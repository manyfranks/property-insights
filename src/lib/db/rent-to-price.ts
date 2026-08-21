/**
 * db/rent-to-price.ts
 *
 * Reader for the Rent-to-Price / "1% Rule" county rankings
 * (/us/rankings/rent-to-price). Built on the same `regional_econ` table as
 * db/regional-econ.ts (see that file's header for the full geography/source
 * model) — this module just adds a ranking-shaped query on top of two
 * metrics that already live there:
 *
 *   - hud_fmr.fmr_2br        (source='hud_fmr',    year=2026, 3,077 counties)
 *   - census_acs.median_home_value (source='census_acs', year=2024, 3,217 counties)
 *   - census_acs.median_gross_rent (source='census_acs', year=2024, secondary —
 *     shown when present, never required)
 *
 * VINTAGE CAVEAT (honest, load-bearing): FMR is 2026-vintage and
 * median_home_value is 2024-vintage. HUD republishes FMR annually (ahead of
 * the federal fiscal year) while Census ACS 5-year estimates lag further
 * behind their release. Comparing the two is therefore a *cross-vintage*
 * ratio, not a same-year snapshot — home values are ~2 years older than the
 * rent figure they're being divided by. In a rising-price market this
 * overstates today's true yield; in a falling one it understates it. The
 * ratio is a useful screening signal, not a precise point-in-time yield —
 * every surface that renders it must disclose this (see the page-level
 * methodology sections).
 */

import { sql, dbAvailable } from "@/lib/db";
import { US_COUNTIES, type UsCounty } from "@/lib/us-counties";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export interface RentToPriceCounty {
  county: UsCounty;
  /** HUD FMR, 2-bedroom, monthly ($) */
  fmr2br: number;
  fmrYear: number;
  /** Census ACS median home value ($) */
  medianHomeValue: number;
  homeValueYear: number;
  /** Census ACS median gross rent ($/mo), when on record — secondary column,
   * distinct from fmr2br (HUD's 40th-percentile estimate vs. ACS's survey
   * of actual reported rents). Null when ACS has no row for the county. */
  medianGrossRent: number | null;
  /** fmr2br / medianHomeValue, as a fraction (0.01 = 1%) */
  monthlyRatio: number;
  /** monthlyRatio * 12, as a fraction */
  annualYield: number;
  /** monthlyRatio >= 0.01 — the classic "1% rule" screen */
  passesOnePercentRule: boolean;
}

export interface RentToPriceRankings {
  counties: RentToPriceCounty[];
  /** counties.length restricted to passesOnePercentRule */
  passCount: number;
  /** distinct FMR vintage(s) actually present across the returned rows —
   * normally a single year, but kept as a set in case HUD's rolling release
   * ever leaves a mixed vintage in the table momentarily. */
  fmrYears: number[];
  homeValueYears: number[];
}

/**
 * Rent-to-price ("1% rule") ranking across every US county that has both a
 * fmr_2br row and a median_home_value row on record, sorted descending by
 * monthly ratio (best rent-relative-to-price first).
 *
 * Caching: this module has no in-process cache of its own — it relies on the
 * caller's Next.js route-level revalidation (ISR, `export const revalidate`)
 * the same way db/regional-econ.ts's callers do. That's the right choice
 * here specifically because the ranking pages are static/near-static (HUD
 * FMR and ACS medians only change on their annual release cadence — see the
 * /rent page's `revalidate = 86400`), so a full county scan on every ISR
 * regen (roughly daily, and reused for every visitor in between) is cheap
 * enough that a bespoke additional cache would just be complexity without a
 * real latency win. If this query ever gets called from a request-time path
 * (e.g. an uncached API route), add a module-level TTL cache here rather
 * than re-querying per-request.
 *
 * Returns an empty result (not null) when the DB isn't configured, so
 * callers can render an empty-state table instead of a hard 500.
 */
/**
 * Fetches the three ranking metrics, optionally scoped to a set of county
 * FIPS codes.
 *
 * Scoping matters at build time: `/us/rankings/rent-to-price/[state]`
 * prerenders 51 pages, and an unscoped scan sorted ~9.5k rows per page. Run
 * across Next's parallel static-generation workers that exhausted Neon's
 * sort memory ("out of memory ... TupleSort main") and failed the build.
 * A state-scoped filter cuts each query to roughly one state's counties.
 */
async function fetchMetricRows(fipsFilter: string[] | null): Promise<Row[]> {
  const db = sql();
  if (fipsFilter) {
    if (fipsFilter.length === 0) return [];
    return (await db`
      SELECT geo_fips, metric, year, value
      FROM regional_econ
      WHERE geo_level = 'county'
        AND metric IN ('fmr_2br', 'median_home_value', 'median_gross_rent')
        AND geo_fips = ANY(${fipsFilter})
      ORDER BY geo_fips, metric, year DESC
    `) as Row[];
  }
  return (await db`
    SELECT geo_fips, metric, year, value
    FROM regional_econ
    WHERE geo_level = 'county'
      AND metric IN ('fmr_2br', 'median_home_value', 'median_gross_rent')
    ORDER BY geo_fips, metric, year DESC
  `) as Row[];
}

export async function getRentToPriceRankings(
  fipsFilter?: string[]
): Promise<RentToPriceRankings> {
  if (!dbAvailable()) {
    return { counties: [], passCount: 0, fmrYears: [], homeValueYears: [] };
  }
  const rows = await fetchMetricRows(fipsFilter ?? null);

  // geo_fips -> metric -> latest {year, value}
  const byCounty = new Map<string, Map<string, { year: number; value: number }>>();
  for (const r of rows) {
    const fips = String(r.geo_fips);
    const metric = String(r.metric);
    const year = Number(r.year);
    const value = Number(r.value);
    let metrics = byCounty.get(fips);
    if (!metrics) {
      metrics = new Map();
      byCounty.set(fips, metrics);
    }
    // rows are ordered year DESC per (geo_fips, metric), so the first row
    // seen for a given metric is already the latest — skip the rest
    if (!metrics.has(metric)) metrics.set(metric, { year, value });
  }

  const countyByFips = new Map<string, UsCounty>(US_COUNTIES.map((c) => [c.fips, c]));

  const results: RentToPriceCounty[] = [];
  const fmrYears = new Set<number>();
  const homeValueYears = new Set<number>();

  for (const [fips, metrics] of byCounty.entries()) {
    const fmr = metrics.get("fmr_2br");
    const homeValue = metrics.get("median_home_value");
    if (!fmr || !homeValue || homeValue.value <= 0) continue;

    const county = countyByFips.get(fips);
    if (!county) continue; // not in the published county registry — skip rather than show an unnamed row

    const grossRent = metrics.get("median_gross_rent");
    const monthlyRatio = fmr.value / homeValue.value;

    fmrYears.add(fmr.year);
    homeValueYears.add(homeValue.year);

    results.push({
      county,
      fmr2br: fmr.value,
      fmrYear: fmr.year,
      medianHomeValue: homeValue.value,
      homeValueYear: homeValue.year,
      medianGrossRent: grossRent ? grossRent.value : null,
      monthlyRatio,
      annualYield: monthlyRatio * 12,
      passesOnePercentRule: monthlyRatio >= 0.01,
    });
  }

  results.sort((a, b) => b.monthlyRatio - a.monthlyRatio);

  return {
    counties: results,
    passCount: results.filter((r) => r.passesOnePercentRule).length,
    fmrYears: Array.from(fmrYears).sort((a, b) => b - a),
    homeValueYears: Array.from(homeValueYears).sort((a, b) => b - a),
  };
}

/** Same ranking, scoped to one state. `UsCounty.state` isn't a column on
 * regional_econ, so the state -> FIPS join happens in US_COUNTIES and the
 * resulting FIPS list is pushed down into the query as a filter. */
export async function getRentToPriceRankingsByState(
  stateSlug: string
): Promise<RentToPriceRankings> {
  const fips = US_COUNTIES.filter((c) => c.stateSlug === stateSlug).map((c) => c.fips);
  return getRentToPriceRankings(fips);
}
