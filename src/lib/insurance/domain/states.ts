export const A1_CASE_STATES = ["DRAFT", "COLLECTING_FACTS", "READY_FOR_SUBMISSION", "WITHDRAWN"] as const;
export type A1CaseState = (typeof A1_CASE_STATES)[number];

export const A1_SUBMISSION_STATES = ["DRAFT", "READY", "WITHDRAWN"] as const;
export type A1SubmissionState = (typeof A1_SUBMISSION_STATES)[number];

const CASE_TRANSITIONS: Readonly<Record<A1CaseState, readonly A1CaseState[]>> = {
  DRAFT: ["COLLECTING_FACTS", "READY_FOR_SUBMISSION", "WITHDRAWN"],
  COLLECTING_FACTS: ["READY_FOR_SUBMISSION", "WITHDRAWN"],
  // A finalized case can re-enter fact collection only by creating a new
  // immutable submission version. This is an A1-local edit state, never a
  // provider delivery/review/quote claim.
  READY_FOR_SUBMISSION: ["COLLECTING_FACTS", "WITHDRAWN"],
  WITHDRAWN: [],
};

const SUBMISSION_TRANSITIONS: Readonly<Record<A1SubmissionState, readonly A1SubmissionState[]>> = {
  DRAFT: ["READY", "WITHDRAWN"],
  READY: ["WITHDRAWN"],
  WITHDRAWN: [],
};

const PROVIDER_EVIDENCE_STATES = new Set([
  "SUBMISSION_IN_PROGRESS",
  "SUBMITTING",
  "AWAITING_PROVIDER",
  "SUBMITTED",
  "QUOTED",
  "REFERRED",
  "INSPECTION_REQUIRED",
  "DECLINED",
  "PROVIDER_ERROR",
  "SELECTED",
  "BINDING",
  "BOUND",
  "ISSUED",
]);

export function assertA1StateDoesNotClaimProviderEvidence(state: string): void {
  if (PROVIDER_EVIDENCE_STATES.has(state)) {
    throw new Error(`insurance-a1: state ${state} requires the A2 provider-acknowledgement spine`);
  }
}

export function assertCaseTransition(from: A1CaseState, to: A1CaseState): void {
  assertA1StateDoesNotClaimProviderEvidence(to);
  if (!CASE_TRANSITIONS[from].includes(to)) {
    throw new Error(`insurance-a1: forbidden case transition ${from} -> ${to}`);
  }
}

export function assertSubmissionTransition(from: A1SubmissionState, to: A1SubmissionState): void {
  assertA1StateDoesNotClaimProviderEvidence(to);
  if (!SUBMISSION_TRANSITIONS[from].includes(to)) {
    throw new Error(`insurance-a1: forbidden submission transition ${from} -> ${to}`);
  }
}

/** A2 is an explicit extension, not a weakening of A1's local-only guard. */
export const A2_SUBMISSION_STATES = ["READY", "SUBMITTING", "AWAITING_PROVIDER", "SUBMITTED", "PROVIDER_ERROR", "WITHDRAWN"] as const;
export type A2SubmissionState = (typeof A2_SUBMISSION_STATES)[number];

const A2_SUBMISSION_TRANSITIONS: Readonly<Record<A2SubmissionState, readonly A2SubmissionState[]>> = {
  READY: ["SUBMITTING", "WITHDRAWN"],
  // Withdrawal must remain reachable while a delivery is in flight or stuck
  // in error, not only before dispatch. Cancelling the in-flight provider
  // transaction itself is B2 scope; this only lets the local submission
  // record its owner's withdrawal intent.
  SUBMITTING: ["AWAITING_PROVIDER", "PROVIDER_ERROR", "WITHDRAWN"],
  // A timeout stays ambiguous: neither success nor decline may be inferred.
  AWAITING_PROVIDER: ["SUBMITTED", "PROVIDER_ERROR", "WITHDRAWN"],
  SUBMITTED: [],
  PROVIDER_ERROR: ["AWAITING_PROVIDER", "WITHDRAWN"],
  WITHDRAWN: [],
};

export function assertA2SubmissionTransition(from: A2SubmissionState, to: A2SubmissionState): void {
  if (!A2_SUBMISSION_TRANSITIONS[from].includes(to)) {
    throw new Error(`insurance-a2: forbidden submission transition ${from} -> ${to}`);
  }
}
