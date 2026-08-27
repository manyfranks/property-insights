/**
 * GET /sitemap-discover.xml — dynamic child of the sitemap index at
 * public/sitemap-main.xml (scripts/generate-sitemap.ts). Renders one <url>
 * per distinct /discover/{city-slug} page, read from KV fresh on every
 * crawl.
 *
 * See src/app/sitemap-property.xml/route.ts's file header for the full
 * rationale — this route is its exact sibling, same reasoning applies:
 * /discover is derived from the KV listings store a daily cron mutates
 * (a city's discover page starts existing the moment its first listing
 * lands, same as a property page), so it moved off the build-time static
 * file the other three children (static/blog/us) still correctly use. The
 * URL itself must NOT change — robots.ts advertises sitemap-main.xml, whose
 * <sitemapindex> names this exact path, and /sitemap.xml is separately
 * pinned in a GSC fetch-failure state from a past incident (see robots.ts) —
 * so this route lives at the SAME path the old static
 * public/sitemap-discover.xml used, not a new one. A static file at that
 * path would silently shadow this route again; see
 * scripts/generate-sitemap.ts's header for why it no longer writes one.
 *
 * Degraded-mode contract — identical to sitemap-property.xml/route.ts and
 * src/app/api/sitemap/route.ts: an unreadable KV store throws
 * ListingsStoreUnavailableError, answered with 503 + Retry-After and no
 * urlset body, never a 200 with zero <loc> entries. An `absent` (verifiably
 * empty) store is not an error and renders a truthful empty <urlset>.
 *
 * lastmod sourcing lives in src/lib/sitemap-listing-entries.ts (shared with
 * sitemap-property.xml/route.ts) — MAX(enrichedAt) across a city's
 * listings, never this request's own wall-clock time, omitted rather than
 * guessed when none of a city's listings carry an enrichedAt.
 */
import { NextResponse } from "next/server";
import { ListingsStoreUnavailableError, requireAllListings } from "@/lib/kv/listings";
import { buildDiscoverUrlset } from "@/lib/sitemap-listing-entries";

export const dynamic = "force-dynamic";

export async function GET() {
  let listings;
  try {
    listings = await requireAllListings({ context: "GET /sitemap-discover.xml" });
  } catch (err) {
    if (!(err instanceof ListingsStoreUnavailableError)) throw err;
    console.error(`[sitemap-discover] refusing to publish a sitemap without discover URLs: ${err.reason}`);
    return new NextResponse(
      `Sitemap unavailable: the listings store could not be read (${err.reason}). ` +
        `Refusing to serve a sitemap that omits every discover URL — retry shortly.`,
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

  return new NextResponse(buildDiscoverUrlset(listings), {
    status: 200,
    headers: {
      "Content-Type": "application/xml",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
