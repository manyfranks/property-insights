/**
 * Census ACS 5-year estimates -> regional_econ, property-tax metric.
 *
 * Sibling of scripts/ingest-us-acs.ts (same fetch/throttle/upsert plumbing,
 * same VARS/VINTAGE_CANDIDATES/fail-loud conventions), scoped to a single
 * variable this repo's other ACS ingest doesn't already carry:
 *
 *   median_re_taxes_paid  <- B25103_001E  (+ median_re_taxes_paid_moe <- B25103_001M)
 *
 * B25103 is "Median Real Estate Taxes Paid for Housing Units" (annual
 * property tax bill, dollars) — distinct from B25077 (home value) and
 * B25064 (gross rent), which ingest-us-acs.ts already covers. Kept as its
 * own script/metric rather than folded into ingest-us-acs.ts per the task
 * boundary: that script is read-only reference here, not to be modified.
 *
 * Lands in regional_econ exactly like the sibling script: geo_level='county',
 * source='census_acs', geo_fips="US-SSCCC" (verified against an existing
 * census_acs row before writing this script — same convention, same
 * geo_name "County, State" format). Dollar metric gets unit='USD'; the MOE
 * sibling mirrors the parent metric's unit.
 *
 * One API call returns every county+equivalent in the US (~3,221 rows) — no
 * per-state looping needed. A key is mandatory (a keyless request
 * 302-redirects to a "missing key" page — Census's own fail-loud signal,
 * which we also treat as fail-loud here rather than silently parsing HTML).
 *
 * Requires CENSUS_API_KEY always; DATABASE_URL only for --commit. Default is
 * DRY RUN (fetch + parse + print counts, no DB connection).
 *
 *   npx tsx scripts/ingest-us-acs-property-tax.ts            # dry run (default)
 *   npx tsx scripts/ingest-us-acs-property-tax.ts --commit   # write (needs DATABASE_URL)
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
  "B25103_001E", "B25103_001M", // median real estate taxes paid
];

if (!CENSUS_KEY) {
  throw new Error("CENSUS_API_KEY is required (present in .env.local per task brief — check it loaded).");
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
    console.warn(`  [acs-tax] vintage ${vintage}: redirected (likely not yet published, or key rejected) — trying next candidate.`);
    return null;
  }
  if (res.status === 404) {
    console.warn(`  [acs-tax] vintage ${vintage}: HTTP 404 (not yet published) — trying next candidate.`);
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
  present: number;
  unreliable: number;
}

function buildRows(vintage: number, data: string[][], idx: Header): { rows: RegionalEconRow[]; stats: Stats } {
  const rows: RegionalEconRow[] = [];
  const stats: Stats = { counties: 0, present: 0, unreliable: 0 };

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

    const tax = num(r[idx.B25103_001E]);
    const taxMoe = num(r[idx.B25103_001M]);
    if (tax != null) {
      push(geo_fips, geo_name, "median_re_taxes_paid", tax, "USD");
      if (taxMoe != null) push(geo_fips, geo_name, "median_re_taxes_paid_moe", taxMoe, "USD");
      stats.present++;
      if (taxMoe != null && (cv(tax, taxMoe) ?? 0) > CV_THRESHOLD) stats.unreliable++;
    }
  }
  return { rows, stats };
}

function fmt(metric: string, v: number): string {
  if (metric.endsWith("_moe")) return "±$" + Math.round(v).toLocaleString("en-US");
  return "$" + Math.round(v).toLocaleString("en-US");
}

async function main() {
  console.log(`Census ACS property-tax ingest${COMMIT ? "" : " [DRY RUN — no DB writes, no DB connection]"}`);
  const { vintage, data, idx } = await fetchAll();
  console.log(`vintage: ${vintage} (5-year ACS)`);
  const { rows, stats } = buildRows(vintage, data, idx);

  console.log(`\ncounties seen: ${stats.counties.toLocaleString()}`);
  const pct = stats.counties ? ((stats.present / stats.counties) * 100).toFixed(1) : "0.0";
  const unreliablePct = stats.present ? ((stats.unreliable / stats.present) * 100).toFixed(1) : "0.0";
  console.log(
    `  median_re_taxes_paid      present: ${stats.present.toLocaleString()} (${pct}%)  unreliable (CV>${CV_THRESHOLD * 100}%): ${stats.unreliable.toLocaleString()} (${unreliablePct}%)`
  );

  console.log("\nSample rows (Autauga County AL, San Francisco County CA):");
  for (const fips of ["US-01001", "US-06075"]) {
    const here = rows.filter((r) => r.geo_fips === fips);
    const name = here[0]?.geo_name || fips;
    console.log(`  ${name}:`);
    for (const m of ["median_re_taxes_paid", "median_re_taxes_paid_moe"]) {
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
  console.log(`Census ACS property-tax ingest complete: ${wrote.toLocaleString()} rows upserted.`);
}

main().catch((e) => {
  console.error("ingest-us-acs-property-tax failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
