/**
 * Census ACS 5-year estimates -> regional_econ. Ported from Economic-Atlas's
 * scripts/ingest-acs.js, trimmed to the four metrics Property Insights needs
 * for the US county market panel (EA also carries bachelor_attainment_rate,
 * poverty_rate, median_age, age_65_plus_share — out of scope here):
 *
 *   median_home_value        <- B25077_001E   (+ median_home_value_moe)
 *   median_gross_rent        <- B25064_001E   (+ median_gross_rent_moe)
 *   vacancy_rate              <- B25002_003E / B25002_001E  (+ vacancy_rate_moe, derived)
 *   median_household_income  <- B19013_001E   (+ median_household_income_moe)
 *
 * All land in regional_econ: geo_level='county', source='census_acs'.
 * Dollar metrics get unit='USD'; the vacancy rate gets unit='ratio'; MOE
 * siblings mirror the parent metric's unit.
 *
 * One API call returns every county+equivalent in the US (~3,221 rows) — no
 * per-state looping needed. A key is mandatory (a keyless request
 * 302-redirects to a "missing key" page — Census's own fail-loud signal,
 * which we also treat as fail-loud here rather than silently parsing HTML).
 *
 * MARGIN-OF-ERROR ARITHMETIC (Census ACS MOE handbook, "Transformations" §),
 * ported verbatim from Economic-Atlas's moeOfRatio():
 *   MOE of a proportion p = X/Y: (1/Y) * sqrt(MOE_X^2 - p^2 * MOE_Y^2); if the
 *   radicand is negative, Census's documented fallback is the "conservative"
 *   form (1/Y) * sqrt(MOE_X^2 + p^2 * MOE_Y^2) instead of pretending it's exact.
 *
 * Requires CENSUS_API_KEY always; DATABASE_URL only for --commit. Default is
 * DRY RUN (fetch + parse + print counts, no DB connection).
 *
 *   npx tsx scripts/ingest-us-acs.ts            # dry run (default)
 *   npx tsx scripts/ingest-us-acs.ts --commit   # write (needs DATABASE_URL)
 */
import { loadEnvLocal, INGEST_USER_AGENT, COMMIT, toGeoFips, num, upsertRegionalEcon, RegionalEconRow } from "./lib/ingest-shared";

loadEnvLocal();

const CENSUS_KEY = process.env.CENSUS_API_KEY;
const REGION_SOURCE = "census_acs";
const CV_THRESHOLD = 0.3; // Census Bureau's own "unreliable estimate" cutoff (coefficient of variation > 30%)

// Try current vintage first, then one year back — ACS 5-yr ships once/year
// each December, so "latest" drifts; fail loud only after both attempts miss.
const VINTAGE_CANDIDATES = [2024, 2023];

const VARS = [
  "NAME",
  "B19013_001E", "B19013_001M", // median household income
  "B25077_001E", "B25077_001M", // median home value
  "B25064_001E", "B25064_001M", // median gross rent
  "B25002_001E", "B25002_001M", // total housing units
  "B25002_002E",                 // occupied
  "B25002_003E", "B25002_003M", // vacant
];

if (!CENSUS_KEY) {
  throw new Error("CENSUS_API_KEY is required (present in .env.local per task brief — check it loaded).");
}

// --- MOE arithmetic (Census ACS MOE handbook), ported from EA's moeOfRatio() ---
function moeOfRatio(p: number, moeX: number, moeY: number, y: number): number | null {
  if (!(y > 0)) return null;
  const radicand = moeX * moeX - p * p * moeY * moeY;
  const safe = radicand >= 0 ? radicand : moeX * moeX + p * p * moeY * moeY; // documented fallback
  return Math.sqrt(safe) / y;
}
function cv(estimate: number, moe: number): number | null {
  return estimate > 0 ? moe / 1.645 / estimate : null;
}

type Header = Record<string, number>;

async function fetchVintage(vintage: number): Promise<{ header: string[]; data: string[][] } | null> {
  const url = `https://api.census.gov/data/${vintage}/acs/acs5?get=${VARS.join(",")}&for=county:*&in=state:*&key=${CENSUS_KEY}`;
  const res = await fetch(url, {
    headers: { "User-Agent": INGEST_USER_AGENT },
    redirect: "manual", // a keyless/bad request 302s to missing_key.html — treat any redirect as failure, not a silent HTML parse
  });
  if (res.status >= 300 && res.status < 400) {
    console.warn(`  [acs] vintage ${vintage}: redirected (likely not yet published, or key rejected) — trying next candidate.`);
    return null;
  }
  if (res.status === 404) {
    console.warn(`  [acs] vintage ${vintage}: HTTP 404 (not yet published) — trying next candidate.`);
    return null;
  }
  if (!res.ok) {
    throw new Error(`Census ACS HTTP ${res.status} for vintage ${vintage}: ${await res.text().catch(() => "")}`);
  }
  const rows = (await res.json()) as string[][];
  const [header, ...data] = rows;
  return { header, data };
}

async function fetchAll(): Promise<{ vintage: number; data: string[][]; idx: Header }> {
  for (const vintage of VINTAGE_CANDIDATES) {
    const result = await fetchVintage(vintage);
    if (!result) continue;
    const { header, data } = result;
    const idx: Header = Object.fromEntries(header.map((h, i) => [h, i]));
    const required = [...VARS, "state", "county"];
    const missing = required.filter((c) => idx[c] === undefined);
    if (missing.length) {
      throw new Error(
        `ACS ${vintage} response is missing expected column(s): ${missing.join(", ")}. Aborting — refusing to write partial data.`
      );
    }
    return { vintage, data, idx };
  }
  throw new Error(`ACS: none of the candidate vintages (${VINTAGE_CANDIDATES.join(", ")}) returned a usable response. Aborting.`);
}

interface Stats {
  counties: number;
  present: Record<string, number>;
  unreliable: Record<string, number>;
}

function buildRows(vintage: number, data: string[][], idx: Header): { rows: RegionalEconRow[]; stats: Stats } {
  const rows: RegionalEconRow[] = [];
  const stats: Stats = {
    counties: 0,
    present: { median_home_value: 0, median_gross_rent: 0, median_household_income: 0, vacancy_rate: 0 },
    unreliable: { median_home_value: 0, median_gross_rent: 0, median_household_income: 0, vacancy_rate: 0 },
  };

  const push = (geo_fips: string, geo_name: string, metric: string, value: number | null, unit: string) => {
    if (value == null) return;
    rows.push({ geo_fips, geo_name, metric, year: vintage, value, unit, source: REGION_SOURCE });
  };

  for (const r of data) {
    const state = r[idx.state];
    const county = r[idx.county];
    if (!/^\d{2}$/.test(state) || !/^\d{3}$/.test(county)) continue;
    const geo_fips = toGeoFips(state, county);
    const geo_name = r[idx.NAME];
    stats.counties++;

    const inc = num(r[idx.B19013_001E]);
    const incMoe = num(r[idx.B19013_001M]);
    if (inc != null) {
      push(geo_fips, geo_name, "median_household_income", inc, "USD");
      if (incMoe != null) push(geo_fips, geo_name, "median_household_income_moe", incMoe, "USD");
      stats.present.median_household_income++;
      if (incMoe != null && (cv(inc, incMoe) ?? 0) > CV_THRESHOLD) stats.unreliable.median_household_income++;
    }

    const val = num(r[idx.B25077_001E]);
    const valMoe = num(r[idx.B25077_001M]);
    if (val != null) {
      push(geo_fips, geo_name, "median_home_value", val, "USD");
      if (valMoe != null) push(geo_fips, geo_name, "median_home_value_moe", valMoe, "USD");
      stats.present.median_home_value++;
      if (valMoe != null && (cv(val, valMoe) ?? 0) > CV_THRESHOLD) stats.unreliable.median_home_value++;
    }

    const rent = num(r[idx.B25064_001E]);
    const rentMoe = num(r[idx.B25064_001M]);
    if (rent != null) {
      push(geo_fips, geo_name, "median_gross_rent", rent, "USD");
      if (rentMoe != null) push(geo_fips, geo_name, "median_gross_rent_moe", rentMoe, "USD");
      stats.present.median_gross_rent++;
      if (rentMoe != null && (cv(rent, rentMoe) ?? 0) > CV_THRESHOLD) stats.unreliable.median_gross_rent++;
    }

    const totalUnits = num(r[idx.B25002_001E]);
    const totalMoe = num(r[idx.B25002_001M]);
    const vacant = num(r[idx.B25002_003E]);
    const vacantMoe = num(r[idx.B25002_003M]);
    if (totalUnits != null && totalUnits > 0 && vacant != null) {
      const rate = vacant / totalUnits;
      push(geo_fips, geo_name, "vacancy_rate", rate, "ratio");
      if (vacantMoe != null && totalMoe != null) {
        const rateMoe = moeOfRatio(rate, vacantMoe, totalMoe, totalUnits);
        if (rateMoe != null) {
          push(geo_fips, geo_name, "vacancy_rate_moe", rateMoe, "ratio");
          stats.present.vacancy_rate++;
          if ((cv(rate, rateMoe) ?? 0) > CV_THRESHOLD) stats.unreliable.vacancy_rate++;
        }
      }
    }
  }
  return { rows, stats };
}

function fmt(metric: string, v: number): string {
  if (metric.startsWith("median_") && !metric.endsWith("_moe")) return "$" + Math.round(v).toLocaleString("en-US");
  if (metric.startsWith("median_") && metric.endsWith("_moe")) return "±$" + Math.round(v).toLocaleString("en-US");
  if (metric.endsWith("_moe")) return "±" + (v * 100).toFixed(1) + "pp";
  return (v * 100).toFixed(1) + "%";
}

async function main() {
  console.log(`Census ACS ingest${COMMIT ? "" : " [DRY RUN — no DB writes, no DB connection]"}`);
  const { vintage, data, idx } = await fetchAll();
  console.log(`vintage: ${vintage} (5-year ACS)`);
  const { rows, stats } = buildRows(vintage, data, idx);

  console.log(`\ncounties seen: ${stats.counties.toLocaleString()}`);
  for (const m of Object.keys(stats.present)) {
    const pct = stats.counties ? ((stats.present[m] / stats.counties) * 100).toFixed(1) : "0.0";
    const unreliablePct = stats.present[m] ? ((stats.unreliable[m] / stats.present[m]) * 100).toFixed(1) : "0.0";
    console.log(
      `  ${m.padEnd(26)} present: ${stats.present[m].toLocaleString()} (${pct}%)  unreliable (CV>${CV_THRESHOLD * 100}%): ${stats.unreliable[m].toLocaleString()} (${unreliablePct}%)`
    );
  }

  console.log("\nSample rows (Autauga County AL, San Francisco County CA):");
  for (const fips of ["US-01001", "US-06075"]) {
    const here = rows.filter((r) => r.geo_fips === fips);
    const name = here[0]?.geo_name || fips;
    console.log(`  ${name}:`);
    for (const m of ["median_home_value", "median_home_value_moe", "median_gross_rent", "vacancy_rate", "median_household_income"]) {
      const r = here.find((x) => x.metric === m);
      console.log(`    ${m.padEnd(26)} ${r ? fmt(m, r.value) : "(missing)"}`);
    }
  }

  console.log(`\nTOTAL rows to upsert: ${rows.length.toLocaleString()}`);
  if (!COMMIT) {
    console.log(`\nDRY RUN OK — would upsert ~${rows.length.toLocaleString()} rows into regional_econ (source='${REGION_SOURCE}'). No DB writes. Pass --commit to write.`);
    return;
  }

  const wrote = await upsertRegionalEcon(rows);
  console.log(`Census ACS ingest complete: ${wrote.toLocaleString()} rows upserted.`);
}

main().catch((e) => {
  console.error("ingest-us-acs failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
