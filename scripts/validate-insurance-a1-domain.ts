import { resolveKernelExecution } from "../src/config/insurance-kernel/execution-mode";
import { postHogEventContainsInsuranceCapability } from "../src/lib/insurance/privacy/sensitive-routes";
import {
  assertA1StateDoesNotClaimProviderEvidence,
  assertCaseTransition,
  assertSubmissionTransition,
} from "../src/lib/insurance/domain/states";
import { assertAnswerProvenance, hashAccessToken } from "../src/lib/insurance/domain/submission";

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[insurance-a1-validation] ${message}`);
}

function mustReject(action: () => void, message: string): void {
  let rejected = false;
  try { action(); } catch { rejected = true; }
  expect(rejected, message);
}

assertCaseTransition("DRAFT", "READY_FOR_SUBMISSION");
assertSubmissionTransition("DRAFT", "READY");
mustReject(() => assertCaseTransition("READY_FOR_SUBMISSION", "DRAFT"), "finalized cases cannot move backward");
mustReject(() => assertSubmissionTransition("READY", "DRAFT"), "finalized submissions cannot be edited in place");
for (const state of ["SUBMITTED", "AWAITING_PROVIDER", "QUOTED", "BOUND"]) {
  mustReject(() => assertA1StateDoesNotClaimProviderEvidence(state), `${state} must require provider evidence`);
}

assertAnswerProvenance({
  id: crypto.randomUUID(),
  questionKey: "property.roof_age",
  answerKind: "ATTESTATION",
  value: 12,
  origin: "USER",
  correctsAnswerId: crypto.randomUUID(),
});
mustReject(
  () => assertAnswerProvenance({
    id: crypto.randomUUID(),
    questionKey: "property.roof_age",
    answerKind: "EVIDENCE",
    value: 12,
    origin: "MODEL_HINT",
    correctsAnswerId: crypto.randomUUID(),
  }),
  "model evidence cannot overwrite source evidence"
);
const rawToken = Buffer.alloc(32, 7).toString("base64url");
expect(hashAccessToken(rawToken).length === 64, "access tokens must be stored only as SHA-256 hashes");
mustReject(() => hashAccessToken("visible-token"), "short access tokens must fail closed");

expect(
  postHogEventContainsInsuranceCapability({ properties: { $current_url: `https://propertyinsights.xyz/insurance/case/${rawToken}` } }),
  "capability URL must be rejected from PostHog"
);
expect(
  !postHogEventContainsInsuranceCapability({ properties: { $current_url: "https://propertyinsights.xyz/insurance" } }),
  "ordinary insurance pages may retain baseline analytics"
);
expect(
  postHogEventContainsInsuranceCapability({ properties: { caseAccessToken: rawToken } }),
  "capability tokens must be rejected even when a caller tries to attach one as an analytics property"
);
expect(
  postHogEventContainsInsuranceCapability({ properties: { consentText: "frozen text" } }),
  "consent payloads must be rejected from PostHog"
);

const narrowed = resolveKernelExecution({
  NODE_ENV: "development",
  INSURANCE_KERNEL_EXECUTION_MODE: "SIMULATION",
  INSURANCE_KERNEL_ENABLE_CASE_PORTAL: "1",
});
expect(!narrowed.features.casePortal, "misconfigured portal flag must narrow to disabled");

console.log("insurance A1 domain and privacy validation passed");
