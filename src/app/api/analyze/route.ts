import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getListingBySlug } from "@/lib/kv/listings";
import { analyzeListingAsync } from "@/lib/analyze";
import { slugify } from "@/lib/utils";

export const maxDuration = 30;

export async function POST(req: NextRequest) {
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

  const address = body.address;
  if (!address || typeof address !== "string") {
    return NextResponse.json({ error: "Address is required" }, { status: 400 });
  }

  // Was: fetch the entire (multi-MB) listings array just to find one
  // address by exact match. slugify() is the same normalization used to
  // build listings:by-slug:{s} at write time (see kv/listings.ts's
  // writeAllListings/upsertListing), so this is a single cheap KV get
  // instead of a full-array scan.
  const lookup = await getListingBySlug(slugify(address));

  // "We could not read the store" is a different answer from "no such
  // property," and the client acts on it differently: 503 + Retry-After is
  // retryable, 404 is final. Collapsing them would also teach anything that
  // caches this response (and any crawler that reaches it) that a live
  // property does not exist.
  if (lookup.status === "unavailable") {
    console.error(`[listing-store] /api/analyze degraded for "${address}": ${lookup.reason}`);
    return NextResponse.json(
      { error: "Listings store temporarily unavailable — please retry." },
      { status: 503, headers: { "Retry-After": "30" } }
    );
  }

  if (lookup.status === "absent") {
    return NextResponse.json({ error: "Property not found" }, { status: 404 });
  }

  const result = await analyzeListingAsync(lookup.listing);
  return NextResponse.json(result);
}
