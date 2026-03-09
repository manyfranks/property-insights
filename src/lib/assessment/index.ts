import { Assessment } from "../types";
import { lookupBC, lookupBCSync } from "./bc";
import { lookupON, lookupONSync } from "./on";
import { lookupAB, lookupABSync } from "./ab";

/**
 * Async lookup — tries cache first, then live scrape/API.
 * Use in API routes where async is fine.
 */
export async function lookupAssessment(
  address: string,
  province: string,
  city?: string,
  unit?: string
): Promise<Assessment | null> {
  switch (province) {
    case "BC":
      return lookupBC(address, city, unit);
    case "ON":
      return lookupON(address, unit);
    case "AB":
      return lookupAB(address, unit);
    default:
      return null;
  }
}

/**
 * Sync cache-only lookup — for preloaded data path (server components, dashboard).
 */
export function lookupAssessmentSync(address: string, province: string, unit?: string): Assessment | null {
  switch (province) {
    case "BC":
      return lookupBCSync(address, unit);
    case "ON":
      return lookupONSync(address, unit);
    case "AB":
      return lookupABSync(address, unit);
    default:
      return null;
  }
}
