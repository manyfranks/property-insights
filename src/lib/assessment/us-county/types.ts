/**
 * assessment/us-county/types.ts
 *
 * Shared shape for the free, unauthenticated county-assessor adapters in
 * this directory (maricopa.ts, miami-dade.ts, travis.ts) — the Phase 5
 * open-data-assessor pattern (docs/plans/08-EXECUTION-PHASEMAP.md) applied
 * to the three Discover metros (Austin/Miami/Phoenix). Deliberately NOT the
 * same shape as ../types.ts's `Assessment` (totalValue/landValue/
 * buildingValue/found/...) — that type is the CA-shaped adapter contract
 * consumed by lookupAssessment()/lookupAssessmentSync() in ../index.ts.
 * These county adapters are a standalone enrichment path invoked by
 * scripts/enrich-us-from-assessors.ts, which maps this shape onto the
 * Listing fields RentCast enrichment already writes (yearBuilt/taxes/
 * lotSize/preAssessment) — see that script for the mapping.
 */

export interface CountyAssessorResult {
  /** The county's own "assessed"/"limited"/capped value used for tax
   * calculation — NOT necessarily market value (AZ's Limited Property
   * Value and FL's Save-Our-Homes-capped Assessed Value are both
   * routinely below their county's own market-value figure). */
  assessedValue: number;
  /** The county's own market-value figure when it publishes one distinct
   * from assessedValue (AZ's Full Cash Value, FL's Just Value). */
  marketValue?: number;
  yearBuilt?: number;
  /** Square feet. */
  lotSize?: number;
  /** Not populated by any of the three adapters below — none of the free
   * sources found publish a per-parcel dollar tax amount (only assessed/
   * taxable VALUE, which would require the local millage rate to convert
   * to a tax bill, and that data isn't in these datasets). Left optional
   * so a future county with real tax data can populate it honestly. */
  annualTaxes?: number;
  assessmentYear: string;
  source: "county_assessor";
  /** How this county's own assessedValue/marketValue pair relates to true
   * market value — lets callers (src/lib/pipeline/us-assess.ts's
   * buildUsAssessment) decide how much scrutiny an anchored value needs
   * WITHOUT hardcoding a per-state guess (../../rentcast.ts's
   * assessmentBasisForState is a blunt "every state except CA is
   * assessed_ratio" default; this field lets a verified county adapter
   * override that with what it actually observed).
   *
   * "assessed_ratio": assessedValue is a legally fractional or capped
   * figure that is EXPECTED to run below true market value by design (a
   * fixed levy ratio, an annual-increase cap, or both) — assessedValue
   * alone should not be trusted as a market proxy; prefer marketValue when
   * present, and treat a low assessedValue/asking ratio as normal rather
   * than a red flag. Cook (fixed 10% Level of Assessment on class-2
   * residential — see cook.ts), NYC (curtxbtot capped by the state's
   * assessment-increase-cap law, ~4-4.5% of market observed — see nyc.ts),
   * and Maricopa (LPV, capped below Full Cash Value by AZ's rate-cap
   * formula — see maricopa.ts) all set this.
   *
   * "full_value": assessedValue is ALREADY meant to equal (or closely
   * track) true market value by statute — no ratio correction needed, and
   * assessedValue is safe to anchor on directly even without a separate
   * marketValue figure. King County sets this (WA appraises at 100% of
   * market value by statute — see king.ts).
   *
   * Optional and left unset by no adapter in this directory as of this
   * field's introduction (all six set it) — kept optional so a future
   * adapter that hasn't been classified yet degrades to the existing
   * state-level default (assessmentBasisForState) rather than failing to
   * compile. See src/lib/pipeline/us-assess.ts's buildUsAssessment for how
   * this maps onto Assessment.assessmentBasis. */
  assessmentBasis?: "assessed_ratio" | "full_value";
}

export interface CountyAdapter {
  /** Human-readable label for logging/reporting. */
  name: string;
  /** false = module exists but is a documented no-op (see travis.ts) —
   * callers should skip rather than "run and get zero matches" so the
   * enrichment script's report distinguishes "tried, poor match rate" from
   * "known infeasible, not attempted". */
  feasible: boolean;
  /** 5-digit state+county FIPS code, zero-padded (e.g. "48453" for Travis
   * County, TX; "04013" for Maricopa County, AZ) — the same format
   * `${geo.stateFips}${geo.countyFips}` produces in
   * src/lib/geo/census-geocoder.ts and src/app/api/assess/route.ts. Used to
   * route live per-request lookups (see ./index.ts's lookupCountyLive) by
   * FIPS rather than the city|state registry key, which exists only for
   * this directory's batch-enrichment lookup (resolveCountyAdapter). */
  countyFips: string;
  /** Whether lookupByAddress is safe to call inline in a LIVE user request
   * path (src/app/api/assess/route.ts's handleUSAssessment, alongside the
   * RentCast bundle fetch) — i.e. it's a real address-indexed network call
   * with bounded latency, not a local bulk-file index that takes minutes on
   * a cold process (see travis.ts's module doc for why Travis is `false`).
   * `false` means lookupCountyLive() must short-circuit to null WITHOUT
   * ever invoking lookupByAddress — for Travis specifically, calling it
   * would trigger a ~4.9GB one-time bulk download, unacceptable inside a
   * Vercel serverless request. A new county adapter that only supports a
   * batch/bulk source (not address-indexed live API) must set this false. */
  liveCapable: boolean;
  lookupByAddress(street: string, city?: string): Promise<CountyAssessorResult | null>;
}
