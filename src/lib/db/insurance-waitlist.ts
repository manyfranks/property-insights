/**
 * db/insurance-waitlist.ts
 *
 * Persistence for the /insurance landing page's waitlist mode: entered when
 * either the intake flag is off or the visitor's region isn't "live" yet
 * (src/config/insurance-rollout.ts). Distinct from coverage_profiles — no
 * property confirmation, no underwriting questions, no consent-to-broker-
 * handoff; just "notify me when this opens," so the schema is much thinner.
 *
 * Follows the same conventions as src/lib/db/coverage-profiles.ts:
 * validation throws with clear messages (fail loud — a malformed row must
 * never be silently dropped or half-written), and the API route turns a
 * thrown error into a 400.
 */

import { randomUUID } from "node:crypto";
import { dbAvailable, sql } from "@/lib/db";
import type { Country, InsuranceLine } from "@/config/affiliate-vendors";

const COUNTRIES: Country[] = ["US", "CA"];
const LINES: InsuranceLine[] = ["homeowner", "landlord", "tenant", "strata", "commercial"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface CreateWaitlistEntryInput {
  email: string;
  country: Country;
  region: string;
  /** Optional — the visitor may join before picking a coverage line. */
  line?: InsuranceLine | null;
  /** Optional — the visitor may join before typing/selecting an address. */
  address?: string | null;
}

export interface WaitlistEntry {
  id: string;
  createdAt: string;
}

interface WaitlistRow {
  id: string;
  created_at: string | Date;
}

function requireEmail(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("email is required");
  }
  const trimmed = value.trim();
  if (trimmed.length > 254 || !EMAIL_RE.test(trimmed)) {
    throw new Error("email is invalid");
  }
  return trimmed;
}

function optionalString(value: unknown, label: string, maxLen: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error(`${label} must be a string or null`);
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > maxLen) throw new Error(`${label} exceeds maximum length of ${maxLen}`);
  return trimmed;
}

/** Throws on any validation failure — used by the API route so a bad
 *  payload never reaches the insert. */
export async function createWaitlistEntry(input: CreateWaitlistEntryInput): Promise<WaitlistEntry> {
  if (!dbAvailable()) throw new Error("DATABASE_URL not set — cannot persist waitlist entry");

  const email = requireEmail(input.email);
  if (!COUNTRIES.includes(input.country)) {
    throw new Error(`country must be one of: ${COUNTRIES.join(", ")}`);
  }
  const region = optionalString(input.region, "region", 10)?.toUpperCase();
  if (!region) throw new Error("region is required");
  let line: InsuranceLine | null = null;
  if (input.line !== null && input.line !== undefined) {
    if (!LINES.includes(input.line)) throw new Error(`line must be one of: ${LINES.join(", ")}`);
    line = input.line;
  }
  const address = optionalString(input.address, "address", 300);

  const id = randomUUID();
  const db = sql();
  const rows = (await db`
    INSERT INTO insurance_waitlist (id, email, country, region, line, address)
    VALUES (${id}, ${email}, ${input.country}, ${region}, ${line}, ${address})
    RETURNING id, created_at
  `) as WaitlistRow[];

  const row = rows[0];
  if (!row) throw new Error("insurance_waitlist insert returned no row");
  return { id: row.id, createdAt: new Date(row.created_at).toISOString() };
}
