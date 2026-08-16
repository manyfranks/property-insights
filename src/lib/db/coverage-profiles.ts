/**
 * db/coverage-profiles.ts
 *
 * Persistence for Stage 2 of the insurance path (see
 * docs/proposals/insurance-distribution-proposal.html, "Stages" + "seam"
 * sections): the user confirms pre-filled property data, answers ~6
 * questions only they can answer, and consents. The stored profile row is
 * distinct from the affiliate click log in partner-clicks.ts. Its optional
 * vendor_id is legacy affiliate click attribution only: it does not record
 * profile delivery, broker-of-record appointment, or provider activity.
 *
 * Ships stage-gated behind NEXT_PUBLIC_INSURANCE_STAGE reaching "intake" —
 * see stageAtLeast("intake") in src/config/insurance-stage.ts and the API
 * route, which 404s below that stage. Affiliate navigation remains separate
 * from this persistence path. This module does not transmit a profile or
 * consented data to a partner.
 *
 * Validation throws with clear messages (fail loud — a malformed or
 * unconsented profile must never be silently dropped or half-written). The
 * API route turns a thrown error into a 400.
 */

import { randomUUID } from "node:crypto";
import type { NeonQueryFunction, NeonQueryFunctionInTransaction } from "@neondatabase/serverless";
import { dbAvailable, sql } from "@/lib/db";
import type { AffiliateSource, Country, InsuranceLine } from "@/config/affiliate-vendors";

/**
 * Thrown for every expected client-input validation failure below (bad
 * shape, out-of-range value, unconsented submission, mismatched idempotency
 * key/token, etc). Kept as a distinct class — rather than a plain Error —
 * so callers (src/app/api/coverage-profile/route.ts) can classify a
 * `catch` by type (400, safe message) instead of string-matching on driver
 * internals, and so anything that ISN'T this class (a missing table, a DB
 * outage, an unexpected exception) falls through to a generic 500 with the
 * raw error logged server-side only. Still `instanceof Error`, so existing
 * `err instanceof Error ? err.message : ...` call sites are unaffected.
 */
export class CoverageProfileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoverageProfileValidationError";
  }
}

export type CoverageFieldSource = "known" | "modeled";
export type CoverageOccupancy =
  | "owner"
  | "long_term_rental"
  | "short_term_rental"
  | "vacant"
  | "strata_corp";
export type ContactPreference = "email" | "phone" | "either";

/** Prefilled snapshot handed to the user for confirmation. Each field group
 *  carries its own `source` — "known" when it comes from our own listing /
 *  assessment data, "modeled" when it's an estimate (e.g. RentCast AVM,
 *  regional-econ fallback) — so the confirmation UI and the partner both
 *  know which numbers are authoritative vs. inferred. */
export interface CoverageProfileProperty {
  identity: {
    type: string;
    yearBuilt: number | null;
    beds: number | null;
    baths: number | null;
    sqft: number | null;
    source: CoverageFieldSource;
  };
  value: {
    estimatedValue: number | null;
    estimatedRent: number | null;
    source: CoverageFieldSource;
  };
  hazards: {
    flood: number | null;
    wildfire: number | null;
    wind: number | null;
    source: CoverageFieldSource;
  };
}

/** The ~6 questions only the user can answer. */
export interface CoverageProfileAnswers {
  occupancy: CoverageOccupancy;
  unitCount: number;
  claims5yr: number;
  coverageExpiry: string | null; // ISO date (YYYY-MM-DD), null if unknown/none
  roofAge: number | null;
  contact: {
    name: string;
    email: string | null;
    phone: string | null;
    preference: ContactPreference;
  };
}

export interface CreateCoverageProfileInput {
  /** Clerk user id, or null when signed out / opted out of sale-share. */
  userId: string | null;
  country: Country;
  region: string;
  address: string;
  line: InsuranceLine;
  /** Raw, not-yet-validated payload — validated by validateCoverageProperty() inside createCoverageProfile(). */
  property: unknown;
  /** Raw, not-yet-validated payload — validated by validateCoverageAnswers() inside createCoverageProfile(). */
  answers: unknown;
  consent: boolean;
  consentText: string;
  source?: AffiliateSource | null;
}

export interface CoverageProfile {
  id: string;
  createdAt: string;
}

interface CoverageProfileRow {
  id: string;
  created_at: string | Date;
}

const COUNTRIES: Country[] = ["US", "CA"];
const LINES: InsuranceLine[] = ["homeowner", "landlord", "tenant", "strata", "commercial"];
const OCCUPANCIES: CoverageOccupancy[] = [
  "owner",
  "long_term_rental",
  "short_term_rental",
  "vacant",
  "strata_corp",
];
const CONTACT_PREFERENCES: ContactPreference[] = ["email", "phone", "either"];
const FIELD_SOURCES: CoverageFieldSource[] = ["known", "modeled"];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Same UUID shape as user-assessments.ts's ASSESSMENT_ID. */
const COVERAGE_PROFILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isCoverageProfileId(value: unknown): value is string {
  return typeof value === "string" && COVERAGE_PROFILE_ID.test(value);
}

function requireString(value: unknown, label: string, maxLen: number): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new CoverageProfileValidationError(`${label} is required`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLen) {
    throw new CoverageProfileValidationError(`${label} exceeds maximum length of ${maxLen}`);
  }
  return trimmed;
}

function requireNullableNumber(value: unknown, label: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new CoverageProfileValidationError(`${label} must be a number or null`);
  }
  return value;
}

function requireFieldSource(value: unknown, label: string): CoverageFieldSource {
  if (typeof value !== "string" || !FIELD_SOURCES.includes(value as CoverageFieldSource)) {
    throw new CoverageProfileValidationError(`${label}.source must be one of: ${FIELD_SOURCES.join(", ")}`);
  }
  return value as CoverageFieldSource;
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CoverageProfileValidationError(`${label} is required`);
  }
  return value as Record<string, unknown>;
}

export function validateCoverageProperty(input: unknown): CoverageProfileProperty {
  const raw = requireObject(input, "property");

  const identityRaw = requireObject(raw.identity, "property.identity");
  const identity = {
    type: requireString(identityRaw.type, "property.identity.type", 40),
    yearBuilt: requireNullableNumber(identityRaw.yearBuilt, "property.identity.yearBuilt"),
    beds: requireNullableNumber(identityRaw.beds, "property.identity.beds"),
    baths: requireNullableNumber(identityRaw.baths, "property.identity.baths"),
    sqft: requireNullableNumber(identityRaw.sqft, "property.identity.sqft"),
    source: requireFieldSource(identityRaw.source, "property.identity"),
  };

  const valueRaw = requireObject(raw.value, "property.value");
  const value = {
    estimatedValue: requireNullableNumber(valueRaw.estimatedValue, "property.value.estimatedValue"),
    estimatedRent: requireNullableNumber(valueRaw.estimatedRent, "property.value.estimatedRent"),
    source: requireFieldSource(valueRaw.source, "property.value"),
  };

  const hazardsRaw = requireObject(raw.hazards, "property.hazards");
  const hazards = {
    flood: requireNullableNumber(hazardsRaw.flood, "property.hazards.flood"),
    wildfire: requireNullableNumber(hazardsRaw.wildfire, "property.hazards.wildfire"),
    wind: requireNullableNumber(hazardsRaw.wind, "property.hazards.wind"),
    source: requireFieldSource(hazardsRaw.source, "property.hazards"),
  };

  return { identity, value, hazards };
}

export function validateCoverageAnswers(input: unknown): CoverageProfileAnswers {
  const raw = requireObject(input, "answers");

  if (typeof raw.occupancy !== "string" || !OCCUPANCIES.includes(raw.occupancy as CoverageOccupancy)) {
    throw new CoverageProfileValidationError(`answers.occupancy must be one of: ${OCCUPANCIES.join(", ")}`);
  }
  if (
    typeof raw.unitCount !== "number" ||
    !Number.isInteger(raw.unitCount) ||
    raw.unitCount < 0 ||
    raw.unitCount > 500
  ) {
    throw new CoverageProfileValidationError("answers.unitCount must be a non-negative integer");
  }
  if (
    typeof raw.claims5yr !== "number" ||
    !Number.isInteger(raw.claims5yr) ||
    raw.claims5yr < 0 ||
    raw.claims5yr > 50
  ) {
    throw new CoverageProfileValidationError("answers.claims5yr must be a non-negative integer");
  }

  let coverageExpiry: string | null = null;
  if (raw.coverageExpiry !== null && raw.coverageExpiry !== undefined) {
    if (typeof raw.coverageExpiry !== "string" || !ISO_DATE_RE.test(raw.coverageExpiry)) {
      throw new CoverageProfileValidationError("answers.coverageExpiry must be an ISO date (YYYY-MM-DD) or null");
    }
    coverageExpiry = raw.coverageExpiry;
  }

  const roofAge = requireNullableNumber(raw.roofAge, "answers.roofAge");
  if (roofAge !== null && (roofAge < 0 || roofAge > 200)) {
    throw new CoverageProfileValidationError("answers.roofAge is out of range");
  }

  const contactRaw = requireObject(raw.contact, "answers.contact");
  const name = requireString(contactRaw.name, "answers.contact.name", 120);
  if (
    typeof contactRaw.preference !== "string" ||
    !CONTACT_PREFERENCES.includes(contactRaw.preference as ContactPreference)
  ) {
    throw new CoverageProfileValidationError(`answers.contact.preference must be one of: ${CONTACT_PREFERENCES.join(", ")}`);
  }

  let email: string | null = null;
  if (contactRaw.email !== null && contactRaw.email !== undefined) {
    if (
      typeof contactRaw.email !== "string" ||
      contactRaw.email.length > 254 ||
      !EMAIL_RE.test(contactRaw.email)
    ) {
      throw new CoverageProfileValidationError("answers.contact.email is invalid");
    }
    email = contactRaw.email;
  }

  let phone: string | null = null;
  if (contactRaw.phone !== null && contactRaw.phone !== undefined) {
    if (
      typeof contactRaw.phone !== "string" ||
      contactRaw.phone.length > 30 ||
      contactRaw.phone.replace(/[^0-9]/g, "").length < 7
    ) {
      throw new CoverageProfileValidationError("answers.contact.phone is invalid");
    }
    phone = contactRaw.phone;
  }

  if (!email && !phone) {
    throw new CoverageProfileValidationError("answers.contact requires at least one of email or phone");
  }

  return {
    occupancy: raw.occupancy as CoverageOccupancy,
    unitCount: raw.unitCount,
    claims5yr: raw.claims5yr,
    coverageExpiry,
    roofAge,
    contact: { name, email, phone, preference: contactRaw.preference as ContactPreference },
  };
}

/** Fully validated, ready-to-insert shape of a coverage profile — the
 *  return of validateCoverageProfileInput() below. */
export interface ValidatedCoverageProfileInput {
  userId: string | null;
  country: Country;
  region: string;
  address: string;
  line: InsuranceLine;
  property: CoverageProfileProperty;
  answers: CoverageProfileAnswers;
  consentText: string;
  source: string | null;
}

/**
 * Validates a raw CreateCoverageProfileInput end to end — including
 * `consent !== true`, which the schema's CHECK constraint also enforces at
 * the data layer as a second line of defense. Throws
 * CoverageProfileValidationError on any failure.
 *
 * Shared by createCoverageProfile (legacy path, below) and the A1
 * dual-write path (src/lib/insurance/application/cases.ts) so the
 * compatibility `coverage_profiles` row's validation rules can't drift
 * between the two write paths.
 */
export function validateCoverageProfileInput(
  input: CreateCoverageProfileInput
): ValidatedCoverageProfileInput {
  if (!COUNTRIES.includes(input.country)) {
    throw new CoverageProfileValidationError(`country must be one of: ${COUNTRIES.join(", ")}`);
  }
  const region = requireString(input.region, "region", 10).toUpperCase();
  const address = requireString(input.address, "address", 300);
  if (!LINES.includes(input.line)) {
    throw new CoverageProfileValidationError(`line must be one of: ${LINES.join(", ")}`);
  }
  const property = validateCoverageProperty(input.property);
  const answers = validateCoverageAnswers(input.answers);
  if (input.consent !== true) {
    throw new CoverageProfileValidationError("consent must be explicitly true");
  }
  const consentText = requireString(input.consentText, "consentText", 4000);
  const source = input.source ? requireString(input.source, "source", 60) : null;
  const userId = input.userId ? requireString(input.userId, "userId", 200) : null;

  return { userId, country: input.country, region, address, line: input.line, property, answers, consentText, source };
}

/** Either a plain sql() client or the `tx` handle inside `.transaction()` —
 *  both share the same tagged-template call signature. `boolean, boolean`
 *  (not `false, false`) matches what `ReturnType<typeof neon>` actually
 *  resolves to for src/lib/db/index.ts's `sql()` (TS falls back to the
 *  generic's constraint, not its default, through ReturnType). */
export type CoverageProfileSqlExecutor =
  | NeonQueryFunction<boolean, boolean>
  | NeonQueryFunctionInTransaction<boolean, boolean>;

/**
 * Builds (and, outside a transaction, executes) the `coverage_profiles`
 * insert. Deliberately not `async` — a tagged-template call against the
 * neon driver returns a lazy, thenable query object; awaiting it here would
 * execute it immediately and break the A1 dual-write path, which needs to
 * return this un-awaited so it can be batched into `db.transaction(...)`
 * alongside the canonical-case inserts. The legacy path (createCoverageProfile
 * below) awaits the return value itself.
 *
 * Column list and insert semantics are exactly what createCoverageProfile
 * used to inline — preserved verbatim so the compatibility row's shape
 * can't drift between the legacy and dual-write paths (F10).
 */
export function insertCoverageProfileRow(
  executor: CoverageProfileSqlExecutor,
  id: string,
  profile: ValidatedCoverageProfileInput
) {
  return executor`
    INSERT INTO coverage_profiles (
      id, user_id, country, region, address, line, property, answers,
      consent, consent_text, consented_at, source
    ) VALUES (
      ${id}, ${profile.userId}, ${profile.country}, ${profile.region}, ${profile.address}, ${profile.line},
      ${JSON.stringify(profile.property)}, ${JSON.stringify(profile.answers)}, TRUE, ${profile.consentText}, NOW(), ${profile.source}
    )
    RETURNING id, created_at
  `;
}

/**
 * Insert a new coverage profile. Throws on any validation failure — see
 * validateCoverageProfileInput() above.
 */
export async function createCoverageProfile(
  input: CreateCoverageProfileInput
): Promise<CoverageProfile> {
  if (!dbAvailable()) throw new Error("DATABASE_URL not set — cannot persist coverage profile");

  const validated = validateCoverageProfileInput(input);
  const id = randomUUID();
  const db = sql();
  const rows = (await insertCoverageProfileRow(db, id, validated)) as CoverageProfileRow[];

  const row = rows[0];
  if (!row) throw new Error("coverage_profiles insert returned no row");
  return { id: row.id, createdAt: new Date(row.created_at).toISOString() };
}

/**
 * Records legacy affiliate click attribution (the registry id from
 * src/config/affiliate-vendors.ts) on a coverage profile. This is not a
 * delivery acknowledgement, licensed-partner handoff, broker-of-record
 * appointment, or reconciliation record for provider activity.
 *
 * First-write-wins: the UPDATE only matches a profile whose vendor_id is
 * still NULL, so a duplicate or replayed partner-connect click (the POST is
 * fire-and-forget over a plain `<a>` click, not idempotency-keyed) can't
 * overwrite an earlier, possibly-different stamp. Returns `false` — not an
 * error — when the profile doesn't exist, the id is malformed in a way that
 * still passed isCoverageProfileId (shouldn't happen), or it was already
 * stamped; callers that only want best-effort click attribution should treat
 * `false` as a silent no-op.
 */
export async function markProfileHandoff(id: string, vendorId: string): Promise<boolean> {
  if (!dbAvailable()) throw new Error("DATABASE_URL not set — cannot update coverage profile");
  if (!isCoverageProfileId(id)) throw new Error("Invalid coverage profile id");
  const vendor = requireString(vendorId, "vendorId", 60);

  const db = sql();
  const rows = (await db`
    UPDATE coverage_profiles
    SET vendor_id = ${vendor}
    WHERE id = ${id} AND vendor_id IS NULL
    RETURNING id
  `) as Array<{ id: string }>;
  return rows.length === 1;
}
