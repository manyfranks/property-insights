/**
 * assessment/us-county/miami-dade.ts
 *
 * Free, unauthenticated county-assessor enrichment for Miami-Dade County
 * (Miami, FL) listings — see ./types.ts for the shared result shape and
 * scripts/enrich-us-from-assessors.ts for how it's applied to cached
 * Discover listings.
 *
 * SOURCE VERIFICATION (live-probed 2026-08-07) — TWO-STEP, because no
 * single free source has both an address index AND populated values:
 *
 * Step 1 — address -> FOLIO (fast, address-indexed, but values always null)
 *   Miami-Dade's own public ArcGIS MapServer,
 *   MD_LandInformation/MapServer/24 ("Property @ PaGis" — the per-unit
 *   property layer; note layer 26 "Parcels @ PaParcel" looked equivalent
 *   at first but only carries land-parcel-level records and is MISSING
 *   every condo unit — confirmed live: none of 5 real condo addresses
 *   matched layer 26 at all, all 5 matched layer 24):
 *     https://gis.miamidade.gov/arcgis/rest/services/MD_LandInformation/MapServer/24
 *   Queried by TRUE_SITE_ADDR (indexed, sub-second). Confirmed LIVE against
 *   5 cached Miami addresses. BUT: a live `returnCountOnly` probe of
 *   `WHERE TOTAL_VAL_CUR IS NOT NULL` across the full parcel-level layer
 *   (26) returned 0 of 596,107 rows — LAND_VAL_CUR/BUILDING_VAL_CUR/
 *   TOTAL_VAL_CUR are declared in the schema but never populated. A real
 *   upstream data gap on Miami-Dade's GIS export, not a bug in this
 *   adapter — hence step 2.
 *
 * Step 2 — FOLIO -> assessed value (has values, but NOT address-indexed)
 *   Florida Dept. of Revenue's statewide cadastral FeatureServer (the "NAL"
 *   Name-Address-Legal real-property roll every FL county submits
 *   annually, republished by FGIO):
 *     https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0
 *   10.8M rows statewide. Live-probed: filtering by PHY_ADDR1 (even just
 *   `WHERE CO_NO=23`, Miami-Dade's county number, with no address
 *   condition at all) consistently timed out past 30-40s — not usably
 *   indexed for attribute queries at this row count. Filtering by
 *   PARCEL_ID equality, however, returns in ~0.2-3s (confirmed with 3 real
 *   folios pulled from step 1) — PARCEL_ID uses the SAME 13-digit folio
 *   format as step 1's FOLIO field (verified byte-for-byte match). So step
 *   2 is always a PARCEL_ID equality query, never an address query.
 *
 * MATCH-RATE FOLLOW-UP (re-verified 2026-08-07 against all 36 of 50 cached
 * Miami listings this adapter didn't match): 33 of those 36 are genuinely
 * ambiguous multi-unit/condo complexes at step 1 (confirmed by direct
 * TRUE_SITE_ADDR query — e.g. "1900 N Bayshore Dr" alone resolves to 705
 * individually-folioed condo units; none of our cached listings carry a
 * unit number, see the rows.length!==1 guard below) or a condo unit whose
 * FOLIO exists in step 1 but has no corresponding record in the FDOR
 * statewide roll at all (confirmed for 2 addresses by direct PARCEL_ID
 * query — FDOR only publishes the master/common-area parcel for some small
 * condo buildings, not every individual unit). Both are real, structural
 * gaps in the free data, not fixable by better string normalization —
 * consistent with this adapter's existing "skip rather than guess" stance.
 * The remaining 3 of 36 WERE a real normalization bug, since fixed by
 * normalizeMiamiAddress() below: Miami-Dade's own TRUE_SITE_ADDR keeps a
 * street-type word spelled out in full when it is NOT the address's final
 * suffix — e.g. "486 NW 165th Street Rd" is stored as
 * "486 NW 165 STREET RD" (STREET full, only the trailing RD abbreviated),
 * not "486 NW 165 ST RD" as the old unconditional STREET->ST regex
 * produced. All 3 rediscovered addresses turned out to also be condo
 * buildings once correctly found, so this fix doesn't move today's 14/50
 * count, but it's a genuine correctness fix (the old code could 0-result
 * ANY compound-suffix street, condo or not) kept for whatever single-family
 * "___ Street Road"/"___ Avenue Road"-style address comes up next.
 *
 * FIELD MAPPING (FDOR NAL schema, see the 2025 NAL/SDF/NAP User's Guide):
 *   AV_NSD (Assessed Value, Non-School District) -> assessedValue (FL's
 *     Save-Our-Homes-capped figure — the actual tax-relevant value,
 *     routinely below JV for longer-held homestead properties)
 *   JV (Just Value)                              -> marketValue
 *   ACT_YR_BLT                                    -> yearBuilt
 *   LND_SQFOOT                                    -> lotSize (falls back to
 *     step 1's LOT_SIZE field if FDOR's is 0/missing)
 *   ASMNT_YR                                      -> assessmentYear
 * No per-parcel dollar tax amount is published in either dataset —
 * annualTaxes is intentionally left unset (see ./types.ts's doc comment).
 */

import { CountyAssessorResult } from "./types";

const MDC_PARCEL_QUERY_URL =
  "https://gis.miamidade.gov/arcgis/rest/services/MD_LandInformation/MapServer/24/query";
const FDOR_QUERY_URL =
  "https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0/query";

const FETCH_TIMEOUT_MS = 10_000;

// Miami-Dade drops ordinal suffixes on numbered streets: "107th" -> "107",
// "3rd" -> "3", "80th" -> "80" (confirmed: TRUE_SITE_ADDR stores
// "20015 NE 3 CT", never "3RD"). Also normalize a handful of common
// full-word street types to the county's abbreviations — our cached
// listings (RentCast-sourced) already arrive abbreviated in every sample
// tested, but this is defensive for any that aren't.
//
// IMPORTANT: only the LAST token of the address is a candidate for this
// abbreviation, never an earlier one — see the module doc's "MATCH-RATE
// FOLLOW-UP" note. TRUE_SITE_ADDR keeps a street-type word spelled out in
// full when something else (another suffix, e.g. "RD"/"LN") follows it, so
// unconditionally abbreviating every occurrence (the old behavior) turned
// real addresses like "486 NW 165th Street Rd" into a query for
// "486 NW 165 ST RD", which zero-results against the county's actual
// "486 NW 165 STREET RD".
const STREET_TYPE_ABBREV_MAP: [string, string][] = [
  ["STREET", "ST"],
  ["AVENUE", "AVE"],
  ["BOULEVARD", "BLVD"],
  ["DRIVE", "DR"],
  ["COURT", "CT"],
  ["ROAD", "RD"],
  ["PLACE", "PL"],
  ["TERRACE", "TER"],
  ["LANE", "LN"],
  ["CIRCLE", "CIR"],
  ["TRAIL", "TRL"],
  ["PARKWAY", "PKWY"],
  ["HIGHWAY", "HWY"],
];

function normalizeMiamiAddress(street: string): string {
  const s = street.trim().toUpperCase().replace(/\s+/g, " ");
  const ordinalsStripped = s.replace(/\b(\d+)(ST|ND|RD|TH)\b/g, "$1");
  const tokens = ordinalsStripped.split(" ");
  const lastIdx = tokens.length - 1;
  if (lastIdx >= 0) {
    const abbrev = STREET_TYPE_ABBREV_MAP.find(([full]) => tokens[lastIdx] === full);
    if (abbrev) tokens[lastIdx] = abbrev[1];
  }
  return tokens.join(" ").replace(/'/g, "''");
}

interface MdcParcelAttributes {
  FOLIO?: string;
  TRUE_SITE_ADDR?: string;
  CONDO_FLAG?: string;
  YEAR_BUILT?: number;
  LOT_SIZE?: number;
}

interface FdorAttributes {
  PARCEL_ID?: string;
  JV?: number;
  AV_NSD?: number;
  ACT_YR_BLT?: number;
  LND_SQFOOT?: number;
  ASMNT_YR?: number;
}

async function fetchJson(url: URL, shapeLogTag: string): Promise<unknown | null> {
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    console.error(`[${shapeLogTag}] fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  if (!res.ok) {
    console.error(`[${shapeLogTag}] non-200 (${res.status})`);
    return null;
  }
  try {
    return await res.json();
  } catch {
    console.error(`[${shapeLogTag}] response was not valid JSON`);
    return null;
  }
}

/** Step 1: address -> FOLIO (+ fallback year/lot fields). */
async function findFolio(
  normalizedAddress: string
): Promise<{ folio: string; yearBuilt?: number; lotSize?: number } | null> {
  const url = new URL(MDC_PARCEL_QUERY_URL);
  url.searchParams.set("where", `TRUE_SITE_ADDR LIKE '${normalizedAddress}%'`);
  url.searchParams.set("outFields", "FOLIO,TRUE_SITE_ADDR,CONDO_FLAG,YEAR_BUILT,LOT_SIZE");
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("f", "json");

  const data = await fetchJson(url, "miami-dade-shape");
  if (data == null) return null;

  const features = (data as { features?: unknown }).features;
  if (!Array.isArray(features)) {
    console.error(
      `[miami-dade-shape] no "features" array in step-1 response — API shape may have changed. Keys: [${Object.keys(
        (data as object) || {}
      ).join(", ")}]`
    );
    return null;
  }
  if (features.length === 0) return null;

  const rows = features
    .map((f) => (f as { attributes?: MdcParcelAttributes }).attributes)
    .filter((a): a is MdcParcelAttributes => !!a && !!a.FOLIO);
  if (rows.length === 0) return null;

  // Multiple hits at one street number = a condo building with several
  // individually-folioed units (confirmed with real 8-, 43-, 90-, and
  // 231-unit examples during source verification). No cached listing
  // carries a unit number, so we can't tell which sub-unit is the actual
  // listing. Filtering to "the one CONDO_FLAG='N' row" was considered but
  // dropped — Maricopa's equivalent shortcut turned out to match
  // common-area/non-livable parcels alongside real units (see
  // maricopa.ts's doc comment on that false-positive), so this adapter
  // takes the same conservative stance: only accept a single unambiguous
  // row, skip everything else.
  if (rows.length !== 1) return null;
  const chosen = rows[0];

  return {
    folio: chosen.FOLIO!,
    yearBuilt: typeof chosen.YEAR_BUILT === "number" && chosen.YEAR_BUILT > 1800 ? chosen.YEAR_BUILT : undefined,
    lotSize: typeof chosen.LOT_SIZE === "number" && chosen.LOT_SIZE > 0 ? Math.round(chosen.LOT_SIZE) : undefined,
  };
}

/** Step 2: FOLIO -> value/year/lot from the FDOR statewide NAL roll. */
async function fetchFdorRecord(folio: string): Promise<FdorAttributes | null> {
  const url = new URL(FDOR_QUERY_URL);
  url.searchParams.set("where", `PARCEL_ID='${folio.replace(/'/g, "''")}'`);
  url.searchParams.set("outFields", "PARCEL_ID,JV,AV_NSD,ACT_YR_BLT,LND_SQFOOT,ASMNT_YR");
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("f", "json");

  const data = await fetchJson(url, "miami-dade-shape");
  if (data == null) return null;

  const features = (data as { features?: unknown }).features;
  if (!Array.isArray(features)) {
    console.error(
      `[miami-dade-shape] no "features" array in step-2 (FDOR) response for folio ${folio} — API shape may have changed.`
    );
    return null;
  }
  if (features.length === 0) return null;

  return (features[0] as { attributes?: FdorAttributes }).attributes ?? null;
}

/**
 * Live two-step lookup (see module doc). Returns null on any "no usable
 * result" outcome — no address match, ambiguous condo match, or a folio
 * with no assessed value in the FDOR roll — never throws for those.
 */
export async function lookupByAddress(
  street: string,
  _city?: string
): Promise<CountyAssessorResult | null> {
  const normalized = normalizeMiamiAddress(street);
  if (!normalized) return null;

  const step1 = await findFolio(normalized);
  if (!step1) return null;

  const fdor = await fetchFdorRecord(step1.folio);
  if (!fdor) return null;

  const assessedValue = typeof fdor.AV_NSD === "number" && fdor.AV_NSD > 0 ? fdor.AV_NSD : null;
  if (assessedValue == null) return null;

  const marketValue = typeof fdor.JV === "number" && fdor.JV > 0 ? fdor.JV : undefined;
  const yearBuilt =
    (typeof fdor.ACT_YR_BLT === "number" && fdor.ACT_YR_BLT > 1800 ? fdor.ACT_YR_BLT : undefined) ??
    step1.yearBuilt;
  const lotSize =
    (typeof fdor.LND_SQFOOT === "number" && fdor.LND_SQFOOT > 0 ? Math.round(fdor.LND_SQFOOT) : undefined) ??
    step1.lotSize;

  const result: CountyAssessorResult = {
    assessedValue: Math.round(assessedValue),
    marketValue: marketValue != null ? Math.round(marketValue) : undefined,
    yearBuilt,
    lotSize,
    assessmentYear: typeof fdor.ASMNT_YR === "number" ? String(fdor.ASMNT_YR) : String(new Date().getFullYear()),
    source: "county_assessor",
  };
  return result;
}

/** Minimal health probe — mirrors ab.ts's calgarySodaHealthCheck() convention. */
export async function miamiDadeHealthCheck(): Promise<{ ok: boolean; detail: string }> {
  try {
    const result = await lookupByAddress("15231 NE 11 Ct");
    if (result) return { ok: true, detail: `assessedValue=${result.assessedValue} year=${result.assessmentYear}` };
    return { ok: false, detail: "known-good address returned no result (dataset/schema may have changed)" };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? `${err.name}: ${err.message}` : String(err) };
  }
}
