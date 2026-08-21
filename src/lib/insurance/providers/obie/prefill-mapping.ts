/**
 * lib/insurance/providers/obie/prefill-mapping.ts
 *
 * Pure mapping helpers for an upcoming Obie Insurance pre-fill integration.
 * NOT wired into any UI, API route, or existing call site — partner
 * credentials haven't landed yet. These functions exist so the mapping
 * logic (and its edge cases) can be designed and tested ahead of time,
 * then adopted by a future intake/submission path without redesign.
 *
 * No I/O, no React, no side effects — every export here is a pure function
 * over plain data. Errors are thrown only for genuinely invalid input to a
 * safety-critical conversion (see toAnnualLossOfRent below); everything
 * else in this module degrades to a documented default rather than
 * throwing, because a best-effort partner pre-fill that the user reviews
 * and can correct is more useful than a hard failure.
 */

// ---------------------------------------------------------------------------
// 1. Dwelling type mapping
// ---------------------------------------------------------------------------

/** Obie's dwelling-type enum (exact strings, per partner spec). */
export type ObieDwellingType =
  | "SFR"
  | "CONDO"
  | "APARTMENT_BUILDING"
  | "DUPLEX"
  | "TRIPLEX"
  | "QUADPLEX"
  | "OTHER";

/** Our own normalized vocabulary, produced by normalizePropertyType() in
 *  src/lib/comparables.ts. Townhouse maps to SFR: a townhouse is a single,
 *  individually-owned dwelling unit (ground-to-roof, its own entrance) —
 *  structurally and for insurance purposes it's a single-family risk, not
 *  a multi-unit one, even though it may share a wall with a neighbor. */
const NORMALIZED_TYPE_MAP: Record<string, ObieDwellingType> = {
  SFH: "SFR",
  Condo: "CONDO",
  Townhouse: "SFR",
  Other: "OTHER",
};

/** Raw/unnormalized strings, case-insensitive and trimmed, mapped straight
 *  to Obie's enum. Covers the same source vocabulary as comparables.ts's
 *  TYPE_MAP (so a raw MLS property_type string maps consistently whichever
 *  path it takes) plus the multi-unit categories Obie distinguishes that
 *  our own TYPE_MAP collapses into "Other" (we don't need that resolution
 *  for comparables matching; Obie's underwriting does).
 *
 *  Where a raw string exists in both comparables.ts's TYPE_MAP and this
 *  list with a different target (e.g. "multi family" is "Other" there,
 *  "APARTMENT_BUILDING" here), this list wins for Obie mapping — the two
 *  maps serve different consumers and are allowed to diverge. */
const RAW_TYPE_MAP: Record<string, ObieDwellingType> = {
  // -- single-family-shaped, from comparables.ts TYPE_MAP --
  "single family residence": "SFR",
  "single family": "SFR",
  "detached": "SFR",
  // -- condo-shaped --
  "condominium": "CONDO",
  "apartment/condominium": "CONDO",
  "apartment": "CONDO",
  // -- townhouse-shaped (single dwelling unit; see comment above) --
  "townhouse": "SFR",
  "attached": "SFR",
  "semi detached (half duplex)": "SFR",
  "half duplex": "SFR",
  "semi detached": "SFR",
  "row / townhouse": "SFR",
  // -- other, from comparables.ts TYPE_MAP --
  "manufactured home": "OTHER",
  // -- multi-unit vocabulary Obie distinguishes explicitly --
  "duplex": "DUPLEX",
  "triplex": "TRIPLEX",
  "fourplex": "QUADPLEX",
  "quadplex": "QUADPLEX",
  "quad": "QUADPLEX",
  "multi family": "APARTMENT_BUILDING",
  "apartment building": "APARTMENT_BUILDING",
};

/** Dwelling-type categories that count as "generic/unknown" for the
 *  purposes of unitCount refinement below — see toObieDwellingType's
 *  precedence comment. */
const GENERIC_DWELLING_TYPES: ReadonlySet<ObieDwellingType> = new Set(["SFR", "OTHER"]);

function unitCountOverride(unitCount: number): ObieDwellingType | null {
  if (unitCount === 2) return "DUPLEX";
  if (unitCount === 3) return "TRIPLEX";
  if (unitCount === 4) return "QUADPLEX";
  if (unitCount >= 5) return "APARTMENT_BUILDING";
  // unitCount 0 or 1: no override — see precedence comment on
  // toObieDwellingType. In particular, unitCount === 1 must never be read
  // as "therefore single-family": it's simply not one of the multi-unit
  // signals this override reacts to.
  return null;
}

/**
 * Maps our property-type data (plus, optionally, a known unit count) to
 * Obie's dwelling-type enum. Never throws — OTHER is the deliberate
 * escape hatch for anything unrecognized, since this is a best-effort
 * pre-fill the user reviews before submission, not a validated field.
 *
 * Precedence (highest to lowest):
 *   1. normalizedType, if it's one of our known normalized values
 *      ("SFH" | "Condo" | "Townhouse" | "Other") — already the output of
 *      our own canonical normalizePropertyType() pipeline, so it's more
 *      trustworthy than a raw string when both are supplied.
 *   2. rawType, case-insensitive/trimmed, against the extended vocabulary
 *      above.
 *   3. OTHER, if neither is recognized.
 *
 *   Then: unitCount refinement. A known integer unitCount can OVERRIDE
 *   the result of steps 1-3, but only when that result is "generic" —
 *   defined here as SFR or OTHER. It never overrides CONDO, or an
 *   already-specific multi-unit category (DUPLEX/TRIPLEX/QUADPLEX/
 *   APARTMENT_BUILDING) derived from an explicit raw string. This is
 *   deliberate: a condo unit's insurance risk profile doesn't change
 *   because the building it's in has many units, and unitCount === 1
 *   must not be allowed to downgrade an explicit CONDO to SFR (there is
 *   no rule mapping unitCount 1 to SFR at all — see unitCountOverride).
 *   The refinement exists for the common real-world case where source
 *   data types a legal duplex/triplex as a generic "detached"/"single
 *   family" record and only unitCount reveals the true configuration.
 */
export function toObieDwellingType(input: {
  normalizedType?: string | null;
  rawType?: string | null;
  unitCount?: number | null;
}): ObieDwellingType {
  const { normalizedType, rawType, unitCount } = input;

  let base: ObieDwellingType = "OTHER";
  if (normalizedType && normalizedType in NORMALIZED_TYPE_MAP) {
    base = NORMALIZED_TYPE_MAP[normalizedType];
  } else if (rawType) {
    const key = rawType.toLowerCase().trim();
    base = RAW_TYPE_MAP[key] ?? "OTHER";
  }

  if (
    typeof unitCount === "number" &&
    Number.isInteger(unitCount) &&
    unitCount >= 0 &&
    GENERIC_DWELLING_TYPES.has(base)
  ) {
    const override = unitCountOverride(unitCount);
    if (override) return override;
  }

  return base;
}

// ---------------------------------------------------------------------------
// 2. Rent unit conversion (monthly -> annual)
// ---------------------------------------------------------------------------

/**
 * Thrown for invalid input to the rent-conversion helpers below. Kept
 * distinct (rather than a plain Error) so a future call site can
 * recognize a mapping-input problem rather than an unrelated failure,
 * mirroring the `insurance-a1:` prefix convention used elsewhere in
 * src/lib/insurance/domain — this integration uses `insurance-obie:`.
 */
export class ObiePrefillMappingError extends Error {
  constructor(message: string) {
    super(`insurance-obie: ${message}`);
    this.name = "ObiePrefillMappingError";
  }
}

/**
 * Branded rent figures, monthly vs. annual, so the two units cannot be
 * confused at the type level (a bare `estimatedRent * 12` is a silent
 * 12x-if-you-forget bug risk this brand is designed to prevent).
 *
 * Deliberately currency-neutral naming (not "...Cad" / "...Usd"): this
 * module converts a TIME UNIT (monthly -> annual), not a currency. Our
 * own estimatedRent may be CAD (BC listings) or USD (US expansion), while
 * Obie's lossOfRent field is USD. Baking "Cad" into the brand would be
 * actively misleading for a US-sourced value flowing through the exact
 * same function. Any CAD<->USD conversion is a separate, explicit concern
 * (needs an exchange rate and an as-of date) that must happen — if it
 * ever needs to — outside this module, not silently folded into a
 * unit-of-time brand.
 */
export type MonthlyRent = number & { readonly __brand: "MonthlyRent" };
export type AnnualLossOfRent = number & { readonly __brand: "AnnualLossOfRent" };

/**
 * Validates and brands a monthly rent figure. Zero is a valid rent
 * (vacant/non-income unit); NaN, Infinity/-Infinity, and negative values
 * are rejected as thrown errors — these indicate an upstream bug, not a
 * legitimate "no data" state (that's represented as `null`, handled by
 * monthlyRentToAnnual below, never as a sentinel numeric value here).
 */
export function asMonthlyRent(value: number): MonthlyRent {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new ObiePrefillMappingError("monthly rent must be a number, got NaN");
  }
  if (!Number.isFinite(value)) {
    throw new ObiePrefillMappingError("monthly rent must be finite");
  }
  if (value < 0) {
    throw new ObiePrefillMappingError("monthly rent must not be negative");
  }
  return value as MonthlyRent;
}

/**
 * Converts a branded monthly rent to Obie's annual lossOfRent figure.
 * Rounded to the nearest whole currency unit (nearest dollar) — Obie's
 * field is a coverage-limit-shaped input, not a precise accounting value,
 * and every other money figure in this codebase's prefill layer
 * (formatMoney in src/components/insurance/coverage-prefill.ts) is
 * likewise rounded to whole units for display, so this keeps rounding
 * behavior consistent with the rest of the pre-fill pipeline.
 */
export function toAnnualLossOfRent(monthly: MonthlyRent): AnnualLossOfRent {
  return Math.round(monthly * 12) as AnnualLossOfRent;
}

/**
 * Null-safe convenience wrapper for call sites that hold a plain
 * `number | null | undefined` (e.g. CoverageProfileProperty.value.estimatedRent)
 * and don't want to thread the branded types through themselves. Returns
 * null straight through for null/undefined (an absent estimate stays
 * absent — never coerced to 0). Any other value is routed through the
 * validated `asMonthlyRent` -> `toAnnualLossOfRent` path, so it still
 * throws on NaN/Infinity/negative input exactly as the branded functions
 * do — only the null/undefined case is treated specially here.
 */
export function monthlyRentToAnnual(monthly: number | null | undefined): number | null {
  if (monthly === null || monthly === undefined) return null;
  return toAnnualLossOfRent(asMonthlyRent(monthly));
}

// ---------------------------------------------------------------------------
// 3. Name splitting
// ---------------------------------------------------------------------------

/**
 * Splits a combined contact name into Obie's separate firstName/lastName
 * fields. Never throws — a mis-split first/last name pair is a UI
 * annoyance the user corrects on Obie's own form, not a validation
 * failure worth blocking a pre-fill over.
 *
 * Precedence (highest to lowest):
 *   1. Clerk's own first/last name fields, when BOTH are present and
 *      non-empty (after trimming). Clerk is the authoritative identity
 *      source for a signed-in user — it already asked the user for these
 *      as separate fields, so there's no splitting ambiguity to resolve.
 *      Used verbatim (trimmed only), not further parsed.
 *   2. Otherwise, split `fullName` on whitespace: the first token is
 *      firstName, every remaining token is joined with a single space to
 *      form lastName. A single-token name yields firstName only
 *      (lastName null) rather than guessing a last name exists.
 *   3. Otherwise (empty/null input, no Clerk names, no fullName): both
 *      null.
 *
 * Deliberate non-goal: this function does NOT parse suffixes (Jr., III),
 * prefixes/particles (van, de la, Mc), or multi-word surnames beyond
 * "everything after the first token." Any such heuristic is a guess that
 * is sometimes wrong while *looking* confident and specific — which is
 * worse for a pre-fill than a plainly-naive split, because a wrong-but-
 * plausible guess is easier for a distracted user to miss and rubber-
 * stamp than an obviously-blunt one. The user reviews and can correct
 * either field in Obie's own form before it's submitted, so simplicity
 * here is a feature, not a shortcut.
 */
export function splitPersonName(input: {
  fullName?: string | null;
  clerkFirstName?: string | null;
  clerkLastName?: string | null;
}): { firstName: string | null; lastName: string | null } {
  const clerkFirst = input.clerkFirstName?.trim() || "";
  const clerkLast = input.clerkLastName?.trim() || "";
  if (clerkFirst && clerkLast) {
    return { firstName: clerkFirst, lastName: clerkLast };
  }

  const full = input.fullName?.trim() ?? "";
  if (!full) return { firstName: null, lastName: null };

  const tokens = full.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { firstName: null, lastName: null };
  if (tokens.length === 1) return { firstName: tokens[0], lastName: null };

  const [firstName, ...rest] = tokens;
  return { firstName, lastName: rest.join(" ") };
}
