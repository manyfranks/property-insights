import { randomUUID } from "node:crypto";
import { dbAvailable, sql } from "@/lib/db";
import { insuranceKernelExecution, type RequestedKernelExecutionMode } from "@/config/insurance-kernel/execution-mode";
import { assertIdempotencyKey, canonicalSha256 } from "@/lib/insurance/domain/submission";
import {
  assertProviderMode,
  canonicalWebhookHash,
  canTransitionDelivery,
  DELIVERY_TRANSACTION_STATES,
  DETERMINISTIC_SIMULATOR_PROVIDER_KEY,
  isUuid,
  type DeliveryTransactionState,
  type ProviderAcknowledgement,
  type ProviderWebhookEvent,
  type SubmissionProvider,
} from "@/lib/insurance/domain/delivery";
import { assertA2SubmissionTransition, type A2SubmissionState } from "@/lib/insurance/domain/states";
import { InsuranceCaseConflictError } from "./cases";

export class InsuranceDeliveryDeniedError extends Error {
  readonly code = "INSURANCE_DELIVERY_DENIED";
  constructor() { super("Insurance delivery is not enabled for this request."); this.name = "InsuranceDeliveryDeniedError"; }
}

export interface SubmitFinalizedSubmissionInput {
  caseId: string;
  submissionId: string;
  providerConnectionId: string;
  providerKey: string;
  idempotencyKey: string;
  executionMode: RequestedKernelExecutionMode;
  /** Required for any non-simulator provider; A2 has no authority evaluator yet. */
  authorityDecisionId?: string | null;
  schemaVersion: string;
  payloadReference: string;
}

export interface ProviderSubmissionResult {
  providerSubmissionId: string;
  outboxEventId: string;
  status: DeliveryTransactionState;
  replayed: boolean;
}

interface ExistingProviderSubmissionRow {
  id: string;
  outbox_event_id: string | null;
  status: DeliveryTransactionState;
  request_hash: string;
}

/** Vocabulary from 0006's insurance_operator_exceptions CHECK. */
type OperatorExceptionType =
  | "PROVIDER_TIMEOUT"
  | "RETRY_EXHAUSTED"
  | "PERMANENT_FAILURE"
  | "WEBHOOK_CONFLICT"
  | "WEBHOOK_OUT_OF_ORDER"
  | "RECONCILIATION_MISMATCH";

function assertUuid(value: string, _label: string): void {
  void _label;
  try { assertIdempotencyKey(value); } catch { throw new InsuranceDeliveryDeniedError(); }
}

/**
 * A2’s authority gate is intentionally narrow. There is no real provider
 * adapter/appointment matrix yet, so production delivery is denied even when
 * a quote-request flag is accidentally set. Simulator traffic requires the
 * explicitly narrow simulation execution configuration.
 */
function assertDeliveryRuntime(input: SubmitFinalizedSubmissionInput): void {
  const config = insuranceKernelExecution();
  if (!config.enabled || !config.features.quoteRequest || config.mode !== input.executionMode) {
    throw new InsuranceDeliveryDeniedError();
  }
  if (input.providerKey === DETERMINISTIC_SIMULATOR_PROVIDER_KEY) {
    if (!config.simulatorOutputsAllowed || input.executionMode !== "SIMULATION") throw new InsuranceDeliveryDeniedError();
    return;
  }
  // A2 is intentionally incapable of calling real paper. The explicit
  // authority reference remains in the contract so B2 can replace this deny.
  if (input.executionMode === "PRODUCTION" || !input.authorityDecisionId) throw new InsuranceDeliveryDeniedError();
  throw new InsuranceDeliveryDeniedError();
}

function submissionRequestHash(input: SubmitFinalizedSubmissionInput): string {
  return canonicalSha256({
    command: "SUBMIT_FINALIZED_SUBMISSION", caseId: input.caseId, submissionId: input.submissionId,
    providerConnectionId: input.providerConnectionId, providerKey: input.providerKey,
    executionMode: input.executionMode, authorityDecisionId: input.authorityDecisionId ?? null,
    schemaVersion: input.schemaVersion, payloadReference: input.payloadReference,
  });
}

async function findExisting(input: SubmitFinalizedSubmissionInput, requestHash: string): Promise<ProviderSubmissionResult | null> {
  const rows = (await sql()`
    SELECT ps.id, ps.status, ps.request_hash, oe.id AS outbox_event_id
    FROM insurance_provider_submissions ps
    LEFT JOIN insurance_outbox_events oe ON oe.aggregate_type='PROVIDER_SUBMISSION' AND oe.aggregate_id=ps.id
      AND oe.event_type='SUBMISSION_DISPATCH'
    WHERE ps.submission_id=${input.submissionId}::uuid AND ps.provider_connection_id=${input.providerConnectionId}::uuid
    LIMIT 1
  `) as ExistingProviderSubmissionRow[];
  const row = rows[0];
  if (!row) return null;
  if (row.request_hash !== requestHash || !row.outbox_event_id) throw new InsuranceCaseConflictError();
  return { providerSubmissionId: row.id, outboxEventId: row.outbox_event_id, status: row.status, replayed: true };
}

/**
 * The database transaction is the delivery boundary: no provider request is
 * attempted here. A durable provider transaction, dispatch intent, timeline
 * and audit evidence either all commit, or none do.
 */
export async function submitFinalizedSubmission(input: SubmitFinalizedSubmissionInput): Promise<ProviderSubmissionResult> {
  if (!dbAvailable()) throw new InsuranceDeliveryDeniedError();
  assertUuid(input.caseId, "caseId"); assertUuid(input.submissionId, "submissionId");
  assertUuid(input.providerConnectionId, "providerConnectionId"); assertIdempotencyKey(input.idempotencyKey);
  assertDeliveryRuntime(input);
  const requestHash = submissionRequestHash(input);
  const replay = await findExisting(input, requestHash);
  if (replay) return replay;

  const providerSubmissionId = randomUUID();
  const outboxEventId = randomUUID();
  const correlationId = input.idempotencyKey;
  const payloadHash = canonicalSha256({ payloadReference: input.payloadReference, requestHash });
  const db = sql();
  try {
    await db.transaction((tx) => [
      // This SELECT assertion is deliberately embedded in every insert/update
      // predicate, so a stale/wrong-mode submission cannot create orphan work.
      tx`INSERT INTO insurance_provider_submissions (
        id,case_id,submission_id,provider_connection_id,execution_mode,status,provider_idempotency_key,request_hash,raw_request_reference,provider_schema_version
      ) SELECT ${providerSubmissionId}::uuid,c.id,s.id,pc.id,c.execution_mode,'PENDING_DISPATCH',${input.idempotencyKey},${requestHash},${input.payloadReference},${input.schemaVersion}
        FROM insurance_cases c JOIN insurance_submissions s ON s.case_id=c.id
        JOIN insurance_provider_connections pc ON pc.id=${input.providerConnectionId}::uuid
        WHERE c.id=${input.caseId}::uuid AND s.id=${input.submissionId}::uuid AND c.execution_mode=${input.executionMode}
          AND c.status='READY_FOR_SUBMISSION' AND s.status='READY' AND pc.provider_key=${input.providerKey}
          AND pc.enabled AND ${input.executionMode}=ANY(pc.supported_execution_modes)`,
      tx`INSERT INTO insurance_outbox_events (
        id,aggregate_type,aggregate_id,event_type,schema_version,execution_mode,correlation_id,idempotency_key,payload_reference,payload_hash
      ) SELECT ${outboxEventId}::uuid,'PROVIDER_SUBMISSION',${providerSubmissionId}::uuid,'SUBMISSION_DISPATCH',${input.schemaVersion},${input.executionMode},${correlationId},${input.idempotencyKey},${input.payloadReference},${payloadHash}
        WHERE EXISTS (SELECT 1 FROM insurance_provider_submissions WHERE id=${providerSubmissionId}::uuid)`,
      tx`UPDATE insurance_submissions SET status='SUBMITTING',updated_at=NOW()
        WHERE id=${input.submissionId}::uuid AND status='READY'
          AND EXISTS (SELECT 1 FROM insurance_provider_submissions WHERE id=${providerSubmissionId}::uuid)`,
      tx`UPDATE insurance_cases SET status='SUBMISSION_IN_PROGRESS',updated_at=NOW()
        WHERE id=${input.caseId}::uuid AND status='READY_FOR_SUBMISSION'
          AND EXISTS (SELECT 1 FROM insurance_provider_submissions WHERE id=${providerSubmissionId}::uuid)`,
      tx`INSERT INTO insurance_case_timeline_events (id,case_id,event_type,from_state,to_state,actor_type,correlation_id,details)
        SELECT ${randomUUID()}::uuid,${input.caseId}::uuid,'PROVIDER_DELIVERY_QUEUED','READY_FOR_SUBMISSION','SUBMISSION_IN_PROGRESS','SERVICE',${correlationId},
          jsonb_build_object('providerSubmissionId',${providerSubmissionId},'providerKey',${input.providerKey})
        WHERE EXISTS (SELECT 1 FROM insurance_outbox_events WHERE id=${outboxEventId}::uuid)`,
      tx`INSERT INTO insurance_audit_events (id,case_id,event_type,actor_type,correlation_id,subject_type,subject_id,after_hash,metadata)
        SELECT ${randomUUID()}::uuid,${input.caseId}::uuid,'PROVIDER_SUBMISSION_QUEUED','SERVICE',${correlationId},'PROVIDER_SUBMISSION',${providerSubmissionId}::uuid,${requestHash},
          jsonb_build_object('providerKey',${input.providerKey},'providerDelivery',true)
        WHERE EXISTS (SELECT 1 FROM insurance_outbox_events WHERE id=${outboxEventId}::uuid)`,
    ]);
  } catch (error) {
    const raced = await findExisting(input, requestHash);
    if (raced) return raced;
    throw error;
  }
  const created = await findExisting(input, requestHash);
  if (!created) throw new InsuranceDeliveryDeniedError();
  // A webhook can legitimately arrive before this transaction commits (the
  // provider races us). Give any evidence already sitting in the inbox for
  // this connection a chance to land now that the transaction it needed
  // exists. Non-fatal: a missed reprocess here is recovered by the next
  // provider retry or an explicit reconciliation run.
  try {
    await reprocessDeferredWebhooks(input.providerConnectionId);
  } catch (error) {
    console.error("[insurance-a2] post-submit webhook reprocess failed (non-fatal)", error);
  }
  return { ...created, replayed: false };
}

/* ------------------------------------------------------------------------ *
 * Operator exceptions
 * ------------------------------------------------------------------------ */

/** Attaches an exception to a known provider submission (and, if relevant,
 * the webhook that triggered it). Idempotent per open exception of the same
 * type on the same submission. */
async function openProviderSubmissionException(
  providerSubmissionId: string,
  type: OperatorExceptionType,
  webhookInboxId: string | null
): Promise<void> {
  await sql()`
    INSERT INTO insurance_operator_exceptions (id,case_id,provider_submission_id,webhook_inbox_id,exception_type,reason_code)
    SELECT ${randomUUID()}::uuid,case_id,id,${webhookInboxId}::uuid,${type},${type}
    FROM insurance_provider_submissions WHERE id=${providerSubmissionId}::uuid
      AND NOT EXISTS (
        SELECT 1 FROM insurance_operator_exceptions e
        WHERE e.provider_submission_id=${providerSubmissionId}::uuid AND e.status='OPEN' AND e.exception_type=${type}
      )
  `;
}

/** Opens an exception for a webhook that never matched a provider submission
 * (case_id is unknown, so this is the only way to keep it visible). */
async function openOrphanWebhookException(webhookInboxId: string, type: OperatorExceptionType, reasonCode: string): Promise<void> {
  await sql()`
    INSERT INTO insurance_operator_exceptions (id,case_id,provider_submission_id,webhook_inbox_id,exception_type,reason_code)
    SELECT ${randomUUID()}::uuid,NULL,NULL,${webhookInboxId}::uuid,${type},${reasonCode}
    WHERE NOT EXISTS (
      SELECT 1 FROM insurance_operator_exceptions e
      WHERE e.webhook_inbox_id=${webhookInboxId}::uuid AND e.status='OPEN' AND e.exception_type=${type}
    )
  `;
}

/* ------------------------------------------------------------------------ *
 * Delivery-state machine helpers shared by dispatch results and webhooks
 * ------------------------------------------------------------------------ */

const DISPATCH_EVENT_PREFIX = "DISPATCH_";

/** Every dispatch-sourced ledger event is named DISPATCH_<targetState>, which
 * both keeps it visibly distinct from provider webhook event types
 * (SUBMISSION_ACKNOWLEDGED / SUBMISSION_PENDING / SUBMISSION_FAILED) and
 * lets rebuildProviderProjection() decode it without a lookup table. */
function dispatchEventType(target: DeliveryTransactionState): string {
  return `${DISPATCH_EVENT_PREFIX}${target}`;
}

/**
 * Resolves the ordered list of single-hop hop targets needed to reach
 * `intended` from `current`, each hop individually legal per
 * canTransitionDelivery. Returns null if no legal path exists.
 *
 * A same-state call is always legal (idempotent no-op) and reported as a
 * single self-hop so callers do not need a separate no-op branch.
 *
 * The one bridge this function grants beyond a direct canTransitionDelivery()
 * call: from PENDING_DISPATCH, a target that is not itself directly
 * reachable (only ACKNOWLEDGED is not) is reached via AWAITING_PROVIDER. This
 * represents a synchronous acknowledgement returned in the very first
 * dispatch response, which never has a separate "awaiting" window in real
 * time but must still be representable as one in the append-only ledger so a
 * fold over that ledger reproduces ACKNOWLEDGED (see rebuildProviderProjection).
 * The bridge is deliberately NOT granted from RETRY_SCHEDULED, DEAD_LETTER, or
 * RECONCILIATION_REQUIRED: those are states the system (or an operator) has
 * already made a decision about, and a stray/late result against them (e.g. a
 * late worker reporting ACKNOWLEDGED against a submission that has since been
 * dead-lettered) must be rejected as a conflict, not silently resurrected.
 */
export function resolveLegalHops(current: DeliveryTransactionState, intended: DeliveryTransactionState): DeliveryTransactionState[] | null {
  if (current === intended) return [intended];
  if (canTransitionDelivery(current, intended)) return [intended];
  if (current === "PENDING_DISPATCH" && canTransitionDelivery("AWAITING_PROVIDER", intended)) {
    return ["AWAITING_PROVIDER", intended];
  }
  return null;
}

export interface SubmissionAdvancementStep {
  from: A2SubmissionState;
  to: A2SubmissionState;
}

/**
 * Maps a landed delivery-transaction state to the insurance_submissions
 * advancement it implies, expressed as a flat list of individually
 * WHERE-guarded (from -> to) steps applied in sequence inside the same
 * transaction as the delivery write. Each pair is validated with
 * assertA2SubmissionTransition() against src/lib/insurance/domain/states.ts
 * before any SQL is built.
 *
 * The list mixes two shapes on purpose, both safe to execute unconditionally
 * in sequence because each step's own WHERE=<from> guard decides whether it
 * actually applies:
 *  - A genuine chain (ACKNOWLEDGED): SUBMITTING->AWAITING_PROVIDER must land
 *    before AWAITING_PROVIDER->SUBMITTED can match, and it does, because
 *    Postgres executes the batch's statements in order inside one real
 *    transaction (the whole point of "respect the trigger by issuing
 *    sequential UPDATEs in the same transaction").
 *  - Independent alternatives (DEAD_LETTER): a permanent failure can be
 *    observed while the submission is still SUBMITTING (a first attempt that
 *    fails synchronously) or already AWAITING_PROVIDER (a later failure).
 *    Only the step whose `from` matches reality applies; the other is a
 *    harmless no-op guard.
 */
export function submissionAdvancementSteps(deliveryState: DeliveryTransactionState): SubmissionAdvancementStep[] {
  const steps: SubmissionAdvancementStep[] = deliveryState === "AWAITING_PROVIDER" || deliveryState === "RETRY_SCHEDULED"
    ? [{ from: "SUBMITTING", to: "AWAITING_PROVIDER" }]
    : deliveryState === "ACKNOWLEDGED"
    ? [{ from: "SUBMITTING", to: "AWAITING_PROVIDER" }, { from: "AWAITING_PROVIDER", to: "SUBMITTED" }]
    : deliveryState === "DEAD_LETTER"
    ? [{ from: "SUBMITTING", to: "PROVIDER_ERROR" }, { from: "AWAITING_PROVIDER", to: "PROVIDER_ERROR" }]
    : [];
  for (const step of steps) assertA2SubmissionTransition(step.from, step.to);
  return steps;
}

/* ------------------------------------------------------------------------ *
 * Dispatch results
 * ------------------------------------------------------------------------ */

/**
 * No external retry/backoff orchestrator exists in A2 yet (nothing in this
 * codebase calls recordProviderDispatchResult today). This bounds when a
 * RETRYABLE_FAILURE outcome is instead treated as exhausted -> DEAD_LETTER
 * with a RETRY_EXHAUSTED exception, per F9. A real worker's retry policy is
 * expected to replace this constant, not the shape of the check.
 */
export const MAX_DELIVERY_ATTEMPTS = 5;

export interface DispatchOutcomeResolution {
  intended: DeliveryTransactionState;
  attemptOutcome: "ACKNOWLEDGED" | "DISPATCHED" | "RETRYABLE_FAILURE" | "PERMANENT_FAILURE";
  retryable: boolean;
  exhausted: boolean;
  exceptionType: OperatorExceptionType | null;
}

/** PENDING (-> DISPATCHED outcome) and ACKNOWLEDGED are the normal delivery
 * flow and never open an exception. RETRYABLE_FAILURE is only exceptional
 * once retries are exhausted (typed RETRY_EXHAUSTED, not the outcome's own
 * vocabulary); a bare PERMANENT_FAILURE always opens one. */
export function exceptionForDispatchOutcome(kind: ProviderAcknowledgement["kind"], exhausted: boolean): OperatorExceptionType | null {
  if (kind === "PERMANENT_FAILURE") return "PERMANENT_FAILURE";
  if (kind === "RETRYABLE_FAILURE" && exhausted) return "RETRY_EXHAUSTED";
  return null;
}

/** Pure decision layer for a single dispatch acknowledgement, isolated from
 * the DB so it is directly testable (see scripts/validate-insurance-a2-domain.ts). */
export function resolveDispatchOutcome(kind: ProviderAcknowledgement["kind"], attemptNumber: number): DispatchOutcomeResolution {
  const exhausted = kind === "RETRYABLE_FAILURE" && attemptNumber >= MAX_DELIVERY_ATTEMPTS;
  const intended: DeliveryTransactionState = kind === "ACKNOWLEDGED" ? "ACKNOWLEDGED"
    : kind === "PENDING" ? "AWAITING_PROVIDER"
    : kind === "RETRYABLE_FAILURE" ? (exhausted ? "DEAD_LETTER" : "RETRY_SCHEDULED")
    : "DEAD_LETTER";
  // Attempt outcome reflects what the provider actually said (0004's CHECK
  // vocabulary), independent of whether retries are exhausted.
  const attemptOutcome = kind === "ACKNOWLEDGED" ? "ACKNOWLEDGED"
    : kind === "PENDING" ? "DISPATCHED"
    : kind === "RETRYABLE_FAILURE" ? "RETRYABLE_FAILURE"
    : "PERMANENT_FAILURE";
  const retryable = kind === "RETRYABLE_FAILURE" && !exhausted;
  return { intended, attemptOutcome, retryable, exhausted, exceptionType: exceptionForDispatchOutcome(kind, exhausted) };
}

interface ProviderSubmissionCurrentRow {
  status: DeliveryTransactionState;
  submission_id: string;
  case_id: string;
}

async function readProviderSubmissionCurrent(providerSubmissionId: string): Promise<ProviderSubmissionCurrentRow | null> {
  // FOR UPDATE documents intent and protects a real session-based caller;
  // over the Neon HTTP driver this read cannot hold its lock into the
  // separate batched transaction below (each call is its own HTTP round
  // trip), so the real concurrency guard is the WHERE=<expected prior
  // status> predicate on the UPDATE inside that transaction, verified via
  // RETURNING and retried once on a miss (see recordProviderDispatchResult).
  const rows = (await sql()`
    SELECT status, submission_id, case_id FROM insurance_provider_submissions WHERE id=${providerSubmissionId}::uuid FOR UPDATE
  `) as ProviderSubmissionCurrentRow[];
  return rows[0] ?? null;
}

/** Provider dispatch runs only after the atomic intent commit. */
export async function recordProviderDispatchResult(
  providerSubmissionId: string,
  acknowledgement: ProviderAcknowledgement,
  attemptNumber: number,
  correlationId: string
): Promise<DeliveryTransactionState> {
  void correlationId; // A3 owns operator-facing correlation/timeline links for exceptions.
  assertUuid(providerSubmissionId, "providerSubmissionId");

  const { intended, attemptOutcome, retryable, exceptionType } = resolveDispatchOutcome(acknowledgement.kind, attemptNumber);

  let current = await readProviderSubmissionCurrent(providerSubmissionId);
  if (!current) throw new InsuranceDeliveryDeniedError();

  for (let attempt = 0; attempt < 2; attempt++) {
    const hops = resolveLegalHops(current.status, intended);
    if (!hops) {
      // Illegal transition (e.g. a late worker reporting ACKNOWLEDGED
      // against a submission that has since moved to DEAD_LETTER). The
      // attempt and its claimed outcome are still durable evidence; the
      // provider_submissions row itself is left untouched.
      await sql()`
        INSERT INTO insurance_provider_delivery_attempts (id,provider_submission_id,attempt_number,outcome,retryable)
        VALUES (${randomUUID()}::uuid,${providerSubmissionId}::uuid,${attemptNumber},${attemptOutcome},${retryable})
      `;
      await sql()`
        INSERT INTO insurance_provider_status_events (id,provider_submission_id,webhook_inbox_id,event_type,provider_status,event_hash,occurred_at)
        VALUES (${randomUUID()}::uuid,${providerSubmissionId}::uuid,NULL,${dispatchEventType(intended)},${acknowledgement.providerStatus ?? null},
          ${canonicalSha256({ providerSubmissionId, attemptNumber, intended, rejected: true })},NOW())
        ON CONFLICT DO NOTHING
      `;
      await openProviderSubmissionException(providerSubmissionId, "WEBHOOK_CONFLICT", null);
      return current.status;
    }

    const finalState = hops[hops.length - 1];
    const submissionSteps = submissionAdvancementSteps(finalState);
    const priorStatus = current.status;
    const db = sql();
    const results = await db.transaction((tx) => {
      const queries: ReturnType<typeof tx>[] = [
        tx`INSERT INTO insurance_provider_delivery_attempts (id,provider_submission_id,attempt_number,outcome,retryable)
          VALUES (${randomUUID()}::uuid,${providerSubmissionId}::uuid,${attemptNumber},${attemptOutcome},${retryable})`,
      ];
      let priorHop = priorStatus;
      for (const hop of hops) {
        queries.push(tx`
          INSERT INTO insurance_provider_status_events (id,provider_submission_id,webhook_inbox_id,event_type,provider_status,event_hash,occurred_at)
          VALUES (${randomUUID()}::uuid,${providerSubmissionId}::uuid,NULL,${dispatchEventType(hop)},${acknowledgement.providerStatus ?? null},
            ${canonicalSha256({ providerSubmissionId, attemptNumber, hop, priorHop })},NOW())
          ON CONFLICT DO NOTHING
        `);
        queries.push(tx`
          UPDATE insurance_provider_submissions SET status=${hop},
            provider_external_id=COALESCE(${acknowledgement.providerExternalId ?? null},provider_external_id),
            provider_status=COALESCE(${acknowledgement.providerStatus ?? null},provider_status),
            raw_response_reference=COALESCE(${acknowledgement.rawPayloadReference ?? null},raw_response_reference),
            acknowledged_at=CASE WHEN ${hop}='ACKNOWLEDGED' THEN COALESCE(acknowledged_at,NOW()) ELSE acknowledged_at END,
            updated_at=NOW()
          WHERE id=${providerSubmissionId}::uuid AND status=${priorHop}
          RETURNING id
        `);
        priorHop = hop;
      }
      for (const step of submissionSteps) {
        queries.push(tx`
          UPDATE insurance_submissions SET status=${step.to},updated_at=NOW()
          WHERE id=${current!.submission_id}::uuid AND status=${step.from}
            AND EXISTS (SELECT 1 FROM insurance_provider_submissions WHERE id=${providerSubmissionId}::uuid AND status=${finalState})
        `);
      }
      return queries;
    });

    // index 0 = delivery_attempts insert, index 1 = first hop's status_events
    // insert, index 2 = first hop's provider_submissions UPDATE (RETURNING id).
    const firstHopUpdate = results[2] as { id: string }[];
    if (firstHopUpdate.length > 0) {
      if (exceptionType) await openProviderSubmissionException(providerSubmissionId, exceptionType, null);
      return finalState;
    }

    // Race: the row's status changed between our read and this transaction.
    // Re-read once and re-evaluate; if it still fails, surface a conflict
    // rather than silently dropping the outcome.
    current = await readProviderSubmissionCurrent(providerSubmissionId);
    if (!current) throw new InsuranceDeliveryDeniedError();
  }

  await openProviderSubmissionException(providerSubmissionId, "WEBHOOK_CONFLICT", null);
  return current.status;
}

/* ------------------------------------------------------------------------ *
 * Webhook ingestion
 * ------------------------------------------------------------------------ */

/**
 * Private transport seam. A route is intentionally not exported in A2; named
 * provider source controls and secret ownership are B2 prerequisites.
 */
export async function ingestVerifiedProviderWebhook(
  provider: SubmissionProvider,
  providerConnectionId: string,
  executionMode: RequestedKernelExecutionMode,
  rawBody: string,
  signature: string,
  timestamp: string,
  signatureKeyId: string
): Promise<{ accepted: boolean; duplicate: boolean }> {
  assertProviderMode(provider, executionMode);
  const event = provider.verifyWebhook(rawBody, signature, timestamp);
  const rawHash = canonicalWebhookHash(rawBody);
  // A non-UUID transactionId must never reach a ::uuid cast; treat it as
  // absent and fall back to matching on the provider's external id only.
  const transactionId = isUuid(event.transactionId) ? event.transactionId : null;
  const normalizedReasonCodes = event.normalizedReasonCodes ? JSON.stringify(event.normalizedReasonCodes) : null;

  const inserted = (await sql()`
    INSERT INTO insurance_webhook_inbox (
      id,provider_connection_id,execution_mode,provider_event_id,event_type,occurred_at,signature_key_id,raw_payload_hash,
      transaction_external_id,transaction_id,provider_status,normalized_reason_codes,raw_payload_reference,processing_status
    )
    VALUES (
      ${randomUUID()}::uuid,${providerConnectionId}::uuid,${executionMode},${event.providerEventId},${event.eventType},${event.occurredAt},${signatureKeyId},${rawHash},
      ${event.transactionExternalId ?? null},${transactionId}::uuid,${event.providerStatus ?? null},${normalizedReasonCodes}::jsonb,${event.rawPayloadReference ?? null},'RECEIVED'
    )
    ON CONFLICT (provider_connection_id,provider_event_id) DO NOTHING RETURNING id
  `) as { id: string }[];

  if (inserted[0]) {
    await projectProviderEvent(providerConnectionId, event, inserted[0].id, rawHash);
    return { accepted: true, duplicate: false };
  }

  // Duplicate delivery of an already-known provider_event_id. A provider
  // retry is the recovery mechanism for a projection that got stuck (a
  // transient failure, or a match that only became legal after a later
  // state change) -- it must be allowed to complete, not bounced.
  const existing = (await sql()`
    SELECT id, processing_status FROM insurance_webhook_inbox
    WHERE provider_connection_id=${providerConnectionId}::uuid AND provider_event_id=${event.providerEventId}
    LIMIT 1
  `) as { id: string; processing_status: string }[];
  const row = existing[0];
  if (row && (row.processing_status === "RECEIVED" || row.processing_status === "DEFERRED")) {
    await projectProviderEvent(providerConnectionId, event, row.id, rawHash);
  }
  return { accepted: true, duplicate: true };
}

type ProjectableWebhookEvent = Pick<ProviderWebhookEvent, "transactionExternalId" | "transactionId" | "eventType" | "providerStatus" | "occurredAt">;

function webhookTargetState(eventType: ProjectableWebhookEvent["eventType"]): DeliveryTransactionState {
  return eventType === "SUBMISSION_ACKNOWLEDGED" ? "ACKNOWLEDGED"
    : eventType === "SUBMISSION_FAILED" ? "DEAD_LETTER" : "AWAITING_PROVIDER";
}

async function findMatchingProviderSubmission(providerConnectionId: string, event: ProjectableWebhookEvent) {
  const transactionId = isUuid(event.transactionId) ? event.transactionId : null;
  const rows = (await sql()`
    SELECT id,status,case_id,submission_id FROM insurance_provider_submissions
    WHERE provider_connection_id=${providerConnectionId}::uuid
      AND (provider_external_id=${event.transactionExternalId ?? null} OR id=${transactionId}::uuid)
    LIMIT 1
  `) as { id: string; status: DeliveryTransactionState; case_id: string; submission_id: string }[];
  return rows[0] ?? null;
}

/**
 * Projects one webhook event onto its matching provider submission. Any
 * failure here (including a bug in this function) must not leave the inbox
 * row permanently stuck as an un-flagged 'RECEIVED': it is caught, recorded
 * as an error_code on the inbox row, and left in a state a later retry or
 * reprocessDeferredWebhooks() can pick back up. Nothing here re-throws.
 */
async function projectProviderEvent(providerConnectionId: string, event: ProjectableWebhookEvent, inboxId: string, eventHash: string): Promise<void> {
  try {
    const match = await findMatchingProviderSubmission(providerConnectionId, event);
    if (!match) {
      await sql()`UPDATE insurance_webhook_inbox SET processing_status='DEFERRED',error_code='UNKNOWN_TRANSACTION' WHERE id=${inboxId}::uuid AND processing_status<>'PROJECTED'`;
      await openOrphanWebhookException(inboxId, "WEBHOOK_OUT_OF_ORDER", "UNKNOWN_TRANSACTION");
      return;
    }

    const intended = webhookTargetState(event.eventType);
    let current = match.status;
    for (let attempt = 0; attempt < 2; attempt++) {
      const hops = resolveLegalHops(current, intended);
      if (!hops) {
        await sql()`UPDATE insurance_webhook_inbox SET processing_status='CONFLICT',error_code='ILLEGAL_TRANSITION' WHERE id=${inboxId}::uuid AND processing_status<>'PROJECTED'`;
        // Still durable evidence of what the provider claimed, even though
        // it is out of order relative to this submission's history.
        await sql()`
          INSERT INTO insurance_provider_status_events (id,provider_submission_id,webhook_inbox_id,event_type,provider_status,event_hash,occurred_at)
          VALUES (${randomUUID()}::uuid,${match.id}::uuid,${inboxId}::uuid,${event.eventType},${event.providerStatus ?? null},${eventHash},${event.occurredAt})
          ON CONFLICT DO NOTHING
        `;
        await openProviderSubmissionException(match.id, "WEBHOOK_CONFLICT", inboxId);
        return;
      }

      const finalState = hops[hops.length - 1];
      const submissionSteps = submissionAdvancementSteps(finalState);
      const db = sql();
      const results = await db.transaction((tx) => {
        const queries: ReturnType<typeof tx>[] = [];
        let priorHop = current;
        for (const hop of hops) {
          const isTerminalHop = hop === intended;
          queries.push(tx`
            INSERT INTO insurance_provider_status_events (id,provider_submission_id,webhook_inbox_id,event_type,provider_status,event_hash,occurred_at)
            VALUES (${randomUUID()}::uuid,${match.id}::uuid,${inboxId}::uuid,${isTerminalHop ? event.eventType : dispatchEventType(hop)},${event.providerStatus ?? null},
              ${isTerminalHop ? eventHash : canonicalSha256({ inboxId, hop, eventHash })},${event.occurredAt})
            ON CONFLICT DO NOTHING
          `);
          queries.push(tx`
            UPDATE insurance_provider_submissions SET status=${hop},
              provider_status=COALESCE(${event.providerStatus ?? null},provider_status),
              acknowledged_at=CASE WHEN ${hop}='ACKNOWLEDGED' THEN COALESCE(acknowledged_at,NOW()) ELSE acknowledged_at END,
              updated_at=NOW()
            WHERE id=${match.id}::uuid AND status=${priorHop}
            RETURNING id
          `);
          priorHop = hop;
        }
        for (const step of submissionSteps) {
          queries.push(tx`
            UPDATE insurance_submissions SET status=${step.to},updated_at=NOW()
            WHERE id=${match.submission_id}::uuid AND status=${step.from}
              AND EXISTS (SELECT 1 FROM insurance_provider_submissions WHERE id=${match.id}::uuid AND status=${finalState})
          `);
        }
        queries.push(tx`
          UPDATE insurance_webhook_inbox SET processing_status='PROJECTED',processed_at=NOW(),error_code=NULL
          WHERE id=${inboxId}::uuid AND EXISTS (SELECT 1 FROM insurance_provider_submissions WHERE id=${match.id}::uuid AND status=${finalState})
        `);
        return queries;
      });

      const firstHopUpdate = results[1] as { id: string }[];
      if (firstHopUpdate.length > 0) return;

      const refreshed = (await sql()`SELECT status FROM insurance_provider_submissions WHERE id=${match.id}::uuid`) as { status: DeliveryTransactionState }[];
      if (!refreshed[0]) return;
      current = refreshed[0].status;
    }

    await sql()`UPDATE insurance_webhook_inbox SET processing_status='CONFLICT',error_code='PROJECTION_RACE_EXHAUSTED' WHERE id=${inboxId}::uuid AND processing_status<>'PROJECTED'`;
    await openProviderSubmissionException(match.id, "WEBHOOK_CONFLICT", inboxId);
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 200) : "unknown_projection_error";
    console.error("[insurance-a2] webhook projection failed; inbox row left reprocessable", { inboxId, detail });
    await sql()`
      UPDATE insurance_webhook_inbox SET processing_status='RECEIVED',error_code=${`PROJECTION_ERROR:${detail}`}
      WHERE id=${inboxId}::uuid AND processing_status<>'PROJECTED'
    `;
  }
}

/**
 * Re-projects every RECEIVED/DEFERRED inbox row for a provider connection.
 * This is the recovery path for (a) a webhook that arrived before the
 * provider-submission transaction it belongs to had committed, and (b) a
 * projection that failed transiently and was left reprocessable rather than
 * thrown away. Never throws; callers treat this as best-effort.
 */
export async function reprocessDeferredWebhooks(providerConnectionId: string): Promise<number> {
  assertUuid(providerConnectionId, "providerConnectionId");
  const rows = (await sql()`
    SELECT id, event_type, occurred_at, raw_payload_hash, transaction_external_id, transaction_id, provider_status
    FROM insurance_webhook_inbox
    WHERE provider_connection_id=${providerConnectionId}::uuid AND processing_status IN ('RECEIVED','DEFERRED')
    ORDER BY occurred_at, id
  `) as {
    id: string; event_type: ProviderWebhookEvent["eventType"]; occurred_at: string; raw_payload_hash: string;
    transaction_external_id: string | null; transaction_id: string | null; provider_status: string | null;
  }[];
  let reprocessed = 0;
  for (const row of rows) {
    const event: ProjectableWebhookEvent = {
      eventType: row.event_type,
      occurredAt: row.occurred_at,
      transactionExternalId: row.transaction_external_id ?? undefined,
      transactionId: row.transaction_id ?? undefined,
      providerStatus: row.provider_status ?? undefined,
    };
    await projectProviderEvent(providerConnectionId, event, row.id, row.raw_payload_hash);
    reprocessed += 1;
  }
  return reprocessed;
}

/* ------------------------------------------------------------------------ *
 * Projection rebuild
 * ------------------------------------------------------------------------ */

const DELIVERY_STATE_NAMES: ReadonlySet<string> = new Set(DELIVERY_TRANSACTION_STATES);

/** Decodes a status-event's target state from either vocabulary: the
 * provider webhook event types (SUBMISSION_ACKNOWLEDGED/PENDING/FAILED) or
 * this module's own DISPATCH_<state> dispatch-sourced events. Returns null
 * for an event type the fold does not recognize (never thrown -- an
 * unrecognized event is itself evidence, just not a state transition). */
export function deliveryStateForStatusEvent(eventType: string): DeliveryTransactionState | null {
  if (eventType.startsWith(DISPATCH_EVENT_PREFIX)) {
    const candidate = eventType.slice(DISPATCH_EVENT_PREFIX.length);
    return DELIVERY_STATE_NAMES.has(candidate) ? (candidate as DeliveryTransactionState) : null;
  }
  switch (eventType) {
    case "SUBMISSION_ACKNOWLEDGED": return "ACKNOWLEDGED";
    case "SUBMISSION_FAILED": return "DEAD_LETTER";
    case "SUBMISSION_PENDING": return "AWAITING_PROVIDER";
    default: return null;
  }
}

export interface DeliveryFold {
  state: DeliveryTransactionState;
  /** Indices into the input array whose transition was actually applied
   * (i.e. not skip-with-note), in encounter order. */
  appliedIndices: number[];
}

/**
 * Pure, order-sensitive fold over a sequence of status-event event_types,
 * starting from PENDING_DISPATCH (zero events therefore fold to
 * PENDING_DISPATCH, never AWAITING_PROVIDER). Each event's target state is
 * applied only if canTransitionDelivery() allows it from the fold's current
 * state at that point in the sequence. An event whose transition is illegal
 * at that point (a late/out-of-order/conflicting event that
 * projectProviderEvent or recordProviderDispatchResult still recorded as
 * durable evidence without ever applying it live) is skipped without
 * changing the fold state -- skip-with-note, not an error.
 *
 * Isolated from the DB so it is directly testable (see
 * scripts/validate-insurance-a2-domain.ts), and shared by
 * rebuildProviderProjection() below.
 */
export function foldDeliveryStatusEvents(eventTypes: readonly string[]): DeliveryFold {
  let state: DeliveryTransactionState = "PENDING_DISPATCH";
  const appliedIndices: number[] = [];
  eventTypes.forEach((eventType, index) => {
    const target = deliveryStateForStatusEvent(eventType);
    if (target === null) return; // unrecognized event type: skip-with-note, not counted as a transition
    if (target === state || canTransitionDelivery(state, target)) {
      state = target;
      appliedIndices.push(index);
    }
    // else: skip-with-note -- illegal at this point in the fold.
  });
  return { state, appliedIndices };
}

/**
 * Rebuild uses append-only status evidence; it never trusts a mutable UI
 * projection. See foldDeliveryStatusEvents() for the fold semantics.
 */
export async function rebuildProviderProjection(providerSubmissionId: string): Promise<void> {
  assertUuid(providerSubmissionId, "providerSubmissionId");
  const rows = (await sql()`
    SELECT event_type,provider_status,event_hash,occurred_at FROM insurance_provider_status_events
    WHERE provider_submission_id=${providerSubmissionId}::uuid ORDER BY occurred_at,id
  `) as { event_type: string; provider_status: string | null; event_hash: string; occurred_at: string }[];

  const { state, appliedIndices } = foldDeliveryStatusEvents(rows.map((row) => row.event_type));
  const appliedEventHashes = appliedIndices.map((index) => rows[index].event_hash);

  const projectionHash = canonicalSha256({ providerSubmissionId, state, events: appliedEventHashes });
  await sql()`
    INSERT INTO insurance_provider_submission_projections (provider_submission_id,state,projection_hash,source_event_count,last_event_at,rebuilt_at)
    VALUES (${providerSubmissionId}::uuid,${state},${projectionHash},${rows.length},${rows.at(-1)?.occurred_at ?? null},NOW())
    ON CONFLICT (provider_submission_id) DO UPDATE SET state=EXCLUDED.state,projection_hash=EXCLUDED.projection_hash,source_event_count=EXCLUDED.source_event_count,last_event_at=EXCLUDED.last_event_at,rebuilt_at=NOW()
  `;
}
