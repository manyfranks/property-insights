/**
 * GET /api/search?q=<query>
 *
 * Lightweight search endpoint for the navbar autocomplete.
 * Returns up to 8 matching listings by address or city.
 *
 * Degraded mode: 503, never an empty 200. The response shape is a bare
 * array, so an outage used to arrive at the navbar as `[]` — visually
 * identical to "no property matches that", which is a claim about the data
 * this endpoint had no basis to make. A user typing their own address and
 * being told it is not tracked is a wrong answer, not a slow one, and the
 * client can distinguish a 503 from an empty result set. On a verifiably
 * empty store (`absent`) an empty array is correct and is still returned.
 */

import { NextRequest, NextResponse } from "next/server";
import { ListingsStoreUnavailableError, requireAllListings } from "@/lib/kv/listings";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.toLowerCase();
  if (!q || q.length < 2) {
    return NextResponse.json([]);
  }

  let listings;
  try {
    listings = await requireAllListings({ context: "GET /api/search" });
  } catch (err) {
    if (!(err instanceof ListingsStoreUnavailableError)) throw err;
    console.error(`[search] listing search unavailable: ${err.reason}`);
    return NextResponse.json(
      { error: `Search is temporarily unavailable: ${err.reason}` },
      { status: 503, headers: { "Retry-After": "30", "Cache-Control": "no-store" } }
    );
  }

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
