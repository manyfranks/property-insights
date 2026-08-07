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
import { findAndFetchDetail, fetchDetailByUrl, parseZoocasaUrl, ZoocasaNotFoundError } from "@/lib/zoocasa";
import { enrichListing } from "@/lib/pipeline/enrich";
import { upsertListing } from "@/lib/kv/listings";
import { trackEvent } from "@/lib/db/user-events";
import { sendAssessmentEmail } from "@/lib/email";
import { assessLimiter } from "@/lib/rate-limit";
import { slugify } from "@/lib/utils";

const RATE_LIMIT_RESPONSE = (resetMs: number) =>
  NextResponse.json(
    { error: "Daily assessment limit reached (15/day). Resets in 24 hours.", code: "RATE_LIMIT" },
    { status: 429, headers: { "Retry-After": String(Math.ceil(resetMs / 1000)) } }
  );

export const maxDuration = 60;

// Region mapping: full names + common abbreviations → region codes.
// Canadian provinces map to lowercase 2-letter codes (unchanged from the
// original PROVINCE_MAP — Zoocasa's search API expects these lowercase).
// US states/DC map to UPPERCASE USPS codes, which doubles as the CA/US
// discriminator below (no Canadian code is ever uppercase 2 letters).
const REGION_MAP: Record<string, string> = {
  // Canada
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

  // United States — 50 states + DC (US support lands in a later phase;
  // for now these just let parseAddress recognize the address so the
  // route can return a clear "not yet" response instead of failing to
  // parse at all).
  alabama: "AL", al: "AL",
  alaska: "AK", ak: "AK",
  arizona: "AZ", az: "AZ",
  arkansas: "AR", ar: "AR",
  california: "CA", ca: "CA",
  colorado: "CO", co: "CO",
  connecticut: "CT", ct: "CT",
  delaware: "DE", de: "DE",
  florida: "FL", fl: "FL",
  georgia: "GA", ga: "GA",
  hawaii: "HI", hi: "HI",
  idaho: "ID", id: "ID",
  illinois: "IL", il: "IL",
  indiana: "IN", in: "IN",
  iowa: "IA", ia: "IA",
  kansas: "KS", ks: "KS",
  kentucky: "KY", ky: "KY",
  louisiana: "LA", la: "LA",
  maine: "ME", me: "ME",
  maryland: "MD", md: "MD",
  massachusetts: "MA", ma: "MA",
  michigan: "MI", mi: "MI",
  minnesota: "MN", mn: "MN",
  mississippi: "MS", ms: "MS",
  missouri: "MO", mo: "MO",
  montana: "MT", mt: "MT",
  nebraska: "NE", ne: "NE",
  nevada: "NV", nv: "NV",
  "new hampshire": "NH", nh: "NH",
  "new jersey": "NJ", nj: "NJ",
  "new mexico": "NM", nm: "NM",
  "new york": "NY", ny: "NY",
  "north carolina": "NC", nc: "NC",
  "north dakota": "ND", nd: "ND",
  ohio: "OH", oh: "OH",
  oklahoma: "OK", ok: "OK",
  oregon: "OR", or: "OR",
  pennsylvania: "PA", pa: "PA",
  "rhode island": "RI", ri: "RI",
  "south carolina": "SC", sc: "SC",
  "south dakota": "SD", sd: "SD",
  tennessee: "TN", tn: "TN",
  texas: "TX", tx: "TX",
  utah: "UT", ut: "UT",
  vermont: "VT", vt: "VT",
  virginia: "VA", va: "VA",
  washington: "WA", wa: "WA",
  "west virginia": "WV", wv: "WV",
  wisconsin: "WI", wi: "WI",
  wyoming: "WY", wy: "WY",
  "district of columbia": "DC", dc: "DC",
};

/**
 * Parse a Google Places address into street, city, region, country.
 * Expected formats:
 *   "123 Main St, Vancouver, BC V5K 1A1, Canada"
 *   "123 Main St, Vancouver, BC, Canada"
 *   "123 Main St, Vancouver, British Columbia, Canada"
 *   "123 Main St, Austin, TX 78701, USA"
 *   "123 Main St, Austin, TX"
 */
function parseAddress(raw: string): {
  street: string;
  city: string;
  region: string;
  country: "CA" | "US";
} | null {
  // Remove trailing country suffix (Canada or USA, in the forms Google
  // Places tends to emit)
  const cleaned = raw
    .replace(/,?\s*(Canada|USA|U\.S\.A\.|United States(?: of America)?)\s*$/i, "")
    .trim();
  const parts = cleaned.split(",").map((p) => p.trim());

  if (parts.length < 3) return null;

  const street = parts[0];
  const city = parts[1];

  // Region is in the third part, possibly with a postal/ZIP code attached
  const regionPart = parts[2]
    .replace(/[A-Z]\d[A-Z]\s*\d[A-Z]\d/i, "") // Strip CA postal code (A1A 1A1)
    .replace(/\b\d{5}(-\d{4})?\b/, "") // Strip US ZIP / ZIP+4
    .trim()
    .toLowerCase();

  const region = REGION_MAP[regionPart];
  if (!region) return null;

  const country: "CA" | "US" = /^[A-Z]{2}$/.test(region) ? "US" : "CA";

  return { street, city, region, country };
}

export async function POST(req: Request) {
  const t0 = Date.now();
  const log = (step: string, extra?: string) =>
    console.log(`[assess] ${step} (${Date.now() - t0}ms)${extra ? " — " + extra : ""}`);

  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Sign in to request an assessment" }, { status: 401 });
  }

  // Daily cap pre-check (no consume) — blocks spam without charging the user.
  // The slot is consumed below, after Zoocasa confirms the listing is real,
  // so failed lookups (bad address, listing not found) don't count.
  const limiter = assessLimiter();
  if (limiter) {
    const { remaining, reset } = await limiter.getRemaining(userId);
    if (remaining <= 0) {
      return RATE_LIMIT_RESPONSE(reset - Date.now());
    }
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
        {
          error:
            "Could not parse address. Please use a full Canadian or US address " +
            "(e.g., 123 Main St, Vancouver, BC or 123 Main St, Austin, TX) or paste a Zoocasa listing URL.",
        },
        { status: 400 }
      );
    }

    const { street, city, region, country } = parsed;
    log("parsed", `${street} | ${city} | ${region} (${country})`);

    if (country === "US") {
      log("us region — not yet supported");
      return NextResponse.json(
        {
          error:
            "US property assessments are coming soon. Property Insights currently " +
            "supports Canadian addresses (BC, AB, ON in depth; other provinces via area-median estimate).",
          code: "US_NOT_SUPPORTED",
        },
        { status: 422 }
      );
    }

    try {
      detail = await findAndFetchDetail(street, city, region);
      log("zoocasa ok", `${detail.listing.address}${detail.listing.unit ? " unit=" + detail.listing.unit : ""}`);
    } catch (err) {
      log("zoocasa error", err instanceof Error ? err.message : String(err));
      if (err instanceof ZoocasaNotFoundError) {
        return NextResponse.json(
          {
            error:
              "We couldn't find this property in Zoocasa's active listings. " +
              "If you have the Zoocasa listing URL, paste it here for an exact match.",
          },
          { status: 404 }
        );
      }
      return NextResponse.json(
        { error: "Failed to look up this property. Please try again." },
        { status: 502 }
      );
    }
  }

  // Lookup succeeded — now consume a slot from the daily cap. Race with the
  // pre-check is acceptable: the cap is per-user-per-day, not a security gate.
  if (limiter) {
    const result = await limiter.limit(userId);
    if (!result.success) {
      return RATE_LIMIT_RESPONSE(result.reset - Date.now());
    }
  }

  const listing = detail.listing;

  // Fetch sold pool for comparables
  let soldPool: import("@/lib/zoocasa").ZoocasaSoldRaw[] = [];
  try {
    log("sold pool fetch");
    const { fetchSoldListings } = await import("@/lib/zoocasa");
    soldPool = await fetchSoldListings(listing.city, listing.province);
    log("sold pool done", `${soldPool.length} listings`);
  } catch (err) {
    log("sold pool failed", err instanceof Error ? err.message : String(err));
  }

  // Enrich with scoring, offer model, comparables, and LLM narrative
  // Always use LLM for on-demand user requests (even WATCH tier)
  log("enrich start");
  const enriched = await enrichListing(listing, { forceLlm: true, soldPool });
  log("enrich done", `tier=${enriched.preTier} score=${enriched.preScore} offer=${enriched.preOffer?.final_offer}`);

  // Tag source and enrichment time
  enriched.source = "user";
  enriched.enrichedAt = new Date().toISOString();

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
