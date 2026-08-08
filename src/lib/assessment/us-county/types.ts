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
}

export interface CountyAdapter {
  /** Human-readable label for logging/reporting. */
  name: string;
  /** false = module exists but is a documented no-op (see travis.ts) —
   * callers should skip rather than "run and get zero matches" so the
   * enrichment script's report distinguishes "tried, poor match rate" from
   * "known infeasible, not attempted". */
  feasible: boolean;
  lookupByAddress(street: string, city?: string): Promise<CountyAssessorResult | null>;
}
