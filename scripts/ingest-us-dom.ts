/**
 * Realtor.com county median days-on-market (via FRED) -> regional_econ.
 *
 * SERIES ID PATTERN — verified live against FRED (2026-08-08) for all three
 * Discover metro counties before writing this script:
 *   MEDDAYONMAR{unpadded 5-digit county FIPS as an integer}
 *   e.g. MEDDAYONMAR48453 = Travis County, TX (48453, no leading zero to
 *   strip); MEDDAYONMAR4013 = Maricopa County, AZ (04013 -> leading zero
 *   stripped -> 4013); MEDDAYONMAR12086 = Miami-Dade County, FL (12086).
 *   Confirmed live: a request with the zero-padded form (MEDDAYONMAR04013)
 *   404/400s — FRED's series IDs are the county FIPS run through a plain
 *   int-to-string conversion, not the zero-padded 5-digit code.
 *
 * NOT EVERY COUNTY HAS THIS SERIES — realtor.com's inventory metrics only
 * cover counties with enough MLS listing volume to compute a stable median.
 * A county with no series returns HTTP 400 (`{"error_code":400,
 * "error_message":"Bad Request.  The series does not exist."}` — confirmed
 * live), not 404. Treated as skip-and-log, not a failure — the whole point
 * of the hit-rate report below is to show how many of the target counties
 * actually have this data.
 *
 * Metric written: median_dom, unit=days, source=realtor_com_via_fred,
 * geo_level=county, monthly grain (see src/lib/db/schema.sql's regional_econ
 * doc comment for why `month` exists and how the natural-key index handles
 * it) — one row per (county, year, month), last 36 months per county.
 *
 * SCOPE: the 3 Discover metro counties (Travis TX, Maricopa AZ, Miami-Dade
 * FL — src/lib/data/city-metadata.ts's US_DISCOVER_CITIES) union
 * TOP_METRO_FIPS (src/lib/us-counties.ts, ~105 counties; the 3 Discover
 * counties are already members of that list, so the union is really just
 * TOP_METRO_FIPS plus a defensive explicit include in case that list is
 * ever trimmed). County display names come from the local US_COUNTIES
 * registry (src/lib/data/us-counties.json), not a second FRED call — it
 * already carries every TOP_METRO_FIPS county's name+state.
 *
 * CHUNKED / RESUMABLE (the HUD ingest lesson — see ingest-us-hud-fmr.ts):
 * each county's ~36 rows are upserted (--commit) IMMEDIATELY after that
 * county's fetch succeeds, not batched across the whole run. An interrupted
 * run (Ctrl-C, network blip, rate limit) has already durably written every
 * county processed so far — nothing is lost, and simply re-running the
 * script is safe (upsertRegionalEcon is an idempotent ON CONFLICT DO
 * UPDATE) rather than requiring a resume flag.
 *
 * FRED calls are free/effectively unlimited but this stays polite: ~500ms
 * between requests (DOM_INGEST_DELAY_MS).
 *
 * Requires FRED_API_KEY always; DATABASE_URL only for --commit. Default is
 * DRY RUN (fetch + parse + print hit-rate/counts, no DB connection).
 *
 *   npx tsx scripts/ingest-us-dom.ts            # dry run (default)
 *   npx tsx scripts/ingest-us-dom.ts --commit   # write (needs DATABASE_URL)
 */
import { loadEnvLocal, COMMIT, sleep, upsertRegionalEcon, RegionalEconRow } from "./lib/ingest-shared";
import { TOP_METRO_FIPS } from "../src/lib/us-counties";
import { US_DISCOVER_CITIES } from "../src/lib/data/city-metadata";
import countiesData from "../src/lib/data/us-counties.json";

loadEnvLocal();

const FRED_KEY = process.env.FRED_API_KEY;
const REGION_SOURCE = "realtor_com_via_fred";
const METRIC = "median_dom";
const UNIT = "days";
const MONTHS_BACK = 36;
const DELAY_MS = Number(process.env.DOM_INGEST_DELAY_MS || 500);

if (!FRED_KEY) {
  throw new Error(
    "FRED_API_KEY is required (free, instant signup: https://fred.stlouisfed.org/docs/api/api_key.html)."
  );
}

interface CountyNameRow {
  fips: string;
  county: string;
  state: string;
}
const NAME_BY_FIPS = new Map<string, CountyNameRow>(
  (countiesData as CountyNameRow[]).map((c) => [c.fips, c])
);

// Discover's 3 metro counties, unioned with TOP_METRO_FIPS (already a
// superset in practice — see module doc — but explicit rather than assumed).
const TARGET_FIPS: string[] = Array.from(
  new Set([...US_DISCOVER_CITIES.map((c) => c.countyFips), ...TOP_METRO_FIPS])
);

function seriesIdFor(countyFips: string): string {
  const fiveDigit = countyFips.replace(/^US-/, "");
  const asInt = parseInt(fiveDigit, 10);
  return `MEDDAYONMAR${asInt}`;
}

function geoNameFor(countyFips: string): string {
  const row = NAME_BY_FIPS.get(countyFips);
  return row ? `${row.county}, ${row.state}` : countyFips;
}

interface FredObservation {
  date: string; // "YYYY-MM-01"
  value: string; // numeric string, or "." for missing
}
interface FredObservationsResponse {
  observations: FredObservation[];
}

type FetchOutcome =
  | { ok: true; rows: RegionalEconRow[] }
  | { ok: false; reason: "no_series" }
  | { ok: false; reason: "error"; message: string };

async function fetchCountyDom(countyFips: string): Promise<FetchOutcome> {
  const seriesId = seriesIdFor(countyFips);
  const geoName = geoNameFor(countyFips);
  const url =
    `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}` +
    `&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=${MONTHS_BACK}`;

  const res = await fetch(url, {
    headers: { "User-Agent": "Property Insights ingest mfrancis45@gmail.com" },
  });

  if (res.status === 400) {
    // Confirmed live: FRED returns 400 (not 404) for a series that doesn't
    // exist, e.g. {"error_code":400,"error_message":"Bad Request.  The
    // series does not exist."} — treat any 400 here as "no series for this
    // county", since our series_id is always well-formed (constructed from
    // a known-valid FIPS), so a 400 can't be a malformed-request bug.
    return { ok: false, reason: "no_series" };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { ok: false, reason: "error", message: `HTTP ${res.status}: ${body.slice(0, 300)}` };
  }

  const json = (await res.json()) as FredObservationsResponse;
  if (!json || !Array.isArray(json.observations)) {
    // Shape surprise — fail loud rather than silently skip.
    throw new Error(`${seriesId}: unexpected response shape (no observations array). Got: ${JSON.stringify(json).slice(0, 300)}`);
  }

  const rows: RegionalEconRow[] = [];
  for (const obs of json.observations) {
    if (obs.value === "." || obs.value == null || obs.value === "") continue; // FRED's missing-value sentinel
    const value = Number(obs.value);
    if (!Number.isFinite(value)) continue;
    const dateMatch = /^(\d{4})-(\d{2})-\d{2}$/.exec(obs.date);
    if (!dateMatch) {
      throw new Error(`${seriesId}: unexpected observation date shape "${obs.date}". Aborting — refusing to guess.`);
    }
    const year = Number(dateMatch[1]);
    const month = Number(dateMatch[2]);
    rows.push({
      geo_fips: countyFips,
      geo_name: geoName,
      metric: METRIC,
      year,
      month,
      value,
      unit: UNIT,
      source: REGION_SOURCE,
    });
  }
  return { ok: true, rows };
}

interface Stats {
  attempted: number;
  hit: number;
  miss: number;
  errored: number;
  totalRows: number;
}

async function main() {
  console.log(`Realtor.com median-DOM ingest (via FRED)${COMMIT ? "" : " [DRY RUN — no DB writes]"}`);
  console.log(`target counties: ${TARGET_FIPS.length} (Discover metros ${US_DISCOVER_CITIES.length}, TOP_METRO_FIPS ${TOP_METRO_FIPS.length}, unioned)`);

  const stats: Stats = { attempted: 0, hit: 0, miss: 0, errored: 0, totalRows: 0 };
  const missed: string[] = [];
  const errors: string[] = [];
  const sample: RegionalEconRow[] = [];

  for (const fips of TARGET_FIPS) {
    stats.attempted++;
    const outcome = await fetchCountyDom(fips);

    if (outcome.ok) {
      stats.hit++;
      stats.totalRows += outcome.rows.length;
      if (sample.length < 3 && outcome.rows.length > 0) sample.push(outcome.rows[0]);

      if (COMMIT && outcome.rows.length > 0) {
        // Commit PER COUNTY, immediately — see module doc's "chunked /
        // resumable" section. An interruption after this point has already
        // durably saved this county.
        await upsertRegionalEcon(outcome.rows);
      }
      console.log(
        `  [${stats.attempted}/${TARGET_FIPS.length}] ${geoNameFor(fips)} (${fips}, ${seriesIdFor(fips)}): ${outcome.rows.length} months` +
          (COMMIT ? " — committed" : "")
      );
    } else if (outcome.reason === "no_series") {
      stats.miss++;
      missed.push(`${geoNameFor(fips)} (${fips})`);
      console.log(`  [${stats.attempted}/${TARGET_FIPS.length}] ${geoNameFor(fips)} (${fips}, ${seriesIdFor(fips)}): NO SERIES — skipped`);
    } else {
      stats.errored++;
      errors.push(`${geoNameFor(fips)} (${fips}): ${outcome.message}`);
      console.warn(`  [${stats.attempted}/${TARGET_FIPS.length}] ${geoNameFor(fips)} (${fips}, ${seriesIdFor(fips)}): ERROR — ${outcome.message}`);
    }

    await sleep(DELAY_MS);
  }

  const hitRate = stats.attempted ? ((stats.hit / stats.attempted) * 100).toFixed(1) : "0.0";
  console.log(`\n=== Summary ===`);
  console.log(`attempted: ${stats.attempted}`);
  console.log(`hit (series exists): ${stats.hit} (${hitRate}%)`);
  console.log(`miss (no series): ${stats.miss}`);
  console.log(`errored: ${stats.errored}`);
  console.log(`total month-rows collected: ${stats.totalRows.toLocaleString()}`);

  if (missed.length > 0) {
    console.log(`\nCounties with no median-DOM series (${missed.length}):`);
    for (const m of missed) console.log(`  - ${m}`);
  }
  if (errors.length > 0) {
    console.log(`\nCounties that errored (${errors.length}) — investigate, these are NOT "no series":`);
    for (const e of errors) console.log(`  - ${e}`);
  }
  if (sample.length > 0) {
    console.log(`\nSample rows:`);
    for (const r of sample) console.log(`  ${r.geo_name}: ${r.year}-${String(r.month).padStart(2, "0")} = ${r.value} days`);
  }

  if (!COMMIT) {
    console.log(`\nDRY RUN OK — would upsert ~${stats.totalRows.toLocaleString()} rows into regional_econ (metric='${METRIC}', source='${REGION_SOURCE}'). No DB writes. Pass --commit to write.`);
    return;
  }

  console.log(`\nRealtor.com median-DOM ingest complete: ${stats.totalRows.toLocaleString()} rows upserted across ${stats.hit} counties.`);
}

main().catch((e) => {
  console.error("ingest-us-dom failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
