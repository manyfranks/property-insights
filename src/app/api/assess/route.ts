/**
 * POST /api/assess
 *
 * On-demand property assessment. Accepts a Google Places address,
 * finds the listing on Zoocasa, enriches it (scoring + offer model + LLM),
 * saves to KV, and emails the result to the user.
 *
 * Auth required (Clerk).
 * maxDuration: 60s (assessment lookup + LLM call).
 */

import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { fetchDetail, fetchDetailByUrl, parseZoocasaUrl, ZoocasaNotFoundError } from "@/lib/zoocasa";
import { enrichListing } from "@/lib/pipeline/enrich";
import { upsertListing } from "@/lib/kv/listings";
import { trackEvent } from "@/lib/db/user-events";
import { sendAssessmentEmail } from "@/lib/email";
import { slugify } from "@/lib/utils";

export const maxDuration = 60;

// Province mapping: full names + common abbreviations → 2-letter codes
const PROVINCE_MAP: Record<string, string> = {
  "british columbia": "bc",
  bc: "bc",
  alberta: "ab",
  ab: "ab",
  ontario: "on",
  on: "on",
  quebec: "qc",
  qc: "qc",
  manitoba: "mb",
  mb: "mb",
  saskatchewan: "sk",
  sk: "sk",
  "nova scotia": "ns",
  ns: "ns",
  "new brunswick": "nb",
  nb: "nb",
  "prince edward island": "pe",
  pe: "pe",
  pei: "pe",
  "newfoundland and labrador": "nl",
  nl: "nl",
};

/**
 * Parse a Google Places address into street, city, province.
 * Expected formats:
 *   "123 Main St, Vancouver, BC V5K 1A1, Canada"
 *   "123 Main St, Vancouver, BC, Canada"
 *   "123 Main St, Vancouver, British Columbia, Canada"
 */
function parseAddress(raw: string): {
  street: string;
  city: string;
  province: string;
} | null {
  // Remove "Canada" suffix
  const cleaned = raw.replace(/,?\s*Canada\s*$/i, "").trim();
  const parts = cleaned.split(",").map((p) => p.trim());

  if (parts.length < 3) return null;

  const street = parts[0];
  const city = parts[1];

  // Province is in the third part, possibly with postal code
  const provPart = parts[2]
    .replace(/[A-Z]\d[A-Z]\s*\d[A-Z]\d/i, "") // Strip postal code
    .trim()
    .toLowerCase();

  const province = PROVINCE_MAP[provPart];
  if (!province) return null;

  return { street, city, province };
}

export async function POST(req: Request) {
  const t0 = Date.now();
  const log = (step: string, extra?: string) =>
    console.log(`[assess] ${step} (${Date.now() - t0}ms)${extra ? " — " + extra : ""}`);

  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Sign in to request an assessment" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const rawAddress = typeof body.address === "string" ? body.address.trim() : "";
  log("start", rawAddress);

  // Length check + reject control characters and obvious injection patterns
  if (!rawAddress || rawAddress.length > 500 || /[\x00-\x1f<>{}]/.test(rawAddress)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }

  // Check if input is a Zoocasa URL
  const isZoocasaUrl = parseZoocasaUrl(rawAddress);

  let detail;

  if (isZoocasaUrl) {
    // Direct URL fetch — bypass address parsing entirely
    log("url detected", `zoocasa → ${isZoocasaUrl.city}, ${isZoocasaUrl.province}`);
    try {
      detail = await fetchDetailByUrl(rawAddress);
      log("zoocasa ok", detail.listing.address);
    } catch (err) {
      log("zoocasa error", err instanceof Error ? err.message : String(err));
      if (err instanceof ZoocasaNotFoundError) {
        return NextResponse.json(
          { error: "This listing wasn't found on Zoocasa. It may no longer be active." },
          { status: 404 }
        );
      }
      return NextResponse.json(
        { error: "Failed to load this listing. Please try again." },
        { status: 502 }
      );
    }
  } else {
    // Standard address parsing flow
    const parsed = parseAddress(rawAddress);
    if (!parsed) {
      log("parse failed");
      return NextResponse.json(
        { error: "Could not parse address. Please use a full Canadian address (e.g., 123 Main St, Vancouver, BC) or paste a Zoocasa listing URL." },
        { status: 400 }
      );
    }

    const { street, city, province } = parsed;
    log("parsed", `${street} | ${city} | ${province}`);

    try {
      detail = await fetchDetail(street, city, province);
      log("zoocasa ok", `${detail.listing.address}${detail.listing.unit ? " unit=" + detail.listing.unit : ""}`);
    } catch (err) {
      log("zoocasa error", err instanceof Error ? err.message : String(err));
      if (err instanceof ZoocasaNotFoundError) {
        return NextResponse.json(
          { error: "This property wasn't found on Zoocasa. It may not be currently listed for sale." },
          { status: 404 }
        );
      }
      return NextResponse.json(
        { error: "Failed to look up this property. Please try again." },
        { status: 502 }
      );
    }
  }

  const listing = detail.listing;

  // Enrich with scoring, offer model, and LLM narrative
  // Always use LLM for on-demand user requests (even WATCH tier)
  log("enrich start");
  const enriched = await enrichListing(listing, { forceLlm: true });
  log("enrich done", `tier=${enriched.preTier} score=${enriched.preScore} offer=${enriched.preOffer?.final_offer}`);

  // Save to KV
  log("kv write");
  await upsertListing(enriched);
  log("kv done");

  const slug = slugify(enriched.address);

  // Get user email from Clerk and send assessment
  let emailSent = false;
  try {
    log("email start");
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const email = user.emailAddresses?.[0]?.emailAddress;

    if (email && enriched.preNarrative) {
      const result = await sendAssessmentEmail(email, {
        listing: enriched,
        tier: enriched.preTier || "WATCH",
        score: enriched.preScore || 0,
        narrative: enriched.preNarrative,
        finalOffer: enriched.preOffer?.final_offer,
        savings: enriched.preOffer?.savings,
        percentOfList: enriched.preOffer?.pct_of_list,
      });
      emailSent = result.success;
      log("email done", emailSent ? "sent" : "not sent");
    } else {
      log("email skip", `email=${!!email} narrative=${!!enriched.preNarrative}`);
    }
  } catch (err) {
    log("email error", err instanceof Error ? err.message : String(err));
  }

  // Track assessment request (strongest intent signal)
  trackEvent(userId, "assessment_request", {
    address: enriched.address,
    city: enriched.city,
    price: enriched.price,
    slug,
  }).catch(() => {}); // fire and forget

  log("done", slug);
  return NextResponse.json({
    ok: true,
    slug,
    address: enriched.address,
    city: enriched.city,
    emailSent,
  });
}
