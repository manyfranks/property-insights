import { Assessment } from "../types";
import { lookupBC, lookupBCSync } from "./bc";
import { lookupON } from "./on";
import { lookupAB } from "./ab";

/**
 * Async lookup — tries cache first, then live scrape.
 * Use in API routes where async is fine.
 */
export async function lookupAssessment(address: string, province: string): Promise<Assessment | null> {
  switch (province) {
    case "BC":
      return lookupBC(address);
    case "ON":
      return lookupON(address);
    case "AB":
      return lookupAB(address);
    default:
      return null;
  }
}

/**
 * Sync cache-only lookup — for preloaded data path (server components, dashboard).
 */
export function lookupAssessmentSync(address: string, province: string): Assessment | null {
  switch (province) {
    case "BC":
      return lookupBCSync(address);
    case "ON":
      return lookupON(address);
    case "AB":
      return lookupAB(address);
    default:
      return null;
  }
}
