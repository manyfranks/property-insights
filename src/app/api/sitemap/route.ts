import { NextResponse } from "next/server";
import { getAllListings } from "@/lib/kv/listings";
import { BLOG_POSTS } from "@/lib/blog";
import { slugify } from "@/lib/utils";
import { BASE_URL } from "@/lib/seo";

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

  const urls: string[] = [
    // Static pages
    entry(BASE_URL, now, "daily", 1.0),
    entry(`${BASE_URL}/dashboard`, now, "daily", 0.9),
    entry(`${BASE_URL}/how-it-works`, now, "monthly", 0.7),
    entry(`${BASE_URL}/blog`, now, "weekly", 0.8),
    entry(`${BASE_URL}/privacy`, now, "yearly", 0.3),
    entry(`${BASE_URL}/terms`, now, "yearly", 0.3),
    entry(`${BASE_URL}/data-usage`, now, "yearly", 0.3),

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
