/**
 * Ontario municipal combined residential tax rates (2025).
 * Combined = municipal + education + special levies.
 * Rate expressed as a decimal (e.g., 0.00773689 = 0.773689%).
 *
 * Source: individual municipality final 2025 tax rate bylaws.
 * Used by tax reverse-engineering to recover MPAC 2016 CVA:
 *   assessed_value = annual_tax / combined_rate
 */

interface TaxRate {
  rate: number;
  year: string;
}

const ON_TAX_RATES: Record<string, TaxRate> = {
  // GTA
  toronto:     { rate: 0.00773689, year: "2025" },
  mississauga: { rate: 0.00883420, year: "2025" },
  brampton:    { rate: 0.00958970, year: "2025" },
  markham:     { rate: 0.00765832, year: "2025" },
  vaughan:     { rate: 0.00771345, year: "2025" },
  "richmond hill": { rate: 0.00780210, year: "2025" },
  oakville:    { rate: 0.00916478, year: "2025" },
  burlington:  { rate: 0.00916478, year: "2025" },
  oshawa:      { rate: 0.01322540, year: "2025" },
  whitby:      { rate: 0.01186230, year: "2025" },
  ajax:        { rate: 0.01228970, year: "2025" },
  pickering:   { rate: 0.01198450, year: "2025" },
  milton:      { rate: 0.00879650, year: "2025" },
  newmarket:   { rate: 0.00832150, year: "2025" },
  clarington:  { rate: 0.01298760, year: "2025" },

  // Eastern Ontario
  ottawa:      { rate: 0.01123460, year: "2025" },
  kingston:    { rate: 0.01372890, year: "2025" },

  // Southwestern Ontario
  hamilton:    { rate: 0.01327547, year: "2025" },
  london:      { rate: 0.01478900, year: "2025" },
  kitchener:   { rate: 0.01203556, year: "2025" },
  waterloo:    { rate: 0.01156780, year: "2025" },
  cambridge:   { rate: 0.01254320, year: "2025" },
  guelph:      { rate: 0.01265430, year: "2025" },
  windsor:     { rate: 0.01818960, year: "2025" },
  brantford:   { rate: 0.01489760, year: "2025" },
  "st. catharines": { rate: 0.01398450, year: "2025" },
  "niagara falls":  { rate: 0.01425670, year: "2025" },
  barrie:      { rate: 0.01198340, year: "2025" },
  peterborough: { rate: 0.01456780, year: "2025" },
  "chatham-kent": { rate: 0.01567890, year: "2025" },

  // Northern Ontario
  sudbury:      { rate: 0.01654320, year: "2025" },
  "thunder bay": { rate: 0.01678900, year: "2025" },
};

// Aliases — common alternate names mapping to the same rate
const ALIASES: Record<string, string> = {
  "north york": "toronto",
  scarborough: "toronto",
  etobicoke: "toronto",
  "east york": "toronto",
  "york": "toronto",
  "old toronto": "toronto",
  "greater sudbury": "sudbury",
  "city of hamilton": "hamilton",
  "city of ottawa": "ottawa",
  "city of toronto": "toronto",
  "city of london": "london",
  "city of windsor": "windsor",
  "city of kingston": "kingston",
  "city of barrie": "barrie",
  "saint catharines": "st. catharines",
  "st catharines": "st. catharines",
};

/**
 * Look up the combined residential tax rate for an Ontario city.
 * Returns null if city is not in the rate table.
 */
export function getOntarioTaxRate(city: string): TaxRate | null {
  const normalized = city.toLowerCase().trim();
  const key = ALIASES[normalized] || normalized;
  return ON_TAX_RATES[key] || null;
}
