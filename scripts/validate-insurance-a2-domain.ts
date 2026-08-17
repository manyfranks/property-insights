import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolveKernelExecution } from "../src/config/insurance-kernel/execution-mode";
import {
  assertProviderMode,
  canTransitionDelivery,
  isUuid,
  verifyHmacWebhook,
  type ProviderEnvelope,
  type SubmissionProvider,
} from "../src/lib/insurance/domain/delivery";
import { assertA2SubmissionTransition } from "../src/lib/insurance/domain/states";
import {
  exceptionForDispatchOutcome,
  foldDeliveryStatusEvents,
  MAX_DELIVERY_ATTEMPTS,
  resolveDispatchOutcome,
  resolveLegalHops,
  submissionAdvancementSteps,
} from "../src/lib/insurance/application/delivery";

function expect(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`[insurance-a2-domain] ${message}`);
}

/** rejects() must assert on the SPECIFIC expected failure, not merely that
 * something threw -- otherwise an assertion that has quietly stopped
 * exercising the intended guard (e.g. it now fails one line earlier, for an
 * unrelated reason) would still report green. */
function rejects(action: () => unknown, expectedMessageSubstring: string, message: string): void {
  try {
    action();
  } catch (error) {
    const actual = error instanceof Error ? error.message : String(error);
    if (!actual.includes(expectedMessageSubstring)) {
      throw new Error(`[insurance-a2-domain] ${message}: expected error containing "${expectedMessageSubstring}", got "${actual}"`);
    }
    return;
  }
  throw new Error(`[insurance-a2-domain] ${message}: expected an error containing "${expectedMessageSubstring}", but nothing threw`);
}

const noOpProvider: SubmissionProvider = {
  key: "deterministic-simulator",
  supportedModes: ["SIMULATION", "SANDBOX"],
  async submit() { return { kind: "PENDING" }; },
  verifyWebhook() { throw new Error("not reached"); },
};

assertProviderMode(noOpProvider, "SIMULATION");
rejects(() => assertProviderMode(noOpProvider, "PRODUCTION"), "not authorized for PRODUCTION", "simulator's declared modes must exclude production");
// Even a (hypothetically) misconfigured connection that claims PRODUCTION
// support must still be rejected specifically as impossible for the simulator.
const misconfiguredSimulator: SubmissionProvider = { ...noOpProvider, supportedModes: ["SIMULATION", "SANDBOX", "PRODUCTION"] };
rejects(() => assertProviderMode(misconfiguredSimulator, "PRODUCTION"), "impossible in production", "simulator must be impossible in production even if misconfigured to claim it");
expect(canTransitionDelivery("PENDING_DISPATCH", "AWAITING_PROVIDER"), "dispatch may await provider");
expect(canTransitionDelivery("AWAITING_PROVIDER", "RETRY_SCHEDULED"), "awaiting provider may retry");
expect(canTransitionDelivery("DEAD_LETTER", "AWAITING_PROVIDER"), "operator replay may re-await provider");
expect(!canTransitionDelivery("PENDING_DISPATCH", "ACKNOWLEDGED"), "success cannot be inferred before provider evidence");
expect(!canTransitionDelivery("ACKNOWLEDGED", "AWAITING_PROVIDER"), "acknowledged work cannot silently regress");
assertA2SubmissionTransition("READY", "SUBMITTING");
assertA2SubmissionTransition("SUBMITTING", "AWAITING_PROVIDER");
rejects(() => assertA2SubmissionTransition("AWAITING_PROVIDER", "SUBMITTING"), "forbidden submission transition", "timeouts cannot silently regress or infer a resend");

// F8: withdrawal must be reachable from an in-flight or errored submission,
// not only before dispatch.
assertA2SubmissionTransition("SUBMITTING", "WITHDRAWN");
assertA2SubmissionTransition("PROVIDER_ERROR", "WITHDRAWN");

const raw = JSON.stringify({ providerEventId: randomUUID(), eventType: "SUBMISSION_ACKNOWLEDGED" });
const secret = "a2-test-secret";
const timestamp = new Date().toISOString();
const signature = createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");
verifyHmacWebhook(raw, signature, timestamp, secret);
rejects(() => verifyHmacWebhook(raw, "0".repeat(64), timestamp, secret), "invalid webhook signature", "invalid signatures must fail before inbox write");
rejects(() => verifyHmacWebhook(raw, signature, new Date(Date.now() - 301_000).toISOString(), secret), "timestamp expired", "expired webhooks must fail before inbox write");

// F2(a): a non-UUID transactionId must never reach a ::uuid cast.
expect(isUuid(randomUUID()), "a real UUID must pass the guard");
expect(!isUuid("not-a-uuid"), "a non-UUID value must be treated as absent, not cast");
expect(!isUuid(undefined), "an absent transactionId must be treated as absent");

const production = resolveKernelExecution({
  NODE_ENV: "production", VERCEL_ENV: "production", INSURANCE_KERNEL_EXECUTION_MODE: "PRODUCTION",
  INSURANCE_KERNEL_ENABLE_QUOTE_REQUEST: "1",
});
expect(!production.simulatorOutputsAllowed, "production must never enable simulator outputs");
const malformed = resolveKernelExecution({ NODE_ENV: "production", VERCEL_ENV: "production", INSURANCE_KERNEL_EXECUTION_MODE: "PRODUCTION", INSURANCE_KERNEL_ENABLE_QUOTE_REQUEST: "true" });
expect(!malformed.features.quoteRequest, "non-exact delivery flags must fail closed");

const envelope: ProviderEnvelope = {
  requestId: randomUUID(), idempotencyKey: randomUUID(), correlationId: randomUUID(), causationId: null,
  executionMode: "SIMULATION", caseId: randomUUID(), aggregateId: randomUUID(), schemaVersion: "a2-v1",
  consentArtifactIds: [randomUUID()], authorityDecisionId: null, providerConnectionId: randomUUID(), requestedAt: new Date().toISOString(),
};
expect(envelope.executionMode === "SIMULATION", "fixture envelope must retain mode as an immutable fact");

/* ------------------------------------------------------------------------ *
 * F1 / F5 / F7 / F9: application-layer delivery decision logic
 * ------------------------------------------------------------------------ */

// F1: an illegal transition (a late worker reporting ACKNOWLEDGED against a
// submission that has since moved to DEAD_LETTER) must be denied, not
// silently applied.
expect(resolveLegalHops("DEAD_LETTER", "ACKNOWLEDGED") === null, "DEAD_LETTER -> ACKNOWLEDGED must be denied (late-worker conflict)");
expect(resolveLegalHops("RECONCILIATION_REQUIRED", "AWAITING_PROVIDER") !== null, "reconciliation-triggered redispatch must remain legal (F1 legal-source handling)");
expect(resolveLegalHops("RECONCILIATION_REQUIRED", "ACKNOWLEDGED") !== null, "reconciliation may resolve directly to acknowledged");
{
  const sameState = resolveLegalHops("ACKNOWLEDGED", "ACKNOWLEDGED");
  expect(sameState !== null && sameState.length === 1 && sameState[0] === "ACKNOWLEDGED", "same-state dispatch result must be treated as an idempotent no-op, not an error");
}

// F5: a synchronous acknowledgement (no separate awaiting-provider window in
// real time) is represented in the ledger as two events -- an
// AWAITING_PROVIDER bridge, then ACKNOWLEDGED -- and rebuild must fold both
// back to ACKNOWLEDGED. Zero events must fold to PENDING_DISPATCH, never
// AWAITING_PROVIDER.
{
  const syncAckHops = resolveLegalHops("PENDING_DISPATCH", "ACKNOWLEDGED");
  expect(syncAckHops !== null && syncAckHops.length === 2 && syncAckHops[0] === "AWAITING_PROVIDER" && syncAckHops[1] === "ACKNOWLEDGED",
    "a synchronous ack from a fresh dispatch must bridge through AWAITING_PROVIDER in the ledger");
  const rebuilt = foldDeliveryStatusEvents(["DISPATCH_AWAITING_PROVIDER", "DISPATCH_ACKNOWLEDGED"]);
  expect(rebuilt.state === "ACKNOWLEDGED", "rebuild of a synchronously-acknowledged transaction must reproduce ACKNOWLEDGED");
  expect(rebuilt.appliedIndices.length === 2, "both bridge events must be counted as applied");
}
expect(foldDeliveryStatusEvents([]).state === "PENDING_DISPATCH", "zero ledger events must fold to PENDING_DISPATCH, never AWAITING_PROVIDER");
{
  // A late, out-of-order webhook recorded as durable evidence without ever
  // being applied live must be skip-with-noted, not silently reproduced.
  const withConflict = foldDeliveryStatusEvents(["DISPATCH_AWAITING_PROVIDER", "DISPATCH_DEAD_LETTER", "SUBMISSION_ACKNOWLEDGED"]);
  expect(withConflict.state === "DEAD_LETTER", "an illegal late event must be skipped, not silently resurrect the transaction");
  expect(withConflict.appliedIndices.length === 2, "the skipped illegal event must not count as applied");
}
{
  // All six delivery states must be reachable by the fold.
  const allSix = foldDeliveryStatusEvents([
    "DISPATCH_AWAITING_PROVIDER", "DISPATCH_ACKNOWLEDGED",
  ]);
  expect(allSix.state === "ACKNOWLEDGED", "sanity: fold reaches ACKNOWLEDGED");
  const retrySchedule = foldDeliveryStatusEvents(["DISPATCH_RETRY_SCHEDULED"]);
  expect(retrySchedule.state === "RETRY_SCHEDULED", "fold reaches RETRY_SCHEDULED");
  const deadLetter = foldDeliveryStatusEvents(["DISPATCH_DEAD_LETTER"]);
  expect(deadLetter.state === "DEAD_LETTER", "fold reaches DEAD_LETTER");
  const reconciliation = foldDeliveryStatusEvents(["DISPATCH_AWAITING_PROVIDER", "DISPATCH_ACKNOWLEDGED", "DISPATCH_RECONCILIATION_REQUIRED"]);
  expect(reconciliation.state === "RECONCILIATION_REQUIRED", "fold reaches RECONCILIATION_REQUIRED");
}

// F9: PENDING is the normal DELAYED_ACK flow and must never open an
// exception; ACKNOWLEDGED never does either. RETRYABLE_FAILURE is only
// exceptional once retries are exhausted (typed RETRY_EXHAUSTED, not the
// outcome's own vocabulary); PERMANENT_FAILURE always opens one.
expect(exceptionForDispatchOutcome("PENDING", false) === null, "PENDING must never open an operator exception");
expect(exceptionForDispatchOutcome("ACKNOWLEDGED", false) === null, "ACKNOWLEDGED must never open an operator exception");
expect(exceptionForDispatchOutcome("RETRYABLE_FAILURE", false) === null, "a non-exhausted retry must not open an exception");
expect(exceptionForDispatchOutcome("RETRYABLE_FAILURE", true) === "RETRY_EXHAUSTED", "retry exhaustion must open a RETRY_EXHAUSTED exception");
expect(exceptionForDispatchOutcome("PERMANENT_FAILURE", false) === "PERMANENT_FAILURE", "a permanent failure must open a PERMANENT_FAILURE exception");

{
  const pending = resolveDispatchOutcome("PENDING", 1);
  expect(pending.intended === "AWAITING_PROVIDER", "PENDING must intend AWAITING_PROVIDER");
  expect(pending.attemptOutcome === "DISPATCHED", "PENDING's recorded attempt outcome must be DISPATCHED, not TIMEOUT");
  expect(pending.exceptionType === null, "PENDING creates no exception");

  const belowMax = resolveDispatchOutcome("RETRYABLE_FAILURE", MAX_DELIVERY_ATTEMPTS - 1);
  expect(!belowMax.exhausted && belowMax.intended === "RETRY_SCHEDULED" && belowMax.exceptionType === null, "a retry below the exhaustion threshold must stay RETRY_SCHEDULED with no exception");

  const atMax = resolveDispatchOutcome("RETRYABLE_FAILURE", MAX_DELIVERY_ATTEMPTS);
  expect(atMax.exhausted && atMax.intended === "DEAD_LETTER" && atMax.exceptionType === "RETRY_EXHAUSTED", "exhausting retries must dead-letter with a RETRY_EXHAUSTED exception");
}

// F7: ACKNOWLEDGED must wire through to a real SUBMITTED advancement, using
// assertA2SubmissionTransition to validate every hop against the domain's
// own submission state machine.
{
  const ackSteps = submissionAdvancementSteps("ACKNOWLEDGED");
  expect(ackSteps.length === 2, "an acknowledgement must advance the submission in two guarded hops");
  expect(ackSteps[0].from === "SUBMITTING" && ackSteps[0].to === "AWAITING_PROVIDER", "first hop must be SUBMITTING -> AWAITING_PROVIDER");
  expect(ackSteps[1].from === "AWAITING_PROVIDER" && ackSteps[1].to === "SUBMITTED", "second hop must be AWAITING_PROVIDER -> SUBMITTED");
  expect(ackSteps.some((step) => step.to === "SUBMITTED"), "SUBMITTED must be reachable via the wired advancement");
}
{
  const deadLetterSteps = submissionAdvancementSteps("DEAD_LETTER");
  expect(deadLetterSteps.some((step) => step.from === "SUBMITTING" && step.to === "PROVIDER_ERROR"), "a permanent failure while still SUBMITTING must reach PROVIDER_ERROR");
  expect(deadLetterSteps.some((step) => step.from === "AWAITING_PROVIDER" && step.to === "PROVIDER_ERROR"), "a permanent failure while AWAITING_PROVIDER must also reach PROVIDER_ERROR");
}
expect(submissionAdvancementSteps("PENDING_DISPATCH").length === 0, "a submission still PENDING_DISPATCH has nothing to advance yet");

const deliverySource = readFileSync("src/lib/insurance/application/delivery.ts", "utf8");
expect(!/posthog|capture\(/i.test(deliverySource), "A2 delivery must not emit case, consent, or provider payloads to analytics");
expect(!/console\.(log|error).*rawBody/i.test(deliverySource), "A2 must not log signed/raw webhook bodies");
console.log("insurance A2 domain validation passed");
