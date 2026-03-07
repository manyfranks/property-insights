import { Assessment } from "../types";
import { ON_ASSESSMENT_CACHE } from "../data/assessments";

// Ontario assessment — cache lookup against MPAC/CVA data.
// MPAC assessments frozen at 2016 values. Post-MVP: live lookup.

export function lookupON(address: string): Assessment | null {
  return lookupONSync(address);
}

export function lookupONSync(address: string): Assessment | null {
  const cached = ON_ASSESSMENT_CACHE[address];
  if (!cached) return null;
  return {
    totalValue: cached.total,
    landValue: cached.land,
    buildingValue: cached.building,
    assessmentYear: "2016",
    found: true,
  };
}
