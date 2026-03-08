import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const cityName: string = body.city?.trim();

  if (!cityName || cityName.length > 100) {
    return NextResponse.json({ error: "Invalid city name" }, { status: 400 });
  }

  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  const existing = (user.unsafeMetadata?.requestedCities as string[]) || [];

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
