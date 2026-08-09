/**
 * Build-time sitemap generator — writes public/sitemap.xml as a STATIC file.
 *
 * Why static: GSC's sitemap fetcher repeatedly failed ("Couldn't fetch")
 * against the dynamic /api/sitemap function behind a next.config rewrite,
 * even though curl and GSC's own live URL-inspection succeeded. A static
 * CDN-served file removes every dynamic variable (cold starts, middleware,
 * rewrite). Runs as `prebuild` on every deploy; listings freshness is
 * one-deploy-cycle stale, which is acceptable (counties dominate the URL set
 * and are fully static).
 *
 * Also dedupes property slugs — the KV store briefly accumulated duplicate
 * addresses (pre-hardening Zoocasa scope pollution), and duplicate <loc>
 * entries are a sitemap-quality negative.
 *
 * KV creds come from the environment (Vercel build env or .env.local).
 */
import { loadEnvLocal } from "./lib/ingest-shared";
loadEnvLocal();

import { writeFileSync } from "node:fs";
import { join } from "node:path";

async function main() {
  const { getAllListings } = await import("../src/lib/kv/listings");
  const { BLOG_POSTS } = await import("../src/lib/blog");
  const { slugify } = await import("../src/lib/utils");
  const { BASE_URL } = await import("../src/lib/seo");
  const { US_COUNTIES, getAllStatesWithCounties, isTopMetroCounty } = await import("../src/lib/us-counties");

  const listings = await getAllListings();
  const now = new Date().toISOString();

  // Counties with HUD FMR data get a /rent page (fail-soft: no DB at build
  // time → skip rent URLs rather than failing the whole sitemap).
  let fmrFips = new Set<string>();
  let taxFips = new Set<string>();
  try {
    if (process.env.DATABASE_URL) {
      const { neon } = await import("@neondatabase/serverless");
      const sql = neon(process.env.DATABASE_URL);
      const rows = (await sql`
        SELECT DISTINCT geo_fips FROM regional_econ WHERE metric = 'fmr_2br'
      `) as { geo_fips: string }[];
      fmrFips = new Set(rows.map((r) => r.geo_fips));
      // Property-tax pages gate on taxes AND home value both present.
      const taxRows = (await sql`
        SELECT geo_fips FROM regional_econ
        WHERE metric IN ('median_re_taxes_paid', 'median_home_value')
        GROUP BY geo_fips HAVING count(DISTINCT metric) = 2
      `) as { geo_fips: string }[];
      taxFips = new Set(taxRows.map((r) => r.geo_fips));
    }
  } catch (err) {
    console.error("[sitemap] county tool queries failed — tool URLs skipped:", err);
  }

  const entry = (url: string, lastmod: string, changefreq: string, priority: number) =>
    `<url><loc>${url}</loc><lastmod>${lastmod}</lastmod><changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`;

  const tagSlugs = [...new Set(BLOG_POSTS.flatMap((p) => p.tags.map((t) => slugify(t))))];
  const citySlugs = [...new Set(listings.map((l) => l.city.toLowerCase().replace(/\s+/g, "-")))];
  const propertySlugs = [...new Set(listings.map((l) => slugify(l.address)))];

  const urls: string[] = [
    entry(BASE_URL, now, "daily", 1.0),
    entry(`${BASE_URL}/dashboard`, now, "daily", 0.9),
    entry(`${BASE_URL}/how-it-works`, now, "monthly", 0.7),
    entry(`${BASE_URL}/blog`, now, "weekly", 0.8),
    entry(`${BASE_URL}/tools/assessment-gap`, now, "monthly", 0.7),
    entry(`${BASE_URL}/privacy`, now, "yearly", 0.3),
    entry(`${BASE_URL}/terms`, now, "yearly", 0.3),
    entry(`${BASE_URL}/data-usage`, now, "yearly", 0.3),
    ...BLOG_POSTS.map((post) =>
      entry(`${BASE_URL}/blog/${post.slug}`, new Date(post.updatedAt || post.publishedAt).toISOString(), "monthly", 0.8)
    ),
    ...tagSlugs.map((tag) => entry(`${BASE_URL}/blog/tags/${tag}`, now, "weekly", 0.6)),
    ...citySlugs.map((city) => entry(`${BASE_URL}/discover/${city}`, now, "daily", 0.8)),
    ...propertySlugs.map((slug) => entry(`${BASE_URL}/property/${slug}`, now, "weekly", 0.8)),
    entry(`${BASE_URL}/us`, now, "monthly", 0.7),
    ...getAllStatesWithCounties().map((s) => entry(`${BASE_URL}/us/${s.stateSlug}`, now, "monthly", 0.6)),
    ...US_COUNTIES.map((c) =>
      entry(`${BASE_URL}/us/${c.stateSlug}/${c.countySlug}`, now, "monthly", isTopMetroCounty(c.fips) ? 0.7 : 0.6)
    ),
    ...US_COUNTIES.filter((c) => fmrFips.has(`US-${c.fips}`) || fmrFips.has(c.fips)).map((c) =>
      entry(`${BASE_URL}/us/${c.stateSlug}/${c.countySlug}/rent`, now, "monthly", isTopMetroCounty(c.fips) ? 0.7 : 0.6)
    ),
    ...US_COUNTIES.filter((c) => taxFips.has(`US-${c.fips}`) || taxFips.has(c.fips)).map((c) =>
      entry(`${BASE_URL}/us/${c.stateSlug}/${c.countySlug}/property-tax`, now, "monthly", isTopMetroCounty(c.fips) ? 0.7 : 0.6)
    ),
    entry(`${BASE_URL}/tools/appeal-checker`, now, "monthly", 0.7),
    entry(`${BASE_URL}/resources`, now, "monthly", 0.6),
    entry(`${BASE_URL}/us/rankings/investment`, now, "weekly", 0.8),
    entry(`${BASE_URL}/us/rankings/rent-to-price`, now, "weekly", 0.8),
    ...getAllStatesWithCounties().flatMap((s) => [
      entry(`${BASE_URL}/us/rankings/investment/${s.stateSlug}`, now, "monthly", 0.6),
      entry(`${BASE_URL}/us/rankings/rent-to-price/${s.stateSlug}`, now, "monthly", 0.6),
    ]),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>`;
  const out = join(process.cwd(), "public", "sitemap.xml");
  writeFileSync(out, xml);
  // Identical copy at a fresh URL: GSC's sitemap pipeline can pin a stale
  // failure state to a URL (this one failed since March even after the
  // content became a static file, while live URL-inspection passed) — a
  // never-before-submitted path gets a clean fetch state.
  const out2 = join(process.cwd(), "public", "sitemap-main.xml");
  writeFileSync(out2, xml);
  console.log(`[sitemap] wrote ${out} + sitemap-main.xml: ${urls.length} URLs (${propertySlugs.length} unique properties from ${listings.length} listings)`);
}

main().catch((err) => {
  console.error("[sitemap] generation failed:", err);
  process.exit(1);
});
