/**
 * POST /api/insurance/waitlist
 *
 * "Notify me" capture for the /insurance landing page's waitlist mode —
 * entered whenever the rollout hasn't reached "intake" yet or the visitor's
 * region isn't "live" yet (src/config/insurance-rollout.ts). Deliberately
 * not gated on stageAtLeast("intake") the way /api/coverage-profile is:
 * waitlist mode is precisely what renders when that stage (or a region's
 * live status) hasn't been reached, so gating this route on the same stage
 * would make the landing page's own waitlist CTA always fail. Still
 * requires stageAtLeast("landing") (src/config/insurance-stage.ts —
 * supersedes the old NEXT_PUBLIC_INSURANCE_LANDING / NEXT_PUBLIC_INSURANCE_INTAKE
 * pair; mirrors the landing page's own gate) so the endpoint doesn't accept
 * writes while the surface that links to it is 404'd.
 *
 * No property snapshot, no consent-to-broker-handoff — just an email plus
 * whatever geo/line/address context the visitor had already entered.
 * Rate-limited per IP like /api/coverage-profile (one-shot submission,
 * anonymous by design).
 *
 * Intentionally accepts every region, including ones in
 * INSURANCE_STATE_EXCLUSIONS (QC/NB/WA) — "notify me" capture carries no
 * referral or broker handoff, so the permanent-exclusion compliance
 * boundary that gates /coverage-profile and the result-page module doesn't
 * apply here.
 */

import { NextResponse } from "next/server";
import { dbAvailable } from "@/lib/db";
import { createWaitlistEntry, type CreateWaitlistEntryInput } from "@/lib/db/insurance-waitlist";
import type { Country, InsuranceLine } from "@/config/affiliate-vendors";
import { stageAtLeast } from "@/config/insurance-stage";
import { insuranceWaitlistLimiter } from "@/lib/rate-limit";

const VALID_COUNTRIES: Country[] = ["US", "CA"];
const VALID_LINES: InsuranceLine[] = ["homeowner", "landlord", "tenant", "strata", "commercial"];
const MAX_DATA_SIZE = 2048; // bytes — this payload is tiny (email + geo strings)

export async function POST(req: Request) {
  if (!stageAtLeast("landing")) {
    return NextResponse.json(
      { error: "Insurance landing is not enabled (NEXT_PUBLIC_INSURANCE_STAGE has not reached \"landing\")" },
      { status: 404 }
    );
  }

  if (!dbAvailable()) {
    return NextResponse.json({ error: "Database not configured (DATABASE_URL not set)" }, { status: 500 });
  }

  const limiter = insuranceWaitlistLimiter();
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

  const email = typeof body.email === "string" ? body.email : undefined;
  if (!email) {
    return NextResponse.json({ error: "Invalid or missing email" }, { status: 400 });
  }

  const country =
    typeof body.country === "string" && VALID_COUNTRIES.includes(body.country as Country)
      ? (body.country as Country)
      : undefined;
  if (!country) {
    return NextResponse.json({ error: "Invalid or missing country" }, { status: 400 });
  }

  const region = typeof body.region === "string" ? body.region : undefined;
  if (!region) {
    return NextResponse.json({ error: "Invalid or missing region" }, { status: 400 });
  }

  const line =
    typeof body.line === "string" && VALID_LINES.includes(body.line as InsuranceLine)
      ? (body.line as InsuranceLine)
      : null;

  const address = typeof body.address === "string" ? body.address : null;

  const input: CreateWaitlistEntryInput = { email, country, region, line, address };

  try {
    const entry = await createWaitlistEntry(input);
    return NextResponse.json({ id: entry.id });
  } catch (err) {
    // Fail loud: a malformed payload is a 400, not a swallowed error — see
    // src/lib/db/insurance-waitlist.ts's validators.
    const message = err instanceof Error ? err.message : "Failed to save waitlist entry";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
