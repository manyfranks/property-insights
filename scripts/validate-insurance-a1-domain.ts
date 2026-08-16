import { resolveKernelExecution } from "../src/config/insurance-kernel/execution-mode";
import { postHogEventContainsInsuranceCapability } from "../src/lib/insurance/privacy/sensitive-routes";
import {
  assertA1StateDoesNotClaimProviderEvidence,
  assertCaseTransition,
  assertSubmissionTransition,
} from "../src/lib/insurance/domain/states";
import { assertAnswerProvenance, hashAccessToken } from "../src/lib/insurance/domain/submission";
import {
  consentTextWithVendor,
  CONSENT_TEXT_WITHOUT_VENDOR,
  coverageProfileConsentTextV1,
} from "../src/lib/insurance/domain/consent-v1";

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

// F4 regression: lock the byte-exact "coverage-profile-consent-v1" wording
// (owner+counsel approved, legally frozen — see the do-not-edit guard on
// consentTextWithVendor in src/lib/insurance/domain/consent-v1.ts). The
// function's only free variables are vendorName and regionName — country
// and insurance line only influence which vendor/region flow in upstream
// (resolveVendor / regionFullName in src/components/insurance/resolve-vendor.ts,
// not re-tested here) — so representative vendor/region substitutions are
// sufficient to catch any accidental wording change before it reaches the
// build, rather than trusting a client-supplied consentText as-is.
expect(
  consentTextWithVendor("Test Insurer Co.", "Test Region") ===
    "Yes — share my property details with Test Insurer Co. (licensed in Test Region) so they can contact me " +
      "about insurance. I understand Property Insights may earn a referral fee if I do business with them, " +
      "and that Test Insurer Co. alone provides any insurance quotes, advice, or coverage.",
  "consent-v1 vendor-variant wording changed"
);
expect(
  consentTextWithVendor("Another Brokerage", "British Columbia") ===
    "Yes — share my property details with Another Brokerage (licensed in British Columbia) so they can contact me " +
      "about insurance. I understand Property Insights may earn a referral fee if I do business with them, " +
      "and that Another Brokerage alone provides any insurance quotes, advice, or coverage.",
  "consent-v1 vendor-variant wording changed for a second (vendor, region) combination"
);
expect(
  CONSENT_TEXT_WITHOUT_VENDOR ===
    "Yes — share my property details with a licensed insurance brokerage for my region so they can contact " +
      "me about insurance. Any insurance quotes, advice, or coverage come from that licensed brokerage — " +
      "Property Insights does not sell, quote, or bind insurance.",
  "consent-v1 no-vendor wording changed"
);
expect(
  coverageProfileConsentTextV1(null, "Texas") === CONSENT_TEXT_WITHOUT_VENDOR,
  "coverageProfileConsentTextV1 must fall back to the no-vendor text when no vendor resolves"
);
expect(
  coverageProfileConsentTextV1("Test Insurer Co.", "Texas") === consentTextWithVendor("Test Insurer Co.", "Texas"),
  "coverageProfileConsentTextV1 must match consentTextWithVendor when a vendor resolves"
);

console.log("insurance A1 domain and privacy validation passed");
