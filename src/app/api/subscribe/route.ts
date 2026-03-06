import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { CITY_METADATA } from "@/lib/data/city-metadata";

const validSlugs = new Set(CITY_METADATA.map((c) => c.slug));

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

  const validCities = cities.filter((c) => validSlugs.has(c));
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
