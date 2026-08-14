/**
 * components/insurance/resolve-vendor.ts
 *
 * Shared, client-safe vendor/region resolution for the Stage 2 insurance
 * handoff (screen 4, coverage-handoff.tsx) and the intake wizard's
 * vendor-aware consent copy (screen 2 step 4, coverage-profile-wizard.tsx).
 * Zero server imports — this module (and everything it imports from
 * src/config/affiliate-vendors.ts) must stay safe to bundle into the client.
 *
 * `resolveVendor` was originally private to coverage-handoff.tsx; it's
 * extracted here so the wizard can resolve the same vendor reactively (line
 * is live wizard state through step 4) to pick the correct consent copy
 * variant, without duplicating the eligibility logic.
 */

import {
  AFFILIATE_VENDORS,
  rotateTies,
  type AffiliateVendor,
  type Country,
  type InsuranceLine,
} from "@/config/affiliate-vendors";

/** Landlord/commercial/strata lines are rental & building-ownership
 *  concerns, closer to the app's "investor" audience mode; homeowner/tenant
 *  map to "buyer". Local to this module rather than goal-line-map.ts,
 *  which is owned by a different in-flight change on this branch. */
export function audienceModeForLine(line: InsuranceLine): "buyer" | "investor" {
  return line === "landlord" || line === "commercial" || line === "strata" ? "investor" : "buyer";
}

/**
 * Resolves the vendor to hand a coverage profile off to: the `vendorParam`
 * query param wins when it names an eligible vendor for this
 * country/line/region; otherwise the top eligible insurance vendor from the
 * registry (src/config/affiliate-vendors.ts) by cpaTier/affiliateReady;
 * otherwise null (the caller falls back to a plain, visibly-unsponsored
 * "match me" path). Pure function of its arguments — no I/O.
 */
export function resolveVendor(
  country: Country,
  region: string,
  line: InsuranceLine,
  vendorParam: string | null
): AffiliateVendor | null {
  const mode = audienceModeForLine(line);
  const eligible = AFFILIATE_VENDORS.filter(
    (v) =>
      v.enabled &&
      v.vertical === "insurance" &&
      v.country === country &&
      v.audienceMode.includes(mode) &&
      (!v.lines || v.lines.includes(line)) &&
      !v.stateExclusions?.includes(region)
  );

  if (vendorParam) {
    const requested = eligible.find((v) => v.id === vendorParam);
    if (requested) return requested;
  }

  const sorted = rotateTies(
    [...eligible].sort((a, b) => {
      if (b.cpaTier !== a.cpaTier) return b.cpaTier - a.cpaTier;
      return Number(b.affiliateReady) - Number(a.affiliateReady);
    })
  );

  return sorted[0] ?? null;
}

/**
 * CA province/territory + US state/DC codes to full names, for consent copy
 * that needs to read "licensed in British Columbia" rather than "licensed in
 * BC". Intentionally standalone rather than importing
 * src/lib/us-counties.ts's larger county registry (that module pulls in the
 * full county JSON, which would bloat this client bundle for a name lookup).
 * Falls back to the raw code for anything not listed (e.g. a code this app
 * doesn't otherwise operate in) rather than fabricating a name.
 */
const REGION_FULL_NAMES: Record<string, string> = {
  // Canada
  AB: "Alberta",
  BC: "British Columbia",
  MB: "Manitoba",
  NB: "New Brunswick",
  NL: "Newfoundland and Labrador",
  NS: "Nova Scotia",
  NT: "Northwest Territories",
  NU: "Nunavut",
  ON: "Ontario",
  PE: "Prince Edward Island",
  QC: "Quebec",
  SK: "Saskatchewan",
  YT: "Yukon",
  // United States
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  DC: "District of Columbia",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
};

/** Full region name for consent copy, e.g. "BC" -> "British Columbia".
 *  Falls back to the raw (uppercased) code when unrecognized — never
 *  fabricates a name for a region this app doesn't otherwise operate in. */
export function regionFullName(region: string): string {
  const upper = region.toUpperCase();
  return REGION_FULL_NAMES[upper] ?? region;
}
