import { Assessment } from "../types";
import { ON_ASSESSMENT_CACHE } from "../data/assessments";
import { getOntarioTaxRate } from "./on-tax-rates";

// Ontario assessment — cache lookup + tax reverse-engineering.
// MPAC assessments frozen at 2016 values.

export function lookupON(address: string, unit?: string, city?: string, taxes?: string): Assessment | null {
  return lookupONSync(address, unit, city, taxes);
}

export function lookupONSync(address: string, unit?: string, city?: string, taxes?: string): Assessment | null {
  // 1. Cache
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

  // 2. Tax reverse-engineering: assessed_value = annual_tax / combined_rate
  if (taxes && city) {
    const parsedTax = parseFloat(taxes.replace(/[$,]/g, ""));
    if (parsedTax > 0) {
      const rate = getOntarioTaxRate(city);
      if (rate) {
        const totalValue = Math.round(parsedTax / rate.rate);
        // Sanity: reject if computed value is unreasonable (<$50K or >$50M)
        if (totalValue >= 50_000 && totalValue <= 50_000_000) {
          return {
            totalValue,
            landValue: 0,
            buildingValue: 0,
            assessmentYear: "2016",
            found: true,
          };
        }
      }
    }
  }

  return null;
}
