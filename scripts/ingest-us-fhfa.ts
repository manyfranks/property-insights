/**
 * FHFA House Price Index, county annual (All-Transactions Index) ->
 * regional_econ. Ported from Economic-Atlas's scripts/ingest-fhfa-hpi.js.
 *
 * One metric: hpi (index, base=100 in the year the county index was first
 * recorded — FHFA does NOT rebase every county to a common year; see GOTCHA
 * #2 below). geo_level='county', unit='index', source='fhfa'.
 *
 * SOURCE GOTCHAS (ported straight from EA, verified against the same file):
 *   1. FIPS CODE READS BACK AS A NUMBER. The XLSX's "FIPS code" column is
 *      numeric (e.g. Autauga AL = 1001, not "01001") — states 01-09 lose
 *      their leading zero. Zero-pad to 5 digits before use.
 *   2. "HPI" (col F, base=100 at first recording) is NOT on a common base
 *      year across counties. We store col F as-is, not the 1990-base or
 *      2000-base columns (those are blank for counties not yet indexed by
 *      that base year) — col F maximizes real, non-blank coverage.
 *   3. BLANK/MISSING VALUES: FHFA leaves the cell empty when a county-year
 *      has no index — we skip-and-count, never write 0 or interpolate.
 *   4. Real header is spreadsheet row 6 (0-indexed row 5); rows 1-5 are
 *      title/footnote text.
 *
 * URL: https://www.fhfa.gov/hpi/download/annual/hpi_at_county.xlsx (XLSX
 * only, no CSV alternative at county level). Uses the `xlsx` npm package
 * (added as a devDependency here — EA uses the same package; no lighter
 * alternative parses this file reliably).
 *
 * Requires DATABASE_URL only for --commit. No API key — public federal bulk
 * file, fetched with a plain `fetch()` + descriptive User-Agent (unlike
 * FEMA NRI, this endpoint does NOT block on Node's TLS fingerprint — verified
 * live). Default is DRY RUN.
 *
 *   npx tsx scripts/ingest-us-fhfa.ts            # dry run (default)
 *   npx tsx scripts/ingest-us-fhfa.ts --commit   # write (needs DATABASE_URL)
 */
import * as XLSX from "xlsx";
import { loadEnvLocal, INGEST_USER_AGENT, COMMIT, upsertRegionalEcon, RegionalEconRow } from "./lib/ingest-shared";

loadEnvLocal();

const URL = "https://www.fhfa.gov/hpi/download/annual/hpi_at_county.xlsx";
const REGION_SOURCE = "fhfa";
const UNIT = "index";
const METRIC = "hpi";
const HEADER_ROW = 5; // 0-indexed; real header is spreadsheet row 6
const EXPECTED_HEADER = ["State", "County", "FIPS code", "Year", "Annual Change (%)", "HPI", "HPI with 1990 base", "HPI with 2000 base"];

async function fetchBuffer(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url, { headers: { "User-Agent": INGEST_USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.arrayBuffer();
}

interface ParsedWorkbook {
  idx: Record<string, number>;
  dataRows: unknown[][];
}

function parseWorkbook(buf: ArrayBuffer): ParsedWorkbook {
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, range: 0 });
  const header = (rows[HEADER_ROW] || []).map((h) => (typeof h === "string" ? h.trim() : h));
  const missing = EXPECTED_HEADER.filter((h) => !header.includes(h));
  if (missing.length) {
    throw new Error(
      `hpi_at_county.xlsx header row ${HEADER_ROW + 1} is missing expected column(s): ${missing.join(", ")} ` +
        `(got: ${JSON.stringify(header)}). Aborting — the source layout changed; refusing to write partial data.`
    );
  }
  const idx: Record<string, number> = Object.fromEntries(header.map((h, i) => [String(h), i]));
  return { idx, dataRows: rows.slice(HEADER_ROW + 1) };
}

interface Stats {
  seen: number;
  kept: number;
  blank: number;
  badFips: number;
  counties: Set<string>;
  years: Set<number>;
}

function buildRows({ idx, dataRows }: ParsedWorkbook): { rows: RegionalEconRow[]; stats: Stats } {
  const rows: RegionalEconRow[] = [];
  const stats: Stats = { seen: 0, kept: 0, blank: 0, badFips: 0, counties: new Set(), years: new Set() };
  for (const r of dataRows) {
    if (!r || r.length === 0) continue;
    stats.seen++;
    const rawFips = r[idx["FIPS code"]];
    const year = r[idx["Year"]];
    const hpi = r[idx["HPI"]];
    const stateAbbr = r[idx["State"]];
    const countyName = r[idx["County"]];
    if (rawFips == null || year == null) {
      stats.badFips++;
      continue;
    }
    // GOTCHA #1: numeric FIPS loses the leading zero for state 01-09 — zero-pad to 5.
    const fips = String(rawFips).trim().padStart(5, "0");
    if (!/^\d{5}$/.test(fips)) {
      stats.badFips++;
      continue;
    }
    if (hpi == null || hpi === "" || hpi === ".") {
      stats.blank++;
      continue;
    }
    const value = Number(hpi);
    if (!Number.isFinite(value) || value <= 0) {
      stats.blank++;
      continue;
    }
    rows.push({
      geo_fips: `US-${fips}`,
      geo_name: `${countyName}, ${stateAbbr}`,
      metric: METRIC,
      year: Number(year),
      value,
      unit: UNIT,
      source: REGION_SOURCE,
    });
    stats.kept++;
    stats.counties.add(fips);
    stats.years.add(Number(year));
  }
  return { rows, stats };
}

function usd(v: number): string {
  return v.toFixed(2);
}

async function main() {
  console.log(`FHFA county HPI ingest${COMMIT ? "" : " [DRY RUN — no DB writes, no DB connection]"}`);
  const buf = await fetchBuffer(URL);
  const parsed = parseWorkbook(buf);
  const { rows, stats } = buildRows(parsed);

  const yrs = [...stats.years].sort((a, b) => a - b);
  console.log(`\nrows seen (incl. header/blank lines): ${stats.seen.toLocaleString()}`);
  console.log(`kept (to upsert): ${stats.kept.toLocaleString()}  (${stats.counties.size} distinct counties x ${yrs.length} yrs: ${yrs[0]}-${yrs[yrs.length - 1]})`);
  console.log(`blank/non-numeric HPI skipped: ${stats.blank.toLocaleString()}`);
  console.log(`bad/missing FIPS or year skipped: ${stats.badFips.toLocaleString()}`);
  console.log(`county coverage vs ~3,143 US counties: ${((stats.counties.size / 3143) * 100).toFixed(1)}%`);

  const named: Record<string, string> = { "01001": "Autauga County, AL", "06075": "San Francisco County, CA" };
  console.log("\nSample rows (latest year present):");
  // Math.max(...rows.map(...)) blows the call stack at 100k+ elements — reduce instead.
  const latest = rows.reduce((max, r) => (r.year > max ? r.year : max), -Infinity);
  for (const fips of Object.keys(named)) {
    const r = rows.find((x) => x.geo_fips === `US-${fips}` && x.year === latest);
    if (r) console.log(`  ${r.geo_name.padEnd(28)} ${r.year}  HPI=${usd(r.value)}`);
  }

  console.log(`\nTOTAL rows to upsert: ${rows.length.toLocaleString()}`);
  if (!COMMIT) {
    console.log(
      `\nDRY RUN OK — would upsert ~${rows.length.toLocaleString()} rows into regional_econ ` +
        `(source='${REGION_SOURCE}', metric='${METRIC}', unit='${UNIT}'). No DB writes. Pass --commit to write.`
    );
    return;
  }

  const wrote = await upsertRegionalEcon(rows);
  console.log(`FHFA HPI ingest complete: ${wrote.toLocaleString()} rows upserted.`);
}

main().catch((e) => {
  console.error("ingest-us-fhfa failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
