import { Assessment } from "../types";
import { lookupBC, lookupBCSync } from "./bc";
import { lookupON, lookupONSync } from "./on";
import { lookupAB, lookupABSync } from "./ab";
import { getStatCanMedian } from "../data/statcan-chsp";

/**
 * Async lookup — tries province-specific sources, then StatCan area median.
 * Use in API routes where async is fine.
 */
export async function lookupAssessment(
  address: string,
  province: string,
  city?: string,
  unit?: string,
  taxes?: string
): Promise<Assessment | null> {
  let result: Assessment | null = null;

  switch (province) {
    case "BC":
      result = await lookupBC(address, city, unit);
      break;
    case "ON":
      result = await lookupON(address, unit, city, taxes);
      break;
    case "AB":
      result = await lookupAB(address, unit, city);
      break;
  }

  if (result) return result;

  // Last resort: StatCan area median (city-level, not property-specific)
  if (city) {
    const median = getStatCanMedian(city);
    if (median) {
      return {
        totalValue: median.medianAssessment,
        landValue: 0,
        buildingValue: 0,
        assessmentYear: median.year,
        found: true,
        source: "area_median",
      };
    }
  }

  return null;
}

/**
 * Sync cache-only lookup — for preloaded data path (server components, dashboard).
 * Falls back to StatCan area median if cache misses.
 */
export function lookupAssessmentSync(
  address: string,
  province: string,
  unit?: string,
  city?: string,
  taxes?: string
): Assessment | null {
  let result: Assessment | null = null;

  switch (province) {
    case "BC":
      result = lookupBCSync(address, unit);
      break;
    case "ON":
      result = lookupONSync(address, unit, city, taxes);
      break;
    case "AB":
      result = lookupABSync(address, unit);
      break;
  }

  if (result) return result;

  if (city) {
    const median = getStatCanMedian(city);
    if (median) {
      return {
        totalValue: median.medianAssessment,
        landValue: 0,
        buildingValue: 0,
        assessmentYear: median.year,
        found: true,
        source: "area_median",
      };
    }
  }

  return null;
}
