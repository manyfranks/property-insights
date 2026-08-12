/**
 * POST /api/track
 *
 * Record a user behavior event. Requires authentication and analytics consent.
 * Events are stored in Postgres per-user for lead scoring and service improvement.
 */

import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { trackEvent, EventType } from "@/lib/db/user-events";
import { isOptedOutRequest } from "@/lib/privacy";
import { JOURNEY_EVENT_TYPES } from "@/lib/property-intelligence/journey";
import { shouldTrackConsentedEvent, validateEventData } from "@/lib/tracking-validation";

const VALID_TYPES: EventType[] = [
  "property_view",
  "assessment_request",
  "search",
  "city_subscribe",
  "partner_click",
  ...JOURNEY_EVENT_TYPES,
];

export async function POST(req: Request) {
  // Do Not Sell/Share: short-circuit before auth/consent checks so an
  // opted-out browser is never recorded, signed in or not.
  if (isOptedOutRequest(req)) {
    return NextResponse.json({ ok: true, tracked: false });
  }

  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  // Check consent before tracking
  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  const metadata = user.unsafeMetadata as Record<string, unknown> | undefined;

  if (!shouldTrackConsentedEvent(req, metadata)) {
    return NextResponse.json({ ok: true, tracked: false });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const type = body.type as string;
  if (!type || !VALID_TYPES.includes(type as EventType)) {
    return NextResponse.json({ error: "Invalid event type" }, { status: 400 });
  }

  const data = validateEventData(type as EventType, body.data);
  if (data === null) {
    return NextResponse.json({ error: "Invalid event data" }, { status: 400 });
  }

  await trackEvent(userId, type as EventType, data);
  return NextResponse.json({ ok: true, tracked: true });
}
