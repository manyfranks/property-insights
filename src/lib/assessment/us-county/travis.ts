/**
 * assessment/us-county/travis.ts
 *
 * Travis County (Austin, TX) — free, unauthenticated assessed-value lookup
 * via TCAD's own published bulk certified-appraisal-roll export, NOT a
 * live per-address API (there isn't one — see "WHY NOT A LIVE API" below).
 *
 * This supersedes an earlier version of this file that marked Travis
 * infeasible after two dead-end live-API routes were confirmed:
 *   1. Travis Central Appraisal District's real valuation API
 *      (prod-container.trueprodigyapi.com, behind travis.prodigycad.com)
 *      403s bare requests (WAF Origin check) and 401s
 *      ("Authorization header missing") once a real Origin header is added
 *      — no self-serve token issuance found.
 *   2. Travis County's own free/unauthenticated ArcGIS layer
 *      (gis.traviscountytx.gov TCAD_public/MapServer/0) is address-
 *      queryable but its schema has no value/tax/yearBuilt field at all —
 *      just PROP_ID, situs address, acreage, legal description.
 * Both are still true and still dead ends for a live per-address call.
 *
 * WHAT CHANGED: TCAD separately publishes the entire county's certified
 * appraisal roll as a free bulk download (no login, no request form) at
 *   https://traviscad.org/publicinformation
 * under "20XX Certified Appraisal Export" — a set of fixed-width flat
 * files inside one ZIP, documented by TCAD's own
 * "Export Layout - Property File" PDF (Legacy8.0.33-AppraisalExportLayout,
 * linked from the same page). This is the same TrueAutomation/"Legacy"
 * CAD export format several Texas CADs publish (a public GitHub scraper,
 * intelligent-environments-lab/tcad, exists specifically to consume it),
 * so it is a real, intended-for-reuse artifact — not a leaked file.
 * Live-verified 2026-08-07: downloaded the "2026 Certified Appraisal
 * Export Supp 0" ZIP (~530MB compressed, ~4.9GB uncompressed PROP.TXT +
 * improvement/land detail files), parsed it against the layout PDF, and
 * matched 22 of 47 unique cached Austin listing addresses to a single,
 * unambiguous parcel with a real assessed_val/appraised_val (prop_id
 * 222863 for "5507 Burgundy Dr" — the exact PROP_ID the old ArcGIS-layer
 * probe in dead-end (2) above also found, confirming the join is correct).
 * The other 25 were genuine condo/multi-unit complexes sharing one situs
 * address with no unit number in our cached listings to disambiguate
 * (e.g. "6804 N Capital Of Tx Hwy" resolves to 97 individually-folioed
 * condo units) — same conservative "skip rather than guess" policy as
 * maricopa.ts/miami-dade.ts, not a bug.
 *
 * WHY NOT A LIVE API: this is a ~530MB compressed / multi-GB uncompressed
 * bulk file, not an address-indexed endpoint — there is no way to ask TCAD
 * "what is 5507 Burgundy Dr worth" over HTTP for free. So this module
 * downloads the export ONCE per local process (cached to disk under
 * os.tmpdir(), re-downloaded only if the cached copy is >30 days old) and
 * builds an in-memory address index by streaming the relevant member files
 * out of the ZIP via the system `unzip -p` binary (Node has no built-in
 * ZIP64 reader, and PROP.TXT alone exceeds the 4GB ZIP32 size limit, so a
 * pure-JS zip lib would need ZIP64 support; `unzip` already handles that
 * correctly and is present on the dev machine this runs on). This is safe
 * ONLY because — per ./types.ts's module doc — these us-county adapters
 * are exclusively invoked by scripts/enrich-us-from-assessors.ts, a local
 * batch script, never by a live user request path; the multi-minute first
 * call here would be unacceptable in a Vercel serverless function but is
 * fine for a one-time local enrichment run.
 *
 * FIELD MAPPING (TCAD "Export Layout - Property File", PROP.TXT, one
 * fixed-width record per property+owner — see prop_id dedup note below):
 *   assessed_val (offset 1946-1960)  -> assessedValue (TX's post-cap,
 *     actually-taxed figure — same role as AZ's LPV_CUR/FL's AV_NSD
 *     elsewhere in this directory)
 *   market_value (offset 4214-4227) -> marketValue, falling back to
 *     appraised_val (1916-1930) when market_value is 0/blank (observed:
 *     the two are equal for the overwhelming majority of rows; TCAD's own
 *     field description literally calls market_value "Property market
 *     value", so it's preferred when present)
 *   prop_val_yr (offset 18-22)       -> assessmentYear
 *   situs_num/situs_unit/situs_street_prefx/situs_street/
 *     situs_street_suffix (offsets 4460-4479, 1040-1109) -> the address
 *     index key (see normalizeStreetPart())
 *   yr_built (IMP_DET.TXT, offset 86-89, joined on prop_id)  -> yearBuilt
 *   size_square_feet (LAND_DET.TXT, offset 84-97, joined on prop_id)
 *     -> lotSize
 * No per-parcel dollar tax amount is published — annualTaxes intentionally
 * left unset (see ./types.ts's doc comment on that field).
 *
 * prop_id DEDUP: per the layout PDF's own note, a property with multiple
 * owners gets one PROP.TXT record PER OWNER, all sharing the same prop_id.
 * This module keeps only the first record seen for a given prop_id — the
 * value fields don't vary by owner-row, only owner/exemption fields do (not
 * consumed here).
 */

import { spawn } from "child_process";
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from "fs";
import { createInterface } from "readline";
import { Readable } from "stream";
import { finished } from "stream/promises";
import os from "os";
import path from "path";
import { CountyAssessorResult } from "./types";

const TCAD_EXPORT_URL =
  "https://traviscad.org/wp-content/largefiles/2026%20Certified%20Appraisal%20Export%20Supp%200_07182026.zip";
const CACHE_DIR = path.join(os.tmpdir(), "property-insights-tcad-export");
const ZIP_PATH = path.join(CACHE_DIR, "tcad-certified-export.zip");
const ZIP_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — TCAD republishes this a few times/year, not daily
const DOWNLOAD_USER_AGENT = "Property Insights research mfrancis45@gmail.com";

// ---------------------------------------------------------------------------
// Fixed-width field offsets, 0-indexed [start, end) — converted from the
// layout PDF's 1-indexed inclusive [start, end] columns (e.g. the PDF's
// "1946 1960" for assessed_val becomes slice(1945, 1960) here).
// ---------------------------------------------------------------------------

const PROP_FIELDS = {
  propId: [0, 12],
  propValYr: [17, 22],
  situsStreetPrefx: [1039, 1049],
  situsStreet: [1049, 1099],
  situsStreetSuffix: [1099, 1109],
  appraisedVal: [1915, 1930],
  assessedVal: [1945, 1960],
  marketValue: [4213, 4227],
  situsNum: [4459, 4474],
  situsUnit: [4474, 4479],
} as const;

const IMP_DET_FIELDS = {
  propId: [0, 12],
  yrBuilt: [85, 89],
} as const;

const LAND_DET_FIELDS = {
  propId: [0, 12],
  sizeSquareFeet: [83, 97],
} as const;

function slice(line: string, field: readonly [number, number]): string {
  return line.slice(field[0], field[1]).trim();
}

// ---------------------------------------------------------------------------
// Address normalization — TCAD's own abbreviation conventions, confirmed
// against real extracted rows (notably HIGHWAY/HWY -> "HY", not the USPS-
// standard "HWY" used elsewhere in this codebase, e.g. miami-dade.ts).
// ---------------------------------------------------------------------------

const DIRECTIONAL_ABBREVS: [RegExp, string][] = [
  [/\bNORTHEAST\b/g, "NE"],
  [/\bNORTHWEST\b/g, "NW"],
  [/\bSOUTHEAST\b/g, "SE"],
  [/\bSOUTHWEST\b/g, "SW"],
  [/\bNORTH\b/g, "N"],
  [/\bSOUTH\b/g, "S"],
  [/\bEAST\b/g, "E"],
  [/\bWEST\b/g, "W"],
];

const STREET_TYPE_ABBREVS: [RegExp, string][] = [
  [/\bSTREET\b/g, "ST"],
  [/\bAVENUE\b/g, "AVE"],
  [/\bBOULEVARD\b/g, "BLVD"],
  [/\bDRIVE\b/g, "DR"],
  [/\bCOURT\b/g, "CT"],
  [/\bROAD\b/g, "RD"],
  [/\bPLACE\b/g, "PL"],
  [/\bTERRACE\b/g, "TER"],
  [/\bLANE\b/g, "LN"],
  [/\bCIRCLE\b/g, "CIR"],
  [/\bTRAIL\b/g, "TRL"],
  [/\bPARKWAY\b/g, "PKWY"],
  [/\bHIGHWAY\b/g, "HY"], // TCAD-specific: "HY", not USPS's "HWY" — confirmed live
  [/\bHWY\b/g, "HY"],
  [/\bCOVE\b/g, "CV"],
  [/\bBEND\b/g, "BND"],
];

/** Canonicalize the non-numeric part of a street address for TCAD-index
 * lookup — uppercase, strip punctuation/ordinals, fold directional and
 * street-type words to TCAD's own abbreviations. */
function normalizeStreetPart(s: string): string {
  let x = s.trim().toUpperCase().replace(/[.,]/g, "").replace(/\s+/g, " ");
  x = x.replace(/\b(\d+)(ST|ND|RD|TH)\b/g, "$1");
  for (const [pat, repl] of DIRECTIONAL_ABBREVS) x = x.replace(pat, repl);
  for (const [pat, repl] of STREET_TYPE_ABBREVS) x = x.replace(pat, repl);
  x = x.replace(/\bTEXAS\b/g, "TX");
  return x.replace(/\s+/g, " ").trim();
}

interface ParsedAddress {
  num: string;
  rest: string;
}

function parseAddress(address: string): ParsedAddress | null {
  const m = address.trim().match(/^(\S+)\s+(.*)$/);
  if (!m) return null;
  return { num: m[1].toUpperCase(), rest: normalizeStreetPart(m[2]) };
}

interface PropertyRow {
  propId: string;
  situsUnit: string;
  rest: string;
  appraisedVal: number;
  assessedVal: number;
  marketValue: number;
  propValYr: string;
}

// ---------------------------------------------------------------------------
// Download + cache the ZIP, then stream one member out of it via `unzip -p`
// (Node has no built-in ZIP64 reader; PROP.TXT alone is ~4.9GB uncompressed,
// over the ZIP32 4GB limit — see module doc).
// ---------------------------------------------------------------------------

async function ensureZipCached(): Promise<string> {
  mkdirSync(CACHE_DIR, { recursive: true });
  if (existsSync(ZIP_PATH) && Date.now() - statSync(ZIP_PATH).mtimeMs < ZIP_MAX_AGE_MS) {
    return ZIP_PATH;
  }
  console.error(`[travis] downloading TCAD certified appraisal export (~530MB, one-time/monthly)...`);
  const res = await fetch(TCAD_EXPORT_URL, { headers: { "User-Agent": DOWNLOAD_USER_AGENT } });
  if (!res.ok || !res.body) {
    throw new Error(`[travis] TCAD export download failed: HTTP ${res.status}`);
  }
  const partPath = `${ZIP_PATH}.part`;
  const fileStream = createWriteStream(partPath);
  await finished(Readable.fromWeb(res.body as import("stream/web").ReadableStream).pipe(fileStream));
  renameSync(partPath, ZIP_PATH);
  console.error(`[travis] download complete: ${ZIP_PATH}`);
  return ZIP_PATH;
}

/** Streams a single member out of the cached ZIP line-by-line via the
 * system `unzip -p` binary (present on the dev machine this batch script
 * runs on — see module doc). Rejects if `unzip` exits non-zero or can't be
 * spawned; callers treat that as "this optional index unavailable". */
async function forEachLineInZipMember(
  zipPath: string,
  memberName: string,
  onLine: (line: string) => void
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn("unzip", ["-p", zipPath, memberName]);
    const rl = createInterface({ input: proc.stdout });
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    rl.on("line", onLine);
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`[travis] unzip -p ${memberName} exited ${code}: ${stderr.slice(0, 500)}`));
    });
  });
}

// ---------------------------------------------------------------------------
// Lazily-built, process-lifetime-cached indices (singletons — this module
// is only ever loaded once per script run, see module doc).
// ---------------------------------------------------------------------------

let propertyIndexPromise: Promise<Map<string, PropertyRow[]>> | null = null;
let yearBuiltIndexPromise: Promise<Map<string, number>> | null = null;
let lotSizeIndexPromise: Promise<Map<string, number>> | null = null;

async function buildPropertyIndex(): Promise<Map<string, PropertyRow[]>> {
  const zipPath = await ensureZipCached();
  const index = new Map<string, PropertyRow[]>();
  const seenPropIds = new Set<string>();
  console.error(`[travis] indexing PROP.TXT (~4.9GB, one-time per process)...`);
  await forEachLineInZipMember(zipPath, "PROP.TXT", (line) => {
    if (line.length < 4227) return; // short/blank trailing line
    const propId = slice(line, PROP_FIELDS.propId);
    if (!propId || seenPropIds.has(propId)) return; // multi-owner dup row (see module doc)
    const situsNum = slice(line, PROP_FIELDS.situsNum);
    if (!situsNum) return;
    seenPropIds.add(propId);

    const rest = normalizeStreetPart(
      [slice(line, PROP_FIELDS.situsStreetPrefx), slice(line, PROP_FIELDS.situsStreet), slice(line, PROP_FIELDS.situsStreetSuffix)]
        .filter(Boolean)
        .join(" ")
    );
    const row: PropertyRow = {
      propId,
      situsUnit: slice(line, PROP_FIELDS.situsUnit),
      rest,
      appraisedVal: Number(slice(line, PROP_FIELDS.appraisedVal)) || 0,
      assessedVal: Number(slice(line, PROP_FIELDS.assessedVal)) || 0,
      marketValue: Number(slice(line, PROP_FIELDS.marketValue)) || 0,
      propValYr: slice(line, PROP_FIELDS.propValYr),
    };
    const bucket = index.get(situsNum);
    if (bucket) bucket.push(row);
    else index.set(situsNum, [row]);
  });
  console.error(`[travis] indexed ${seenPropIds.size} unique parcels under ${index.size} situs numbers`);
  return index;
}

async function buildYearBuiltIndex(): Promise<Map<string, number>> {
  const zipPath = await ensureZipCached();
  const index = new Map<string, number>();
  await forEachLineInZipMember(zipPath, "IMP_DET.TXT", (line) => {
    if (line.length < 89) return;
    const propId = slice(line, IMP_DET_FIELDS.propId);
    if (!propId || index.has(propId)) return; // keep first improvement row (primary structure)
    const yr = parseInt(slice(line, IMP_DET_FIELDS.yrBuilt), 10);
    if (Number.isFinite(yr) && yr > 1800) index.set(propId, yr);
  });
  return index;
}

async function buildLotSizeIndex(): Promise<Map<string, number>> {
  const zipPath = await ensureZipCached();
  const index = new Map<string, number>();
  await forEachLineInZipMember(zipPath, "LAND_DET.TXT", (line) => {
    if (line.length < 97) return;
    const propId = slice(line, LAND_DET_FIELDS.propId);
    if (!propId || index.has(propId)) return;
    const sqft = Math.round(Number(slice(line, LAND_DET_FIELDS.sizeSquareFeet)));
    if (Number.isFinite(sqft) && sqft > 0) index.set(propId, sqft);
  });
  return index;
}

function getPropertyIndex(): Promise<Map<string, PropertyRow[]>> {
  if (!propertyIndexPromise) propertyIndexPromise = buildPropertyIndex();
  return propertyIndexPromise;
}

/** Optional enrichment indices — a failure here (e.g. IMP_DET.TXT stream
 * error) should not fail the whole lookup, just leave yearBuilt/lotSize
 * unset, so these are wrapped rather than awaited directly by callers. */
function getYearBuiltIndex(): Promise<Map<string, number>> {
  if (!yearBuiltIndexPromise) yearBuiltIndexPromise = buildYearBuiltIndex().catch((err) => {
    console.error(`[travis] yearBuilt index unavailable: ${err instanceof Error ? err.message : String(err)}`);
    return new Map<string, number>();
  });
  return yearBuiltIndexPromise;
}

function getLotSizeIndex(): Promise<Map<string, number>> {
  if (!lotSizeIndexPromise) lotSizeIndexPromise = buildLotSizeIndex().catch((err) => {
    console.error(`[travis] lotSize index unavailable: ${err instanceof Error ? err.message : String(err)}`);
    return new Map<string, number>();
  });
  return lotSizeIndexPromise;
}

/**
 * Live lookup against the locally-indexed TCAD certified appraisal roll
 * (see module doc for why this is a bulk-file index rather than an API
 * call). Returns null for "no usable result" — no address match, ambiguous
 * multi-parcel match (condo/multi-unit complex with no unit number to
 * disambiguate, same policy as maricopa.ts/miami-dade.ts), or a parcel with
 * no usable assessed value — never throws for those.
 */
export async function lookupByAddress(street: string, _city?: string): Promise<CountyAssessorResult | null> {
  const parsed = parseAddress(street);
  if (!parsed) return null;

  const index = await getPropertyIndex();
  const candidates = index.get(parsed.num);
  if (!candidates || candidates.length === 0) return null;

  const hits = candidates.filter(
    (c) => c.rest === parsed.rest || c.rest.startsWith(parsed.rest) || parsed.rest.startsWith(c.rest)
  );
  if (hits.length !== 1) return null; // no match, or ambiguous multi-unit — see module doc
  const chosen = hits[0];

  if (chosen.assessedVal <= 0) return null;

  const [yearBuiltIndex, lotSizeIndex] = await Promise.all([getYearBuiltIndex(), getLotSizeIndex()]);

  const marketValue = chosen.marketValue > 0 ? chosen.marketValue : chosen.appraisedVal > 0 ? chosen.appraisedVal : undefined;

  const result: CountyAssessorResult = {
    assessedValue: Math.round(chosen.assessedVal),
    marketValue: marketValue != null ? Math.round(marketValue) : undefined,
    yearBuilt: yearBuiltIndex.get(chosen.propId),
    lotSize: lotSizeIndex.get(chosen.propId),
    assessmentYear: chosen.propValYr ? String(parseInt(chosen.propValYr, 10)) : String(new Date().getFullYear()),
    source: "county_assessor",
  };
  return result;
}

/** Minimal health probe — mirrors ab.ts's calgarySodaHealthCheck()
 * convention. NOTE: unlike the other two adapters' health checks, this one
 * triggers the full one-time bulk download+index build on first call (see
 * module doc) — expect this to take minutes, not milliseconds. */
export async function travisHealthCheck(): Promise<{ ok: boolean; detail: string }> {
  try {
    const result = await lookupByAddress("5507 Burgundy Dr");
    if (result) return { ok: true, detail: `assessedValue=${result.assessedValue} year=${result.assessmentYear}` };
    return { ok: false, detail: "known-good address returned no result (export layout/dataset may have changed)" };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? `${err.name}: ${err.message}` : String(err) };
  }
}
