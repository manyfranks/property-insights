/**
 * POST /api/partner-connect
 *
 * Track affiliate partner click-throughs. No user data is shared with partners;
 * users click through to partner sites and provide their own info there.
 *
 * This endpoint records the click event for internal analytics and lead scoring.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { trackEvent } from "@/lib/db/user-events";

const VALID_TYPES = ["compare-rates", "pre-approval", "insurance"] as const;
type PartnerType = (typeof VALID_TYPES)[number];

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const partnerType = body.partnerType as string;
  if (!partnerType || !VALID_TYPES.includes(partnerType as PartnerType)) {
    return NextResponse.json({ error: "Invalid partner type" }, { status: 400 });
  }

  // Sanitize optional string fields
  const propertySlug =
    typeof body.propertySlug === "string" && body.propertySlug.length < 200
      ? body.propertySlug.slice(0, 200)
      : undefined;
  const city =
    typeof body.city === "string" && body.city.length < 100
      ? body.city.slice(0, 100)
      : undefined;

  // Track the partner click event
  await trackEvent(userId, "partner_click", {
    partnerType,
    ...(propertySlug && { propertySlug }),
    ...(city && { city }),
  });

  return NextResponse.json({ ok: true, partnerType });
}
