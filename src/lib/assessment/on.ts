import { Assessment } from "../types";
import { ON_ASSESSMENT_CACHE } from "../data/assessments";

// Ontario assessment — cache lookup against MPAC/CVA data.
// MPAC assessments frozen at 2016 values. Post-MVP: live lookup.

export function lookupON(address: string, unit?: string): Assessment | null {
  return lookupONSync(address, unit);
}

export function lookupONSync(address: string, unit?: string): Assessment | null {
  const bare = address.replace(/^\d+[A-Z]?-/i, "");
  const cacheKeys = unit
    ? [address, `${unit} - ${bare}`, bare]
    : [address, bare];
  for (const key of cacheKeys) {
    const cached = ON_ASSESSMENT_CACHE[key];
    if (cached) {
      return {
        totalValue: cached.total,
        landValue: cached.land,
        buildingValue: cached.building,
        assessmentYear: "2016",
        found: true,
      };
    }
  }
  return null;
}
