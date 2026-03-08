/**
 * GET /api/autocomplete?q=<query>
 *
 * Proxies to Google Places Autocomplete API (New) for Canadian addresses.
 * Keeps the API key server-side. Includes in-memory cache to deduplicate
 * rapid keystrokes and reduce Google Places costs.
 */

import { NextRequest, NextResponse } from "next/server";

interface PlaceSuggestion {
  address: string;
  placeId: string;
}

// ---------------------------------------------------------------------------
// In-memory cache (survives across requests in warm serverless instances)
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 60_000; // 60 seconds
const CACHE_MAX = 500;

const cache = new Map<string, { data: PlaceSuggestion[]; expires: number }>();

function cacheGet(key: string): PlaceSuggestion[] | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function cacheSet(key: string, data: PlaceSuggestion[]): void {
  // Evict expired entries when approaching max size
  if (cache.size >= CACHE_MAX) {
    const now = Date.now();
    for (const [k, v] of cache) {
      if (now > v.expires) cache.delete(k);
    }
    // If still at max, drop oldest entries
    if (cache.size >= CACHE_MAX) {
      const first = cache.keys().next().value;
      if (first) cache.delete(first);
    }
  }
  cache.set(key, { data, expires: Date.now() + CACHE_TTL_MS });
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q || q.length < 3) {
    return NextResponse.json([]);
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return NextResponse.json([]);
  }

  // Check cache first
  const cacheKey = q.toLowerCase();
  const cached = cacheGet(cacheKey);
  if (cached) {
    return NextResponse.json(cached);
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

    cacheSet(cacheKey, suggestions);
    return NextResponse.json(suggestions);
  } catch {
    return NextResponse.json([]);
  }
}
