/**
 * CMHC Rental Market Survey (RMS) average rent by bedroom count, per CMA ->
 * regional_econ.
 *
 * SOURCE: CMHC's interactive HMIP tool (www03.cmhc-schl.gc.ca/hmip-pimh) has
 * no documented public API — probed live before writing this script
 * (getCubeMetadata-style calls to /TableMapChart/Table and
 * /TableMapChart/TableMatchingCriteria both 500'd with ASP.NET enum-
 * validation errors referencing internal Cawd.Services.Facade types and
 * undocumented GeographyId codes not derivable from any published schema).
 * Per this script's spec, that qualified as export-hostile within the
 * ~30min probing budget.
 *
 * FALLBACK USED — but a stronger one than a hand-typed static table: CMHC
 * separately publishes a real downloadable Excel workbook of RMS results
 * (the same data HMIP renders interactively), found via the data-tables
 * landing page:
 *   https://www.cmhc-schl.gc.ca/professionals/housing-markets-data-and-research/housing-data/data-tables/rental-market/rental-market-report-data-tables
 * which links (via a Sitecore media-library path, not a plain <a href> the
 * page's rendered HTML exposes directly — found by grepping the raw HTML
 * for "/sites/cmhc/...xlsx") to:
 *   https://assets.cmhc-schl.gc.ca/sites/cmhc/professional/housing-markets-data-and-research/housing-data-tables/rental-market/rental-market-report-data-tables/{year}/rmr-canada-{year}-en.xlsx
 * Verified live (2026-08-08): 200 OK, real .xlsx (Table 6.0 = "Average Rent
 * for Turnover and Non-turnover Units", covering every province/major-centre
 * CMA StatCan tracks, including all of ours). This is a stable, CMHC-hosted,
 * annually-republished file — not a scrape of rendered HTML — so it's
 * treated as a real (if URL-versioned) source rather than the fully static
 * fallback table the spec allows for. The {year} path segment changes with
 * each survey release, so fetchWorkbook() below tries the current year down
 * to 2 years back and uses the first one that resolves — this is the one
 * part of the pipeline a maintainer needs to bump if CMHC ever changes the
 * path convention itself (urlForYear() below), not just the year.
 *
 * WHICH RENT: Table 6.0 splits "Turnover units" (rent when a unit is newly
 * re-rented — the closest published proxy for what a new landlord could
 * charge today) from "Non-turnover units" (sitting tenants, often below
 * market). This script ingests Turnover-units rent only — see
 * src/lib/db/regional-econ.ts's getCmaRent doc comment for why.
 *
 * Metric: cmhc_rent_{studio|1br|2br|3br} (see regional-econ.ts's
 * cmaRentMetric — shared naming function, writer and reader can't drift).
 * unit='CAD', source='cmhc_rms_turnover', geo_level='cma', annual grain (the
 * October RMS survey vintage — CMHC does not publish month-level rent data).
 *
 * Requires DATABASE_URL only for --commit. Default is DRY RUN.
 *
 *   npx tsx scripts/ingest-ca-cmhc-rent.ts            # dry run (default)
 *   npx tsx scripts/ingest-ca-cmhc-rent.ts --commit   # write (needs DATABASE_URL)
 */
import * as XLSX from "xlsx";
import { loadEnvLocal, INGEST_USER_AGENT, COMMIT, upsertRegionalEcon, RegionalEconRow } from "./lib/ingest-shared";
import { CA_CMA_TARGETS, cmaRentMetric } from "../src/lib/db/regional-econ";

loadEnvLocal();

const REGION_SOURCE = "cmhc_rms_turnover";
const UNIT = "CAD";
const SHEET_NAME = "Table 6.0";
const TURNOVER_LABEL = "Turnover units";
const NON_TURNOVER_LABEL = "Non-turnover units";
/** Table 6.0's 4 bedroom-count column groups, in the order CMHC publishes
 * them. "3 Bedroom +" is CMHC's own top bucket — there's no separate 4BR+
 * series in the RMS tables. */
const BEDROOM_LABELS: { label: string; beds: number }[] = [
  { label: "Studio", beds: 0 },
  { label: "1 Bedroom", beds: 1 },
  { label: "2 Bedroom", beds: 2 },
  { label: "3 Bedroom +", beds: 3 },
];

function urlForYear(year: number): string {
  return `https://assets.cmhc-schl.gc.ca/sites/cmhc/professional/housing-markets-data-and-research/housing-data-tables/rental-market/rental-market-report-data-tables/${year}/rmr-canada-${year}-en.xlsx`;
}

/** Our CMA display names -> CMHC's exact "Centre" row label in Table 6.0.
 * Almost always "{name} CMA" — Ottawa-Gatineau is the one exception (see
 * regional-econ.ts's CA_CMA_TARGETS doc comment: CMHC also splits this CMA
 * by province, and our Ottawa listings are all Ontario-side). */
function centreLabelFor(target: (typeof CA_CMA_TARGETS)[number]): string {
  if (target.code === 505) return "Ottawa-Gatineau CMA (Ont. part)";
  return `${target.name} CMA`;
}

async function fetchWorkbook(): Promise<{ wb: XLSX.WorkBook; year: number; url: string }> {
  const thisYear = new Date().getFullYear();
  const candidates = [thisYear, thisYear - 1, thisYear - 2];
  const attempts: string[] = [];
  for (const year of candidates) {
    const url = urlForYear(year);
    try {
      const res = await fetch(url, { headers: { "User-Agent": INGEST_USER_AGENT } });
      if (!res.ok) {
        attempts.push(`${year}: HTTP ${res.status}`);
        continue;
      }
      const buf = await res.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      return { wb, year, url };
    } catch (err) {
      attempts.push(`${year}: ${err instanceof Error ? err.message : err}`);
    }
  }
  throw new Error(`No CMHC RMS workbook found for years [${candidates.join(", ")}]. Attempts: ${attempts.join("; ")}`);
}

/** Column-index offsets (relative to a bedroom-block's LABEL column, i.e.
 * where row 7 has "Studio"/"1 Bedroom"/etc) for the two year sub-columns
 * CMHC publishes under each bedroom group. Verified against the live
 * workbook: the label's merged cell anchors one column to the RIGHT of its
 * own "older year" value (e.g. row 7 "Studio" sits at column index 3, but
 * Toronto CMA's Oct-24 Studio rent value sits at column index 2, and Oct-25
 * at column index 4) — a merged-cell anchoring quirk, not a typo. */
const OLDER_YEAR_OFFSET = -1;
const LATEST_YEAR_OFFSET = 1;

interface ParsedTable {
  /** bedroom label -> { older: colIdx, latest: colIdx } within the Turnover
   * units half of the sheet. */
  turnoverCols: Map<string, { older: number; latest: number }>;
  olderYear: number;
  latestYear: number;
  rows: unknown[][];
}

function parseTable6(wb: XLSX.WorkBook): ParsedTable {
  const sheet = wb.Sheets[SHEET_NAME];
  if (!sheet) throw new Error(`Workbook has no sheet named "${SHEET_NAME}" — sheets present: ${wb.SheetNames.join(", ")}`);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, range: 0 });

  // Row indices are 0-based; row 6 = section labels ("Turnover units" /
  // "Non-turnover units"), row 7 = bedroom-group labels, row 9 = "Oct-YY"
  // year sub-headers. Found by inspecting the live workbook — asserted here
  // (not assumed) so a CMHC layout change fails loudly instead of silently
  // mis-mapping columns.
  const sectionRow = (rows[6] || []) as unknown[];
  const bedroomRow = (rows[7] || []) as unknown[];
  const yearRow = (rows[9] || []) as unknown[];

  const turnoverStart = sectionRow.indexOf(TURNOVER_LABEL);
  const nonTurnoverStart = sectionRow.indexOf(NON_TURNOVER_LABEL);
  if (turnoverStart === -1 || nonTurnoverStart === -1 || nonTurnoverStart <= turnoverStart) {
    throw new Error(
      `${SHEET_NAME} row 6 is missing expected section labels "${TURNOVER_LABEL}"/"${NON_TURNOVER_LABEL}" — CMHC's layout may have changed. Got: ${JSON.stringify(sectionRow).slice(0, 300)}`
    );
  }

  const turnoverCols = new Map<string, { older: number; latest: number }>();
  for (const { label } of BEDROOM_LABELS) {
    let colIdx = -1;
    for (let i = turnoverStart; i < nonTurnoverStart; i++) {
      if (bedroomRow[i] === label) {
        colIdx = i;
        break;
      }
    }
    if (colIdx === -1) {
      throw new Error(`${SHEET_NAME}: could not find "${label}" column within the Turnover units section (cols ${turnoverStart}-${nonTurnoverStart}). Row 8: ${JSON.stringify(bedroomRow).slice(0, 400)}`);
    }
    turnoverCols.set(label, { older: colIdx + OLDER_YEAR_OFFSET, latest: colIdx + LATEST_YEAR_OFFSET });
  }

  // Derive the actual years from the "Oct-YY" header text rather than
  // assuming — makes next year's re-run (Oct-26/Oct-27 headers) work with
  // zero code changes.
  const firstBlock = turnoverCols.get("Studio")!;
  const olderHeader = String(yearRow[firstBlock.older] ?? "");
  const latestHeader = String(yearRow[firstBlock.latest] ?? "");
  const olderMatch = /Oct-(\d{2})/.exec(olderHeader);
  const latestMatch = /Oct-(\d{2})/.exec(latestHeader);
  if (!olderMatch || !latestMatch) {
    throw new Error(`${SHEET_NAME}: could not parse "Oct-YY" year headers at row 9 cols ${firstBlock.older}/${firstBlock.latest}. Got "${olderHeader}" / "${latestHeader}".`);
  }

  return {
    turnoverCols,
    olderYear: 2000 + Number(olderMatch[1]),
    latestYear: 2000 + Number(latestMatch[1]),
    rows,
  };
}

/** Parses a CMHC table cell into a number, or null for CMHC's suppression
 * marker ("**", data withheld for sample-size reliability — a legitimate
 * "no usable figure" outcome, not a shape error) or any other non-numeric
 * cell. */
function parseRentCell(raw: unknown): number | null {
  if (raw == null) return null;
  const str = String(raw).trim();
  if (str === "" || str === "**") return null;
  const num = Number(str.replace(/,/g, ""));
  return Number.isFinite(num) && num > 0 ? num : null;
}

function findCentreRow(rows: unknown[][], centreLabel: string): unknown[] | null {
  for (const row of rows) {
    if (row[0] === centreLabel) return row;
  }
  return null;
}

function buildRows(target: (typeof CA_CMA_TARGETS)[number], parsed: ParsedTable): { rows: RegionalEconRow[]; missing: string[] } {
  const centreLabel = centreLabelFor(target);
  const row = findCentreRow(parsed.rows, centreLabel);
  const rows: RegionalEconRow[] = [];
  const missing: string[] = [];

  if (!row) {
    missing.push(`${centreLabel}: row not found in ${SHEET_NAME}`);
    return { rows, missing };
  }

  for (const { label, beds } of BEDROOM_LABELS) {
    const cols = parsed.turnoverCols.get(label)!;
    // Prefer the latest year; fall back to the older year if the latest is
    // suppressed (small-sample CMAs sometimes have this for 3BR+).
    const latestValue = parseRentCell(row[cols.latest]);
    const olderValue = parseRentCell(row[cols.older]);
    const value = latestValue ?? olderValue;
    const year = latestValue != null ? parsed.latestYear : parsed.olderYear;
    if (value == null) {
      missing.push(`${centreLabel} ${label}: suppressed in both ${parsed.latestYear} and ${parsed.olderYear}`);
      continue;
    }
    rows.push({
      geo_fips: `CA-CMA-${target.code}`,
      geo_name: `${target.name} CMA`,
      metric: cmaRentMetric(beds),
      year,
      value,
      unit: UNIT,
      source: REGION_SOURCE,
    });
  }

  return { rows, missing };
}

async function main() {
  console.log(`CMHC RMS average-rent ingest (${SHEET_NAME}, Turnover units)${COMMIT ? "" : " [DRY RUN — no DB writes]"}`);

  const { wb, year: fileYear, url } = await fetchWorkbook();
  console.log(`workbook: ${url} (resolved year ${fileYear})`);
  const parsed = parseTable6(wb);
  console.log(`survey years found in workbook: ${parsed.olderYear} (prior) / ${parsed.latestYear} (latest)`);
  console.log(`target CMAs: ${CA_CMA_TARGETS.length}`);

  let totalRows = 0;
  let cmaOk = 0;
  const allMissing: string[] = [];
  const sample: RegionalEconRow[] = [];

  for (const target of CA_CMA_TARGETS) {
    const { rows, missing } = buildRows(target, parsed);
    allMissing.push(...missing);
    if (rows.length > 0) {
      totalRows += rows.length;
      cmaOk++;
      if (sample.length < 3) sample.push(rows[rows.length - 1]);
      if (COMMIT) {
        // Commit PER CMA, immediately — same chunked/resumable rationale as
        // scripts/ingest-us-dom.ts.
        await upsertRegionalEcon(rows);
      }
      console.log(`  [ok] ${target.name} CMA (${target.code}): ${rows.length} bedroom metrics` + (COMMIT ? " — committed" : ""));
    } else {
      console.log(`  [miss] ${target.name} CMA (${target.code}): no usable rent figures`);
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`CMAs with at least one metric: ${cmaOk}/${CA_CMA_TARGETS.length}`);
  console.log(`total metric-rows collected: ${totalRows}`);
  if (allMissing.length > 0) {
    console.log(`\nSuppressed/missing cells (${allMissing.length}):`);
    for (const m of allMissing) console.log(`  - ${m}`);
  }
  if (sample.length > 0) {
    console.log(`\nSample rows:`);
    for (const r of sample) console.log(`  ${r.geo_name} ${r.metric}: $${r.value} (${r.year})`);
  }

  if (!COMMIT) {
    console.log(`\nDRY RUN OK — would upsert ${totalRows} rows into regional_econ (source='${REGION_SOURCE}'). No DB writes. Pass --commit to write.`);
    return;
  }
  console.log(`\nCMHC RMS rent ingest complete: ${totalRows} rows upserted across ${cmaOk} CMAs.`);
}

main().catch((e) => {
  console.error("ingest-ca-cmhc-rent failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
