/**
 * GET /api/search?q=<query>
 *
 * Lightweight search endpoint for the navbar autocomplete.
 * Returns up to 8 matching listings by address or city.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAllListings } from "@/lib/kv/listings";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.toLowerCase();
  if (!q || q.length < 2) {
    return NextResponse.json([]);
  }

  const listings = await getAllListings();
  const matches = listings
    .filter(
      (l) =>
        l.address.toLowerCase().includes(q) ||
        l.city.toLowerCase().includes(q)
    )
    .slice(0, 8)
    .map((l) => ({
      address: l.address,
      city: l.city,
      price: l.price,
    }));

  return NextResponse.json(matches);
}
