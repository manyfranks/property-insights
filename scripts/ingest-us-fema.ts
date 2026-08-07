/**
 * FEMA National Risk Index (NRI), county composite risk + per-hazard scores
 * -> regional_econ. Ported from Economic-Atlas's scripts/ingest-fema-nri.js.
 *
 * Metrics, source='fema', unit='index' (0-100 percentile scores, FEMA's own
 * scale), geo_level='county':
 *   fema_risk_score               <- RISK_SCORE  (composite, all hazards)
 *   fema_eal_score                <- EAL_SCORE   (Expected Annual Loss)
 *   fema_<hazard>_score  for each of the 18 per-hazard "_RISKS" columns
 *     (e.g. fema_wfir_score = wildfire, fema_hrcn_score = hurricane).
 * (EA also carries fema_sovi_score / fema_resl_score composites — Social
 * Vulnerability / Community Resilience — omitted here per this task's scope;
 * trivial to add later by extending COMPOSITE below the same way.)
 *
 * TLS FINGERPRINT WORKAROUND: Node's own https/fetch client gets a 403 from
 * FEMA's bulk zip URL regardless of headers sent (verified live 2026-08 —
 * same result as Economic-Atlas found: a JA3-style TLS/connection
 * fingerprint check, not a header-based one). `curl` gets a clean 200 with
 * identical headers. We shell out to `curl` (and `unzip`) exactly as EA
 * does — both are present on this machine.
 *
 * Field names confirmed against the live file (2026-08): STCOFIPS/COUNTY/
 * STATEABBRV/RISK_SCORE/EAL_SCORE/<hazard>_RISKS all present. Per EA's own
 * correction: FEMA's riverine-flood hazard column prefix is IFLD ("Inland
 * Flooding"), not RFLD.
 *
 * Requires DATABASE_URL only for --commit. No API key — public federal file.
 * Requires the system `curl` and `unzip` binaries. Default is DRY RUN.
 *
 *   npx tsx scripts/ingest-us-fema.ts            # dry run (default)
 *   npx tsx scripts/ingest-us-fema.ts --commit   # write (needs DATABASE_URL)
 *   FEMA_NRI_CSV_FILE=/path/to/NRI_Table_Counties.csv npx tsx scripts/ingest-us-fema.ts   # override
 */
import { execFileSync } from "child_process";
import { readFileSync, statSync, unlink } from "fs";
import os from "os";
import path from "path";
import { loadEnvLocal, INGEST_USER_AGENT, COMMIT, upsertRegionalEcon, RegionalEconRow } from "./lib/ingest-shared";

loadEnvLocal();

// v120 = December 2025 release (confirmed live 2026-08). FEMA does not
// publish a version-free "latest" alias for this URL — when FEMA ships a
// new version, this constant needs a manual bump (rare: NRI releases ~1-2x/yr).
const NRI_ZIP_URL = "https://www.fema.gov/about/reports-and-data/openfema/nri/v120/NRI_Table_Counties.zip";
const LOCAL_FILE = process.env.FEMA_NRI_CSV_FILE || null;
const REGION_SOURCE = "fema";
const UNIT = "index";

const COMPOSITE: Record<string, string> = {
  fema_risk_score: "RISK_SCORE",
  fema_eal_score: "EAL_SCORE",
};
// All 18 hazard prefixes — confirmed against the live file's header directly.
// IFLD (Inland Flooding), not RFLD — EA's audit-caught correction.
const HAZARDS = ["AVLN", "CFLD", "CWAV", "DRGT", "ERQK", "HAIL", "HWAV", "HRCN", "ISTM", "IFLD", "LNDS", "LTNG", "SWND", "TRND", "TSUN", "VLCN", "WFIR", "WNTW"];

function fetchZipAndExtractCsv(url: string): { csvText: string; lastModified: string | null } {
  const tmpZip = path.join(os.tmpdir(), `nri-counties-${Date.now()}.zip`);
  const tmpHeaders = path.join(os.tmpdir(), `nri-counties-${Date.now()}.headers`);
  try {
    execFileSync("curl", ["-sL", "--fail", "-A", INGEST_USER_AGENT, "-D", tmpHeaders, "-o", tmpZip, url], { maxBuffer: 50 * 1024 * 1024 });
    const headerText = readFileSync(tmpHeaders, "utf8");
    const m = headerText.match(/^last-modified:\s*(.+)$/im);
    const lastModified = m ? m[1].trim() : null;
    // -p streams the named member to stdout without writing extra files.
    const csvText = execFileSync("unzip", ["-p", tmpZip, "NRI_Table_Counties.csv"], { maxBuffer: 200 * 1024 * 1024 }).toString("utf8");
    return { csvText, lastModified };
  } catch (e) {
    throw new Error(`Failed to fetch/extract ${url}: ${e instanceof Error ? e.message : e}`);
  } finally {
    unlink(tmpZip, () => {});
    unlink(tmpHeaders, () => {});
  }
}

// Minimal quote-aware CSV line splitter — NRI's county table has no embedded
// commas in the columns we use (all numeric/short codes), but this guards it anyway.
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQ = !inQ;
      continue;
    }
    if (c === "," && !inQ) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

function loadCsv(): { csvText: string; lastModified: string | null } {
  if (LOCAL_FILE) {
    console.warn(`  [override] reading local CSV ${LOCAL_FILE} (FEMA_NRI_CSV_FILE set) — NOT a live fetch`);
    const stat = statSync(LOCAL_FILE);
    return { csvText: readFileSync(LOCAL_FILE, "utf8"), lastModified: stat.mtime.toUTCString() };
  }
  try {
    return fetchZipAndExtractCsv(NRI_ZIP_URL);
  } catch (e) {
    throw new Error(
      `Could not fetch FEMA NRI live (${e instanceof Error ? e.message : e}). If NRI_ZIP_URL 404s, FEMA likely shipped a ` +
        `new version (bump v120 in NRI_ZIP_URL — check https://www.fema.gov/about/openfema/data-sets/national-risk-index-data). ` +
        `Fallback: download NRI_Table_Counties.csv by hand and re-run with FEMA_NRI_CSV_FILE=/path/to/file.csv.`
    );
  }
}

interface Stats {
  seen: number;
  counties: Set<string>;
  missingByMetric: Record<string, number>;
}

function buildRows(text: string, year: number): { rows: RegionalEconRow[]; stats: Stats } {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (!lines.length) throw new Error("NRI_Table_Counties.csv is empty");
  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  const idx: Record<string, number> = Object.fromEntries(header.map((h, i) => [h, i]));

  const required = ["STCOFIPS", "COUNTY", "STATEABBRV", ...Object.values(COMPOSITE), ...HAZARDS.map((h) => `${h}_RISKS`)];
  const missing = required.filter((c) => idx[c] === undefined);
  if (missing.length) {
    throw new Error(`NRI_Table_Counties.csv is missing expected column(s): ${missing.join(", ")}. Aborting — refusing to write partial data.`);
  }

  const rows: RegionalEconRow[] = [];
  const stats: Stats = { seen: 0, counties: new Set(), missingByMetric: {} };
  for (let i = 1; i < lines.length; i++) {
    const c = parseCsvLine(lines[i]);
    const fips = String(c[idx.STCOFIPS] || "").trim().padStart(5, "0");
    if (!/^\d{5}$/.test(fips)) continue;
    stats.seen++;
    const geo_fips = `US-${fips}`;
    const geo_name = `${c[idx.COUNTY]}, ${c[idx.STATEABBRV]}`;

    const pushMetric = (metric: string, raw: string) => {
      const n = Number(raw);
      if (raw == null || raw === "" || !Number.isFinite(n)) {
        stats.missingByMetric[metric] = (stats.missingByMetric[metric] || 0) + 1;
        return;
      }
      rows.push({ geo_fips, geo_name, metric, year, value: n, unit: UNIT, source: REGION_SOURCE });
    };
    for (const [metric, col] of Object.entries(COMPOSITE)) pushMetric(metric, c[idx[col]]);
    for (const hz of HAZARDS) pushMetric(`fema_${hz.toLowerCase()}_score`, c[idx[`${hz}_RISKS`]]);
    stats.counties.add(fips);
  }
  return { rows, stats };
}

async function main() {
  console.log(`FEMA National Risk Index ingest${COMMIT ? "" : " [DRY RUN — no DB writes, no DB connection]"}`);
  const { csvText, lastModified } = loadCsv();
  // NRI is a single current snapshot (not an annual time series), so
  // regional_econ's required `year` column needs SOME value — derive it from
  // the zip's own Last-Modified date (the real release date), never a
  // hardcoded guess that goes stale on a future refresh.
  const nriYear = lastModified ? new Date(lastModified).getUTCFullYear() : null;
  if (!nriYear || !Number.isFinite(nriYear)) {
    throw new Error(`Could not derive a vintage year from Last-Modified ("${lastModified}") — refusing to stamp a guessed year.`);
  }
  console.log(`vintage year (from source Last-Modified: ${lastModified}): ${nriYear}`);
  const { rows, stats } = buildRows(csvText, nriYear);

  console.log(`\ncounties seen: ${stats.seen.toLocaleString()}`);
  console.log(`coverage vs ~3,143 US counties: ${((stats.counties.size / 3143) * 100).toFixed(1)}%`);
  const missingKeys = Object.keys(stats.missingByMetric);
  if (missingKeys.length) console.log(`missing/non-numeric by metric: ${missingKeys.map((k) => `${k}=${stats.missingByMetric[k]}`).join(", ")}`);

  console.log("\nSample rows (a high-wildfire-risk and a high-hurricane-risk county, if present):");
  for (const fips of ["US-06037", "US-12086"]) {
    // LA County CA, Miami-Dade FL
    const here = rows.filter((r) => r.geo_fips === fips);
    if (!here.length) continue;
    console.log(`  ${here[0].geo_name}:`);
    for (const m of ["fema_risk_score", "fema_wfir_score", "fema_hrcn_score"]) {
      const r = here.find((x) => x.metric === m);
      console.log(`    ${m.padEnd(20)} ${r ? r.value : "(missing)"}`);
    }
  }

  console.log(`\nTOTAL rows to upsert: ${rows.length.toLocaleString()}`);
  if (!COMMIT) {
    console.log(`\nDRY RUN OK — would upsert ~${rows.length.toLocaleString()} rows into regional_econ (source='${REGION_SOURCE}'). No DB writes. Pass --commit to write.`);
    return;
  }

  const wrote = await upsertRegionalEcon(rows);
  console.log(`FEMA NRI ingest complete: ${wrote.toLocaleString()} rows upserted.`);
}

main().catch((e) => {
  console.error("ingest-us-fema failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
