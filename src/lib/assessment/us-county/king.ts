/**
 * assessment/us-county/king.ts
 *
 * LIVE, unauthenticated county-assessor lookup for King County, WA
 * (Seattle) — county FIPS 53033. See ./types.ts for the shared result
 * shape/CountyAdapter contract and ./index.ts for how liveCapable adapters
 * are wired into src/app/api/assess/route.ts's live per-request path.
 *
 * SOURCE VERIFICATION (live-probed 2026-08-09): King County's Assessor
 * publishes a single hosted ArcGIS FeatureServer layer that has BOTH an
 * address index AND real appraised/taxable value fields in one row — no
 * two-step join needed (unlike cook.ts/miami-dade.ts):
 *   "Parcels with Address, Property and Ownership Information (Public)"
 *   https://services.arcgis.com/Ej0PsM5Aw677QF1W/arcgis/rest/services/PARCEL_ADDRESS_PUB_AREA_3069/FeatureServer/0
 *   (item id 203f285e0db44975abc96940345f1454 on arcgis.com, owner
 *   KingCounty; discoverable from the Assessor's own GIS Data Catalog page
 *   https://www5.kingcounty.gov/sdc?Layer=PARCEL_ADDRESS_PUB_AREA). This
 *   supersedes the legacy gisdata.kingcounty.gov/arcgis/rest/... endpoints
 *   referenced in older documentation/blog posts — those now 302-redirect
 *   to a "moved to ArcGIS Online" notice page; this services.arcgis.com
 *   URL is the live replacement, confirmed working.
 *
 * Live-verified 3 real Seattle single-family addresses recovered from this
 * exact layer (209 N 41st St, 119 N 41st St, 4018 1st Ave NW — all
 * PREUSE_DESC="Single Family(Res Use/Zone)") by exact ADDR_FULL match,
 * ~330-420ms per query, single round trip.
 *
 * MULTI-UNIT AMBIGUITY: per the layer's own description ("a single address
 * is assigned to each parcel record ... some parcels have multiple
 * addresses, [and] this layer provides only one address for each parcel"),
 * most condo/apartment units in this layer do NOT collide on ADDR_FULL —
 * each parcel's assigned address is usually already unique. But this is
 * NOT universal: a live probe of "300 VIRGINIA ST" (a downtown Seattle
 * condo/mixed-use tower) returned 3 distinct PINs sharing that exact
 * ADDR_FULL, differentiated only by UNIT_NUM (a residential unit, a
 * parking stall, and a storage locker) — so the same conservative
 * "ambiguous match = skip" guard used by every other adapter in this
 * directory is still required and is exercised for real by this dataset,
 * not merely defensive.
 *
 * FIELD MAPPING (see the layer's own field list, `?f=json` on the query
 * endpoint):
 *   TAX_LNDVAL + TAX_IMPR   -> assessedValue (WA's "taxable" land+
 *     improvement value — the figure actually billed; differs from the
 *     appraised figure only when an exemption, e.g. senior/disabled,
 *     applies). Unlike Cook/NYC, WA does NOT apply a fractional assessment
 *     ratio — parcels are appraised at 100% of market value by statute, so
 *     assessedValue and marketValue are equal for the overwhelming
 *     majority of parcels (no exemption). Returned as assessmentBasis
 *     "full_value" (./types.ts's CountyAssessorResult field), not
 *     "assessed_ratio".
 *   APPRLNDVAL + APPR_IMPR  -> marketValue (the appraised/full-value
 *     figure before any exemption is applied)
 *   LOTSQFT                 -> lotSize
 *   KCTP_TAXYR               -> assessmentYear
 * NOT AVAILABLE: this layer has no year-built field at all (checked the
 * full field list — 60+ property/ownership/legal columns, none of them a
 * construction-year value) — yearBuilt is intentionally left undefined,
 * every time, for this adapter. No per-parcel dollar tax amount is
 * published either — annualTaxes is intentionally left unset (see
 * ./types.ts's doc comment on that field).
 *
 * ADDRESSING: ADDR_FULL is already USPS-abbreviated single-letter
 * directionals ("N", "NW", ...) and abbreviated street types ("ST", "AVE",
 * ...) — e.g. "215 N 41ST ST", "4011 GREENWOOD AVE N". UNLIKE Miami-Dade/
 * Travis, King County's ADDR_FULL KEEPS ordinal suffixes on numbered
 * streets ("41ST ST", never "41 ST") — confirmed live; do NOT strip them.
 */

import { CountyAssessorResult } from "./types";

const KING_QUERY_URL =
  "https://services.arcgis.com/Ej0PsM5Aw677QF1W/arcgis/rest/services/PARCEL_ADDRESS_PUB_AREA_3069/FeatureServer/0/query";

const FETCH_TIMEOUT_MS = 7_000;

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
  [/\bWAY\b/g, "WAY"],
];

/** Uppercase, collapse whitespace, expand full direction/street-type words
 * to King County's own abbreviations. Deliberately does NOT strip ordinal
 * suffixes on numbered streets — see module doc's ADDRESSING note. */
function normalizeKingAddress(street: string): string {
  let s = street.trim().toUpperCase().replace(/[.,]/g, "").replace(/\s+/g, " ");
  for (const [pat, repl] of DIRECTIONAL_ABBREVS) s = s.replace(pat, repl);
  for (const [pat, repl] of STREET_TYPE_ABBREVS) s = s.replace(pat, repl);
  return s.replace(/'/g, "''");
}

interface KingAttributes {
  ADDR_FULL?: string;
  APPRLNDVAL?: number;
  APPR_IMPR?: number;
  TAX_LNDVAL?: number;
  TAX_IMPR?: number;
  KCTP_TAXYR?: number;
  LOTSQFT?: number;
  UNIT_NUM?: string | null;
}

async function queryKing(where: string): Promise<KingAttributes[] | null> {
  const url = new URL(KING_QUERY_URL);
  url.searchParams.set("where", where);
  url.searchParams.set(
    "outFields",
    "ADDR_FULL,APPRLNDVAL,APPR_IMPR,TAX_LNDVAL,TAX_IMPR,KCTP_TAXYR,LOTSQFT,UNIT_NUM"
  );
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("f", "json");

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    console.error(`[king-shape] fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  if (!res.ok) {
    console.error(`[king-shape] non-200 (${res.status})`);
    return null;
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    console.error(`[king-shape] response was not valid JSON`);
    return null;
  }
  const features = (data as { features?: unknown }).features;
  if (!Array.isArray(features)) {
    console.error(
      `[king-shape] no "features" array — API shape may have changed. Keys: [${Object.keys(
        (data as object) || {}
      ).join(", ")}]`
    );
    return null;
  }
  return features
    .map((f) => (f as { attributes?: KingAttributes }).attributes)
    .filter((a): a is KingAttributes => !!a);
}

/**
 * Live lookup against King County's public ArcGIS parcel/address/value
 * layer (see module doc). Returns null on any "no usable result" outcome —
 * no address match, ambiguous multi-parcel match (e.g. a condo tower's
 * unit/parking/storage rows sharing one ADDR_FULL — confirmed live, see
 * module doc), or a matched row with no usable value — never throws for
 * those.
 */
export async function lookupByAddress(street: string, _city?: string): Promise<CountyAssessorResult | null> {
  const normalized = normalizeKingAddress(street);
  if (!normalized) return null;

  let rows = await queryKing(`ADDR_FULL='${normalized}'`);
  if (rows == null) return null;
  if (rows.length === 0) {
    // Tolerate minor trailing differences (e.g. a stray unit token the
    // caller didn't strip) with a prefix match — still requires a single
    // unambiguous result below, same as the exact-match path.
    rows = await queryKing(`ADDR_FULL LIKE '${normalized}%'`);
    if (rows == null) return null;
  }
  if (rows.length === 0) return null;

  // Multiple rows for one address = a multi-unit parcel group (confirmed
  // live against a real downtown Seattle condo/mixed-use tower — see
  // module doc). No unit number in the raw `street` input to disambiguate,
  // so — same conservative policy as every other adapter in this
  // directory — skip rather than guess.
  if (rows.length !== 1) return null;
  const chosen = rows[0];

  // A single exact-address result can still be one condo/apartment unit,
  // not the containing building or parcel. Production example: King County
  // returns only UNIT_NUM="102" for 1122 BROADWAY E. This adapter does not
  // receive an explicit unit identifier, so using that row would silently
  // attach unit 102's assessed value to the whole-building request.
  if (typeof chosen.UNIT_NUM === "string" && chosen.UNIT_NUM.trim()) return null;

  const taxLand = typeof chosen.TAX_LNDVAL === "number" ? chosen.TAX_LNDVAL : 0;
  const taxImpr = typeof chosen.TAX_IMPR === "number" ? chosen.TAX_IMPR : 0;
  const assessedValue = taxLand + taxImpr;
  if (assessedValue <= 0) return null;

  const apprLand = typeof chosen.APPRLNDVAL === "number" ? chosen.APPRLNDVAL : 0;
  const apprImpr = typeof chosen.APPR_IMPR === "number" ? chosen.APPR_IMPR : 0;
  const marketValue = apprLand + apprImpr;

  const result: CountyAssessorResult = {
    assessedValue: Math.round(assessedValue),
    marketValue: marketValue > 0 ? Math.round(marketValue) : undefined,
    // yearBuilt intentionally always undefined — not published by this
    // layer, see module doc's "NOT AVAILABLE" note.
    lotSize:
      typeof chosen.LOTSQFT === "number" && chosen.LOTSQFT > 0 ? Math.round(chosen.LOTSQFT) : undefined,
    assessmentYear:
      typeof chosen.KCTP_TAXYR === "number" ? String(chosen.KCTP_TAXYR) : String(new Date().getFullYear()),
    source: "county_assessor",
    // WA appraises at 100% of market value by statute — no fractional
    // levy ratio or assessment cap (see module doc's FIELD MAPPING note) —
    // so assessedValue is itself already a market-tracking figure, safe to
    // anchor on directly even on the rare parcel where APPRLNDVAL/APPR_IMPR
    // come back unpopulated.
    assessmentBasis: "full_value",
  };
  return result;
}

/** Minimal health probe — mirrors ab.ts's calgarySodaHealthCheck() convention. */
export async function kingHealthCheck(): Promise<{ ok: boolean; detail: string }> {
  try {
    const result = await lookupByAddress("209 N 41st St");
    if (result) return { ok: true, detail: `assessedValue=${result.assessedValue} year=${result.assessmentYear}` };
    return { ok: false, detail: "known-good address returned no result (dataset/schema may have changed)" };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? `${err.name}: ${err.message}` : String(err) };
  }
}
