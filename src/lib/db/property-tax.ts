/**
 * db/property-tax.ts
 *
 * Reader for the /us/[state]/[county]/property-tax page — a county's
 * effective property-tax rate, derived from two regional_econ ACS metrics
 * (median_re_taxes_paid from scripts/ingest-us-acs-property-tax.ts,
 * median_home_value from scripts/ingest-us-acs.ts) rather than stored as
 * its own metric, since "effective rate" is a ratio the source data doesn't
 * publish directly.
 *
 * Follows src/lib/db/regional-econ.ts's conventions: dbAvailable() guard on
 * every export, defensive row typing, fail-soft null instead of throwing on
 * a missing DATABASE_URL or missing rows — callers (the page) treat null as
 * "no /property-tax page for this county" and call notFound().
 */

import { sql, dbAvailable } from "@/lib/db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CountyPropertyTaxPanel {
  /** normalized "US-SSCCC" form */
  countyFips: string;

  /** ACS median annual real estate tax bill, USD. Data gate — see
   * getCountyPropertyTaxPanel's doc comment. */
  medianReTaxesPaid: number;
  medianReTaxesPaidMoe: number | null;

  /** ACS median home value, USD. Second half of the data gate — the
   * effective rate can't be derived without it. */
  medianHomeValue: number;

  medianHouseholdIncome: number | null;

  /** medianReTaxesPaid / medianHomeValue, as a ratio (0.011 = 1.1%). Always
   * present when the panel itself is non-null (both inputs are the gate). */
  effectiveRate: number;

  /** metric name -> year the value shown above was recorded for */
  vintages: {
    median_re_taxes_paid: number;
    median_home_value: number;
    median_household_income?: number;
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Accepts either a bare 5-digit county FIPS ("06075") or the stored
 * "US-SSCCC" form and always returns the latter. Mirrors
 * regional-econ.ts's normalizeCountyFips (kept local — the task boundary
 * for this file doesn't include editing regional-econ.ts to export it). */
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

function latestByMetric(rows: MetricRow[]): Map<string, MetricRow> {
  const byMetric = new Map<string, MetricRow>();
  for (const r of rows) {
    const existing = byMetric.get(r.metric);
    if (!existing || r.year > existing.year) byMetric.set(r.metric, r);
  }
  return byMetric;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Property-tax panel for a US county: median annual tax bill, median home
 * value, median household income (all latest census_acs rows), plus the
 * derived effective rate (taxes / home value).
 *
 * Data gate: returns null unless BOTH median_re_taxes_paid AND
 * median_home_value have a row on record for the county — an effective
 * rate is meaningless with only one side of the ratio, and the page should
 * 404 rather than show a bill with no rate or a rate with no dollar figure.
 * median_household_income is best-effort context and does not gate.
 */
export async function getCountyPropertyTaxPanel(countyFips: string): Promise<CountyPropertyTaxPanel | null> {
  if (!dbAvailable()) return null;

  const geoFips = normalizeCountyFips(countyFips);
  const db = sql();

  const rows = (await db`
    SELECT metric, year, value
    FROM regional_econ
    WHERE geo_fips = ${geoFips}
      AND source = 'census_acs'
      AND metric IN ('median_re_taxes_paid', 'median_re_taxes_paid_moe', 'median_home_value', 'median_household_income')
    ORDER BY metric, year DESC
  `) as Row[];

  if (rows.length === 0) return null;

  const byMetric = latestByMetric(
    rows.map((r) => ({ metric: String(r.metric), year: Number(r.year), value: Number(r.value) }))
  );

  const taxes = byMetric.get("median_re_taxes_paid");
  const homeValue = byMetric.get("median_home_value");
  if (!taxes || !homeValue || !(homeValue.value > 0)) return null; // data gate

  const taxesMoe = byMetric.get("median_re_taxes_paid_moe");
  const income = byMetric.get("median_household_income");

  const vintages: CountyPropertyTaxPanel["vintages"] = {
    median_re_taxes_paid: taxes.year,
    median_home_value: homeValue.year,
    ...(income ? { median_household_income: income.year } : {}),
  };

  return {
    countyFips: geoFips,
    medianReTaxesPaid: taxes.value,
    medianReTaxesPaidMoe: taxesMoe ? taxesMoe.value : null,
    medianHomeValue: homeValue.value,
    medianHouseholdIncome: income ? income.value : null,
    effectiveRate: taxes.value / homeValue.value,
    vintages,
  };
}

/**
 * Median effective property-tax rate across a state's counties, for the
 * page's "vs. state median" comparison copy — computed in SQL (a per-county
 * ratio computed and then median()'d over PostgreSQL's ordered-set
 * aggregate, rather than pulling every county's rows into JS) since this is
 * a single-purpose comparison figure, not a full panel per county.
 *
 * `stateFipsPrefix` is the 2-digit state FIPS (e.g. "06" for California) —
 * geo_fips is "US-SSCCC", so a `LIKE 'US-06%'` prefix match selects every
 * county in that state. Returns null when the DB isn't configured or the
 * state has no counties with both metrics present.
 */
export async function getStateMedianEffectiveRate(stateFipsPrefix: string): Promise<number | null> {
  if (!dbAvailable()) return null;
  const prefix = stateFipsPrefix.trim();
  if (!/^\d{2}$/.test(prefix)) return null; // defensive — malformed input, not a DB problem

  const db = sql();

  const rows = (await db`
    WITH latest_taxes AS (
      SELECT DISTINCT ON (geo_fips) geo_fips, value AS taxes
      FROM regional_econ
      WHERE geo_fips LIKE ${"US-" + prefix + "%"}
        AND source = 'census_acs'
        AND metric = 'median_re_taxes_paid'
      ORDER BY geo_fips, year DESC
    ),
    latest_value AS (
      SELECT DISTINCT ON (geo_fips) geo_fips, value AS home_value
      FROM regional_econ
      WHERE geo_fips LIKE ${"US-" + prefix + "%"}
        AND source = 'census_acs'
        AND metric = 'median_home_value'
      ORDER BY geo_fips, year DESC
    )
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY (t.taxes / v.home_value)) AS median_rate
    FROM latest_taxes t
    JOIN latest_value v ON v.geo_fips = t.geo_fips
    WHERE v.home_value > 0
  `) as Row[];

  if (rows.length === 0 || rows[0].median_rate == null) return null;
  return Number(rows[0].median_rate);
}

/**
 * Distinct county FIPS with both median_re_taxes_paid AND median_home_value
 * on record — the exact county set /property-tax pages are live for. Used
 * by the orchestrator's sitemap pass, mirroring regional-econ.ts's
 * getCountyFipsWithFmr (same shape: a live DB query, no separate static-file
 * generation step, so the sitemap can never drift out of sync with what
 * getCountyPropertyTaxPanel actually gates on).
 */
export async function getCountyFipsWithPropertyTax(): Promise<string[]> {
  if (!dbAvailable()) return [];
  const db = sql();

  const rows = (await db`
    SELECT DISTINCT t.geo_fips
    FROM regional_econ t
    JOIN regional_econ v
      ON v.geo_fips = t.geo_fips
     AND v.source = 'census_acs'
     AND v.metric = 'median_home_value'
    WHERE t.source = 'census_acs'
      AND t.metric = 'median_re_taxes_paid'
  `) as Row[];

  return rows.map((r) => String(r.geo_fips));
}

/**
 * Same data gate as getCountyFipsWithPropertyTax, scoped to a small
 * candidate list — used by the property-tax page to filter its "sibling
 * county" cross-links down to counties that actually have a live
 * /property-tax page, without pulling the full nationwide set on every
 * render. Mirrors regional-econ.ts's getCountyFipsWithFmrAmong.
 */
export async function getCountyFipsWithPropertyTaxAmong(candidateFips: string[]): Promise<Set<string>> {
  if (!dbAvailable() || candidateFips.length === 0) return new Set();
  const db = sql();
  const normalized = candidateFips.map(normalizeCountyFips);

  const rows = (await db`
    SELECT DISTINCT t.geo_fips
    FROM regional_econ t
    JOIN regional_econ v
      ON v.geo_fips = t.geo_fips
     AND v.source = 'census_acs'
     AND v.metric = 'median_home_value'
    WHERE t.source = 'census_acs'
      AND t.metric = 'median_re_taxes_paid'
      AND t.geo_fips = ANY(${normalized})
  `) as Row[];

  return new Set(rows.map((r) => String(r.geo_fips)));
}
