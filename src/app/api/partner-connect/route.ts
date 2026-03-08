/**
 * POST /api/partner-connect
 *
 * Record a partner connection request. This is the point of express consent
 * for data sharing with a specific partner type (mortgage broker, agent, etc.).
 *
 * This endpoint:
 * 1. Verifies the user is authenticated
 * 2. Records the partner_click event (for analytics)
 * 3. Returns partner info for the frontend to display
 *
 * In production, this would route leads to actual partner integrations.
 * For now, it captures the intent and logs the lead.
 */

import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { trackEvent } from "@/lib/kv/user-events";

export type PartnerType = "mortgage" | "agent" | "insurance" | "inspection";

const PARTNER_INFO: Record<PartnerType, { label: string; description: string }> = {
  mortgage: {
    label: "Mortgage Pre-Approval",
    description: "We'll connect you with a licensed Canadian mortgage broker who can help with pre-approval and rate comparison.",
  },
  agent: {
    label: "Buyer's Agent",
    description: "We'll connect you with a licensed real estate agent in your target market.",
  },
  insurance: {
    label: "Home Insurance",
    description: "Get home insurance quotes from Canadian providers.",
  },
  inspection: {
    label: "Home Inspection",
    description: "Connect with a certified home inspector in your area.",
  },
};

const VALID_TYPES: PartnerType[] = ["mortgage", "agent", "insurance", "inspection"];

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

  // Log lead without PII (no email in logs)
  console.log(`[partner-connect] type=${partnerType} user=${userId} property=${propertySlug || "none"} city=${city || "none"}`);

  const info = PARTNER_INFO[partnerType as PartnerType];

  return NextResponse.json({
    ok: true,
    partnerType,
    message: info.description,
  });
}
