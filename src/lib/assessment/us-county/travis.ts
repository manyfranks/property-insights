/**
 * assessment/us-county/travis.ts
 *
 * Travis County (Austin, TX) — CONFIRMED NOT FEASIBLE for free per-address
 * assessed-value lookup as of 2026-08-07. Documented honestly here rather
 * than faked (per this module's task brief) — two routes were investigated
 * live and both are dead ends:
 *
 * 1. Travis Central Appraisal District's actual valuation data lives behind
 *    ProdigyCAD (traviscad.org's "Property Search" iframes
 *    travis.prodigycad.com, a React SPA backed by
 *    prod-container.trueprodigyapi.com — shared multi-tenant infra used by
 *    several TX CADs). Its "/public/..." endpoints
 *    (/public/propertyaccount/{id}/value, /public/property/search) are NOT
 *    actually public despite the path name:
 *      - Bare request -> 403 Forbidden (WAF-level Origin check).
 *      - Same request + a real `Origin: https://travis.prodigycad.com`
 *        header -> clears the WAF, but the app then returns
 *        401 "Authorization header missing" on every one of them, including
 *        the plain property/search endpoint. No self-serve token issuance
 *        was found (Auth0 tenant referenced in the bundle, no public client
 *        credentials).
 *      - Confirmed both failure modes live against real requests before
 *        writing this file.
 *
 * 2. Travis County's own open ArcGIS layer IS free/unauthenticated and
 *    address-queryable by situs_num/situs_street:
 *      https://gis.traviscountytx.gov/server1/rest/services/Boundaries_and_Jurisdictions/TCAD_public/MapServer/0
 *    (386,682 parcels, confirmed live — e.g. "5507 Burgundy Dr" resolves to
 *    PROP_ID 222863). BUT its schema has no value, tax, or year-built field
 *    at all: only PROP_ID, geo_id, situs address, tcad_acres, legal
 *    description, and a `hyperlink` back to the auth-walled portal in (1).
 *    Confirmed by pulling the layer's full field list — there is nothing
 *    left to map onto assessedValue/marketValue/yearBuilt.
 *
 * Texas also has no Florida-DOR-style statewide cadastral/NAL equivalent to
 * fall back to (each of Texas's 254 counties runs independent CAD software;
 * Texas is a non-disclosure state for sale prices, though appraisal rolls
 * themselves are public — just not through a source found to be both free
 * and address-queryable here).
 *
 * lookupByAddress() therefore always resolves to null, and
 * scripts/enrich-us-from-assessors.ts marks this county `feasible: false`
 * and does not run it against the cached Austin listings (see
 * ./types.ts's CountyAdapter.feasible doc comment for why that distinction
 * matters for honest reporting). Kept as a real module — not deleted — so
 * a future session can revisit if TCAD/ProdigyCAD ever issues self-serve
 * API tokens, or if Travis County's open GIS layer is ever extended with
 * value data.
 */

import { CountyAssessorResult } from "./types";

export async function lookupByAddress(
  _street: string,
  _city?: string
): Promise<CountyAssessorResult | null> {
  return null;
}
