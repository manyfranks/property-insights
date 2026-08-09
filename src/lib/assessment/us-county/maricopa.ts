/**
 * assessment/us-county/maricopa.ts
 *
 * Free, unauthenticated county-assessor enrichment for Maricopa County
 * (Phoenix, AZ) listings — see ./types.ts for the shared result shape and
 * scripts/enrich-us-from-assessors.ts for how it's applied to cached
 * Discover listings.
 *
 * SOURCE VERIFICATION (live-probed 2026-08-07):
 * The Assessor's own documented REST API
 * (mcassessor.maricopa.gov/search/property, /parcel/{apn} — see
 * /file/home/MC-Assessor-API-Documentation.pdf) requires a manually-issued
 * `AUTHORIZATION` token (no self-serve signup — "use the contact us form
 * ... select API Question/Token"); every unauthenticated request 500s,
 * including with a dummy header. That official API is NOT used here.
 *
 * Instead this hits the SAME underlying parcel roll, published with zero
 * auth, through the Assessor's own public ArcGIS Online web map
 * ("Maricopa County Assessor Parcel Viewer",
 * https://www.arcgis.com/home/item.html?id=44a9cd16081347eca8937994eaa1292f)
 * whose feature layer is:
 *   https://gis.mcassessor.maricopa.gov/arcgis/rest/services/Parcels/MapServer/0
 * Confirmed live against 3 cached Phoenix addresses (4330 N 5th Ave, 8429 W
 * Vernon Ave, 3131 W Cochise Dr) before writing this adapter — single-family
 * parcels match on the first try; the 4330 N 5th Ave / 3131 W Cochise Dr
 * condo complexes returned 33/144 unit rows respectively, confirming the
 * multi-match skip logic below is needed, not hypothetical.
 *
 * FIELD MAPPING (see the layer's own field aliases):
 *   LPV_CUR (Limited Property Value)  -> assessedValue  (what AZ actually
 *     taxes off of — capped below Full Cash Value by the state's rate-cap
 *     formula, so it is meaningfully lower than market value; same role as
 *     assessed_ratio states elsewhere in this codebase, see
 *     ../rentcast.ts's assessmentBasisForState)
 *   FCV_CUR (Full Cash Value)         -> marketValue
 *   CONST_YEAR                        -> yearBuilt
 *   LAND_SIZE (sqft)                  -> lotSize
 *   TAX_YR_CUR                        -> assessmentYear
 * No per-parcel dollar tax amount is published in this layer — annualTaxes
 * is intentionally left unset (see ./types.ts's doc comment on that field).
 */

import { CountyAssessorResult } from "./types";

const MARICOPA_QUERY_URL =
  "https://gis.mcassessor.maricopa.gov/arcgis/rest/services/Parcels/MapServer/0/query";

const FETCH_TIMEOUT_MS = 10_000;

function normalizeAddress(street: string): string {
  return street.trim().toUpperCase().replace(/\s+/g, " ").replace(/'/g, "''");
}

/** Maricopa's FCV_CUR/LPV_CUR come back as padded, comma-formatted strings
 * like "     210,100" — strip and parse, treating <= 0 / unparsable as
 * "no usable value" rather than a hard error (mirrors ab.ts's
 * extractAssessedValue "value <= 0 is legitimate but unusable" stance). */
function parseMoneyString(raw: unknown): number | null {
  if (raw == null) return null;
  const cleaned = String(raw).replace(/[,\s]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

interface MaricopaAttributes {
  APN?: string;
  PHYSICAL_ADDRESS?: string;
  PHYSICAL_SUITE?: string | null;
  CONST_YEAR?: string;
  LAND_SIZE?: number;
  FCV_CUR?: string;
  LPV_CUR?: string;
  TAX_YR_CUR?: string;
}

/**
 * Live lookup against the public Maricopa Assessor parcel layer. Returns
 * null on any "no usable result" outcome (no match, ambiguous condo/
 * apartment match with no unit to disambiguate, missing/invalid assessed
 * value) — never throws for those, matching the rest of the codebase's
 * adapter contract. Logs with a grep-able `[maricopa-shape]` prefix only
 * for genuine API-shape drift (non-JSON response, missing `features`
 * array), same convention as assessment/ab.ts's SodaShapeError logging.
 */
export async function lookupByAddress(
  street: string,
  _city?: string
): Promise<CountyAssessorResult | null> {
  const normalized = normalizeAddress(street);
  if (!normalized) return null;

  const url = new URL(MARICOPA_QUERY_URL);
  url.searchParams.set("where", `PHYSICAL_ADDRESS LIKE '${normalized}%'`);
  url.searchParams.set(
    "outFields",
    "APN,PHYSICAL_ADDRESS,PHYSICAL_SUITE,CONST_YEAR,LAND_SIZE,FCV_CUR,LPV_CUR,TAX_YR_CUR"
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
    console.error(
      `[maricopa-shape] fetch failed for "${street}": ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
  if (!res.ok) {
    console.error(`[maricopa-shape] non-200 (${res.status}) for "${street}"`);
    return null;
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    console.error(`[maricopa-shape] response was not valid JSON for "${street}"`);
    return null;
  }

  const features = (data as { features?: unknown })?.features;
  if (!Array.isArray(features)) {
    console.error(
      `[maricopa-shape] no "features" array for "${street}" — API shape may have changed. Keys: [${Object.keys(
        (data as object) || {}
      ).join(", ")}]`
    );
    return null;
  }
  if (features.length === 0) return null;

  const rows = features
    .map((f) => (f as { attributes?: MaricopaAttributes }).attributes)
    .filter((a): a is MaricopaAttributes => !!a);
  if (rows.length === 0) return null;

  // Multiple hits at one street number = a condo/apartment complex (see
  // module doc — confirmed with real 33- and 144-unit examples). None of
  // our cached listings carry a unit number, so we can't tell which
  // sub-unit is the actual listing. A tempting shortcut — "pick the one row
  // with no PHYSICAL_SUITE" — turned out to be a trap during live testing:
  // condo complexes often carry one extra row for the shared land/common
  // area (also suite-less, but CONST_YEAR="" and a near-zero LPV_CUR, e.g.
  // ~$6k against real units valued at $50-90k) that would silently pass as
  // a false "match". So: only accept a single unambiguous row; anything
  // else — including a suite-less common-area row alongside real units —
  // is skipped rather than guessed at.
  if (rows.length !== 1) return null;
  const chosen = rows[0];

  const assessedValue = parseMoneyString(chosen.LPV_CUR);
  if (assessedValue == null) return null;

  const marketValue = parseMoneyString(chosen.FCV_CUR) ?? undefined;
  const yearBuiltNum = chosen.CONST_YEAR ? parseInt(chosen.CONST_YEAR, 10) : NaN;
  const yearBuilt = Number.isFinite(yearBuiltNum) && yearBuiltNum > 1800 ? yearBuiltNum : undefined;
  const lotSize =
    typeof chosen.LAND_SIZE === "number" && chosen.LAND_SIZE > 0 ? Math.round(chosen.LAND_SIZE) : undefined;

  const result: CountyAssessorResult = {
    assessedValue: Math.round(assessedValue),
    marketValue: marketValue != null ? Math.round(marketValue) : undefined,
    yearBuilt,
    lotSize,
    assessmentYear: chosen.TAX_YR_CUR ? String(chosen.TAX_YR_CUR) : String(new Date().getFullYear()),
    source: "county_assessor",
    // LPV is capped below Full Cash Value by AZ's rate-cap formula (see
    // module doc's FIELD MAPPING note) — not itself a market figure.
    assessmentBasis: "assessed_ratio",
  };
  return result;
}

/** Minimal health probe — mirrors ab.ts's calgarySodaHealthCheck() convention.
 * NOTE: intentionally NOT "4330 N 5th Ave" — that address is one of this
 * module's own documented ambiguous-condo examples (see the module doc
 * above), which correctly returns null by design (rows.length!==1 guard).
 * Using it here would make this health check permanently report a false
 * failure. "8429 W Vernon Ave" is a genuine single-family match, live-
 * reconfirmed while wiring src/lib/assessment/us-county/index.ts's
 * lookupCountyLive() (2026-08-09). */
export async function maricopaHealthCheck(): Promise<{ ok: boolean; detail: string }> {
  try {
    const result = await lookupByAddress("8429 W Vernon Ave");
    if (result) return { ok: true, detail: `assessedValue=${result.assessedValue} year=${result.assessmentYear}` };
    return { ok: false, detail: "known-good address returned no result (dataset/schema may have changed)" };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? `${err.name}: ${err.message}` : String(err) };
  }
}
