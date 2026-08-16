/**
 * POST /api/coverage-profile
 *
 * Stores a coverage profile — the prefilled property snapshot plus the ~6
 * questions only the user can answer — ahead of the existing affiliate
 * handoff. A1 can additionally dual-write a canonical case and immutable
 * submission, but no state in this route means provider delivery, review,
 * quoting, or broker-of-record appointment. After a successful
 * insert, this route best-effort notifies the operator inbox
 * (sendCoverageProfileNotification in src/lib/email.ts — OPERATOR_NOTIFY_EMAIL
 * env var, defaults to insights@mail.propertyinsights.xyz) so the handoff
 * has a human-visible trigger; a failed notification never fails the
 * submission (the profile is already durably stored) but is never
 * swallowed either — it's console.error'd and reported via the response's
 * `operatorNotified` field, per the project's fail-loud policy. The handoff
 * redirect/deep-link and the eventual `markProfileHandoff()` call remain a
 * separate concern.
 *
 * Stage-gated: returns 404 while NEXT_PUBLIC_INSURANCE_STAGE hasn't reached
 * "intake" (see src/config/insurance-stage.ts — supersedes the old
 * NEXT_PUBLIC_INSURANCE_INTAKE flag). This is a visible gate, not a silent
 * no-op — the flag exists because the public
 * privacy pages haven't yet been amended to disclose the partner handoff
 * (see the updated doc comment on src/app/api/partner-connect/route.ts).
 *
 * Auth is optional, like partner-connect: anonymous submissions are allowed
 * since the profile is consented by the submitter in the request itself,
 * not tied to having an account. Do Not Sell/Share (Sec-GPC header or the
 * pi_dns cookie — src/lib/privacy.ts) is honored exactly the way
 * partner-connect honors it: the profile is still stored (it's
 * user-initiated and separately consented via `consent`/`consentText`), but
 * with no user_id, so it's never attributed to a signed-in account.
 *
 * consent must be exactly `true`, or the request is rejected with 400 —
 * this endpoint never stores a profile the user didn't affirmatively
 * consent to, matching the CHECK(consent = TRUE) constraint on the table.
 *
 * A1 dual-write path: only taken when the kernel's caseRecord feature is on
 * AND the request carries a valid idempotencyKey (UUID) and a non-empty
 * caseAccessToken — a stale cached wizard bundle or a pre-A1 caller falls
 * back to the legacy-only path instead of being rejected (console.warn'd
 * once). On that path, the submitted `consentText` is recomputed
 * server-side from the same (vendor, region) inputs
 * (src/lib/insurance/domain/consent-v1.ts) and rejected on mismatch — never
 * trusted as-is under the frozen "coverage-profile-consent-v1" label.
 * Errors are classified: expected validation failures (ineligible intended
 * recipient, malformed capability fields, consent-text mismatch) are a 400;
 * canonical idempotency conflicts are a non-specific 409; and anything else
 * (missing tables, DB outage, unexpected exceptions) is a 500 with a generic
 * message and the raw error console.error'd server-side. An idempotent replay
 * of the dual-write
 * (same idempotencyKey) is reported back distinctly from a fresh create so
 * the operator-notification email below fires at most once per case.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { dbAvailable } from "@/lib/db";
import {
  createCoverageProfile,
  validateCoverageProperty,
  validateCoverageAnswers,
  CoverageProfileValidationError,
  type CreateCoverageProfileInput,
} from "@/lib/db/coverage-profiles";
import type { AffiliateSource, Country, InsuranceLine } from "@/config/affiliate-vendors";
import { isOptedOutRequest } from "@/lib/privacy";
import { insuranceProfileLimiter } from "@/lib/rate-limit";
import { stageAtLeast } from "@/config/insurance-stage";
import { sendCoverageProfileNotification } from "@/lib/email";
import { insuranceKernelExecution } from "@/config/insurance-kernel/execution-mode";
import {
  createFinalizedCoverageCase,
  InsuranceCaseConflictError,
} from "@/lib/insurance/application/cases";
import { resolveVendor, regionFullName } from "@/components/insurance/resolve-vendor";
import { assertIdempotencyKey } from "@/lib/insurance/domain/submission";
import { coverageProfileConsentTextV1 } from "@/lib/insurance/domain/consent-v1";

const VALID_COUNTRIES: Country[] = ["US", "CA"];
const VALID_LINES: InsuranceLine[] = ["homeowner", "landlord", "tenant", "strata", "commercial"];

// Same VALID_SOURCES list as src/app/api/partner-connect/route.ts (AffiliateSource).
const VALID_SOURCES = [
  "assess-result",
  "property-page",
  "calculator",
  "email",
  "discover",
  "county-page",
  "rent-page",
  "state-page",
  "resources",
  "blog",
] as const;

// Profiles carry a full property snapshot + answers, so the cap is larger
// than partner-connect's 1KB click-tracking payload, but still bounded.
const MAX_DATA_SIZE = 8192; // bytes

/** Non-throwing UUID check for F2's stale-client fallback gate below —
 *  reuses the canonical validator (src/lib/insurance/domain/submission.ts)
 *  instead of duplicating its regex. */
function isValidIdempotencyKey(value: string): boolean {
  try {
    assertIdempotencyKey(value);
    return true;
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  if (!stageAtLeast("intake")) {
    return NextResponse.json(
      { error: "Insurance intake is not enabled (NEXT_PUBLIC_INSURANCE_STAGE has not reached \"intake\")" },
      { status: 404 }
    );
  }

  // Distinct from the flag gate above: a missing DATABASE_URL is a server
  // misconfiguration, not a client error, so it's a visible 500 — never a
  // silently-dropped submission.
  if (!dbAvailable()) {
    return NextResponse.json({ error: "Database not configured (DATABASE_URL not set)" }, { status: 500 });
  }

  // Per-IP rate limit — submissions are anonymous-allowed (see doc comment
  // above) and write PII rows, so this is checked early, before any body
  // parsing. Fail loud on limit (429 JSON), never a silent empty success.
  const limiter = insuranceProfileLimiter();
  if (limiter) {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const result = await limiter.limit(ip);
    if (!result.success) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429, headers: { "Retry-After": String(Math.ceil((result.reset - Date.now()) / 1000)) } }
      );
    }
  }

  // Optional auth — anonymous submissions are still stored (see doc comment above).
  const { userId: authUserId } = await auth();

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const rawSize = JSON.stringify(body ?? {}).length;
  if (rawSize > MAX_DATA_SIZE) {
    return NextResponse.json({ error: "Payload too large" }, { status: 400 });
  }

  if (body.consent !== true) {
    return NextResponse.json(
      { error: "consent must be true — coverage profiles cannot be stored without explicit consent" },
      { status: 400 }
    );
  }

  const country =
    typeof body.country === "string" && VALID_COUNTRIES.includes(body.country as Country)
      ? (body.country as Country)
      : undefined;
  if (!country) {
    return NextResponse.json({ error: "Invalid or missing country" }, { status: 400 });
  }

  const line =
    typeof body.line === "string" && VALID_LINES.includes(body.line as InsuranceLine)
      ? (body.line as InsuranceLine)
      : undefined;
  if (!line) {
    return NextResponse.json({ error: `line must be one of: ${VALID_LINES.join(", ")}` }, { status: 400 });
  }

  const region = typeof body.region === "string" ? body.region : undefined;
  if (!region) {
    return NextResponse.json({ error: "Invalid or missing region" }, { status: 400 });
  }

  const address = typeof body.address === "string" ? body.address : undefined;
  if (!address) {
    return NextResponse.json({ error: "Invalid or missing address" }, { status: 400 });
  }

  const consentText = typeof body.consentText === "string" ? body.consentText : undefined;
  if (!consentText) {
    return NextResponse.json({ error: "Invalid or missing consentText" }, { status: 400 });
  }

  const source =
    typeof body.source === "string" && VALID_SOURCES.includes(body.source as AffiliateSource)
      ? (body.source as AffiliateSource)
      : undefined;

  // Do Not Sell/Share: honor either the client-reported opt-out or a live
  // server-observed signal on this request. The profile is still stored —
  // it's the user's own consented submission — but never attributed to a
  // signed-in account once opted out, matching partner-connect exactly.
  const clientOptOut = body.optOut === true;
  const isOptedOut = clientOptOut || isOptedOutRequest(req);
  const userId = isOptedOut ? null : authUserId;

  const input: CreateCoverageProfileInput = {
    userId,
    country,
    region,
    address,
    line,
    property: body.property,
    answers: body.answers,
    consent: true,
    consentText,
    source,
  };

  const kernel = insuranceKernelExecution();
  // Narrowed once here (rather than re-testing `kernel.mode !== "DISABLED"`
  // inline below) so TypeScript can see `requestedExecutionMode` excludes
  // "DISABLED" — matches CreateFinalizedCoverageCaseInput's executionMode
  // type (RequestedKernelExecutionMode).
  const requestedExecutionMode = kernel.mode !== "DISABLED" ? kernel.mode : null;
  const kernelWantsCaseRecord = kernel.features.caseRecord && requestedExecutionMode !== null;

  // F2: idempotencyKey/caseAccessToken are new, A1-only fields. A cached
  // pre-A1 wizard bundle or a pre-A1 API caller won't send a valid pair even
  // though the server-side kernel flag is on. Never 400 that — fall back to
  // the legacy path exactly as when the flag is off, and log once so the
  // fallback is visible (fail-loud, not silently degraded).
  const idempotencyKeyCandidate = typeof body.idempotencyKey === "string" ? body.idempotencyKey : "";
  const accessTokenCandidate = typeof body.caseAccessToken === "string" ? body.caseAccessToken : "";
  const useKernelCaseRecord =
    kernelWantsCaseRecord && isValidIdempotencyKey(idempotencyKeyCandidate) && accessTokenCandidate.length > 0;
  if (kernelWantsCaseRecord && !useKernelCaseRecord) {
    console.warn(
      "insurance-a1: legacy client payload, dual-write skipped (missing/invalid idempotencyKey or caseAccessToken)"
    );
  }

  let profile: Awaited<ReturnType<typeof createCoverageProfile>>;
  let caseAccessPath: string | undefined;
  let newlyCreated = true;

  if (useKernelCaseRecord) {
    try {
      if (!requestedExecutionMode) {
        // Unreachable: useKernelCaseRecord already implies
        // kernelWantsCaseRecord, which implies requestedExecutionMode isn't
        // null. Here purely so TypeScript narrows it to
        // RequestedKernelExecutionMode for the createFinalizedCoverageCase
        // call below.
        throw new Error("insurance-a1: kernel unexpectedly disabled after gating");
      }
      const requestedRecipientId = typeof body.intendedRecipientId === "string" ? body.intendedRecipientId : null;
      // F5: eligibility lists (src/config/affiliate-vendors.ts) use
      // uppercase region codes, same as the legacy path's stored region —
      // normalize before the eligibility check so a lowercase region can't
      // wrongly reject (or silently mis-resolve) a valid submission.
      const normalizedRegion = region.trim().toUpperCase();
      const eligibleRecipient = requestedRecipientId
        ? resolveVendor(country, normalizedRegion, line, requestedRecipientId)
        : null;
      if (requestedRecipientId && eligibleRecipient?.id !== requestedRecipientId) {
        throw new CoverageProfileValidationError(
          "intended recipient is not eligible for this country, region, and insurance line"
        );
      }
      // F4: recompute the frozen consent-v1 text server-side from the same
      // (vendor, region) inputs the client rendered it from
      // (src/lib/insurance/domain/consent-v1.ts — the same module the
      // wizard uses), and refuse to record a mismatch under the v1 label.
      // A mismatch means a stale client or a tampered payload; silently
      // storing it as v1 would corrupt the audit artifact.
      const expectedConsentText = coverageProfileConsentTextV1(
        eligibleRecipient?.name ?? null,
        regionFullName(normalizedRegion)
      );
      if (consentText !== expectedConsentText) {
        throw new CoverageProfileValidationError("consent text does not match coverage-profile-consent-v1");
      }
      const intendedRecipients = eligibleRecipient?.id === requestedRecipientId
        ? [{
            counterpartyId: eligibleRecipient.id,
            name: eligibleRecipient.name,
            role: eligibleRecipient.counterpartyRole ?? ("AFFILIATE" as const),
          }]
        : [];
      const created = await createFinalizedCoverageCase({
        ...input,
        region: normalizedRegion,
        executionMode: requestedExecutionMode,
        idempotencyKey: idempotencyKeyCandidate,
        accessToken: accessTokenCandidate,
        intendedRecipients,
      });
      profile = { id: created.profileId, createdAt: created.createdAt };
      newlyCreated = created.newlyCreated;
      if (kernel.features.casePortal) caseAccessPath = `/insurance/case/${accessTokenCandidate}`;
    } catch (err) {
      // A server-authoritative idempotency mismatch is a safe, deliberately
      // non-specific 409. It must not be collapsed into a 500 or reveal
      // whether the key, case, or capability already exists.
      if (err instanceof InsuranceCaseConflictError) {
        return NextResponse.json({ error: err.message, code: err.code }, { status: 409 });
      }
      // F6: split expected validation failures (400, safe specific message)
      // from everything else — missing tables, DB outage, unexpected
      // exceptions (500, generic message; raw error logged server-side
      // only). Classified by type, not by string-matching driver internals.
      if (err instanceof CoverageProfileValidationError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      console.error(
        "[coverage-profile] dual-write case creation FAILED:",
        err instanceof Error ? err.message : String(err)
      );
      return NextResponse.json({ error: "Failed to save coverage profile" }, { status: 500 });
    }
  } else {
    try {
      profile = await createCoverageProfile(input);
    } catch (err) {
      // Fail loud: a malformed or unconsented profile is a 400, not a
      // swallowed error — see src/lib/db/coverage-profiles.ts's validators.
      const message = err instanceof Error ? err.message : "Failed to save coverage profile";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  // Operator notification is best-effort: a failed send never turns a
  // successful intake into an error response (the profile is already
  // durably stored), but per the project's fail-loud policy it must never
  // be silently swallowed either — log it distinctively and report the
  // real outcome to the caller via `operatorNotified` rather than copying
  // sendAssessmentEmail's silent-soft-fail pattern.
  //
  // F8: on the A1 dual-write path, an idempotent replay (findExisting hit
  // inside createFinalizedCoverageCase) is indistinguishable from a fresh
  // create at the DB layer, so it's reported back via `newlyCreated` —
  // skip the notification (and any other create-only side effect) on a
  // replay so the operator inbox doesn't get the same case twice. The
  // legacy path always creates a fresh row, so `newlyCreated` stays true
  // there and this notification behavior is unchanged.
  let operatorNotified = false;
  if (newlyCreated) {
    try {
      const notifyResult = await sendCoverageProfileNotification({
        id: profile.id,
        createdAt: profile.createdAt,
        country,
        region,
        address,
        line,
        // Re-validate the already-inserted raw payload to get the typed
        // shape for the email — createCoverageProfile() validated the same
        // body.property/body.answers to succeed above, so this cannot throw
        // on data that just passed the identical validators.
        property: validateCoverageProperty(body.property),
        answers: validateCoverageAnswers(body.answers),
        consentText,
      });
      operatorNotified = notifyResult.success;
      if (!notifyResult.success) {
        console.error("[coverage-profile] operator email FAILED:", notifyResult.error);
      }
    } catch (err) {
      console.error(
        "[coverage-profile] operator email FAILED:",
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  return NextResponse.json({ id: profile.id, operatorNotified, ...(caseAccessPath ? { caseAccessPath } : {}) });
}
