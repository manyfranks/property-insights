import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const cities: string[] = body.cities;

  if (!Array.isArray(cities) || cities.length === 0) {
    return NextResponse.json({ error: "No cities provided" }, { status: 400 });
  }

  // Accept any city slug (no longer restricted to hardcoded list)
  const validCities = cities.filter((c) => typeof c === "string" && c.length > 0 && c.length < 100);
  if (validCities.length === 0) {
    return NextResponse.json({ error: "No valid cities" }, { status: 400 });
  }

  const client = await clerkClient();
  await client.users.updateUserMetadata(userId, {
    unsafeMetadata: {
      subscribedCities: validCities,
      subscribedAt: new Date().toISOString(),
    },
  });

  return NextResponse.json({ ok: true, cities: validCities });
}
