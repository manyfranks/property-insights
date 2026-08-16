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
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { dbAvailable } from "@/lib/db";
import {
  createCoverageProfile,
  validateCoverageProperty,
  validateCoverageAnswers,
  type CreateCoverageProfileInput,
} from "@/lib/db/coverage-profiles";
import type { AffiliateSource, Country, InsuranceLine } from "@/config/affiliate-vendors";
import { isOptedOutRequest } from "@/lib/privacy";
import { insuranceProfileLimiter } from "@/lib/rate-limit";
import { stageAtLeast } from "@/config/insurance-stage";
import { sendCoverageProfileNotification } from "@/lib/email";
import { insuranceKernelExecution } from "@/config/insurance-kernel/execution-mode";
import { createFinalizedCoverageCase } from "@/lib/insurance/application/cases";
import { resolveVendor } from "@/components/insurance/resolve-vendor";

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
  let profile: Awaited<ReturnType<typeof createCoverageProfile>>;
  let caseAccessPath: string | undefined;
  try {
    if (kernel.features.caseRecord && kernel.mode !== "DISABLED") {
      const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey : "";
      const accessToken = typeof body.caseAccessToken === "string" ? body.caseAccessToken : "";
      const requestedRecipientId = typeof body.intendedRecipientId === "string" ? body.intendedRecipientId : null;
      const eligibleRecipient = requestedRecipientId
        ? resolveVendor(country, region, line, requestedRecipientId)
        : null;
      if (requestedRecipientId && eligibleRecipient?.id !== requestedRecipientId) {
        throw new Error("intended recipient is not eligible for this country, region, and insurance line");
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
        executionMode: kernel.mode,
        idempotencyKey,
        accessToken,
        intendedRecipients,
      });
      profile = { id: created.profileId, createdAt: created.createdAt };
      if (kernel.features.casePortal) caseAccessPath = `/insurance/case/${accessToken}`;
    } else {
      profile = await createCoverageProfile(input);
    }
  } catch (err) {
    // Fail loud: a malformed or unconsented profile is a 400, not a
    // swallowed error — see src/lib/db/coverage-profiles.ts's validators.
    const message = err instanceof Error ? err.message : "Failed to save coverage profile";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // Operator notification is best-effort: a failed send never turns a
  // successful intake into an error response (the profile is already
  // durably stored), but per the project's fail-loud policy it must never
  // be silently swallowed either — log it distinctively and report the
  // real outcome to the caller via `operatorNotified` rather than copying
  // sendAssessmentEmail's silent-soft-fail pattern.
  let operatorNotified = false;
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

  return NextResponse.json({ id: profile.id, operatorNotified, ...(caseAccessPath ? { caseAccessPath } : {}) });
}
