import { NextRequest, NextResponse } from "next/server";
import { searchListings } from "@/lib/zoocasa";
import { getAllListings } from "@/lib/kv/listings";
import { scoreV2 } from "@/lib/scoring";
import { getSignals } from "@/lib/signals";

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { city, province, minPrice, maxPrice, minBeds, sortBy, limit } = body;

  if (!city || !province) {
    return NextResponse.json({ error: "city and province are required" }, { status: 400 });
  }

  try {
    // Try cached listings first
    const allListings = await getAllListings();
    let listings = allListings.filter(
      (l) => l.city.toLowerCase() === city.toLowerCase() && l.province === province
    );
    let source: "live" | "cached" = "cached";

    // If no cached data, try Zoocasa live search
    if (listings.length === 0) {
      try {
        listings = await searchListings(city, province, {
          type: "house",
          minPrice,
          maxPrice,
          beds: minBeds,
        });
        source = "live";
      } catch {
        // Live fetch failed
      }
    }

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

    const results = limit ? scored.slice(0, limit) : scored;

    return NextResponse.json({ results, count: results.length, source });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
