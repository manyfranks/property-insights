/**
 * HUD Fair Market Rents (FMR) -> regional_econ. Ported from Economic-Atlas's
 * scripts/ingest-hud-fmr.js.
 *
 * Metrics, source='hud', geo_level='county', unit='USD':
 *   fmr_studio, fmr_1br, fmr_2br, fmr_3br, fmr_4br
 *
 * API SHAPE (confirmed live against huduser.gov, 2026-08):
 *   - GET /hudapi/public/fmr/listCounties/{state}  (Bearer token) -> county
 *     list with FIPS for a state. Non-metro (and some metro, via "small area
 *     FMR") counties carry a fips_code suffixed "99999".
 *   - GET /hudapi/public/fmr/data/{fips_code}  (Bearer token) -> FMR values.
 *     `data.basicdata` is either a single object (year on `basicdata.year`,
 *     confirmed live e.g. Albany County WY) or — for "small area FMR"
 *     counties (`data.smallarea_status==="1"`) — an ARRAY of ZIP-level
 *     sub-areas with no per-item year (vintage on `data.year` instead).
 *     [0] of that array is the "MSA level"/whole-area entry, used here.
 *     Both shapes handled; whichever is missing fails loud.
 *
 * huduser.gov's bulk-file (static .xlsx) route is behind an AWS WAF
 * challenge — the keyed API is the only viable path, hence HUD_API_KEY is
 * required even for a real dry run (there's no keyless preview).
 *
 * RATE LIMIT: tracked from HUD's own response headers (`x-ratelimit-limit`,
 * `x-ratelimit-remaining` — confirmed live at 60/window), not guessed, plus
 * retry-with-backoff on 429.
 *
 * Requires HUD_API_KEY always; DATABASE_URL only for --commit. Default is
 * DRY RUN. Full 51-state run makes ~3,200 API calls — pass --states=XX,YY
 * to sample a subset for a fast smoke test.
 *
 *   npx tsx scripts/ingest-us-hud-fmr.ts                    # dry run, all states
 *   npx tsx scripts/ingest-us-hud-fmr.ts --states=CA,NY,WY  # dry run, sampled states
 *   npx tsx scripts/ingest-us-hud-fmr.ts --commit            # write (needs DATABASE_URL)
 */
import { loadEnvLocal, COMMIT, sleep, upsertRegionalEcon, RegionalEconRow } from "./lib/ingest-shared";

loadEnvLocal();

const KEY = process.env.HUD_API_KEY;
const BASE = "https://www.huduser.gov/hudapi/public/fmr";
const REGION_SOURCE = "hud";
const UNIT = "USD";
const MAX_RETRIES = Number(process.env.HUD_MAX_RETRIES || 4);
const RATE_LIMIT_BUFFER = 3; // proactively pause once this few requests remain in the window
const RATE_LIMIT_COOLDOWN_MS = 65_000; // HUD's window is unconfirmed in length; errs long, not short

if (!KEY) {
  throw new Error(
    "HUD_API_KEY is required (free, instant Bearer token: https://www.huduser.gov/hudapi/public/login). " +
      "huduser.gov also WAF-blocks the bulk-file alternative, so there is no keyless path for this source at all."
  );
}

const ALL_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA",
  "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK",
  "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC",
];

const statesArg = process.argv.find((a) => a.startsWith("--states="));
const STATES = statesArg
  ? statesArg
      .slice("--states=".length)
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
  : ALL_STATES;

const METRIC_KEYS: Record<string, string> = {
  fmr_studio: "Efficiency",
  fmr_1br: "One-Bedroom",
  fmr_2br: "Two-Bedroom",
  fmr_3br: "Three-Bedroom",
  fmr_4br: "Four-Bedroom",
};

let _remaining: number | null = null;

async function getJson<T>(path: string, attempt = 0): Promise<T> {
  if (_remaining != null && _remaining <= RATE_LIMIT_BUFFER) {
    console.warn(`  [hud] rate-limit buffer low (${_remaining} left) — cooling down ${RATE_LIMIT_COOLDOWN_MS / 1000}s before ${path}`);
    await sleep(RATE_LIMIT_COOLDOWN_MS);
    _remaining = null; // assume the window reset; next response header will confirm/correct
  }
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${KEY}` } });
  const remainingHeader = res.headers.get("x-ratelimit-remaining");
  if (remainingHeader != null) _remaining = Number(remainingHeader);

  if (res.status === 429) {
    if (attempt >= MAX_RETRIES) throw new Error(`HUD HTTP 429 for ${path} (gave up after ${MAX_RETRIES} retries)`);
    const retryAfter = Number(res.headers.get("retry-after"));
    const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : RATE_LIMIT_COOLDOWN_MS;
    console.warn(`  [hud] 429 for ${path} — retry ${attempt + 1}/${MAX_RETRIES} after ${(wait / 1000).toFixed(0)}s`);
    await sleep(wait);
    return getJson<T>(path, attempt + 1);
  }
  if (!res.ok) throw new Error(`HUD HTTP ${res.status} for ${path}`);
  return res.json() as Promise<T>;
}

interface CountyListing {
  fips_code: string;
  county_name: string;
}

async function fetchNonMetroCounties(state: string): Promise<CountyListing[]> {
  const list = await getJson<CountyListing[]>(`/listCounties/${state}`);
  if (!Array.isArray(list)) throw new Error(`listCounties/${state}: unexpected response shape (not an array) — HUD's API layout may have changed. Aborting.`);
  return list.filter((c) => typeof c.fips_code === "string" && c.fips_code.endsWith("99999"));
}

interface HudDataResponse {
  data?: {
    year?: string | number;
    basicdata?: Record<string, unknown> | Record<string, unknown>[];
  };
}

async function fetchFmrForFips(fipsCode: string): Promise<Record<string, number> & { year: number }> {
  const res = await getJson<HudDataResponse>(`/data/${fipsCode}`);
  const basic = res?.data?.basicdata;
  if (!basic) throw new Error(`data/${fipsCode}: missing data.basicdata in response — HUD's API layout may have changed. Aborting.`);
  const arr = (Array.isArray(basic) ? basic[0] : basic) as Record<string, unknown>;
  const year = Number(res.data?.year != null ? res.data.year : arr.year);
  if (!Number.isFinite(year)) throw new Error(`data/${fipsCode}: missing/invalid year in response — HUD's API layout may have changed. Aborting.`);
  const out: Record<string, number> & { year: number } = { year };
  for (const [metric, key] of Object.entries(METRIC_KEYS)) {
    const val = arr[key];
    if (val != null) out[metric] = Number(val);
  }
  return out;
}

interface Stats {
  statesTried: number;
  statesFailed: number;
  discovered: number;
  counties: number;
  errors: number;
}

async function main() {
  console.log(`HUD Fair Market Rents ingest${COMMIT ? "" : " [DRY RUN — no DB writes, but a real HUD_API_KEY call happens either way]"}`);
  if (statesArg) console.log(`SAMPLED RUN: --states=${STATES.join(",")} (not the full 51-state set)`);

  const rows: RegionalEconRow[] = [];
  const stats: Stats = { statesTried: 0, statesFailed: 0, discovered: 0, counties: 0, errors: 0 };

  for (const state of STATES) {
    stats.statesTried++;
    let counties: CountyListing[];
    try {
      counties = await fetchNonMetroCounties(state);
    } catch (e) {
      console.warn(`  [hud] listCounties/${state}: ${e instanceof Error ? e.message : e}`);
      stats.statesFailed++;
      continue;
    }
    stats.discovered += counties.length;
    for (const county of counties) {
      const fipsCode = county.fips_code;
      const countyFips = fipsCode.slice(0, 5);
      try {
        const fmr = await fetchFmrForFips(fipsCode);
        for (const [metric, value] of Object.entries(fmr)) {
          if (metric === "year") continue;
          if (Number.isFinite(value) && value > 0) {
            rows.push({
              geo_fips: `US-${countyFips}`,
              geo_name: county.county_name || countyFips,
              metric,
              value,
              year: fmr.year,
              unit: UNIT,
              source: REGION_SOURCE,
            });
          }
        }
        stats.counties++;
      } catch (e) {
        console.warn(`  [hud] data/${fipsCode}: ${e instanceof Error ? e.message : e}`);
        stats.errors++;
      }
    }
  }

  console.log(`\nstates tried: ${stats.statesTried} (${stats.statesFailed} failed to list), counties discovered: ${stats.discovered}, fetched: ${stats.counties}, errors: ${stats.errors}`);
  console.log(`coverage vs ~3,143 US counties: ${((stats.counties / 3143) * 100).toFixed(1)}% (non-metro + small-area-FMR counties only, by design)`);
  console.log(`\nTOTAL rows to upsert: ${rows.length.toLocaleString()}`);

  const attempted = stats.counties + stats.errors;
  const completionRate = attempted > 0 ? stats.counties / attempted : 0;
  const COMPLETION_THRESHOLD = 0.5;
  if (stats.statesFailed > STATES.length / 2 || (attempted > 0 && completionRate < COMPLETION_THRESHOLD)) {
    throw new Error(
      `HUD ingest failed loud: only ${(completionRate * 100).toFixed(1)}% of attempted county fetches succeeded ` +
        `(${stats.counties}/${attempted}; ${stats.statesFailed}/${STATES.length} states failed to list) — below the ` +
        `${COMPLETION_THRESHOLD * 100}% threshold. Refusing to report this as a successful run.`
    );
  }

  if (!COMMIT) {
    console.log(`\nDRY RUN OK — would upsert ~${rows.length.toLocaleString()} rows into regional_econ (source='${REGION_SOURCE}'). No DB writes. Pass --commit to write.`);
    return;
  }

  const wrote = await upsertRegionalEcon(rows);
  console.log(`HUD FMR ingest complete: ${wrote.toLocaleString()} rows upserted.`);
}

main().catch((e) => {
  console.error("ingest-us-hud-fmr failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
