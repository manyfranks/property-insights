/**
 * POST /api/partner-connect
 *
 * Track affiliate partner click-throughs. For most verticals, no user data
 * is shared with partners: users click through to partner sites and provide
 * their own info there. The exception is the insurance coverage-profile
 * handoff (Stage 2 of the insurance path — see
 * docs/proposals/insurance-distribution-proposal.html, "Stages" + "seam"
 * sections): that flow shares only the data the user explicitly consented
 * to hand to a licensed partner, gated behind the profile's consent
 * checkbox (src/lib/db/coverage-profiles.ts — consent must be exactly
 * `true`, enforced at both the API layer and a DB CHECK constraint) and, until
 * the public privacy pages are amended to disclose it, the
 * NEXT_PUBLIC_INSURANCE_INTAKE feature flag (src/app/api/coverage-profile/route.ts
 * 404s while it's off). This route only carries the resulting `profileId`
 * through as an opaque, size-capped reference for click-through analytics —
 * it does not itself read or transmit the profile contents.
 *
 * Auth is optional: every click (signed-in or anonymous) is logged to the
 * append-only partner_clicks table so top-of-funnel EPC data isn't lost for
 * signed-out visitors. When a Clerk session exists, the click is *also*
 * mirrored into user_events via trackEvent so intent scoring is unchanged.
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
import { trackPartnerClick } from "@/lib/db/partner-clicks";
import { isCoverageProfileId } from "@/lib/db/coverage-profiles";
import { isOptedOutRequest } from "@/lib/privacy";

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
  "county-page",
  "rent-page",
  "state-page",
  "resources",
  "blog",
] as const;
type Source = (typeof VALID_SOURCES)[number];

// Same cap used by src/app/api/track/route.ts — keep tracked event payloads small.
const MAX_DATA_SIZE = 1024; // bytes

export async function POST(req: Request) {
  // Optional auth — anonymous clicks are still tracked (see partner_clicks).
  const { userId: authUserId } = await auth();

  // Do Not Sell/Share: honor either an explicit client-reported opt-out
  // (the visitor had already opted out before this click) or a live
  // server-observed signal (Sec-GPC header / pi_dns cookie on the request
  // itself). When opted out, the click is still logged to the no-PI
  // partner_clicks table for aggregate EPC, but with no user_id, and it is
  // never mirrored into user_events (which would tie it to the account).
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

  const clientOptOut = body.optOut === true;
  const isOptedOut = clientOptOut || isOptedOutRequest(req);
  // Never attribute a click to a signed-in account once opted out.
  const userId = isOptedOut ? null : authUserId;

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

  // Opaque reference to a Stage-2 insurance coverage profile
  // (src/lib/db/coverage-profiles.ts) that this click is handing off. Only
  // shape-validated here (a plausible UUID) — this route never reads or
  // transmits the profile's contents, just carries the id through for
  // click-through analytics.
  const profileIdRaw = body.profileId;
  const profileId = isCoverageProfileId(profileIdRaw) ? profileIdRaw : undefined;
  if (profileIdRaw !== undefined && !profileId) {
    return NextResponse.json({ error: "Invalid profileId" }, { status: 400 });
  }

  const data = {
    ...(partnerType && { partnerType }),
    ...(vendor && { vendor }),
    ...(vertical && { vertical }),
    ...(state && { state }),
    ...(source && { source }),
    ...(affiliate !== undefined && { affiliate }),
    ...(propertySlug && { propertySlug }),
    ...(city && { city }),
    ...(profileId && { profileId }),
  };

  if (JSON.stringify(data).length > MAX_DATA_SIZE) {
    return NextResponse.json({ error: "Payload too large" }, { status: 400 });
  }

  // Always log the click, signed-in or not (append-only, no PI for anon rows).
  await trackPartnerClick({
    vendor: vendor ?? partnerType ?? "unknown",
    vertical,
    state,
    source,
    affiliate,
    propertySlug,
    city,
    userId,
  });

  // Signed-in users additionally get the click mirrored into user_events so
  // the existing intent-score aggregation (src/lib/db/user-events.ts) keeps
  // working — but never when opted out of sale/share, even if the request
  // is otherwise authenticated.
  if (userId) {
    await trackEvent(userId, "partner_click", data);
  }

  return NextResponse.json({ ok: true, vendor: vendor ?? partnerType });
}
