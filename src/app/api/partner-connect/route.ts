/**
 * POST /api/partner-connect
 *
 * Track affiliate partner click-throughs. No user data is shared with partners;
 * users click through to partner sites and provide their own info there.
 *
 * This endpoint records the click event for internal analytics and lead scoring.
 *
 * Payload has two generations that coexist:
 *  - `partnerType` — the original 3-vendor CA field. Still populated (via
 *    AffiliateVendor.legacyPartnerType) so the existing intent-score SQL in
 *    src/lib/db/user-events.ts (which filters on
 *    data->>'partnerType' IN ('compare-rates','pre-approval')) keeps working.
 *  - `vendor` / `vertical` / `state` / `source` / `affiliate` — the vendor
 *    registry fields (src/config/affiliate-vendors.ts), covering every
 *    vendor including ones with no legacy mapping (all US vendors).
 * At least one of `partnerType` or `vendor` must be present and valid.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { trackEvent } from "@/lib/db/user-events";

const VALID_TYPES = ["compare-rates", "pre-approval", "insurance"] as const;
type PartnerType = (typeof VALID_TYPES)[number];

const VALID_VERTICALS = [
  "insurance",
  "mortgage",
  "investor-tools",
  "tax-appeal",
  "agent-referral",
  "home-services",
] as const;
type Vertical = (typeof VALID_VERTICALS)[number];

const VALID_SOURCES = [
  "assess-result",
  "property-page",
  "calculator",
  "email",
  "discover",
] as const;
type Source = (typeof VALID_SOURCES)[number];

// Same cap used by src/app/api/track/route.ts — keep tracked event payloads small.
const MAX_DATA_SIZE = 1024; // bytes

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

  const partnerTypeRaw = body.partnerType;
  const partnerType =
    typeof partnerTypeRaw === "string" && VALID_TYPES.includes(partnerTypeRaw as PartnerType)
      ? (partnerTypeRaw as PartnerType)
      : undefined;
  if (partnerTypeRaw !== undefined && !partnerType) {
    return NextResponse.json({ error: "Invalid partner type" }, { status: 400 });
  }

  const vendor =
    typeof body.vendor === "string" && body.vendor.length > 0 && body.vendor.length < 60
      ? body.vendor
      : undefined;

  if (!partnerType && !vendor) {
    return NextResponse.json({ error: "Invalid partner click payload" }, { status: 400 });
  }

  const vertical =
    typeof body.vertical === "string" && VALID_VERTICALS.includes(body.vertical as Vertical)
      ? (body.vertical as Vertical)
      : undefined;

  const source =
    typeof body.source === "string" && VALID_SOURCES.includes(body.source as Source)
      ? (body.source as Source)
      : undefined;

  const affiliate = typeof body.affiliate === "boolean" ? body.affiliate : undefined;

  // Sanitize optional string fields
  const state =
    typeof body.state === "string" && body.state.length > 0 && body.state.length <= 10
      ? body.state.slice(0, 10).toUpperCase()
      : undefined;
  const propertySlug =
    typeof body.propertySlug === "string" && body.propertySlug.length < 200
      ? body.propertySlug.slice(0, 200)
      : undefined;
  const city =
    typeof body.city === "string" && body.city.length < 100
      ? body.city.slice(0, 100)
      : undefined;

  const data = {
    ...(partnerType && { partnerType }),
    ...(vendor && { vendor }),
    ...(vertical && { vertical }),
    ...(state && { state }),
    ...(source && { source }),
    ...(affiliate !== undefined && { affiliate }),
    ...(propertySlug && { propertySlug }),
    ...(city && { city }),
  };

  if (JSON.stringify(data).length > MAX_DATA_SIZE) {
    return NextResponse.json({ error: "Payload too large" }, { status: 400 });
  }

  // Track the partner click event
  await trackEvent(userId, "partner_click", data);

  return NextResponse.json({ ok: true, vendor: vendor ?? partnerType });
}
