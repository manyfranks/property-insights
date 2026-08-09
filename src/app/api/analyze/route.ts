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
  const listing = await getListingBySlug(slugify(address));

  if (!listing) {
    return NextResponse.json({ error: "Property not found" }, { status: 404 });
  }

  const result = await analyzeListingAsync(listing);
  return NextResponse.json(result);
}
