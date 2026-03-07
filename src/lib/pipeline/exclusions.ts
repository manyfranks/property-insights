/**
 * pipeline/exclusions.ts
 *
 * Hard exclusion filters and filter profiles.
 *
 * A listing that matches any exclusion pattern is dropped before scoring —
 * it never appears in daily picks regardless of DOM or language signals.
 *
 * Profiles control which exclusions apply and what price/type targets to use.
 */

import { Listing } from "../types";

// ---------------------------------------------------------------------------
// Exclusion patterns
// ---------------------------------------------------------------------------

/**
 * Always excluded — regardless of profile.
 * These listings cannot serve the buyer's intent in any mode.
 */
const ALWAYS_EXCLUDE: RegExp[] = [
  // Leasehold / non-freehold
  /leasehold/i,
  /prepaid lease/i,

  // Strata masquerading as SFH
  /strata lot/i,
  /condo fee/i,
  /monthly fee.*strata/i,

  // Must be bought together
  /must be (sold|purchased) (together|with)/i,
  /buy.{0,10}(together|adjacent|with lot)/i,
  /package (deal|purchase)/i,
  /adjacent (lot|parcel|property)/i,

  // Active court orders (development-linked)
  /court order sale/i,
  /ordered by the court/i,
  /by order of/i,
];

/**
 * Excluded in SFH buyer mode only.
 * Investors or dev-mode users may want these.
 */
const SFH_EXCLUDE: RegExp[] = [
  // Teardown language
  /tear.?down/i,
  /demo(lish|lition)? (permit|ready|potential)/i,
  /scraper/i,
  /value (is |in )?land/i,
  /land value only/i,
  /sold as.?is.{0,20}land/i,

  // Development plays
  /land assembly/i,
  /development (site|land|parcel|potential|opportunity)/i,
  /rezoning (potential|application|opportunity)/i,
  /assembly (site|potential|opportunity)/i,
  /subdivision (potential|opportunity)/i,
  /ssmuh/i,             // Small Scale Multi-Unit Housing — dev play, not SFH buy
  /two title/i,
  /3 lots/i,
  /multiple (lots|titles|parcels)/i,

  // Commercial bleed-through
  /commercial zoning/i,
  /c-2|c2 zone/i,
];

// ---------------------------------------------------------------------------
// Filter profiles
// ---------------------------------------------------------------------------

export type ProfileName = "SFH_BUYER" | "INVESTOR_DEV" | "ALL";

export interface FilterProfile {
  name: ProfileName;
  label: string;
  description: string;

  // Price range (optional — null means no limit)
  priceMin: number | null;
  priceMax: number | null;

  // Minimum beds (null = any)
  minBeds: number | null;

  // Which exclusion sets to apply
  excludeSFHPatterns: boolean;

  // Minimum language score to include in results (pre-DOM multiplier)
  minLanguageScore: number;

  // realtor.ca API params for property type
  buildingTypes: string[]; // "1" = House, "2" = Duplex, "3" = Townhouse
}

export const PROFILES: Record<ProfileName, FilterProfile> = {
  /**
   * Default buyer profile.
   * Single family homes, $900K–$1.2M, no teardowns or dev plays.
   * This is what the buyer insights tool targets.
   */
  SFH_BUYER: {
    name: "SFH_BUYER",
    label: "SFH Buyer",
    description: "Move-in ready single family homes, no dev plays",
    priceMin: 900_000,
    priceMax: 1_250_000,
    minBeds: 3,
    excludeSFHPatterns: true,
    minLanguageScore: 10,
    buildingTypes: ["1"],     // House only
  },

  /**
   * Investor / developer profile.
   * Wider price range, teardowns and dev land allowed, lower score bar.
   */
  INVESTOR_DEV: {
    name: "INVESTOR_DEV",
    label: "Investor / Dev",
    description: "Teardowns, land assemblies, and development plays",
    priceMin: 700_000,
    priceMax: 2_500_000,
    minBeds: null,
    excludeSFHPatterns: false,  // dev patterns are the point
    minLanguageScore: 5,
    buildingTypes: ["1", "2"],  // Houses + duplexes
  },

  /**
   * No filters — return everything that passes always-exclude.
   * Useful for exploring a new city before tuning a profile.
   */
  ALL: {
    name: "ALL",
    label: "All Listings",
    description: "Everything that passes hard exclusions",
    priceMin: null,
    priceMax: null,
    minBeds: null,
    excludeSFHPatterns: false,
    minLanguageScore: 0,
    buildingTypes: ["1", "2", "3"],
  },
};

// ---------------------------------------------------------------------------
// Exclusion checker
// ---------------------------------------------------------------------------

export interface ExclusionResult {
  excluded: boolean;
  reason: string | null;
}

/**
 * Returns whether a listing should be excluded and why.
 * Call this before scoring — excluded listings are never surfaced.
 */
export function checkExclusion(
  listing: Listing,
  profile: FilterProfile
): ExclusionResult {
  const text = [listing.description, listing.notes, listing.address]
    .join(" ")
    .toLowerCase();

  // 1. Always-exclude patterns
  for (const pattern of ALWAYS_EXCLUDE) {
    if (pattern.test(text)) {
      return { excluded: true, reason: `Always-exclude: ${pattern.source}` };
    }
  }

  // 2. Profile-specific SFH exclusions
  if (profile.excludeSFHPatterns) {
    for (const pattern of SFH_EXCLUDE) {
      if (pattern.test(text)) {
        return { excluded: true, reason: `SFH-exclude: ${pattern.source}` };
      }
    }
  }

  // 3. Price range check
  if (listing.price > 0) {
    if (profile.priceMin !== null && listing.price < profile.priceMin) {
      return {
        excluded: true,
        reason: `Below price floor: $${listing.price.toLocaleString()} < $${profile.priceMin.toLocaleString()}`,
      };
    }
    if (profile.priceMax !== null && listing.price > profile.priceMax) {
      return {
        excluded: true,
        reason: `Above price ceiling: $${listing.price.toLocaleString()} > $${profile.priceMax.toLocaleString()}`,
      };
    }
  }

  return { excluded: false, reason: null };
}
