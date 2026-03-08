/**
 * GET /api/autocomplete?q=<query>
 *
 * Proxies to Google Places Autocomplete API (New) for Canadian addresses.
 * Keeps the API key server-side.
 */

import { NextRequest, NextResponse } from "next/server";

interface PlaceSuggestion {
  address: string;
  placeId: string;
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q || q.length < 3) {
    return NextResponse.json([]);
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return NextResponse.json([]);
  }

  try {
    const res = await fetch(
      "https://places.googleapis.com/v1/places:autocomplete",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
        },
        body: JSON.stringify({
          input: q,
          includedRegionCodes: ["ca"],
          languageCode: "en",
        }),
      }
    );

    if (!res.ok) {
      const errorText = await res.text();
      console.error("Places API error:", res.status, errorText);
      return NextResponse.json([]);
    }

    const data = await res.json();
    const suggestions: PlaceSuggestion[] = (data.suggestions || [])
      .filter((s: Record<string, unknown>) => s.placePrediction)
      .slice(0, 5)
      .map((s: Record<string, unknown>) => {
        const pred = s.placePrediction as {
          placeId: string;
          text: { text: string };
        };
        return {
          address: pred.text.text,
          placeId: pred.placeId,
        };
      });

    return NextResponse.json(suggestions);
  } catch {
    return NextResponse.json([]);
  }
}
