/**
 * POST /api/discover — city search over the cached store, with a live
 * Zoocasa search as the fallback when nothing is cached for that city.
 *
 * Degraded mode: disclosed live fallback, or 503 — never a silent empty
 * "cached" result.
 *
 * The cached-then-live shape was already here and is genuinely useful, but
 * it was driven by `listings.length === 0`, and getAllListings() answers a
 * KV outage with exactly that. So an outage looked identical to "we have no
 * cached listings for this city": the route would quietly fall through to
 * the live search and, if that also failed, return `{ results: [], count: 0,
 * source: "cached" }` with a 200 — asserting the city has no properties
 * while nothing had actually been read.
 *
 * Now the store read is typed. An unreadable store still tries the live
 * search (a real answer from the provider beats a failure), but the response
 * carries `degraded: true` and `degradedReason` so the caller can see the
 * cache was skipped rather than empty, and if the live search cannot supply
 * results either, the route answers 503 instead of an empty success.
 */
import { NextRequest, NextResponse } from "next/server";
import { searchListings } from "@/lib/zoocasa";
import { readAllListings } from "@/lib/kv/listings";
import { scoreV2 } from "@/lib/scoring";
import { getSignals } from "@/lib/signals";
import type { Listing } from "@/lib/types";

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { city, province, minPrice, maxPrice, minBeds, sortBy, limit } = body;

  if (!city || !province) {
    return NextResponse.json({ error: "city and province are required" }, { status: 400 });
  }

  try {
    // Try cached listings first. The typed read keeps "this city has no
    // cached listings" apart from "the cache could not be read at all" —
    // see the module docstring.
    const store = await readAllListings();
    const storeUnavailable = store.status === "unavailable" ? store.reason : null;
    if (storeUnavailable) {
      console.error(
        `[discover] listings store unreadable (${storeUnavailable}) — falling through to a live ` +
          `Zoocasa search for ${city}, ${province}. This response is NOT backed by the cache.`
      );
    }

    let listings: Listing[] =
      store.status === "ok"
        ? store.listings.filter(
            (l) => l.city.toLowerCase() === city.toLowerCase() && l.province === province
          )
        : [];
    let source: "live" | "cached" = "cached";
    let liveError: string | null = null;

    // No cached data — either genuinely none for this city, or the cache is
    // unreadable. Either way the live search is the remaining source.
    if (listings.length === 0) {
      try {
        listings = await searchListings(city, province, {
          type: "house",
          minPrice,
          maxPrice,
          beds: minBeds,
        });
        source = "live";
      } catch (err) {
        liveError = err instanceof Error ? err.message : String(err);
      }
    }

    // Both sources are gone. Returning an empty 200 here would assert that
    // this city has no listings, which is precisely what was not
    // established — answer with a retryable failure instead.
    if (storeUnavailable && listings.length === 0) {
      return NextResponse.json(
        {
          error:
            `Discover is temporarily unavailable for ${city}, ${province}: the cached listings store ` +
            `could not be read (${storeUnavailable})` +
            (liveError ? `, and the live search failed too (${liveError})` : ", and the live search returned nothing") +
            `.`,
          degraded: true,
        },
        { status: 503, headers: { "Retry-After": "30", "Cache-Control": "no-store" } }
      );
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

    return NextResponse.json({
      results,
      count: results.length,
      source,
      // Present and true only when the cache was skipped because it could
      // not be read — so a consumer can tell a live-sourced answer given
      // under degradation from a normal cache miss.
      ...(storeUnavailable ? { degraded: true, degradedReason: storeUnavailable } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
