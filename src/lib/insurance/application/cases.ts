import { randomUUID } from "node:crypto";
import { dbAvailable, sql } from "@/lib/db";
import {
  validateCoverageProfileInput,
  insertCoverageProfileRow,
  CoverageProfileValidationError,
  type CreateCoverageProfileInput,
  type CoverageProfileAnswers,
  type CoverageProfileProperty,
  type ValidatedCoverageProfileInput,
} from "@/lib/db/coverage-profiles";
import type { CounterpartyRole } from "@/config/affiliate-vendors";
import type { RequestedKernelExecutionMode } from "@/config/insurance-kernel/execution-mode";
import {
  assertIdempotencyKey,
  canonicalJson,
  canonicalSha256,
  hashAccessToken,
  sha256,
  type SubmissionAnswer,
} from "@/lib/insurance/domain/submission";
import type { A1SubmissionState } from "@/lib/insurance/domain/states";

export const A1_ACCESS_TTL_SECONDS = 60 * 60 * 24 * 30;
export const A1_CONSENT_VERSION = "coverage-profile-consent-v1";
export const A1_QUESTIONNAIRE_VERSION = "coverage-profile-v1";

/**
 * A deliberately non-specific conflict response. It is safe to surface as a
 * 409, but never reveals whether a case, idempotency key, or capability token
 * exists. The route owns HTTP mapping; application code owns the semantics.
 */
export class InsuranceCaseConflictError extends Error {
  readonly code = "INSURANCE_CASE_CONFLICT";

  constructor() {
    super("This insurance request conflicts with an existing record. Please start again.");
    this.name = "InsuranceCaseConflictError";
  }
}

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
  /** False on an exact idempotent replay. */
  newlyCreated: boolean;
}

export interface UpdateCoverageCaseInput extends CreateCoverageProfileInput {
  caseId: string;
  executionMode: RequestedKernelExecutionMode;
  idempotencyKey: string;
  accessToken: string;
  intendedRecipients: IntendedRecipient[];
}

export interface FinalizeCoverageCaseInput {
  caseId: string;
  submissionId: string;
  /** The currently authenticated user, if any; recorded as immutable audit evidence. */
  userId: string | null;
  executionMode: RequestedKernelExecutionMode;
  idempotencyKey: string;
  accessToken: string;
}

export interface CaseSubmissionCommandResult {
  caseId: string;
  submissionId: string;
  submissionVersion: number;
  status: A1SubmissionState;
  replayed: boolean;
}

interface ExistingCaseRow {
  case_id: string;
  profile_id: string;
  submission_id: string;
  submission_version: number;
  created_at: string | Date;
  access_token_hash: string | null;
  request_hash: string | null;
}

function assertCaseIdentifier(value: string, label: string): void {
  try {
    assertIdempotencyKey(value);
  } catch {
    throw new CoverageProfileValidationError(`${label} must be a UUID`);
  }
}

/** Validates profile data plus the two capability fields shared by create/update. */
function validateBaseInput(input: CreateFinalizedCoverageCaseInput | UpdateCoverageCaseInput) {
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

function canonicalRecipients(recipients: IntendedRecipient[]) {
  return recipients
    .map((recipient) => ({
      counterpartyId: recipient.counterpartyId,
      name: recipient.name,
      role: recipient.role,
    }))
    .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
}

/**
 * This intentionally contains every semantic input accepted by create/update
 * after validation. It excludes transport-only values (the idempotency key
 * and bearer capability), which have their own durable comparisons.
 */
function profileRequestHash(
  profile: ValidatedCoverageProfileInput,
  executionMode: RequestedKernelExecutionMode,
  recipients: IntendedRecipient[],
  operation: "CREATE" | "UPDATE",
  caseId?: string
): string {
  return canonicalSha256({
    operation,
    caseId: caseId ?? null,
    executionMode,
    userId: profile.userId,
    country: profile.country,
    region: profile.region,
    address: profile.address,
    line: profile.line,
    property: profile.property,
    answers: profile.answers,
    consent: true,
    consentText: profile.consentText,
    source: profile.source,
    intendedRecipients: canonicalRecipients(recipients),
  });
}

function finalizeRequestHash(input: FinalizeCoverageCaseInput): string {
  return canonicalSha256({
    operation: "FINALIZE",
    caseId: input.caseId,
    submissionId: input.submissionId,
    userId: input.userId,
    executionMode: input.executionMode,
  });
}

function fieldAnswers(
  property: CoverageProfileProperty,
  answers: CoverageProfileAnswers,
  address: string
): SubmissionAnswer[] {
  const output: SubmissionAnswer[] = [];
  const add = (
    questionKey: string,
    value: unknown,
    origin: SubmissionAnswer["origin"],
    answerKind: SubmissionAnswer["answerKind"],
    sourceReference: string
  ) => {
    output.push({
      id: randomUUID(),
      questionKey,
      value,
      origin,
      answerKind,
      sourceReference,
      correctsAnswerId: undefined,
    });
  };
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

function fieldScope(answerRows: SubmissionAnswer[]): string[] {
  return ["case.country", "case.region", "insurance.line", ...answerRows.map((answer) => answer.questionKey)];
}

async function findExisting(
  idempotencyKey: string,
  accessTokenHash: string,
  requestHash: string
): Promise<CreatedCoverageCase | null> {
  const db = sql();
  const rows = (await db`
    SELECT c.id AS case_id, c.legacy_coverage_profile_id AS profile_id,
      s.id AS submission_id, s.version AS submission_version,
      c.created_at, c.access_token_hash, c.request_hash
    FROM insurance_cases c
    JOIN insurance_submissions s ON s.case_id = c.id AND s.version = 1
    WHERE c.idempotency_key = ${idempotencyKey}::text
    LIMIT 1
  `) as ExistingCaseRow[];
  const row = rows[0];
  if (!row) return null;
  if (row.access_token_hash !== accessTokenHash || row.request_hash !== requestHash) {
    throw new InsuranceCaseConflictError();
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
  const requestHash = profileRequestHash(validated, input.executionMode, input.intendedRecipients, "CREATE");
  const existing = await findExisting(input.idempotencyKey, validated.accessTokenHash, requestHash);
  if (existing) return existing;

  const profileId = randomUUID();
  const caseId = randomUUID();
  const partyId = randomUUID();
  const consentId = randomUUID();
  const submissionId = randomUUID();
  const correlationId = input.idempotencyKey;
  const answerRows = fieldAnswers(validated.property, validated.answers, validated.address);
  const accessExpiresAt = new Date(Date.now() + A1_ACCESS_TTL_SECONDS * 1000).toISOString();
  const finalizedHash = canonicalSha256(answerRows.map(({ questionKey, value, origin, answerKind }) => ({ questionKey, value, origin, answerKind })));
  const db = sql();

  try {
    await db.transaction((tx) => [
      insertCoverageProfileRow(tx, profileId, validated),
      tx`INSERT INTO insurance_cases (
        id, execution_mode, status, owner_user_id, legacy_coverage_profile_id,
        idempotency_key, request_hash, country, region, insurance_line, access_token_hash, access_token_expires_at
      ) VALUES (
        ${caseId}, ${input.executionMode}, 'DRAFT', ${validated.userId}, ${profileId},
        ${input.idempotencyKey}, ${requestHash}, ${validated.country}, ${validated.region}, ${validated.line},
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
        ${validated.consentText}, ${JSON.stringify(canonicalRecipients(input.intendedRecipients))}, ${JSON.stringify(fieldScope(answerRows))}, NOW()
      )`,
      tx`INSERT INTO insurance_submissions (
        id, case_id, version, status, questionnaire_version, idempotency_key, request_hash, consent_artifact_id
      ) VALUES (${submissionId}, ${caseId}, 1, 'DRAFT', ${A1_QUESTIONNAIRE_VERSION}, ${input.idempotencyKey}, ${requestHash}, ${consentId})`,
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
    // transaction is fully rolled back; replay only when both the capability
    // and canonical request fingerprint match the durable original.
    const raced = await findExisting(input.idempotencyKey, validated.accessTokenHash, requestHash);
    if (raced) return raced;
    throw error;
  }

  return { profileId, caseId, submissionId, submissionVersion: 1, createdAt: new Date().toISOString(), newlyCreated: true };
}

interface CommandOutcomeRow {
  outcome: "REPLAY" | "CREATED" | "CONFLICT";
  submission_id: string | null;
  submission_version: number | null;
  submission_status: A1SubmissionState | null;
}

function commandResult(caseId: string, rows: CommandOutcomeRow[]): CaseSubmissionCommandResult {
  const row = rows[0];
  if (!row || row.outcome === "CONFLICT" || !row.submission_id || !row.submission_version || !row.submission_status) {
    throw new InsuranceCaseConflictError();
  }
  return {
    caseId,
    submissionId: row.submission_id,
    submissionVersion: row.submission_version,
    status: row.submission_status,
    replayed: row.outcome === "REPLAY",
  };
}

/** Internal-only A1 command. One PostgreSQL statement holds the case row lock
 * while it checks the receipt and appends a new immutable draft version. */
export async function updateCoverageCase(input: UpdateCoverageCaseInput): Promise<CaseSubmissionCommandResult> {
  const validated = validateBaseInput(input);
  assertCaseIdentifier(input.caseId, "caseId");
  const requestHash = profileRequestHash(validated, input.executionMode, input.intendedRecipients, "UPDATE", input.caseId);
  const submissionId = randomUUID();
  const consentId = randomUUID();
  const receiptId = randomUUID();
  const timelineId = randomUUID();
  const consentAuditId = randomUUID();
  const submissionAuditId = randomUUID();
  const answers = fieldAnswers(validated.property, validated.answers, validated.address);
  const answersHash = canonicalSha256(answers.map(({ questionKey, value, origin, answerKind }) => ({ questionKey, value, origin, answerKind })));
  const db = sql();
  const rows = (await db`
    WITH authorized AS MATERIALIZED (
      SELECT id, status FROM insurance_cases
      WHERE id=${input.caseId}::uuid AND access_token_hash=${validated.accessTokenHash}
        AND access_token_revoked_at IS NULL AND access_token_expires_at > NOW()
        AND execution_mode=${input.executionMode} AND country=${validated.country}
        AND region=${validated.region} AND insurance_line=${validated.line}
      FOR UPDATE
    ), receipt AS MATERIALIZED (
      SELECT r.request_hash, r.result_submission_id, s.version, s.status
      FROM insurance_case_command_receipts r JOIN authorized c ON c.id=r.case_id
      JOIN insurance_submissions s ON s.id=r.result_submission_id
      WHERE r.command_type='UPDATE' AND r.idempotency_key=${input.idempotencyKey}::text
    ), latest AS MATERIALIZED (
      SELECT s.id, s.version, s.status, s.consent_artifact_id
      FROM insurance_submissions s JOIN authorized c ON c.id=s.case_id
      ORDER BY s.version DESC LIMIT 1 FOR UPDATE OF s
    ), eligible AS MATERIALIZED (
      SELECT c.id AS case_id, s.id AS prior_submission_id, s.version + 1 AS next_version, s.consent_artifact_id
      FROM authorized c JOIN latest s ON TRUE
      WHERE c.status='READY_FOR_SUBMISSION' AND s.status='READY' AND NOT EXISTS (SELECT 1 FROM receipt)
    ), new_consent AS (
      INSERT INTO insurance_consent_artifacts (id,case_id,version,language,purpose,exact_text,intended_recipients,field_scope,granted_at,supersedes_consent_id)
      SELECT ${consentId}::uuid,case_id,${A1_CONSENT_VERSION},${validated.country === "CA" ? "en-CA" : "en-US"},
        'save coverage profile and record intended referral recipients',${validated.consentText},
        ${JSON.stringify(canonicalRecipients(input.intendedRecipients))}::jsonb,${JSON.stringify(fieldScope(answers))}::jsonb,NOW(),consent_artifact_id
      FROM eligible RETURNING id,case_id
    ), new_submission AS (
      INSERT INTO insurance_submissions (id,case_id,version,status,questionnaire_version,idempotency_key,request_hash,consent_artifact_id,supersedes_submission_id)
      SELECT ${submissionId}::uuid,e.case_id,e.next_version,'DRAFT',${A1_QUESTIONNAIRE_VERSION},${input.idempotencyKey},${requestHash},nc.id,e.prior_submission_id
      FROM eligible e JOIN new_consent nc ON nc.case_id=e.case_id RETURNING id,case_id,version
    ), new_answers AS (
      INSERT INTO insurance_submission_answers (id,submission_id,question_key,answer_kind,value,origin,source_reference,corrects_answer_id)
      SELECT (a.value->>'id')::uuid,ns.id,a.value->>'questionKey',a.value->>'answerKind',a.value->'value',a.value->>'origin',NULLIF(a.value->>'sourceReference',''),
        CASE WHEN a.value->>'origin'='USER' AND a.value->>'answerKind'='ATTESTATION' AND prior.value IS DISTINCT FROM a.value->'value' THEN prior.id ELSE NULL END
      FROM new_submission ns JOIN eligible e ON e.case_id=ns.case_id
      CROSS JOIN jsonb_array_elements(${JSON.stringify(answers)}::jsonb) a(value)
      LEFT JOIN insurance_submission_answers prior ON prior.submission_id=e.prior_submission_id AND prior.question_key=a.value->>'questionKey' AND prior.origin='USER' AND prior.answer_kind='ATTESTATION'
      RETURNING id
    ), answered AS (SELECT count(*) FROM new_answers), moved_case AS (
      UPDATE insurance_cases c SET status='COLLECTING_FACTS',updated_at=NOW() FROM new_submission ns CROSS JOIN answered
      WHERE c.id=ns.case_id AND c.status='READY_FOR_SUBMISSION' RETURNING c.id
    ), timeline AS (
      INSERT INTO insurance_case_timeline_events (id,case_id,event_type,from_state,to_state,actor_type,actor_id,correlation_id,details)
      SELECT ${timelineId}::uuid,ns.case_id,'SUBMISSION_VERSION_CREATED','READY_FOR_SUBMISSION','COLLECTING_FACTS','CUSTOMER',${validated.userId},${input.idempotencyKey},jsonb_build_object('submissionVersion',ns.version,'supersedesSubmissionId',e.prior_submission_id)
      FROM new_submission ns JOIN eligible e ON e.case_id=ns.case_id JOIN moved_case c ON c.id=ns.case_id RETURNING id
    ), audit AS (
      INSERT INTO insurance_audit_events (id,case_id,event_type,actor_type,actor_id,correlation_id,subject_type,subject_id,after_hash,metadata)
      SELECT ${consentAuditId}::uuid,nc.case_id,'CONSENT_RECORDED','CUSTOMER',${validated.userId},${input.idempotencyKey},'CONSENT_ARTIFACT',nc.id,${sha256(validated.consentText)},jsonb_build_object('consentVersion',${A1_CONSENT_VERSION},'reaffirmed',true) FROM new_consent nc CROSS JOIN timeline
      UNION ALL
      SELECT ${submissionAuditId}::uuid,ns.case_id,'SUBMISSION_VERSION_CREATED','CUSTOMER',${validated.userId},${input.idempotencyKey},'SUBMISSION',ns.id,${answersHash},jsonb_build_object('submissionVersion',ns.version,'providerDelivery',false) FROM new_submission ns CROSS JOIN timeline
      RETURNING id
    ), audited AS (SELECT count(*) FROM audit), created_receipt AS (
      INSERT INTO insurance_case_command_receipts (id,case_id,command_type,idempotency_key,request_hash,result_submission_id)
      SELECT ${receiptId}::uuid,ns.case_id,'UPDATE',${input.idempotencyKey},${requestHash},ns.id FROM new_submission ns CROSS JOIN audited RETURNING result_submission_id
    )
    SELECT 'REPLAY'::text outcome,r.result_submission_id submission_id,r.version submission_version,r.status submission_status FROM receipt r WHERE r.request_hash=${requestHash}
    UNION ALL SELECT 'CREATED'::text,ns.id,ns.version,'DRAFT'::text FROM new_submission ns JOIN created_receipt cr ON cr.result_submission_id=ns.id
    UNION ALL SELECT 'CONFLICT'::text,NULL::uuid,NULL::integer,NULL::text
      WHERE NOT EXISTS (SELECT 1 FROM receipt WHERE request_hash=${requestHash}) AND NOT EXISTS (SELECT 1 FROM new_submission)
  `) as CommandOutcomeRow[];
  return commandResult(input.caseId, rows);
}

/** Internal-only A1 command. A receipt makes exact finalization retries return
 * the original finalized version; no provider-evidence state is written. */
export async function finalizeCoverageCase(input: FinalizeCoverageCaseInput): Promise<CaseSubmissionCommandResult> {
  if (!dbAvailable()) throw new Error("DATABASE_URL not set — cannot finalize insurance case");
  assertCaseIdentifier(input.caseId, "caseId");
  assertCaseIdentifier(input.submissionId, "submissionId");
  try { assertIdempotencyKey(input.idempotencyKey); } catch (error) { throw new CoverageProfileValidationError(error instanceof Error ? error.message : "invalid idempotency key"); }
  let accessTokenHash: string;
  try { accessTokenHash = hashAccessToken(input.accessToken); } catch (error) { throw new CoverageProfileValidationError(error instanceof Error ? error.message : "invalid access token"); }
  const requestHash = finalizeRequestHash(input);
  const db = sql();
  const rows = (await db`
    WITH authorized AS MATERIALIZED (
      SELECT id,status FROM insurance_cases WHERE id=${input.caseId}::uuid AND access_token_hash=${accessTokenHash}
        AND access_token_revoked_at IS NULL AND access_token_expires_at>NOW() AND execution_mode=${input.executionMode} FOR UPDATE
    ), receipt AS MATERIALIZED (
      SELECT r.request_hash,r.result_submission_id,s.version,s.status FROM insurance_case_command_receipts r
      JOIN authorized c ON c.id=r.case_id JOIN insurance_submissions s ON s.id=r.result_submission_id
      WHERE r.command_type='FINALIZE' AND r.idempotency_key=${input.idempotencyKey}::text
    ), eligible AS MATERIALIZED (
      SELECT c.id case_id,s.id submission_id,s.version FROM authorized c JOIN insurance_submissions s ON s.case_id=c.id
      WHERE c.status='COLLECTING_FACTS' AND s.id=${input.submissionId}::uuid AND s.status='DRAFT'
        AND s.version=(SELECT max(version) FROM insurance_submissions WHERE case_id=c.id) AND NOT EXISTS (SELECT 1 FROM receipt)
      FOR UPDATE OF s
    ), finalized AS (
      UPDATE insurance_submissions s SET status='READY',finalized_at=NOW(),updated_at=NOW() FROM eligible e
      WHERE s.id=e.submission_id AND s.status='DRAFT' RETURNING s.id,s.case_id,s.version,s.request_hash
    ), moved_case AS (
      UPDATE insurance_cases c SET status='READY_FOR_SUBMISSION',updated_at=NOW() FROM finalized s
      WHERE c.id=s.case_id AND c.status='COLLECTING_FACTS' RETURNING c.id
    ), timeline AS (
      INSERT INTO insurance_case_timeline_events (id,case_id,event_type,from_state,to_state,actor_type,actor_id,correlation_id,details)
      SELECT ${randomUUID()}::uuid,s.case_id,'PROFILE_FINALIZED','COLLECTING_FACTS','READY_FOR_SUBMISSION','CUSTOMER',${input.userId},${input.idempotencyKey},jsonb_build_object('submissionVersion',s.version)
      FROM finalized s JOIN moved_case c ON c.id=s.case_id RETURNING id
    ), audit AS (
      INSERT INTO insurance_audit_events (id,case_id,event_type,actor_type,actor_id,correlation_id,subject_type,subject_id,after_hash,metadata)
      SELECT ${randomUUID()}::uuid,s.case_id,'SUBMISSION_FINALIZED','CUSTOMER',${input.userId},${input.idempotencyKey},'SUBMISSION',s.id,s.request_hash,jsonb_build_object('submissionVersion',s.version,'providerDelivery',false)
      FROM finalized s CROSS JOIN timeline RETURNING id
    ), created_receipt AS (
      INSERT INTO insurance_case_command_receipts (id,case_id,command_type,idempotency_key,request_hash,result_submission_id)
      SELECT ${randomUUID()}::uuid,s.case_id,'FINALIZE',${input.idempotencyKey},${requestHash},s.id FROM finalized s CROSS JOIN audit RETURNING result_submission_id
    )
    SELECT 'REPLAY'::text outcome,r.result_submission_id submission_id,r.version submission_version,r.status submission_status FROM receipt r WHERE r.request_hash=${requestHash}
    UNION ALL SELECT 'CREATED'::text,s.id,s.version,'READY'::text FROM finalized s JOIN created_receipt cr ON cr.result_submission_id=s.id
    UNION ALL SELECT 'CONFLICT'::text,NULL::uuid,NULL::integer,NULL::text
      WHERE NOT EXISTS (SELECT 1 FROM receipt WHERE request_hash=${requestHash}) AND NOT EXISTS (SELECT 1 FROM finalized)
  `) as CommandOutcomeRow[];
  return commandResult(input.caseId, rows);
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
