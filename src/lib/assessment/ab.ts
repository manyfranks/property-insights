import { Assessment } from "../types";
import { AB_ASSESSMENT_CACHE } from "../data/assessments";

// Alberta assessment — cache lookup against municipal assessment data.
// Calgary and Edmonton have public lookup tools but each requires a custom scraper. Post-MVP.

export function lookupAB(address: string): Assessment | null {
  return lookupABSync(address);
}

export function lookupABSync(address: string): Assessment | null {
  const cached = AB_ASSESSMENT_CACHE[address];
  if (!cached) return null;
  return {
    totalValue: cached.total,
    landValue: cached.land,
    buildingValue: cached.building,
    assessmentYear: "2025",
    found: true,
  };
}
