/**
 * GET /sitemap-property.xml — dynamic child of the sitemap index at
 * public/sitemap-main.xml (scripts/generate-sitemap.ts). Renders one <url>
 * per distinct /property/{slug} address, read from KV fresh on every crawl.
 *
 * Why this one is dynamic and the other three children (static/blog/us)
 * stay static files: /property and /discover are the two surfaces derived
 * from the KV listings store, which a daily cron adds to and removes from.
 * The other three are code/DB config that only changes on deploy, so a
 * build-time static file is correct — and cheaper — for them. Baking
 * /property into public/ at build time (the old behaviour) meant listings
 * acquired after a deploy were invisible to Google until the *next* deploy;
 * this route removes that lag by reading KV per request instead.
 *
 * This URL must NOT change, and neither may the index that names it.
 * robots.ts advertises ${BASE_URL}/sitemap-main.xml, whose <sitemapindex>
 * points at this exact path; /sitemap.xml is separately pinned in a GSC
 * fetch-failure state from a past incident (see robots.ts's comment block),
 * so minting a fresh sitemap URL — or renaming this one — risks repeating
 * it. Converting this child from a static public/ file to a route at the
 * SAME path is what keeps the index and robots.txt untouched; only the
 * generation mechanism moved from build-time to request-time. See
 * scripts/generate-sitemap.ts's file header for why the old static write
 * was removed and why a stray public/sitemap-property.xml must never come
 * back — a static file in public/ takes precedence over an app route at the
 * same path and would silently shadow this route.
 *
 * Degraded-mode contract — copied from src/app/api/sitemap/route.ts on
 * purpose, so the two never disagree: this route MUST NOT answer 200 with a
 * sitemap missing its property URLs. requireAllListings (src/lib/kv/
 * listings.ts) distinguishes "the store is unreadable" from "the store is
 * genuinely empty" specifically so a KV blip can't produce a valid,
 * well-formed sitemap with zero <loc> entries — a crawler reading that as
 * "these ~2,200 pages are gone" is exactly how this site already lost 409+
 * indexed property URLs once. An unreadable store throws
 * ListingsStoreUnavailableError, answered here with 503 + Retry-After and no
 * urlset body — Google retries a 5xx and keeps whatever sitemap it already
 * holds. An `absent` store (verifiably empty, not just unread) is not an
 * error: requireAllListings hands back `[]` for it and this route renders a
 * truthful, empty <urlset> rather than refusing to answer.
 *
 * lastmod sourcing lives in src/lib/sitemap-listing-entries.ts (shared with
 * sitemap-discover.xml/route.ts) — real per-listing enrichedAt, MAX'd across
 * the rare pair of listings sharing one address slug, never this request's
 * own wall-clock time, omitted rather than guessed when a listing has no
 * enrichedAt. See that file and scripts/generate-sitemap.ts's "lastmod
 * policy" section for the full rationale.
 */
import { NextResponse } from "next/server";
import { ListingsStoreUnavailableError, requireAllListings } from "@/lib/kv/listings";
import { buildPropertyUrlset } from "@/lib/sitemap-listing-entries";

export const dynamic = "force-dynamic";

export async function GET() {
  let listings;
  try {
    listings = await requireAllListings({ context: "GET /sitemap-property.xml" });
  } catch (err) {
    if (!(err instanceof ListingsStoreUnavailableError)) throw err;
    console.error(`[sitemap-property] refusing to publish a sitemap without property URLs: ${err.reason}`);
    // 503 + Retry-After, explicitly no-store: a cached empty-ish sitemap
    // would keep being served past the outage. Plain text so nothing
    // downstream mistakes the body for a parseable urlset.
    return new NextResponse(
      `Sitemap unavailable: the listings store could not be read (${err.reason}). ` +
        `Refusing to serve a sitemap that omits every property URL — retry shortly.`,
      {
        status: 503,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Retry-After": "300",
          "Cache-Control": "no-store",
        },
      }
    );
  }

  return new NextResponse(buildPropertyUrlset(listings), {
    status: 200,
    headers: {
      "Content-Type": "application/xml",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
