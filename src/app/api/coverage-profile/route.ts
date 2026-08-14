/**
 * POST /api/coverage-profile
 *
 * Stage 2 of the insurance path (see
 * docs/proposals/insurance-distribution-proposal.html, "Stages" + "seam"
 * sections): stores a coverage profile — the prefilled property snapshot
 * plus the ~6 questions only the user can answer — ahead of a handoff to a
 * licensed partner, who becomes broker of record. This route only persists
 * the profile and returns its id; the handoff redirect/deep-link and the
 * eventual `markProfileHandoff()` call are a separate concern.
 *
 * Flag-gated: returns 404 while NEXT_PUBLIC_INSURANCE_INTAKE is off. This is
 * a visible gate, not a silent no-op — the flag exists because the public
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
  isInsuranceIntakeEnabled,
  type CreateCoverageProfileInput,
} from "@/lib/db/coverage-profiles";
import type { AffiliateSource, Country, InsuranceLine } from "@/config/affiliate-vendors";
import { isOptedOutRequest } from "@/lib/privacy";

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
  if (!isInsuranceIntakeEnabled()) {
    return NextResponse.json(
      { error: "Insurance intake is not enabled (NEXT_PUBLIC_INSURANCE_INTAKE is off)" },
      { status: 404 }
    );
  }

  // Distinct from the flag gate above: a missing DATABASE_URL is a server
  // misconfiguration, not a client error, so it's a visible 500 — never a
  // silently-dropped submission.
  if (!dbAvailable()) {
    return NextResponse.json({ error: "Database not configured (DATABASE_URL not set)" }, { status: 500 });
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

  try {
    const profile = await createCoverageProfile(input);
    return NextResponse.json({ id: profile.id });
  } catch (err) {
    // Fail loud: a malformed or unconsented profile is a 400, not a
    // swallowed error — see src/lib/db/coverage-profiles.ts's validators.
    const message = err instanceof Error ? err.message : "Failed to save coverage profile";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
