import { randomUUID } from "node:crypto";
import { dbAvailable, sql } from "@/lib/db";
import {
  validateCoverageAnswers,
  validateCoverageProperty,
  type CreateCoverageProfileInput,
  type CoverageProfileAnswers,
  type CoverageProfileProperty,
} from "@/lib/db/coverage-profiles";
import type { CounterpartyRole } from "@/config/affiliate-vendors";
import type { RequestedKernelExecutionMode } from "@/config/insurance-kernel/execution-mode";
import { assertAnswerProvenance, assertIdempotencyKey, hashAccessToken, sha256, type SubmissionAnswer } from "@/lib/insurance/domain/submission";

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
}

interface ExistingCaseRow {
  case_id: string;
  profile_id: string;
  submission_id: string;
  submission_version: number;
  created_at: string | Date;
  access_token_hash: string | null;
}

function requiredText(value: string | null | undefined, label: string, max: number): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(`${label} is required`);
  if (trimmed.length > max) throw new Error(`${label} exceeds maximum length of ${max}`);
  return trimmed;
}

function validateBaseInput(input: CreateFinalizedCoverageCaseInput) {
  if (!dbAvailable()) throw new Error("DATABASE_URL not set — cannot persist insurance case");
  if (!(["US", "CA"] as const).includes(input.country)) throw new Error("invalid country");
  if (!(["homeowner", "landlord", "tenant", "strata", "commercial"] as const).includes(input.line)) {
    throw new Error("invalid insurance line");
  }
  if (input.consent !== true) throw new Error("consent must be explicitly true");
  assertIdempotencyKey(input.idempotencyKey);
  const accessTokenHash = hashAccessToken(input.accessToken);
  const property = validateCoverageProperty(input.property);
  const answers = validateCoverageAnswers(input.answers);
  return {
    property,
    answers,
    accessTokenHash,
    country: input.country,
    region: requiredText(input.region, "region", 10).toUpperCase(),
    address: requiredText(input.address, "address", 300),
    consentText: requiredText(input.consentText, "consentText", 4000),
    source: input.source ? requiredText(input.source, "source", 60) : null,
    userId: input.userId ? requiredText(input.userId, "userId", 200) : null,
  };
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
    throw new Error("insurance-a1: idempotency key was already used by another capability");
  }
  return {
    profileId: row.profile_id,
    caseId: row.case_id,
    submissionId: row.submission_id,
    submissionVersion: row.submission_version,
    createdAt: new Date(row.created_at).toISOString(),
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
      tx`INSERT INTO coverage_profiles (
        id, user_id, country, region, address, line, property, answers,
        consent, consent_text, consented_at, source
      ) VALUES (
        ${profileId}, ${validated.userId}, ${validated.country}, ${validated.region}, ${validated.address}, ${input.line},
        ${JSON.stringify(validated.property)}, ${JSON.stringify(validated.answers)}, TRUE, ${validated.consentText}, NOW(), ${validated.source}
      )`,
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

  return { profileId, caseId, submissionId, submissionVersion: 1, createdAt: new Date().toISOString() };
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

export interface DraftSubmissionCommand {
  caseId: string;
  consentArtifactId: string;
  idempotencyKey: string;
  answers: SubmissionAnswer[];
  actorId: string | null;
}

interface SubmissionCommandRow { id: string; version: number; status: "DRAFT" | "READY" | "WITHDRAWN" }

export interface UpdateDraftAnswersCommand {
  caseId: string;
  submissionId: string;
  idempotencyKey: string;
  answers: SubmissionAnswer[];
  actorId: string | null;
}

/** Replace only a DRAFT's working set. Finalized evidence remains untouchable. */
export async function updateDraftSubmissionAnswers(command: UpdateDraftAnswersCommand): Promise<void> {
  assertIdempotencyKey(command.idempotencyKey);
  command.answers.forEach(assertAnswerProvenance);
  if (command.answers.some((answer) => answer.origin !== "USER")) {
    throw new Error("insurance-a1: customer updates may add attestations but cannot replace source evidence");
  }
  if (command.answers.length === 0) throw new Error("insurance-a1: draft answer set cannot be empty");
  const db = sql();
  const alreadyApplied = (await db`
    SELECT 1 FROM insurance_audit_events
    WHERE case_id = ${command.caseId} AND subject_id = ${command.submissionId}
      AND event_type = 'SUBMISSION_DRAFT_UPDATED' AND correlation_id = ${command.idempotencyKey}
  `) as unknown[];
  if (alreadyApplied[0]) return;
  const draft = (await db`
    SELECT id, version, status FROM insurance_submissions
    WHERE id = ${command.submissionId} AND case_id = ${command.caseId}
  `) as SubmissionCommandRow[];
  if (!draft[0] || draft[0].status !== "DRAFT") {
    throw new Error("insurance-a1: only a draft submission can be updated");
  }
  const afterHash = sha256(JSON.stringify(command.answers.map(({ questionKey, value, origin, answerKind, correctsAnswerId }) => ({
    questionKey, value, origin, answerKind, correctsAnswerId: correctsAnswerId ?? null,
  }))));
  try {
    await db.transaction((tx) => [
      tx`DELETE FROM insurance_submission_answers
        WHERE submission_id = ${command.submissionId} AND origin = 'USER'`,
      ...command.answers.map((answer) => tx`INSERT INTO insurance_submission_answers (
        id, submission_id, question_key, answer_kind, value, origin, source_reference, corrects_answer_id
      ) VALUES (
        ${answer.id}, ${command.submissionId}, ${answer.questionKey}, ${answer.answerKind}, ${JSON.stringify(answer.value)},
        ${answer.origin}, ${answer.sourceReference ?? null}, ${answer.correctsAnswerId ?? null}
      )`),
      tx`INSERT INTO insurance_case_timeline_events (
        id, case_id, event_type, actor_type, actor_id, correlation_id, details
      ) VALUES (
        ${randomUUID()}, ${command.caseId}, 'SUBMISSION_DRAFT_UPDATED', 'CUSTOMER', ${command.actorId},
        ${command.idempotencyKey}, ${JSON.stringify({ submissionVersion: draft[0].version })}
      )`,
      tx`INSERT INTO insurance_audit_events (
        id, case_id, event_type, actor_type, actor_id, correlation_id, subject_type, subject_id, after_hash, metadata
      ) VALUES (
        ${randomUUID()}, ${command.caseId}, 'SUBMISSION_DRAFT_UPDATED', 'CUSTOMER', ${command.actorId},
        ${command.idempotencyKey}, 'SUBMISSION', ${command.submissionId}, ${afterHash},
        ${JSON.stringify({ submissionVersion: draft[0].version })}
      )`,
    ]);
  } catch (error) {
    const raced = (await db`
      SELECT 1 FROM insurance_audit_events
      WHERE case_id = ${command.caseId} AND subject_id = ${command.submissionId}
        AND event_type = 'SUBMISSION_DRAFT_UPDATED' AND correlation_id = ${command.idempotencyKey}
    `) as unknown[];
    if (raced[0]) return;
    throw error;
  }
}

/** Editing a finalized profile always starts a new immutable version. */
export async function createDraftSubmissionVersion(command: DraftSubmissionCommand): Promise<SubmissionCommandRow> {
  assertIdempotencyKey(command.idempotencyKey);
  command.answers.forEach(assertAnswerProvenance);
  if (command.answers.some((answer) => answer.origin !== "USER")) {
    throw new Error("insurance-a1: customer amendments may add attestations but cannot replace source evidence");
  }
  const db = sql();
  const prior = (await db`
    SELECT id, version, status FROM insurance_submissions
    WHERE case_id = ${command.caseId} AND idempotency_key = ${command.idempotencyKey}
  `) as SubmissionCommandRow[];
  if (prior[0]) return prior[0];

  const latest = (await db`
    SELECT id, version, status FROM insurance_submissions
    WHERE case_id = ${command.caseId} ORDER BY version DESC LIMIT 1
  `) as SubmissionCommandRow[];
  if (!latest[0] || latest[0].status === "WITHDRAWN") throw new Error("insurance-a1: case has no amendable submission");
  const submissionId = randomUUID();
  const nextVersion = latest[0].version + 1;
  const sourceRows = (await db`
    SELECT question_key, answer_kind, value, origin, source_reference
    FROM insurance_submission_answers
    WHERE submission_id = ${latest[0].id} AND origin <> 'USER'
    ORDER BY question_key, origin, answer_kind
  `) as Array<{
    question_key: string;
    answer_kind: SubmissionAnswer["answerKind"];
    value: unknown;
    origin: SubmissionAnswer["origin"];
    source_reference: string | null;
  }>;
  const preservedEvidence: SubmissionAnswer[] = sourceRows.map((row) => ({
    id: randomUUID(),
    questionKey: row.question_key,
    answerKind: row.answer_kind,
    value: row.value,
    origin: row.origin,
    sourceReference: row.source_reference,
  }));
  const versionAnswers = [...preservedEvidence, ...command.answers];

  try {
    await db.transaction((tx) => [
      tx`INSERT INTO insurance_submissions (
        id, case_id, version, status, questionnaire_version, idempotency_key,
        consent_artifact_id, supersedes_submission_id
      ) VALUES (
        ${submissionId}, ${command.caseId}, ${nextVersion}, 'DRAFT', ${A1_QUESTIONNAIRE_VERSION},
        ${command.idempotencyKey}, ${command.consentArtifactId}, ${latest[0].id}
      )`,
      ...versionAnswers.map((answer) => tx`INSERT INTO insurance_submission_answers (
        id, submission_id, question_key, answer_kind, value, origin, source_reference, corrects_answer_id
      ) VALUES (
        ${answer.id}, ${submissionId}, ${answer.questionKey}, ${answer.answerKind}, ${JSON.stringify(answer.value)},
        ${answer.origin}, ${answer.sourceReference ?? null}, ${answer.correctsAnswerId ?? null}
      )`),
      tx`INSERT INTO insurance_case_timeline_events (
        id, case_id, event_type, actor_type, actor_id, correlation_id, details
      ) VALUES (
        ${randomUUID()}, ${command.caseId}, 'SUBMISSION_VERSION_CREATED', 'CUSTOMER', ${command.actorId},
        ${command.idempotencyKey}, ${JSON.stringify({ submissionVersion: nextVersion })}
      )`,
    ]);
  } catch (error) {
    const raced = (await db`
      SELECT id, version, status FROM insurance_submissions
      WHERE case_id = ${command.caseId} AND idempotency_key = ${command.idempotencyKey}
    `) as SubmissionCommandRow[];
    if (raced[0]) return raced[0];
    throw error;
  }
  return { id: submissionId, version: nextVersion, status: "DRAFT" };
}

/** Idempotently finalize one draft. No provider-facing state is reachable here. */
export async function finalizeDraftSubmission(caseId: string, submissionId: string, correlationId: string, actorId: string | null): Promise<SubmissionCommandRow> {
  assertIdempotencyKey(correlationId);
  const db = sql();
  const rows = (await db`
    SELECT id, version, status FROM insurance_submissions WHERE id = ${submissionId} AND case_id = ${caseId}
  `) as SubmissionCommandRow[];
  const current = rows[0];
  if (!current) throw new Error("insurance-a1: submission not found");
  if (current.status === "READY") return current;
  if (current.status !== "DRAFT") throw new Error("insurance-a1: withdrawn submission cannot be finalized");

  const answerRows = (await db`
    SELECT question_key, value, origin, answer_kind FROM insurance_submission_answers
    WHERE submission_id = ${submissionId} ORDER BY question_key, origin, answer_kind
  `) as Array<{ question_key: string; value: unknown; origin: string; answer_kind: string }>;
  if (answerRows.length === 0) throw new Error("insurance-a1: empty submission cannot be finalized");
  const afterHash = sha256(JSON.stringify(answerRows));
  const finalized = (await db`
    WITH changed AS (
      UPDATE insurance_submissions
      SET status = 'READY', finalized_at = NOW(), updated_at = NOW()
      WHERE id = ${submissionId} AND case_id = ${caseId} AND status = 'DRAFT'
      RETURNING id, version, status
    ), timeline AS (
      INSERT INTO insurance_case_timeline_events (
        id, case_id, event_type, actor_type, actor_id, correlation_id, details
      )
      SELECT ${randomUUID()}, ${caseId}, 'SUBMISSION_FINALIZED', 'CUSTOMER', ${actorId}, ${correlationId},
        ${JSON.stringify({ submissionVersion: current.version })} FROM changed
      RETURNING id
    ), audit AS (
      INSERT INTO insurance_audit_events (
        id, case_id, event_type, actor_type, actor_id, correlation_id, subject_type, subject_id, after_hash, metadata
      )
      SELECT ${randomUUID()}, ${caseId}, 'SUBMISSION_FINALIZED', 'CUSTOMER', ${actorId}, ${correlationId},
        'SUBMISSION', ${submissionId}, ${afterHash}, ${JSON.stringify({ submissionVersion: current.version, providerDelivery: false })}
      FROM changed
      RETURNING id
    )
    SELECT id, version, status FROM changed
  `) as SubmissionCommandRow[];
  if (finalized[0]) return finalized[0];
  const raced = (await db`
    SELECT id, version, status FROM insurance_submissions WHERE id = ${submissionId} AND case_id = ${caseId}
  `) as SubmissionCommandRow[];
  if (raced[0]?.status === "READY") return raced[0];
  throw new Error("insurance-a1: submission could not be finalized");
}

/** Domain command only in A1; no public withdrawal endpoint/UI is exposed. */
export async function withdrawCaseConsent(
  caseId: string,
  consentArtifactId: string,
  reason: string,
  correlationId: string,
  actorId: string | null
): Promise<void> {
  assertIdempotencyKey(correlationId);
  const withdrawalReason = requiredText(reason, "withdrawal reason", 500);
  const db = sql();
  const state = (await db`SELECT status FROM insurance_cases WHERE id = ${caseId}`) as Array<{ status: string }>;
  if (state[0]?.status === "WITHDRAWN") return;
  await db.transaction((tx) => [
    tx`UPDATE insurance_consent_artifacts
      SET withdrawn_at = COALESCE(withdrawn_at, NOW()), withdrawal_reason = COALESCE(withdrawal_reason, ${withdrawalReason})
      WHERE id = ${consentArtifactId} AND case_id = ${caseId}`,
    tx`UPDATE insurance_submissions SET status = 'WITHDRAWN', updated_at = NOW()
      WHERE case_id = ${caseId} AND status = 'READY'`,
    tx`UPDATE insurance_cases
      SET status = 'WITHDRAWN', access_token_revoked_at = COALESCE(access_token_revoked_at, NOW()), updated_at = NOW()
      WHERE id = ${caseId} AND status <> 'WITHDRAWN'`,
    tx`INSERT INTO insurance_case_timeline_events (
      id, case_id, event_type, to_state, actor_type, actor_id, correlation_id, details
    ) VALUES (
      ${randomUUID()}, ${caseId}, 'CONSENT_WITHDRAWN', 'WITHDRAWN', 'CUSTOMER', ${actorId}, ${correlationId}, '{}'
    )`,
    tx`INSERT INTO insurance_audit_events (
      id, case_id, event_type, actor_type, actor_id, correlation_id, subject_type, subject_id, metadata
    ) VALUES (
      ${randomUUID()}, ${caseId}, 'CONSENT_WITHDRAWN', 'CUSTOMER', ${actorId}, ${correlationId},
      'CONSENT_ARTIFACT', ${consentArtifactId}, ${JSON.stringify({ accessCapabilityRevoked: true })}
    )`,
  ]);
}
