/**
 * components/insurance/coverage-prefill.ts
 *
 * Shared types + pure helpers for the coverage-profile intake wizard
 * (screen 2) and handoff (screen 4). No JSX here on purpose — this module
 * is imported by both the server page (src/app/coverage-profile/page.tsx)
 * and the client components under this directory, so it stays framework-
 * neutral.
 *
 * "Known" vs "modeled" mirrors CoverageProfileProperty's per-group
 * provenance (src/lib/db/coverage-profiles.ts): identity fields (type,
 * year, beds/baths, sqft) come straight from our own listing record when
 * one exists, so the whole group is "known"; estimated value/rent are
 * themselves an estimate (assessment/AVM), so that group is "modeled" —
 * even when a number is present, it is not a plain fact the way an address
 * or a bedroom count is.
 */

import type { Country, InsuranceLine } from "@/config/affiliate-vendors";
import type { Listing } from "@/lib/types";

export type CoverageFieldSource = "known" | "modeled";

export interface CoveragePrefillIdentity {
  /** Non-fabricated starting-point default ("House") when a listing
   *  exists — every listing in this system enters the pipeline through a
   *  house-filtered search, so this is a reasonable default, not an
   *  invented fact — but it's always user-editable via "Edit a detail"
   *  before submission, and null (rendered "— not on file") when there's
   *  no listing to default from at all. */
  type: string | null;
  yearBuilt: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  source: CoverageFieldSource;
}

export interface CoveragePrefillValue {
  estimatedValue: number | null;
  estimatedRent: number | null;
  source: CoverageFieldSource;
}

export interface CoveragePrefill {
  country: Country;
  region: string;
  line: InsuranceLine;
  address: string;
  listingSlug: string | null;
  vendorParam: string | null;
  identity: CoveragePrefillIdentity;
  value: CoveragePrefillValue;
}

/** Strips everything but digits and a decimal point, then parses. Returns
 *  null (never 0 or NaN) when there's nothing usable — a missing
 *  measurement must render "— not on file", not a fabricated zero. */
export function parseNumericField(value: string | undefined | null): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function formatMoney(amount: number | null, country: Country): string {
  if (amount === null) return "— not on file";
  const formatted = "$" + Math.round(amount).toLocaleString("en-US");
  return country === "CA" ? `${formatted} CAD` : formatted;
}

export function formatSize(sqft: number | null, beds: number | null, baths: number | null): string {
  const parts: string[] = [];
  if (sqft !== null) parts.push(`${sqft.toLocaleString("en-US")} sqft`);
  if (beds !== null || baths !== null) {
    const bedsLabel = beds !== null ? `${beds}bd` : "—bd";
    const bathsLabel = baths !== null ? `${baths}ba` : "—ba";
    parts.push(`${bedsLabel} / ${bathsLabel}`);
  }
  return parts.length > 0 ? parts.join(" · ") : "— not on file";
}

/** Builds the prefill object for the wizard from optional listing data.
 *  Listing.beds/baths/sqft/yearBuilt are free-text strings from the Zoocasa
 *  pipeline (e.g. "3", "1,740") — parsed defensively, never guessed. */
export function buildCoveragePrefill(params: {
  country: Country;
  region: string;
  line: InsuranceLine;
  address: string;
  listingSlug: string | null;
  vendorParam: string | null;
  listing: Listing | null;
}): CoveragePrefill {
  const { country, region, line, address, listingSlug, vendorParam, listing } = params;

  const identity: CoveragePrefillIdentity = {
    type: listing ? "House" : null,
    yearBuilt: listing ? parseNumericField(listing.yearBuilt) : null,
    beds: listing ? parseNumericField(listing.beds) : null,
    baths: listing ? parseNumericField(listing.baths) : null,
    sqft: listing ? parseNumericField(listing.sqft) : null,
    source: "known",
  };

  const estimatedValue =
    listing?.preAssessment?.found &&
    typeof listing.preAssessment.totalValue === "number" &&
    listing.preAssessment.totalValue > 0
      ? listing.preAssessment.totalValue
      : null;

  const value: CoveragePrefillValue = {
    estimatedValue,
    // Listing carries no rent-estimate field today — shown honestly as
    // "not on file" rather than derived from an unrelated number.
    estimatedRent: null,
    source: "modeled",
  };

  return { country, region, line, address, listingSlug, vendorParam, identity, value };
}
