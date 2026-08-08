/**
 * assessment/us-county/index.ts
 *
 * Registry for the free, unauthenticated county-assessor adapters (Phase 5
 * open-data-assessor pattern, docs/plans/08-EXECUTION-PHASEMAP.md) applied
 * to the three US Discover metros. Keyed by "city|state" (lowercase) rather
 * than county FIPS — the cached Listing objects carry city/state, not a
 * county code, and there's a 1:1 city:county mapping for these three metros
 * today (Austin:Travis, Miami:Miami-Dade, Phoenix:Maricopa). Revisit if a
 * metro with an ambiguous city->county mapping is ever added.
 *
 * See scripts/enrich-us-from-assessors.ts for the caller that iterates
 * cached US listings and merges results into KV.
 */

import { lookupByAddress as lookupMaricopa } from "./maricopa";
import { lookupByAddress as lookupMiamiDade } from "./miami-dade";
import { lookupByAddress as lookupTravis } from "./travis";
import { CountyAdapter, CountyAssessorResult } from "./types";

export type { CountyAdapter, CountyAssessorResult } from "./types";

const REGISTRY: Record<string, CountyAdapter> = {
  "phoenix|az": {
    name: "Maricopa County Assessor (public ArcGIS parcel layer)",
    feasible: true,
    lookupByAddress: lookupMaricopa,
  },
  "miami|fl": {
    name: "Miami-Dade GIS + FL DOR statewide cadastral (two-step folio handoff)",
    feasible: true,
    lookupByAddress: lookupMiamiDade,
  },
  "austin|tx": {
    name: "Travis CAD — confirmed infeasible (see travis.ts doc comment)",
    feasible: false,
    lookupByAddress: lookupTravis,
  },
};

/** Look up the county adapter for a Discover-metro city/state pair.
 * Returns undefined for any city/state this registry doesn't cover. */
export function resolveCountyAdapter(city: string, state: string): CountyAdapter | undefined {
  return REGISTRY[`${city.trim().toLowerCase()}|${state.trim().toLowerCase()}`];
}

/** All registered adapters, for iterating in reports/scripts. */
export function listCountyAdapters(): { key: string; adapter: CountyAdapter }[] {
  return Object.entries(REGISTRY).map(([key, adapter]) => ({ key, adapter }));
}
