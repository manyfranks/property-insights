import { createHmac, timingSafeEqual } from "node:crypto";
import type { RequestedKernelExecutionMode } from "@/config/insurance-kernel/execution-mode";
import { canonicalJson, canonicalSha256 } from "./submission";

/** A2 deliberately stops before quote, bind, policy, billing, or claims facts. */
export const DELIVERY_TRANSACTION_STATES = [
  "PENDING_DISPATCH",
  "AWAITING_PROVIDER",
  "ACKNOWLEDGED",
  "RETRY_SCHEDULED",
  "DEAD_LETTER",
  "RECONCILIATION_REQUIRED",
] as const;
export type DeliveryTransactionState = (typeof DELIVERY_TRANSACTION_STATES)[number];

export interface ProviderEnvelope {
  requestId: string;
  idempotencyKey: string;
  correlationId: string;
  causationId: string | null;
  executionMode: RequestedKernelExecutionMode;
  caseId: string;
  aggregateId: string;
  schemaVersion: string;
  consentArtifactIds: readonly string[];
  authorityDecisionId: string | null;
  providerConnectionId: string;
  requestedAt: string;
}

export interface SubmissionProviderRequest {
  envelope: ProviderEnvelope;
  /** Canonical submission reference only; adapters load no implicit case facts. */
  submissionId: string;
  submissionVersion: number;
  requestHash: string;
  /** Demo-only scenario selector. Never set by a production adapter. */
  simulationScenario?: "SUCCESS" | "DELAYED_ACK" | "TIMEOUT" | "RETRYABLE_FAILURE" | "PERMANENT_FAILURE";
}

export interface ProviderAcknowledgement {
  kind: "ACKNOWLEDGED" | "PENDING" | "RETRYABLE_FAILURE" | "PERMANENT_FAILURE";
  providerExternalId?: string;
  providerStatus?: string;
  normalizedReasonCodes?: readonly string[];
  retryAfterSeconds?: number;
  rawPayloadReference?: string;
}

export interface ProviderWebhookEvent {
  providerKey: string;
  providerEventId: string;
  occurredAt: string;
  transactionExternalId?: string;
  transactionId?: string;
  eventType: "SUBMISSION_ACKNOWLEDGED" | "SUBMISSION_PENDING" | "SUBMISSION_FAILED";
  providerStatus?: string;
  normalizedReasonCodes?: readonly string[];
  rawPayloadReference?: string;
}

export interface SubmissionProvider {
  readonly key: string;
  readonly supportedModes: readonly RequestedKernelExecutionMode[];
  submit(request: SubmissionProviderRequest): Promise<ProviderAcknowledgement>;
  verifyWebhook(rawBody: string, signature: string, timestamp: string): ProviderWebhookEvent;
  reconcile?(transactionExternalId: string): Promise<ProviderAcknowledgement>;
}

/** Single source of truth for the simulator's key; A2 had this string literal
 * duplicated at five call sites, which is how a rename or a typo becomes a
 * silent authority-gate bypass. */
export const DETERMINISTIC_SIMULATOR_PROVIDER_KEY = "deterministic-simulator";

export function assertProviderMode(provider: SubmissionProvider, mode: RequestedKernelExecutionMode): void {
  if (!provider.supportedModes.includes(mode)) {
    throw new Error(`insurance-a2: provider ${provider.key} is not authorized for ${mode}`);
  }
  if (provider.key === DETERMINISTIC_SIMULATOR_PROVIDER_KEY && mode === "PRODUCTION") {
    throw new Error("insurance-a2: simulator is impossible in production");
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Guards raw provider-supplied identifiers before they are interpolated
 * into a `::uuid` cast. A non-UUID value must never reach the database as an
 * attempted cast; it must instead be treated as absent. */
export function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Webhook integrity belongs at the provider boundary, before any DB write. */
export function verifyHmacWebhook(
  rawBody: string,
  signature: string,
  timestamp: string,
  secret: string,
  now = Date.now(),
  toleranceSeconds = 300
): void {
  const received = Date.parse(timestamp);
  if (!Number.isFinite(received) || Math.abs(now - received) > toleranceSeconds * 1000) {
    throw new Error("insurance-a2: webhook timestamp expired or invalid");
  }
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const supplied = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  if (supplied.length !== expectedBuffer.length || !timingSafeEqual(supplied, expectedBuffer)) {
    throw new Error("insurance-a2: invalid webhook signature");
  }
}

export function canonicalWebhookHash(rawBody: string): string {
  // The raw body (not a parsed/re-serialized body) is the signed evidence.
  return canonicalSha256({ rawBody });
}

export function canonicalEnvelopeHash(envelope: ProviderEnvelope, submissionId: string, requestHash: string): string {
  return canonicalSha256({ envelope: JSON.parse(canonicalJson(envelope)), submissionId, requestHash });
}

export function canTransitionDelivery(
  from: DeliveryTransactionState,
  to: DeliveryTransactionState
): boolean {
  const allowed: Readonly<Record<DeliveryTransactionState, readonly DeliveryTransactionState[]>> = {
    PENDING_DISPATCH: ["AWAITING_PROVIDER", "RETRY_SCHEDULED", "DEAD_LETTER"],
    AWAITING_PROVIDER: ["ACKNOWLEDGED", "RETRY_SCHEDULED", "DEAD_LETTER", "RECONCILIATION_REQUIRED"],
    ACKNOWLEDGED: ["RECONCILIATION_REQUIRED"],
    RETRY_SCHEDULED: ["AWAITING_PROVIDER", "DEAD_LETTER"],
    DEAD_LETTER: ["AWAITING_PROVIDER"],
    RECONCILIATION_REQUIRED: ["AWAITING_PROVIDER", "ACKNOWLEDGED", "DEAD_LETTER"],
  };
  return allowed[from].includes(to);
}
