import { NextRequest, NextResponse } from "next/server";
import { PRELOADED_LISTINGS } from "@/lib/data/listings";
import { analyzeListingAsync } from "@/lib/analyze";

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const { address } = await req.json();

  if (!address || typeof address !== "string") {
    return NextResponse.json({ error: "Address is required" }, { status: 400 });
  }

  const listing = PRELOADED_LISTINGS.find(
    (l) => l.address.toLowerCase() === address.toLowerCase()
  );

  if (!listing) {
    return NextResponse.json({ error: "Property not found" }, { status: 404 });
  }

  const result = await analyzeListingAsync(listing);
  return NextResponse.json(result);
}
