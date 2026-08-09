/**
 * assessment/us-county/index.ts
 *
 * Registry for the free, unauthenticated county-assessor adapters (Phase 5
 * open-data-assessor pattern, docs/plans/08-EXECUTION-PHASEMAP.md) applied
 * to the US Discover metros. Keyed by "city|state" (lowercase) rather than
 * county FIPS — the cached Listing objects carry city/state, not a county
 * code, and there's a 1:1 city:county mapping for every metro registered
 * today (Austin:Travis, Miami:Miami-Dade, Phoenix:Maricopa, Chicago:Cook,
 * Seattle:King, and NYC's five boroughs each their own county). Revisit if
 * a metro with an ambiguous city->county mapping is ever added.
 *
 * See scripts/enrich-us-from-assessors.ts for the caller that iterates
 * cached US listings and merges results into KV (batch path, resolves by
 * city|state via resolveCountyAdapter()).
 *
 * LIVE PATH (added alongside the batch path above): lookupCountyLive(),
 * used by src/app/api/assess/route.ts's handleUSAssessment(), resolves by
 * county FIPS instead (the geocoder gives FIPS, not a registry-friendly
 * city/state pair for every possible input spelling) and is gated by each
 * adapter's `liveCapable` flag — see ./types.ts's CountyAdapter doc comment
 * for exactly what a new adapter must implement to opt in.
 */

import { lookupByAddress as lookupMaricopa } from "./maricopa";
import { lookupByAddress as lookupMiamiDade } from "./miami-dade";
import { lookupByAddress as lookupTravis } from "./travis";
import { lookupByAddress as lookupCook } from "./cook";
import { lookupByAddress as lookupKing } from "./king";
import { lookupByAddress as lookupNyc } from "./nyc";
import { CountyAdapter, CountyAssessorResult } from "./types";

export type { CountyAdapter, CountyAssessorResult } from "./types";

const REGISTRY: Record<string, CountyAdapter> = {
  "phoenix|az": {
    name: "Maricopa County Assessor (public ArcGIS parcel layer)",
    feasible: true,
    countyFips: "04013",
    liveCapable: true,
    lookupByAddress: lookupMaricopa,
  },
  "miami|fl": {
    name: "Miami-Dade GIS + FL DOR statewide cadastral (two-step folio handoff)",
    feasible: true,
    countyFips: "12086",
    liveCapable: true,
    lookupByAddress: lookupMiamiDade,
  },
  "austin|tx": {
    name: "Travis CAD certified appraisal export (bulk-file index, see travis.ts doc comment)",
    feasible: true,
    countyFips: "48453",
    // NOT live-capable — lookupByAddress here triggers a one-time ~4.9GB
    // bulk-file download+index on first call (see travis.ts's module doc).
    // Fine for a local batch script; would be a multi-minute hang (or
    // repeated re-download across cold serverless instances) if invoked
    // from lookupCountyLive() in a live request path. Registered here with
    // liveCapable:false specifically so lookupCountyLive() can route on
    // FIPS and short-circuit to null WITHOUT ever touching this adapter's
    // lookupByAddress, rather than needing a separate "does Travis exist"
    // check at every call site.
    liveCapable: false,
    lookupByAddress: lookupTravis,
  },
  "chicago|il": {
    name: "Cook County Assessor (Socrata open data — parcel address + assessed value + characteristics)",
    feasible: true,
    countyFips: "17031",
    liveCapable: true,
    lookupByAddress: lookupCook,
  },
  "seattle|wa": {
    name: "King County Assessor (public ArcGIS parcel/address/value layer)",
    feasible: true,
    countyFips: "53033",
    liveCapable: true,
    lookupByAddress: lookupKing,
  },
  // NYC — one module (nyc.ts) serves all five boroughs, each its own
  // county/FIPS and its own registry key (BORO_BY_CITY inside nyc.ts
  // resolves which borough to query from the `city` argument callers pass
  // in). Five separate CountyAdapter entries below, all pointing at the
  // same lookupByAddress function, differing only in countyFips/name — see
  // FIPS_INDEX below for why this is required (one adapter object can only
  // declare a single countyFips).
  "new york|ny": {
    name: "NYC DOF Property Valuation and Assessment Data (New York County/Manhattan)",
    feasible: true,
    countyFips: "36061",
    liveCapable: true,
    lookupByAddress: lookupNyc,
  },
  "brooklyn|ny": {
    name: "NYC DOF Property Valuation and Assessment Data (Kings County/Brooklyn)",
    feasible: true,
    countyFips: "36047",
    liveCapable: true,
    lookupByAddress: lookupNyc,
  },
  "queens|ny": {
    name: "NYC DOF Property Valuation and Assessment Data (Queens County)",
    feasible: true,
    countyFips: "36081",
    liveCapable: true,
    lookupByAddress: lookupNyc,
  },
  "bronx|ny": {
    name: "NYC DOF Property Valuation and Assessment Data (Bronx County)",
    feasible: true,
    countyFips: "36005",
    liveCapable: true,
    lookupByAddress: lookupNyc,
  },
  "staten island|ny": {
    name: "NYC DOF Property Valuation and Assessment Data (Richmond County/Staten Island)",
    feasible: true,
    countyFips: "36085",
    liveCapable: true,
    lookupByAddress: lookupNyc,
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

// ---------------------------------------------------------------------------
// Live path — src/app/api/assess/route.ts's handleUSAssessment()
// ---------------------------------------------------------------------------

const FIPS_INDEX: Record<string, CountyAdapter> = Object.fromEntries(
  Object.values(REGISTRY).map((adapter) => [adapter.countyFips, adapter])
);

/** Per-FIPS hard timeout for the live path (ms) — bounds how long
 * handleUSAssessment's Promise.all waits on this call before treating it as
 * a miss and falling back to RentCast-based assessment, exactly as if no
 * live adapter existed.
 *
 * Live-measured while wiring this (2026-08-09, 5 real queries — 2 hits, 1
 * ambiguous-condo miss, 1 genuine no-match, repeated): Maricopa's single
 * ArcGIS query ran 5.7s-7.2s regardless of hit/miss/ambiguous outcome —
 * materially slower than maricopa.ts's original source-verification note
 * (2026-08-07, correctness-focused, no timing recorded) and above this
 * task's initial 6s planning estimate. 9s leaves real margin over the
 * observed range. Miami-Dade's two-step (county GIS folio lookup + FDOR
 * statewide query) ran 1.7s-2.8s, comfortably inside its original 0.2-3s
 * verification range — 8s left as specified.
 *
 * Cook/King/NYC added 2026-08-09 alongside their registration above, same
 * live-measurement discipline: Cook's three-Socrata-call sequence (address
 * -> PIN, then PIN -> value/characteristics in parallel) ran up to ~1.7s
 * in source verification; King's single ArcGIS query ran 330-420ms; NYC's
 * per-borough Socrata query (up to 5 in parallel when the input city
 * doesn't resolve to one borough) ran up to ~1.2s. All three get a flat 6s
 * ceiling — comfortably over their observed worst case with the same
 * margin-over-measured-range approach as Maricopa/Miami-Dade above,
 * without needing Maricopa's wider 9s (Cook/King/NYC's measured latencies
 * never approached that). */
const LIVE_TIMEOUT_MS: Record<string, number> = {
  "04013": 9_000, // Maricopa — single ArcGIS query, live-measured 5.7-7.2s
  "12086": 8_000, // Miami-Dade — two sequential ArcGIS/FDOR queries, live-measured 1.7-2.8s
  "17031": 6_000, // Cook — three-step Socrata lookup, live-measured up to ~1.7s
  "53033": 6_000, // King — single ArcGIS query, live-measured 330-420ms
  "36061": 6_000, // NYC (all 5 boroughs share this timeout) — up to 5 parallel Socrata queries, live-measured up to ~1.2s
  "36047": 6_000,
  "36081": 6_000,
  "36005": 6_000,
  "36085": 6_000,
};
const DEFAULT_LIVE_TIMEOUT_MS = 8_000;

/**
 * Live per-request county-assessor lookup, routed by county FIPS. Returns
 * null (never throws) for: no adapter registered for this FIPS, the
 * registered adapter has `liveCapable: false` (Travis — never invoked),
 * a genuine "no match"/"ambiguous condo"/"no usable value" outcome from the
 * adapter itself (unchanged from the batch path — see maricopa.ts/
 * miami-dade.ts's own "skip rather than guess" doc comments), or a timeout.
 *
 * On timeout, the underlying adapter call is deliberately NOT cancelled —
 * these adapters hold no shared/mutable state and never throw for ordinary
 * failures (per their own doc comments), so letting it resolve into the
 * void after the race has already returned null is a clean abandonment,
 * not a leak. This keeps handleUSAssessment's Promise.all bounded by
 * LIVE_TIMEOUT_MS even if the upstream API is slow that day.
 *
 * Log prefix `[county-live]` (grep-able per RUNBOOK.md §7.1's convention)
 * covers every outcome — hit, miss, timeout, and unexpected error — so a
 * silent live-source degradation shows up in logs even though the caller
 * always degrades gracefully to the RentCast-based assessment.
 */
export async function lookupCountyLive(
  countyFips: string,
  street: string,
  city?: string
): Promise<CountyAssessorResult | null> {
  const adapter = FIPS_INDEX[countyFips];
  if (!adapter || !adapter.liveCapable) return null;

  const timeoutMs = LIVE_TIMEOUT_MS[countyFips] ?? DEFAULT_LIVE_TIMEOUT_MS;
  const t0 = Date.now();
  let timedOut = false;

  try {
    const result = await Promise.race([
      adapter.lookupByAddress(street, city),
      new Promise<null>((resolve) => {
        setTimeout(() => {
          timedOut = true;
          resolve(null);
        }, timeoutMs);
      }),
    ]);
    const elapsed = Date.now() - t0;

    if (timedOut) {
      console.error(
        `[county-live] ${adapter.name} timed out (${timeoutMs}ms) for "${street}" — falling back to RentCast-based assessment`
      );
      return null;
    }
    if (result) {
      console.log(
        `[county-live] ${adapter.name} hit for "${street}" in ${elapsed}ms — assessedValue=${result.assessedValue}` +
          (result.marketValue ? ` marketValue=${result.marketValue}` : "")
      );
    } else {
      console.log(`[county-live] ${adapter.name} miss for "${street}" in ${elapsed}ms (no match / ambiguous / no usable value)`);
    }
    return result;
  } catch (err) {
    console.error(
      `[county-live] ${adapter.name} threw for "${street}": ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}
