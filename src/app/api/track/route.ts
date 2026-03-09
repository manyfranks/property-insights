/**
 * POST /api/track
 *
 * Record a user behavior event. Requires authentication and analytics consent.
 * Events are stored in Postgres per-user for lead scoring and service improvement.
 */

import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { trackEvent, EventType } from "@/lib/db/user-events";
import { hasAnalyticsConsent } from "@/lib/consent";

const VALID_TYPES: EventType[] = [
  "property_view",
  "assessment_request",
  "search",
  "city_subscribe",
  "partner_click",
];

const MAX_DATA_SIZE = 1024; // bytes
const MAX_DATA_KEYS = 10;

/** Validate and sanitize event data. Returns null if invalid. */
function validateData(
  raw: unknown
): Record<string, string | number | boolean> | null {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) return null;

  const data = raw as Record<string, unknown>;
  const keys = Object.keys(data);

  // Limit number of keys
  if (keys.length > MAX_DATA_KEYS) return null;

  // Validate each value type and string length
  const clean: Record<string, string | number | boolean> = {};
  for (const key of keys) {
    if (typeof key !== "string" || key.length > 64) return null;

    const val = data[key];
    if (typeof val === "boolean" || typeof val === "number") {
      clean[key] = val;
    } else if (typeof val === "string") {
      if (val.length > 256) return null;
      clean[key] = val;
    } else {
      return null; // reject non-primitive values
    }
  }

  // Check total serialized size
  if (JSON.stringify(clean).length > MAX_DATA_SIZE) return null;

  return clean;
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  // Check consent before tracking
  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  const metadata = user.unsafeMetadata as Record<string, unknown> | undefined;

  if (!hasAnalyticsConsent(metadata)) {
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

  const data = validateData(body.data);
  if (data === null) {
    return NextResponse.json({ error: "Invalid event data" }, { status: 400 });
  }

  await trackEvent(userId, type as EventType, data);
  return NextResponse.json({ ok: true, tracked: true });
}
