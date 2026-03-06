import { NextRequest, NextResponse } from "next/server";
import { CITY_BOUNDS } from "@/lib/data/city-bounds";
import { searchListingsWithFallback } from "@/lib/realtor-ca";
import { scoreV2 } from "@/lib/scoring";
import { getSignals } from "@/lib/signals";

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { city, province, minPrice, maxPrice, minBeds, sortBy, limit } = body;

  if (!city || !province) {
    return NextResponse.json({ error: "city and province are required" }, { status: 400 });
  }

  const bounds = CITY_BOUNDS[city];
  if (!bounds) {
    return NextResponse.json({ error: `Unknown city: ${city}` }, { status: 400 });
  }

  try {
    const { listings, source } = await searchListingsWithFallback(city, province, bounds, {
      minPrice,
      maxPrice,
      minBeds,
      limit: limit || 30,
    });

    const scored = listings.map((listing) => {
      const score = scoreV2(listing);
      const signals = getSignals(listing);
      return { listing, score, signals };
    });

    if (sortBy === "dom") {
      scored.sort((a, b) => b.listing.dom - a.listing.dom);
    } else if (sortBy === "price") {
      scored.sort((a, b) => a.listing.price - b.listing.price);
    } else {
      scored.sort((a, b) => b.score.total - a.score.total);
    }

    return NextResponse.json({ results: scored, count: scored.length, source });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
