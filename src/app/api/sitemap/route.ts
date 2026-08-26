/**
 * GET /api/sitemap — the dynamic sitemap.
 *
 * Degraded-mode contract: this route MUST NOT answer 200 with a sitemap that
 * is missing its property URLs.
 *
 * getAllListings() returns `[]` both when the store is genuinely empty and
 * when KV could not be read. This route used to take that array at face
 * value, so a KV blip produced a perfectly valid, well-formed sitemap
 * containing zero <loc> entries for /property/* and /discover/*. That is
 * worse than an error: a sitemap is an assertion about which pages exist,
 * and a crawler that fetches one omitting ~2,200 previously-listed URLs
 * reads it as "those pages are gone." This site has already lost 409+
 * property URLs to exactly that class of signal.
 *
 * So the read goes through requireAllListings, which throws rather than
 * hand back an empty array it cannot vouch for, and the failure is answered
 * with 503 + Retry-After. Google retries a 5xx and drops nothing; whatever
 * sitemap it already holds stays authoritative until this route can tell the
 * truth again. An `absent` store (verifiably empty over a healthy
 * connection) is NOT an error — it renders the static/blog/US URLs and no
 * property URLs, because that is then a fact about the site.
 */
import { NextResponse } from "next/server";
import { ListingsStoreUnavailableError, requireAllListings } from "@/lib/kv/listings";
import { BLOG_POSTS } from "@/lib/blog";
import { slugify } from "@/lib/utils";
import { BASE_URL } from "@/lib/seo";
import { US_COUNTIES, getAllStatesWithCounties, isTopMetroCounty } from "@/lib/us-counties";
import { getCountyFipsWithFmr } from "@/lib/db/regional-econ";

function getAllTagSlugs(): string[] {
  const slugs = new Set<string>();
  for (const post of BLOG_POSTS) {
    for (const tag of post.tags) {
      slugs.add(slugify(tag));
    }
  }
  return Array.from(slugs);
}

export const dynamic = "force-dynamic";

function entry(url: string, lastmod: string, changefreq: string, priority: number): string {
  return `<url><loc>${url}</loc><lastmod>${lastmod}</lastmod><changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`;
}

export async function GET() {
  let listings;
  try {
    listings = await requireAllListings({ context: "GET /api/sitemap" });
  } catch (err) {
    if (!(err instanceof ListingsStoreUnavailableError)) throw err;
    console.error(`[sitemap] refusing to publish a sitemap without property URLs: ${err.reason}`);
    // 503 + Retry-After, and explicitly no-store: a cached empty-ish sitemap
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

  const now = new Date().toISOString();

  // County /rent pages only exist for counties with a HUD fmr_2br row on
  // record (~3,077 of 3,144) — a live DB query here (this route is already
  // `force-dynamic`, not a build-time script) so the sitemap can never list
  // a /rent URL that 404s, and never needs a separate static file to stay
  // in sync with getCountyRentPanel's own data gate.
  const fmrFips = new Set(await getCountyFipsWithFmr());
  const countiesWithFmr = US_COUNTIES.filter((c) => fmrFips.has(c.fips));

  const urls: string[] = [
    // Static pages
    entry(BASE_URL, now, "daily", 1.0),
    entry(`${BASE_URL}/dashboard`, now, "daily", 0.9),
    entry(`${BASE_URL}/how-it-works`, now, "monthly", 0.7),
    entry(`${BASE_URL}/insurance`, now, "weekly", 0.8),
    entry(`${BASE_URL}/blog`, now, "weekly", 0.8),
    entry(`${BASE_URL}/tools/assessment-gap`, now, "monthly", 0.7),
    entry(`${BASE_URL}/privacy`, now, "yearly", 0.3),
    entry(`${BASE_URL}/terms`, now, "yearly", 0.3),
    entry(`${BASE_URL}/data-usage`, now, "yearly", 0.3),
    entry(`${BASE_URL}/disclosures`, now, "yearly", 0.3),

    // Blog posts
    ...BLOG_POSTS.map((post) =>
      entry(
        `${BASE_URL}/blog/${post.slug}`,
        new Date(post.updatedAt || post.publishedAt).toISOString(),
        "monthly",
        0.8,
      )
    ),

    // Blog tag pages
    ...getAllTagSlugs().map((tag) =>
      entry(`${BASE_URL}/blog/tags/${tag}`, now, "weekly", 0.6)
    ),

    // City landing pages
    ...[...new Set(listings.map((l) => l.city))].map((city) =>
      entry(
        `${BASE_URL}/discover/${city.toLowerCase().replace(/\s+/g, "-")}`,
        now,
        "daily",
        0.8,
      )
    ),

    // Property pages
    ...listings.map((l) =>
      entry(`${BASE_URL}/property/${slugify(l.address)}`, now, "weekly", 0.8)
    ),

    // US market data hub
    entry(`${BASE_URL}/us`, now, "monthly", 0.7),

    // US state index pages
    ...getAllStatesWithCounties().map((s) =>
      entry(`${BASE_URL}/us/${s.stateSlug}`, now, "monthly", 0.6)
    ),

    // US county market pages — every county in the registry
    ...US_COUNTIES.map((c) =>
      entry(
        `${BASE_URL}/us/${c.stateSlug}/${c.countySlug}`,
        now,
        "monthly",
        isTopMetroCounty(c.fips) ? 0.7 : 0.6,
      )
    ),

    // US county /rent pages — only counties with HUD FMR data on record
    ...countiesWithFmr.map((c) =>
      entry(
        `${BASE_URL}/us/${c.stateSlug}/${c.countySlug}/rent`,
        now,
        "monthly",
        isTopMetroCounty(c.fips) ? 0.65 : 0.55,
      )
    ),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>`;

  return new NextResponse(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/xml",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
