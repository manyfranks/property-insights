export const A1_CASE_STATES = ["DRAFT", "COLLECTING_FACTS", "READY_FOR_SUBMISSION", "WITHDRAWN"] as const;
export type A1CaseState = (typeof A1_CASE_STATES)[number];

export const A1_SUBMISSION_STATES = ["DRAFT", "READY", "WITHDRAWN"] as const;
export type A1SubmissionState = (typeof A1_SUBMISSION_STATES)[number];

const CASE_TRANSITIONS: Readonly<Record<A1CaseState, readonly A1CaseState[]>> = {
  DRAFT: ["COLLECTING_FACTS", "READY_FOR_SUBMISSION", "WITHDRAWN"],
  COLLECTING_FACTS: ["READY_FOR_SUBMISSION", "WITHDRAWN"],
  READY_FOR_SUBMISSION: ["WITHDRAWN"],
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
