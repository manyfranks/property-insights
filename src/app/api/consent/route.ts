/**
 * POST /api/consent
 *
 * Update user consent preferences. Stores in Clerk unsafeMetadata.
 * Body: { analytics: boolean, partnerSharing: boolean }
 *
 * Only updates the `consent` key — does not spread other metadata fields
 * to prevent mass assignment of unrelated fields.
 */

import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { CONSENT_VERSION, ConsentState } from "@/lib/consent";

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

  if (typeof body.analytics !== "boolean" || typeof body.partnerSharing !== "boolean") {
    return NextResponse.json(
      { error: "analytics and partnerSharing must be booleans" },
      { status: 400 }
    );
  }

  const consent: ConsentState = {
    analytics: body.analytics,
    partnerSharing: body.partnerSharing,
    updatedAt: new Date().toISOString(),
    version: CONSENT_VERSION,
  };

  // Only update the consent key — preserve all other metadata as-is
  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  const existing = (user.unsafeMetadata || {}) as Record<string, unknown>;

  await client.users.updateUserMetadata(userId, {
    unsafeMetadata: {
      ...existing,
      consent,
    },
  });

  return NextResponse.json({ ok: true, consent });
}
