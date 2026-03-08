/**
 * POST /api/request-city
 *
 * Request a new city to be added to the platform.
 * Body: { city: string }
 *
 * Stores up to MAX_REQUESTS city names in Clerk unsafeMetadata.
 */

import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const MAX_REQUESTS = 10;
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

  const cityName = typeof body.city === "string" ? body.city.trim() : "";

  if (!cityName || cityName.length > 100 || !CITY_RE.test(cityName)) {
    return NextResponse.json({ error: "Invalid city name" }, { status: 400 });
  }

  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  const existing = (user.unsafeMetadata?.requestedCities as string[]) || [];

  // Cap the number of requests per user
  if (existing.length >= MAX_REQUESTS) {
    return NextResponse.json({ error: "Maximum city requests reached" }, { status: 400 });
  }

  // Avoid duplicates
  if (!existing.includes(cityName)) {
    await client.users.updateUserMetadata(userId, {
      unsafeMetadata: {
        ...user.unsafeMetadata,
        requestedCities: [...existing, cityName],
        lastCityRequestAt: new Date().toISOString(),
      },
    });
  }

  return NextResponse.json({ ok: true, city: cityName });
}
