import { Assessment } from "../types";

/**
 * Normalized input shape for all region adapters. Individual province/state
 * modules (bc.ts, on.ts, ab.ts, future us-*.ts) keep their own historical
 * function signatures internally — this interface is only what the registry
 * in index.ts uses to call them uniformly.
 */
export interface AssessmentLookupInput {
  address: string;
  city?: string;
  unit?: string;
  taxes?: string;
  /** province/state code as passed to lookupAssessment(Sync) — only the US
   * adapter uses this (one adapter shared across all 50 states + DC, so it
   * needs to know which state it's geocoding within). */
  region?: string;
}

export interface AssessmentAdapter {
  lookup(input: AssessmentLookupInput): Promise<Assessment | null>;
  lookupSync(input: AssessmentLookupInput): Assessment | null;
}
