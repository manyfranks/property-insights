/**
 * assessment/us-county/nyc.ts
 *
 * LIVE, unauthenticated county-assessor lookup for New York City's five
 * boroughs/counties — New York (Manhattan, FIPS 36061), Kings (Brooklyn,
 * 36047), Queens (36081), Bronx (36005), Richmond (Staten Island, 36085).
 * See ./types.ts for the shared result shape/CountyAdapter contract and
 * ./index.ts for how liveCapable adapters (and, here, FIVE FIPS codes
 * routed to ONE module) are wired into src/app/api/assess/route.ts's live
 * per-request path.
 *
 * SOURCE VERIFICATION (live-probed 2026-08-09): NYC Open Data (Socrata),
 * "Property Valuation and Assessment Data Tax Classes 1,2,3,4" (dataset
 * 8y4t-faws, last updated 2026-06-15 — actively-maintained, current
 * fiscal-year roll; `max(year)` returned 2027 at verification time):
 *   https://data.cityofnewyork.us/resource/8y4t-faws.json
 *
 * NOTE ON DATASET CHOICE: the task spec's field names (FULLVAL/AVTOT) come
 * from an older DOF "Property Valuation and Assessment Data" export
 * (dataset yjxr-fw8i on this same portal) — live-checked and it stops at
 * year "2018/19" (stale, not maintained). 8y4t-faws is the current,
 * actively-updated dataset covering the same DOF roll (tax classes 1-4,
 * i.e. everything) with an equivalent value model under different column
 * names — CURMKTLAND/CURMKTTOT (current market) and CURACTLAND/CURACTTOT
 * (current *uncapped* actual assessed value) and CURTXBTOT (current
 * taxable / billable assessed value, post any statutory cap) replace
 * FULLVAL/AVLAND/AVTOT. See FIELD MAPPING below for which of these this
 * module actually uses.
 *
 * Live-verified 3 real Staten Island (boro 5) single-family/rowhouse
 * addresses recovered from this exact dataset — 17 Carroll Place, 9
 * Carroll Place, 376 Richmond Terrace — end-to-end via the same
 * house-number + borough + fuzzy-street query this module runs
 * (~400-750ms per query, see below).
 *
 * DATA QUALITY WRINKLE THAT SHAPED THE QUERY STRATEGY: `street_name`
 * values in this dataset are NOT consistently normalized — a live probe of
 * Manhattan (boro 1) street names containing "14" turned up "EAST 14TH
 * STREET", "EAST 14 STREET" (no ordinal), "W 14TH STREET" (abbreviated
 * direction), and "WEST 114TH STREET" all as DISTINCT stored strings.
 * Exact-match on a single normalized guess would miss real matches
 * unpredictably. So this module queries broadly (house number + borough +
 * a `street_name LIKE '%<root>%'` filter, where root is the address's
 * core token(s) with direction/type words stripped — e.g. "14" for "East
 * 14th Street", "CARROLL" for "Carroll Place") and then filters the
 * candidates CLIENT-SIDE by canonicalizing both the stored street_name and
 * the input to a common form (ordinal suffixes stripped, direction/type
 * words expanded to full words) before requiring an unambiguous single
 * match — see canonicalizeStreetName() below. This also protects against
 * the LIKE pattern's own false positives (e.g. root "14" substring-matches
 * "114TH STREET" too — confirmed live) since the canonical-equality step
 * rejects those.
 *
 * MULTI-UNIT/CONDO AMBIGUITY: live-verified against a real Manhattan condo
 * building — "95 Madison Street" resolved to 3+ distinct PARIDs (aptno 5C,
 * 1D, 2D, ...) sharing the same housenum+street with no unit number in the
 * raw `street` input to disambiguate. Same conservative "skip rather than
 * guess" policy as every other adapter in this directory applies here.
 *
 * BOROUGH RESOLUTION: the `city` param is matched against NYC's five
 * borough names/common aliases (see BORO_BY_CITY). USPS's own preferred
 * city names for Queens are neighborhood names (Astoria, Flushing, Long
 * Island City, ...), not "Queens" — so an unresolved/unmapped city falls
 * back to querying all 5 boroughs in PARALLEL and still requires a single
 * unambiguous match across the combined result set (a real street+house-
 * number collision across two different boroughs would correctly resolve
 * to null under this policy, same "skip on ambiguity" stance as elsewhere
 * in this directory — not expected to be common, but conservative by
 * design).
 *
 * PERIOD DEDUP: each PARID can appear multiple times per `year` at
 * different `period` snapshots (tentative/final roll stages) — observed
 * live as period "1" and "3" rows with identical values for all 3 verified
 * addresses. This module keeps the highest-`period` row per PARID
 * (assumed most-final) when deduping.
 *
 * FIELD MAPPING (see the dataset's own field list):
 *   curtxbtot                -> assessedValue (current TAXABLE assessed
 *     total — the actually-billed figure, capped below the uncapped
 *     CURACTTOT for tax classes 1/2 by NY State's assessment-increase-cap
 *     law; same "post-cap, actually-taxed" role as AZ's LPV_CUR/FL's
 *     AV_NSD/Cook's board_tot elsewhere in this directory)
 *   curmkttot                 -> marketValue (current full market value)
 *   yrbuilt                   -> yearBuilt (0/blank treated as "unknown",
 *     common for older condo-converted buildings per live samples)
 *   land_area                 -> lotSize (square feet; 0 for many condo/
 *     apartment units that have no independent land parcel — left
 *     undefined in that case rather than reporting a false 0)
 *   year                       -> assessmentYear
 * NYC's own effective assessment ratio (curtxbtot / curmkttot) varies
 * enormously by tax class and how long a property has been held — the 3
 * verified Staten Island homes ran ~4-4.5%, well below the state's
 * nominal 6% target ratio for class 1, because of decades of accumulated
 * annual-increase caps. This module reports the raw curtxbtot/curmkttot
 * pair as-is rather than attempting to "correct" for the cap — same
 * assessmentBasis "assessed_ratio" situation as Cook County (see cook.ts's
 * module doc; ./types.ts's CountyAssessorResult.assessmentBasis carries
 * this distinction, set on the returned result below).
 * No per-parcel dollar tax amount is published — annualTaxes is
 * intentionally left unset (see ./types.ts's doc comment on that field).
 */

import { CountyAssessorResult } from "./types";

const PVAD_URL = "https://data.cityofnewyork.us/resource/8y4t-faws.json";
const FETCH_TIMEOUT_MS = 7_000;

const BORO_BY_CITY: Record<string, string> = {
  "new york": "1",
  manhattan: "1",
  bronx: "2",
  "the bronx": "2",
  brooklyn: "3",
  queens: "4",
  "staten island": "5",
};

const DIRECTION_EXPAND: Record<string, string> = { E: "EAST", W: "WEST", N: "NORTH", S: "SOUTH" };
const TYPE_EXPAND: Record<string, string> = {
  ST: "STREET",
  AVE: "AVENUE",
  BLVD: "BOULEVARD",
  DR: "DRIVE",
  CT: "COURT",
  RD: "ROAD",
  PL: "PLACE",
  LN: "LANE",
  PKWY: "PARKWAY",
  HWY: "HIGHWAY",
  TER: "TERRACE",
  CIR: "CIRCLE",
  SQ: "SQUARE",
  PLZ: "PLAZA",
};

/** Canonicalize a street-name string for equality comparison: uppercase,
 * strip punctuation, strip ordinal suffixes off numeric tokens anywhere,
 * expand a leading direction abbreviation and a trailing street-type
 * abbreviation to their full words. Used to compare our parsed input
 * against this dataset's inconsistently-formatted street_name values (see
 * module doc's DATA QUALITY WRINKLE note) — NOT used to build the SQL
 * query itself (that uses a looser LIKE, see findCandidates()). */
function canonicalizeStreetName(s: string): string {
  const tokens = s
    .trim()
    .toUpperCase()
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((t) => t.replace(/^(\d+)(ST|ND|RD|TH)$/, "$1"));
  if (tokens.length && DIRECTION_EXPAND[tokens[0]]) tokens[0] = DIRECTION_EXPAND[tokens[0]];
  const lastIdx = tokens.length - 1;
  if (lastIdx >= 0 && TYPE_EXPAND[tokens[lastIdx]]) tokens[lastIdx] = TYPE_EXPAND[tokens[lastIdx]];
  return tokens.join(" ");
}

interface ParsedAddress {
  /** House number as stored in housenum_lo/housenum_hi — NYC (esp.
   * Queens) sometimes uses a hyphenated house number, e.g. "35-06", which
   * is part of the number itself, not a range; kept intact here. */
  houseNum: string;
  /** The address's core token(s) with any leading direction word and
   * trailing street-type word stripped — used to build a loose `LIKE`
   * filter (e.g. "14" for "East 14th Street", "CARROLL" for "Carroll
   * Place"). Ordinal suffixes are NOT stripped here (kept as typed) since
   * this is only used for a substring LIKE, not equality. */
  likeRoot: string;
  /** Full canonicalized form of the street part (direction/type expanded,
   * ordinals stripped) — compared for equality against each candidate
   * row's canonicalized street_name. */
  canonicalStreet: string;
}

function parseAddress(street: string): ParsedAddress | null {
  const trimmed = street.trim();
  const m = trimmed.match(/^(\d+(?:-\d+)?)\s+(.+)$/);
  if (!m) return null;
  const houseNum = m[1].toUpperCase();
  const streetPart = m[2];

  const tokens = streetPart
    .trim()
    .toUpperCase()
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean);
  if (tokens.length === 0) return null;

  let start = 0;
  let end = tokens.length; // exclusive
  const firstExpanded = DIRECTION_EXPAND[tokens[0]] ?? (Object.values(DIRECTION_EXPAND).includes(tokens[0]) ? tokens[0] : undefined);
  if (firstExpanded && tokens.length > 1) start = 1;
  const lastRaw = tokens[tokens.length - 1];
  const lastExpanded = TYPE_EXPAND[lastRaw] ?? (Object.values(TYPE_EXPAND).includes(lastRaw) ? lastRaw : undefined);
  if (lastExpanded && end - start > 1) end -= 1;

  const rootTokens = tokens.slice(start, end);
  const likeRoot = (rootTokens.length ? rootTokens : tokens).join(" ").replace(/^(\d+)(ST|ND|RD|TH)$/, "$1");

  return {
    houseNum: houseNum.replace(/'/g, "''"),
    likeRoot: likeRoot.replace(/'/g, "''"),
    canonicalStreet: canonicalizeStreetName(streetPart),
  };
}

interface PvadRow {
  parid?: string;
  period?: string;
  curmktland?: string;
  curmkttot?: string;
  curtxbtot?: string;
  yrbuilt?: string;
  land_area?: string;
  street_name?: string;
  year?: string;
}

async function queryBoro(parsed: ParsedAddress, boro: string): Promise<PvadRow[] | null> {
  const url = new URL(PVAD_URL);
  const where =
    `boro='${boro}' AND housenum_lo='${parsed.houseNum}' AND housenum_hi='${parsed.houseNum}' ` +
    `AND street_name LIKE '%${parsed.likeRoot}%'`;
  url.searchParams.set("$where", where);
  url.searchParams.set("$order", "year DESC, period DESC");
  url.searchParams.set("$limit", "50");

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    console.error(`[nyc-shape] fetch failed (boro ${boro}): ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  if (!res.ok) {
    console.error(`[nyc-shape] non-200 (${res.status}) for boro ${boro}`);
    return null;
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    console.error(`[nyc-shape] response was not valid JSON for boro ${boro}`);
    return null;
  }
  if (!Array.isArray(data)) {
    console.error(`[nyc-shape] response was not an array for boro ${boro} — got ${typeof data}. API shape may have changed.`);
    return null;
  }
  return data as PvadRow[];
}

/**
 * Live lookup against NYC's current Property Valuation and Assessment
 * Data (see module doc). Returns null on any "no usable result" outcome —
 * unparseable input, no address match, ambiguous multi-unit/multi-borough
 * match, or a matched parcel with no usable taxable value — never throws
 * for those.
 */
export async function lookupByAddress(street: string, city?: string): Promise<CountyAssessorResult | null> {
  const parsed = parseAddress(street);
  if (!parsed) return null;

  const cityKey = city?.trim().toLowerCase();
  const resolvedBoro = cityKey ? BORO_BY_CITY[cityKey] : undefined;
  const borosToTry = resolvedBoro ? [resolvedBoro] : ["1", "2", "3", "4", "5"];

  const perBoroResults = await Promise.all(borosToTry.map((b) => queryBoro(parsed, b)));
  if (perBoroResults.every((r) => r == null)) return null; // every borough query failed outright (shape/fetch error)

  const allRows: PvadRow[] = perBoroResults.flatMap((r) => r ?? []);

  // Filter to rows whose canonicalized street_name matches our
  // canonicalized input exactly — rejects the LIKE filter's own false
  // positives (see module doc's DATA QUALITY WRINKLE note).
  const matching = allRows.filter(
    (r) => typeof r.street_name === "string" && canonicalizeStreetName(r.street_name) === parsed.canonicalStreet
  );
  if (matching.length === 0) return null;

  // Dedup to one row per PARID, keeping the highest `period` seen (rows
  // are already ordered period DESC per boro query, but merge across
  // boroughs defensively).
  const byParid = new Map<string, PvadRow>();
  for (const row of matching) {
    if (!row.parid) continue;
    const existing = byParid.get(row.parid);
    if (!existing || Number(row.period ?? 0) > Number(existing.period ?? 0)) {
      byParid.set(row.parid, row);
    }
  }

  // Multiple distinct PARIDs = a multi-unit/condo building (confirmed live
  // against a real Manhattan condo — see module doc) or, when city was
  // unresolved, a genuine cross-borough collision. No unit number in the
  // raw `street` input to disambiguate, so — same conservative policy as
  // every other adapter in this directory — skip rather than guess.
  if (byParid.size !== 1) return null;
  const chosen = [...byParid.values()][0];

  const assessedValue = parseMoneyString(chosen.curtxbtot);
  if (assessedValue == null) return null;

  const marketValue = parseMoneyString(chosen.curmkttot) ?? undefined;
  const yrbltNum = chosen.yrbuilt ? parseFloat(chosen.yrbuilt) : NaN;
  const yearBuilt = Number.isFinite(yrbltNum) && yrbltNum > 1800 ? Math.round(yrbltNum) : undefined;
  const landAreaNum = chosen.land_area ? parseFloat(chosen.land_area) : NaN;
  const lotSize = Number.isFinite(landAreaNum) && landAreaNum > 0 ? Math.round(landAreaNum) : undefined;

  const result: CountyAssessorResult = {
    assessedValue,
    marketValue,
    yearBuilt,
    lotSize,
    assessmentYear: chosen.year ? String(parseInt(chosen.year, 10)) : String(new Date().getFullYear()),
    source: "county_assessor",
    // curtxbtot is capped well below curmkttot by NY's assessment-increase
    // cap (~4-4.5% observed, vs. the state's nominal 6% target ratio for
    // tax class 1 — see module doc) — same assessed_ratio situation as Cook
    // County, though unlike Cook's derived figure, curmkttot here IS a
    // directly-published DOF market-value field, not a ratio estimate.
    assessmentBasis: "assessed_ratio",
  };
  return result;
}

/** NYC's curtxbtot/curmkttot arrive as plain numeric strings — treat
 * <= 0 / unparsable as "no usable value" rather than a hard error,
 * matching maricopa.ts's parseMoneyString stance. */
function parseMoneyString(raw: unknown): number | null {
  if (raw == null) return null;
  const n = Number(String(raw).replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/** Minimal health probe — mirrors ab.ts's calgarySodaHealthCheck() convention. */
export async function nycHealthCheck(): Promise<{ ok: boolean; detail: string }> {
  try {
    const result = await lookupByAddress("17 Carroll Place", "Staten Island");
    if (result) return { ok: true, detail: `assessedValue=${result.assessedValue} year=${result.assessmentYear}` };
    return { ok: false, detail: "known-good address returned no result (dataset/schema may have changed)" };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? `${err.name}: ${err.message}` : String(err) };
  }
}
