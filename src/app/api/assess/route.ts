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
import { fetchDetail, ZoocasaNotFoundError } from "@/lib/zoocasa";
import { enrichListing } from "@/lib/pipeline/enrich";
import { upsertListing } from "@/lib/kv/listings";
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
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Sign in to request an assessment" }, { status: 401 });
  }

  const body = await req.json();
  const rawAddress: string = body.address?.trim();

  if (!rawAddress || rawAddress.length > 200) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }

  // Parse the address
  const parsed = parseAddress(rawAddress);
  if (!parsed) {
    return NextResponse.json(
      { error: "Could not parse address. Please use a full Canadian address (e.g., 123 Main St, Vancouver, BC)." },
      { status: 400 }
    );
  }

  const { street, city, province } = parsed;

  // Fetch from Zoocasa
  let detail;
  try {
    detail = await fetchDetail(street, city, province);
  } catch (err) {
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

  const listing = detail.listing;

  // Enrich with scoring, offer model, and LLM narrative
  // Always use LLM for on-demand user requests (even WATCH tier)
  const enriched = await enrichListing(listing, { forceLlm: true });

  // Save to KV
  await upsertListing(enriched);

  const slug = slugify(enriched.address);

  // Get user email from Clerk and send assessment
  let emailSent = false;
  try {
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
    }
  } catch {
    // Email failure shouldn't block the response
  }

  return NextResponse.json({
    ok: true,
    slug,
    address: enriched.address,
    city: enriched.city,
    emailSent,
  });
}
