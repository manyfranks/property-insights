/**
 * assessment/us-county/cook.ts
 *
 * LIVE, unauthenticated county-assessor lookup for Cook County, IL
 * (Chicago) — county FIPS 17031. See ./types.ts for the shared result
 * shape/CountyAdapter contract and ./index.ts for how liveCapable adapters
 * are wired into src/app/api/assess/route.ts's live per-request path.
 *
 * SOURCE VERIFICATION (live-probed 2026-08-09), THREE Socrata (SODA2)
 * datasets on datacatalog.cookcountyil.gov, all free/unauthenticated:
 *
 * Step 1 — address -> PIN: "Assessor - Parcel Addresses" (dataset
 * 3723-97qp, last updated 2026-08-01):
 *   https://datacatalog.cookcountyil.gov/resource/3723-97qp.json
 *   Fields used: pin, prop_address_full, prop_address_city_name, tax_year.
 *   Queried by `prop_address_full LIKE '<normalized>%' AND
 *   prop_address_city_name='<CITY>'`. Live-verified 3 real Chicago
 *   addresses recovered from this exact dataset (3754 N Kenmore Ave, 3743
 *   N Seminary Ave, 3739 N Seminary Ave, all Lake View/60613) —
 *   ~400-450ms per query. A live multi-row probe against "200 N Dearborn
 *   St" (a downtown high-rise) returned 10+ distinct PINs sharing that one
 *   street address, confirming the multi-unit ambiguity guard below is
 *   needed, not hypothetical — same shape of problem as
 *   maricopa.ts/miami-dade.ts's condo complexes.
 *
 * Step 2 — PIN -> assessed value: "Assessor - Assessed Values" (dataset
 * uzyt-m557, last updated 2026-08-01, the current successor to the older
 * dataset id referenced in this module's original spec):
 *   https://datacatalog.cookcountyil.gov/resource/uzyt-m557.json
 *   Fields used: class, mailed_tot/certified_tot/board_tot, tax_year.
 *   Cook publishes assessed value in three stages per year — mailed
 *   (Assessor's initial estimate), certified (post-Assessor-appeal), board
 *   (post-Board-of-Review-appeal, the most final figure). Live-verified:
 *   for the current in-progress roll year (2026 at verification time) only
 *   `mailed_tot` was populated yet (certified/board fields absent from the
 *   response entirely); the prior year (2025) had all three, all equal for
 *   the 3 verified PINs. This module always prefers board > certified >
 *   mailed within the single most-recent year that has ANY of the three
 *   populated, so a lookup made mid-cycle degrades to the mailed estimate
 *   rather than silently returning null.
 *
 * Step 3 (optional, fired in parallel with step 2, non-fatal on failure) —
 * PIN -> yearBuilt/lotSize: "Assessor - Single and Multi-Family Improvement
 * Characteristics" (dataset x54s-btds, last updated 2026-08-01):
 *   https://datacatalog.cookcountyil.gov/resource/x54s-btds.json
 *   Fields used: char_yrblt, char_land_sf. Live-verified against the same
 *   3 PINs (e.g. PIN 14202180100000 -> char_yrblt=2021, char_land_sf=2000
 *   — a genuinely new-construction Lake View infill home, consistent with
 *   its $70,000 assessed value on a $700k-class lot). Neither of the two
 *   datasets used in steps 1-2 carries year-built or lot-size at all, so
 *   this step exists purely to fill those two optional CountyAssessorResult
 *   fields; a failure/timeout here only drops yearBuilt/lotSize, never the
 *   whole lookup (mirrors travis.ts's "optional enrichment indices"
 *   wrapping convention).
 *
 * MARKET VALUE (approximate, derived — NOT a Cook-published figure): Cook
 * assesses Class 2 residential property (single-family, condos, co-ops,
 * 2-6 unit buildings — class codes 200-299) at a fixed 10% Level of
 * Assessment set by county ordinance (confirmed via the Assessor's own
 * published guidance, cookcountyassessoril.gov/classifications-real-
 * property and /form-document/class-2-residential-questions: "Class 2
 * residential property is assessed at 10 percent of its estimated
 * property value"). Neither Socrata dataset publishes a market-value
 * field directly (unlike Maricopa's FCV_CUR or Miami-Dade/FDOR's JV), so
 * for class-2xx parcels this module derives marketValue = assessedValue /
 * 0.10 and documents it as an ESTIMATE via the assessmentYear-adjacent
 * comment on the return value below. For any other class (commercial,
 * industrial, etc. — levels of assessment vary and are less reliably
 * documented), marketValue is left undefined rather than guessed at.
 * `assessmentBasis: "assessed_ratio"` on the returned result (see
 * ./types.ts's doc comment) flags this for callers — the derived
 * marketValue above is a ratio estimate, not a publisher-supplied figure,
 * so downstream plausibility checks should still treat it with the same
 * scrutiny as any other assessed_ratio state rather than as directly-
 * observed market data.
 *
 * ADDRESSING: Chicago addresses in prop_address_full are already
 * abbreviated single-letter directionals ("N", "S", "E", "W") and USPS-
 * style street-type abbreviations ("ST", "AVE", "BLVD", ...) — e.g. "3754
 * N KENMORE AVE", "3002 W 111TH ST". UNLIKE Miami-Dade/Travis, Chicago's
 * numbered streets KEEP their ordinal suffix ("111TH ST", never "111 ST")
 * — confirmed live against dataset rows; do NOT strip ordinals here.
 *
 * No per-parcel dollar tax amount is published in either dataset —
 * annualTaxes is intentionally left unset (see ./types.ts's doc comment).
 */

import { CountyAssessorResult } from "./types";

const PARCEL_ADDRESSES_URL = "https://datacatalog.cookcountyil.gov/resource/3723-97qp.json";
const ASSESSED_VALUES_URL = "https://datacatalog.cookcountyil.gov/resource/uzyt-m557.json";
const CHARACTERISTICS_URL = "https://datacatalog.cookcountyil.gov/resource/x54s-btds.json";

// Step 1 gets its own budget; steps 2+3 run in parallel afterward and share
// a second budget — worst case wall time is roughly the sum of the two
// (~8s), matching the task's 6-8s hard-timeout guidance for a live
// per-request path.
const STEP1_TIMEOUT_MS = 4_000;
const STEP23_TIMEOUT_MS = 4_000;

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
  [/\bHIGHWAY\b/g, "HWY"],
  [/\bPLAZA\b/g, "PLZ"],
  [/\bSQUARE\b/g, "SQ"],
];

/** Uppercase, collapse whitespace, expand full direction/street-type words
 * to Cook's own abbreviations. Deliberately does NOT strip ordinal
 * suffixes on numbered streets — see module doc's ADDRESSING note. */
function normalizeChicagoAddress(street: string): string {
  let s = street.trim().toUpperCase().replace(/[.,]/g, "").replace(/\s+/g, " ");
  for (const [pat, repl] of DIRECTIONAL_ABBREVS) s = s.replace(pat, repl);
  for (const [pat, repl] of STREET_TYPE_ABBREVS) s = s.replace(pat, repl);
  return s.replace(/'/g, "''");
}

interface ParcelAddressRow {
  pin?: string;
  prop_address_full?: string;
}

interface AssessedValueRow {
  pin?: string;
  year?: string;
  class?: string;
  mailed_tot?: string;
  certified_tot?: string;
  board_tot?: string;
}

interface CharacteristicsRow {
  pin?: string;
  char_yrblt?: string;
  char_land_sf?: string;
}

async function fetchJsonArray(url: URL, timeoutMs: number, shapeLogTag: string): Promise<unknown[] | null> {
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    console.error(`[${shapeLogTag}] fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  if (!res.ok) {
    console.error(`[${shapeLogTag}] non-200 (${res.status})`);
    return null;
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    console.error(`[${shapeLogTag}] response was not valid JSON`);
    return null;
  }
  if (!Array.isArray(data)) {
    console.error(`[${shapeLogTag}] response was not an array — got ${typeof data}. API shape may have changed.`);
    return null;
  }
  return data;
}

/** Step 1: address (+city) -> a single unambiguous PIN. */
async function findPin(normalizedAddress: string, city: string): Promise<string | null> {
  const url = new URL(PARCEL_ADDRESSES_URL);
  url.searchParams.set(
    "$where",
    `prop_address_full LIKE '${normalizedAddress}%' AND prop_address_city_name='${city}'`
  );
  url.searchParams.set("$select", "pin,prop_address_full");
  url.searchParams.set("$order", "year DESC");
  url.searchParams.set("$limit", "25");

  const rows = await fetchJsonArray(url, STEP1_TIMEOUT_MS, "cook-shape");
  if (rows == null) return null;
  const pins = new Set(
    (rows as ParcelAddressRow[]).map((r) => r.pin).filter((p): p is string => !!p)
  );
  // Multiple distinct PINs at one street address = a multi-unit/condo
  // building (confirmed live against a real downtown high-rise — see
  // module doc). No unit number in the raw `street` input to disambiguate,
  // so — same conservative policy as maricopa.ts/miami-dade.ts/travis.ts —
  // skip rather than guess.
  if (pins.size !== 1) return null;
  return [...pins][0];
}

/** Step 2: PIN -> {assessedValue, class, assessmentYear}, preferring the
 * most-final populated stage (board > certified > mailed) within the most
 * recent year that has ANY of the three populated. */
async function fetchAssessedValue(
  pin: string
): Promise<{ assessedValue: number; assessmentClass: string; assessmentYear: string } | null> {
  const url = new URL(ASSESSED_VALUES_URL);
  url.searchParams.set("pin", pin);
  url.searchParams.set("$order", "year DESC");
  url.searchParams.set("$limit", "3");

  const rows = await fetchJsonArray(url, STEP23_TIMEOUT_MS, "cook-shape");
  if (rows == null) return null;
  for (const raw of rows as AssessedValueRow[]) {
    const stageValue =
      parseMoneyString(raw.board_tot) ?? parseMoneyString(raw.certified_tot) ?? parseMoneyString(raw.mailed_tot);
    if (stageValue != null && raw.class && raw.year) {
      return {
        assessedValue: stageValue,
        assessmentClass: raw.class,
        assessmentYear: String(parseInt(raw.year, 10)),
      };
    }
  }
  return null;
}

/** Step 3 (optional): PIN -> {yearBuilt, lotSize}. Never throws — a
 * failure here just means those two fields stay undefined. */
async function fetchCharacteristics(pin: string): Promise<{ yearBuilt?: number; lotSize?: number }> {
  try {
    const url = new URL(CHARACTERISTICS_URL);
    url.searchParams.set("pin", pin);
    url.searchParams.set("$order", "year DESC");
    url.searchParams.set("$limit", "1");
    url.searchParams.set("$select", "char_yrblt,char_land_sf");

    const rows = await fetchJsonArray(url, STEP23_TIMEOUT_MS, "cook-shape");
    if (!rows || rows.length === 0) return {};
    const row = rows[0] as CharacteristicsRow;
    const yrblt = row.char_yrblt ? parseFloat(row.char_yrblt) : NaN;
    const landSf = row.char_land_sf ? parseFloat(row.char_land_sf) : NaN;
    return {
      yearBuilt: Number.isFinite(yrblt) && yrblt > 1800 ? Math.round(yrblt) : undefined,
      lotSize: Number.isFinite(landSf) && landSf > 0 ? Math.round(landSf) : undefined,
    };
  } catch (err) {
    console.error(
      `[cook-shape] characteristics lookup failed for PIN ${pin}: ${err instanceof Error ? err.message : String(err)}`
    );
    return {};
  }
}

/** Cook's mailed/certified/board totals arrive as plain numeric strings
 * (occasionally "0.0") — treat <= 0 / unparsable as "no usable value at
 * this stage" rather than a hard error, matching maricopa.ts's
 * parseMoneyString stance. */
function parseMoneyString(raw: unknown): number | null {
  if (raw == null) return null;
  const n = Number(String(raw).replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/** Class 2 (200-299) is Cook's fixed-10%-of-market residential class (see
 * module doc's MARKET VALUE section) — the only class this module derives
 * an estimated marketValue for. */
function derivedMarketValue(assessedValue: number, assessmentClass: string): number | undefined {
  if (!/^2\d\d$/.test(assessmentClass)) return undefined;
  return Math.round(assessedValue / 0.10);
}

/**
 * Live three-step lookup (see module doc). Returns null for any "no usable
 * result" outcome — no address match, ambiguous multi-unit match, or a PIN
 * with no usable assessed-value stage in the last 3 years — never throws
 * for those.
 */
export async function lookupByAddress(street: string, city?: string): Promise<CountyAssessorResult | null> {
  const normalized = normalizeChicagoAddress(street);
  if (!normalized) return null;
  const cityUpper = (city?.trim() || "CHICAGO").toUpperCase();

  const pin = await findPin(normalized, cityUpper);
  if (!pin) return null;

  const [assessed, chars] = await Promise.all([fetchAssessedValue(pin), fetchCharacteristics(pin)]);
  if (!assessed) return null;

  const result: CountyAssessorResult = {
    assessedValue: assessed.assessedValue,
    marketValue: derivedMarketValue(assessed.assessedValue, assessed.assessmentClass),
    yearBuilt: chars.yearBuilt,
    lotSize: chars.lotSize,
    assessmentYear: assessed.assessmentYear,
    source: "county_assessor",
    // Fixed 10% Level of Assessment on class-2 residential (see module
    // doc's MARKET VALUE section) — assessedValue is a known ratio of
    // market by county ordinance, not itself a market figure. This is the
    // `assessmentBasis` field ./types.ts's doc comment references as
    // suggested by this module's own earlier note.
    assessmentBasis: "assessed_ratio",
  };
  return result;
}

/** Minimal health probe — mirrors ab.ts's calgarySodaHealthCheck() convention. */
export async function cookHealthCheck(): Promise<{ ok: boolean; detail: string }> {
  try {
    const result = await lookupByAddress("3754 N Kenmore Ave", "Chicago");
    if (result) return { ok: true, detail: `assessedValue=${result.assessedValue} year=${result.assessmentYear}` };
    return { ok: false, detail: "known-good address returned no result (dataset/schema may have changed)" };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? `${err.name}: ${err.message}` : String(err) };
  }
}
