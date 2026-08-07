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
}

export interface AssessmentAdapter {
  lookup(input: AssessmentLookupInput): Promise<Assessment | null>;
  lookupSync(input: AssessmentLookupInput): Assessment | null;
}
