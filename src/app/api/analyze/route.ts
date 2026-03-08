import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getAllListings } from "@/lib/kv/listings";
import { analyzeListingAsync } from "@/lib/analyze";

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

  const listings = await getAllListings();
  const listing = listings.find(
    (l) => l.address.toLowerCase() === address.toLowerCase()
  );

  if (!listing) {
    return NextResponse.json({ error: "Property not found" }, { status: 404 });
  }

  const result = await analyzeListingAsync(listing);
  return NextResponse.json(result);
}
