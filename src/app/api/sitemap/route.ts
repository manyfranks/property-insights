import { NextResponse } from "next/server";
import { getAllListings } from "@/lib/kv/listings";
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
  const listings = await getAllListings();
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
