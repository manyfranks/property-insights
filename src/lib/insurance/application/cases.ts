import { randomUUID } from "node:crypto";
import { dbAvailable, sql } from "@/lib/db";
import {
  validateCoverageProfileInput,
  insertCoverageProfileRow,
  CoverageProfileValidationError,
  type CreateCoverageProfileInput,
  type CoverageProfileAnswers,
  type CoverageProfileProperty,
} from "@/lib/db/coverage-profiles";
import type { CounterpartyRole } from "@/config/affiliate-vendors";
import type { RequestedKernelExecutionMode } from "@/config/insurance-kernel/execution-mode";
import { assertIdempotencyKey, hashAccessToken, sha256, type SubmissionAnswer } from "@/lib/insurance/domain/submission";

export const A1_ACCESS_TTL_SECONDS = 60 * 60 * 24 * 30;
export const A1_CONSENT_VERSION = "coverage-profile-consent-v1";
export const A1_QUESTIONNAIRE_VERSION = "coverage-profile-v1";

export interface IntendedRecipient {
  counterpartyId: string;
  name: string;
  role: CounterpartyRole;
}

export interface CreateFinalizedCoverageCaseInput extends CreateCoverageProfileInput {
  executionMode: RequestedKernelExecutionMode;
  idempotencyKey: string;
  accessToken: string;
  intendedRecipients: IntendedRecipient[];
}

export interface CreatedCoverageCase {
  profileId: string;
  caseId: string;
  submissionId: string;
  submissionVersion: number;
  createdAt: string;
  /** False on an idempotent replay (a findExisting hit, including the
   *  concurrent-race fallback below) — true only the one time this case is
   *  actually created. The route must not repeat create-only side effects
   *  (the operator notification email) on a replay. */
  newlyCreated: boolean;
}

interface ExistingCaseRow {
  case_id: string;
  profile_id: string;
  submission_id: string;
  submission_version: number;
  created_at: string | Date;
  access_token_hash: string | null;
}

/**
 * Validates everything createCoverageProfile's compatibility row needs
 * (delegated to the shared validateCoverageProfileInput — F10) plus the
 * two case-specific capability fields. A malformed idempotency key or
 * access token here is still a client validation failure (400) even though
 * the route-level fallback (F2) already filters out the common case of a
 * missing/malformed pair — this is the defense-in-depth path for anything
 * that gets this far with a non-empty but still-invalid token.
 */
function validateBaseInput(input: CreateFinalizedCoverageCaseInput) {
  if (!dbAvailable()) throw new Error("DATABASE_URL not set — cannot persist insurance case");
  const profile = validateCoverageProfileInput(input);
  let accessTokenHash: string;
  try {
    assertIdempotencyKey(input.idempotencyKey);
    accessTokenHash = hashAccessToken(input.accessToken);
  } catch (err) {
    throw new CoverageProfileValidationError(
      err instanceof Error ? err.message : "invalid idempotency key or access token"
    );
  }
  return { ...profile, accessTokenHash };
}

function fieldAnswers(property: CoverageProfileProperty, answers: CoverageProfileAnswers, address: string): SubmissionAnswer[] {
  const output: SubmissionAnswer[] = [];
  const add = (
    questionKey: string,
    value: unknown,
    origin: SubmissionAnswer["origin"],
    answerKind: SubmissionAnswer["answerKind"],
    sourceReference: string
  ) => output.push({ id: randomUUID(), questionKey, value, origin, answerKind, sourceReference });
  const originFor = (source: "known" | "modeled") => source === "modeled" ? "MODEL_HINT" as const : "ASSESSMENT" as const;

  add("property.address", address, "LISTING", "EVIDENCE", "coverage-profile:address");
  for (const [key, value] of Object.entries(property.identity)) {
    if (key !== "source") add(`property.identity.${key}`, value, originFor(property.identity.source), "EVIDENCE", `coverage-profile:identity:${property.identity.source}`);
  }
  for (const [key, value] of Object.entries(property.value)) {
    if (key !== "source") add(`property.value.${key}`, value, originFor(property.value.source), "EVIDENCE", `coverage-profile:value:${property.value.source}`);
  }
  for (const [key, value] of Object.entries(property.hazards)) {
    if (key !== "source") add(`property.hazards.${key}`, value, originFor(property.hazards.source), "EVIDENCE", `coverage-profile:hazards:${property.hazards.source}`);
  }
  add("insurance.occupancy", answers.occupancy, "USER", "ATTESTATION", "coverage-profile:user");
  add("insurance.unit_count", answers.unitCount, "USER", "ATTESTATION", "coverage-profile:user");
  add("insurance.claims_5yr", answers.claims5yr, "USER", "ATTESTATION", "coverage-profile:user");
  add("insurance.coverage_expiry", answers.coverageExpiry, "USER", "ATTESTATION", "coverage-profile:user");
  add("property.roof_age", answers.roofAge, "USER", "ATTESTATION", "coverage-profile:user");
  add("contact.name", answers.contact.name, "USER", "ATTESTATION", "coverage-profile:user");
  add("contact.email", answers.contact.email, "USER", "ATTESTATION", "coverage-profile:user");
  add("contact.phone", answers.contact.phone, "USER", "ATTESTATION", "coverage-profile:user");
  add("contact.preference", answers.contact.preference, "USER", "ATTESTATION", "coverage-profile:user");
  return output;
}

async function findExisting(idempotencyKey: string, accessTokenHash: string): Promise<CreatedCoverageCase | null> {
  const db = sql();
  const rows = (await db`
    SELECT c.id AS case_id, c.legacy_coverage_profile_id AS profile_id,
      s.id AS submission_id, s.version AS submission_version,
      c.created_at, c.access_token_hash
    FROM insurance_cases c
    JOIN insurance_submissions s ON s.case_id = c.id AND s.version = 1
    WHERE c.idempotency_key = ${idempotencyKey}
    LIMIT 1
  `) as ExistingCaseRow[];
  const row = rows[0];
  if (!row) return null;
  if (row.access_token_hash !== accessTokenHash) {
    throw new CoverageProfileValidationError("insurance-a1: idempotency key was already used by another capability");
  }
  return {
    profileId: row.profile_id,
    caseId: row.case_id,
    submissionId: row.submission_id,
    submissionVersion: row.submission_version,
    createdAt: new Date(row.created_at).toISOString(),
    newlyCreated: false,
  };
}

/**
 * Atomically preserves the legacy affiliate row and creates A1's canonical,
 * finalized version. It never creates a delivery, review, quote, or provider state.
 */
export async function createFinalizedCoverageCase(
  input: CreateFinalizedCoverageCaseInput
): Promise<CreatedCoverageCase> {
  const validated = validateBaseInput(input);
  const existing = await findExisting(input.idempotencyKey, validated.accessTokenHash);
  if (existing) return existing;

  const profileId = randomUUID();
  const caseId = randomUUID();
  const partyId = randomUUID();
  const consentId = randomUUID();
  const submissionId = randomUUID();
  const correlationId = input.idempotencyKey;
  const answerRows = fieldAnswers(validated.property, validated.answers, validated.address);
  const fieldScope = [
    "case.country",
    "case.region",
    "insurance.line",
    ...answerRows.map((answer) => answer.questionKey),
  ];
  const accessExpiresAt = new Date(Date.now() + A1_ACCESS_TTL_SECONDS * 1000).toISOString();
  const finalizedHash = sha256(JSON.stringify(answerRows.map(({ questionKey, value, origin, answerKind }) => ({ questionKey, value, origin, answerKind }))));
  const db = sql();

  try {
    await db.transaction((tx) => [
      // F10: shared with the legacy path (src/lib/db/coverage-profiles.ts)
      // so the compatibility row's column list can't drift between the two
      // write paths.
      insertCoverageProfileRow(tx, profileId, validated),
      tx`INSERT INTO insurance_cases (
        id, execution_mode, status, owner_user_id, legacy_coverage_profile_id,
        idempotency_key, country, region, insurance_line, access_token_hash, access_token_expires_at
      ) VALUES (
        ${caseId}, ${input.executionMode}, 'DRAFT', ${validated.userId}, ${profileId},
        ${input.idempotencyKey}, ${validated.country}, ${validated.region}, ${input.line},
        ${validated.accessTokenHash}, ${accessExpiresAt}
      )`,
      tx`INSERT INTO insurance_parties (id, kind, display_name, email, phone)
        VALUES (${partyId}, 'PERSON', ${validated.answers.contact.name}, ${validated.answers.contact.email}, ${validated.answers.contact.phone})`,
      tx`INSERT INTO insurance_case_parties (case_id, party_id, role)
        VALUES (${caseId}, ${partyId}, 'APPLICANT'), (${caseId}, ${partyId}, 'INSURED'), (${caseId}, ${partyId}, 'CONTACT')`,
      tx`INSERT INTO insurance_consent_artifacts (
        id, case_id, version, language, purpose, exact_text, intended_recipients, field_scope, granted_at
      ) VALUES (
        ${consentId}, ${caseId}, ${A1_CONSENT_VERSION}, ${validated.country === "CA" ? "en-CA" : "en-US"}, 'save coverage profile and record intended referral recipients',
        ${validated.consentText}, ${JSON.stringify(input.intendedRecipients)}, ${JSON.stringify(fieldScope)}, NOW()
      )`,
      tx`INSERT INTO insurance_submissions (
        id, case_id, version, status, questionnaire_version, idempotency_key, consent_artifact_id
      ) VALUES (${submissionId}, ${caseId}, 1, 'DRAFT', ${A1_QUESTIONNAIRE_VERSION}, ${input.idempotencyKey}, ${consentId})`,
      ...answerRows.map((answer) => tx`INSERT INTO insurance_submission_answers (
        id, submission_id, question_key, answer_kind, value, origin, source_reference, corrects_answer_id
      ) VALUES (
        ${answer.id}, ${submissionId}, ${answer.questionKey}, ${answer.answerKind}, ${JSON.stringify(answer.value)},
        ${answer.origin}, ${answer.sourceReference ?? null}, ${answer.correctsAnswerId ?? null}
      )`),
      tx`UPDATE insurance_submissions SET status = 'READY', finalized_at = NOW(), updated_at = NOW() WHERE id = ${submissionId}`,
      tx`UPDATE insurance_cases SET status = 'READY_FOR_SUBMISSION', updated_at = NOW() WHERE id = ${caseId}`,
      tx`INSERT INTO insurance_case_timeline_events (
        id, case_id, event_type, from_state, to_state, actor_type, actor_id, correlation_id, details
      ) VALUES (
        ${randomUUID()}, ${caseId}, 'CASE_CREATED', NULL, 'DRAFT', 'CUSTOMER', ${validated.userId}, ${correlationId}, '{}'
      ), (
        ${randomUUID()}, ${caseId}, 'PROFILE_FINALIZED', 'DRAFT', 'READY_FOR_SUBMISSION', 'CUSTOMER', ${validated.userId}, ${correlationId},
        ${JSON.stringify({ submissionVersion: 1 })}
      )`,
      tx`INSERT INTO insurance_audit_events (
        id, case_id, event_type, actor_type, actor_id, correlation_id, subject_type, subject_id, after_hash, metadata
      ) VALUES (
        ${randomUUID()}, ${caseId}, 'CONSENT_RECORDED', 'CUSTOMER', ${validated.userId}, ${correlationId}, 'CONSENT_ARTIFACT', ${consentId},
        ${sha256(validated.consentText)}, ${JSON.stringify({ consentVersion: A1_CONSENT_VERSION })}
      ), (
        ${randomUUID()}, ${caseId}, 'SUBMISSION_FINALIZED', 'CUSTOMER', ${validated.userId}, ${correlationId}, 'SUBMISSION', ${submissionId},
        ${finalizedHash}, ${JSON.stringify({ submissionVersion: 1, providerDelivery: false })}
      )`,
    ]);
  } catch (error) {
    // A concurrent retry can win the unique idempotency race. The losing
    // transaction is fully rolled back; return the original only when the
    // caller proves possession of the same capability token.
    const raced = await findExisting(input.idempotencyKey, validated.accessTokenHash);
    if (raced) return raced;
    throw error;
  }

  return { profileId, caseId, submissionId, submissionVersion: 1, createdAt: new Date().toISOString(), newlyCreated: true };
}

export interface CaseStatusView {
  caseId: string;
  status: "DRAFT" | "COLLECTING_FACTS" | "READY_FOR_SUBMISSION";
  submissionVersion: number | null;
  updatedAt: string;
}

interface CaseStatusRow {
  id: string;
  status: CaseStatusView["status"] | "WITHDRAWN";
  submission_version: number | null;
  updated_at: string | Date;
}

export async function readCaseStatusByAccessToken(accessToken: string): Promise<CaseStatusView | null> {
  if (!dbAvailable()) return null;
  const tokenHash = hashAccessToken(accessToken);
  const db = sql();
  const rows = (await db`
    SELECT c.id, c.status, MAX(s.version)::int AS submission_version, c.updated_at
    FROM insurance_cases c
    LEFT JOIN insurance_submissions s ON s.case_id = c.id
    WHERE c.access_token_hash = ${tokenHash}
      AND c.access_token_revoked_at IS NULL
      AND c.access_token_expires_at > NOW()
      AND c.status <> 'WITHDRAWN'
    GROUP BY c.id
    LIMIT 1
  `) as CaseStatusRow[];
  const row = rows[0];
  if (!row || row.status === "WITHDRAWN") return null;
  return {
    caseId: row.id,
    status: row.status,
    submissionVersion: row.submission_version,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}
