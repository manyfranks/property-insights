/**
 * POST /api/subscribe
 *
 * Subscribe to city alerts. Stores subscribed cities in Clerk unsafeMetadata.
 * Body: { cities: string[] }
 *
 * Preserves existing metadata keys (consent, requestedCities, etc.).
 */

import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const MAX_CITIES = 20;
const CITY_RE = /^[a-zA-Z\s\-'.]+$/; // letters, spaces, hyphens, apostrophes, periods

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const cities = body.cities;

  if (!Array.isArray(cities) || cities.length === 0) {
    return NextResponse.json({ error: "No cities provided" }, { status: 400 });
  }

  if (cities.length > MAX_CITIES) {
    return NextResponse.json({ error: `Maximum ${MAX_CITIES} cities` }, { status: 400 });
  }

  const validCities = cities.filter(
    (c) => typeof c === "string" && c.length > 0 && c.length < 100 && CITY_RE.test(c)
  );
  if (validCities.length === 0) {
    return NextResponse.json({ error: "No valid cities" }, { status: 400 });
  }

  // Preserve existing metadata — only update subscribe-related keys
  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  const existing = (user.unsafeMetadata || {}) as Record<string, unknown>;

  await client.users.updateUserMetadata(userId, {
    unsafeMetadata: {
      ...existing,
      subscribedCities: validCities,
      subscribedAt: new Date().toISOString(),
    },
  });

  return NextResponse.json({ ok: true, cities: validCities });
}
