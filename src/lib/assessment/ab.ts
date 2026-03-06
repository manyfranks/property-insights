import { Assessment } from "../types";

// Alberta assessment stub — Calgary and Edmonton have public lookup tools
// but each requires a custom scraper. Post-MVP.
export function lookupAB(_address: string): Assessment | null {
  return null;
}
