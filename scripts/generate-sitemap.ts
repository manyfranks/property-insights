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
 *
 * --- lastmod policy (2026-08-19) -----------------------------------------
 * `<lastmod>` used to be `new Date()` (build time) stamped onto every one
 * of the ~11,840 URLs. That is a fabricated signal: it asserts every page
 * changed on every deploy, which is never true, and it trains Google's
 * crawler to ignore the tag (verified: 71% of a stratified GSC sample sat
 * at "Discovered - currently not indexed", i.e. Google knows the URLs and
 * is choosing not to spend crawl budget on them).
 *
 * Rule: lastmod is either a real per-record modification timestamp, or it
 * is omitted for that URL. Never a build/deploy timestamp, never a value
 * synthesized from a data vintage year. See emitEntry() below — passing
 * `null` omits the tag rather than falling back to `now`.
 *
 * Per-surface sourcing:
 *   - /property/[slug]   listing.enrichedAt (per-listing pipeline-enrichment
 *                         timestamp, src/lib/types.ts) — real, set at the
 *                         moment that specific listing was last processed.
 *                         Two rare listings can share one property slug
 *                         (dedup pairs); MAX(enrichedAt) across them.
 *   - /discover/[city]   MAX(enrichedAt) across listings in that city — the
 *                         page is a live aggregation over exactly those
 *                         listings, so this is a real, if derived, signal.
 *   - /us/[state]/[county],
 *     /us/[state]/[county]/rent,
 *     /us/[state]/[county]/property-tax
 *                         MAX(regional_econ.updated_at) for that county's
 *                         geo_fips. regional_econ.updated_at is set to
 *                         NOW() by scripts/lib/ingest-shared.ts's
 *                         upsertRegionalEcon() on every real ingest write
 *                         (insert AND on-conflict update) — a genuine
 *                         per-row modification time, not a build stamp; it
 *                         only moves when that county's data is actually
 *                         re-ingested, not on every deploy. Scoped to
 *                         geo_fips LIKE 'US-%' since these pages only ever
 *                         render US county data.
 *   - /us/[state],
 *     /us/rankings/investment/[state],
 *     /us/rankings/rent-to-price/[state]
 *                         MAX(county lastmod) over the counties in that
 *                         state — same source data, coarser grain.
 *   - /us,
 *     /us/rankings/investment,
 *     /us/rankings/rent-to-price
 *                         MAX(county lastmod) over every US county — same
 *                         source data, coarsest grain.
 *   - /blog/[slug]        post.updatedAt ?? post.publishedAt (src/lib/blog.ts)
 *                         — hand-maintained, real, already correct; not a
 *                         behavior change.
 *   - /blog                MAX(post date) across all posts — real, derived.
 *   - /blog/tags/[tag]    MAX(post date) across posts carrying that tag —
 *                         real, derived.
 *   - static marketing/legal pages (/, /dashboard, /how-it-works,
 *     /insurance, /tools/*, /privacy, /terms, /data-usage, /disclosures,
 *     /resources)
 *                         OMITTED. No CMS, no per-page updated_at column,
 *                         nothing in the DB or KV tracks when these pages'
 *                         *content* last changed — only when the source
 *                         file last changed in git, which conflates
 *                         incidental refactors with real content edits and
 *                         is not guaranteed available at build time (Vercel
 *                         may check out a shallow clone). Omitting is the
 *                         honest choice per the task's own rule.
 *                         TODO: if these ever need a real lastmod, add a
 *                         `updated_at` column to a static-pages table (or a
 *                         hand-maintained `LAST_REVIEWED` map) and read it
 *                         here — do not reach for git log or `new Date()`.
 * ---------------------------------------------------------------------------
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
  const { US_COUNTIES, getAllStatesWithCounties, getCountiesByState, isTopMetroCounty } = await import(
    "../src/lib/us-counties"
  );

  const listings = await getAllListings();

  // Counties with HUD FMR data get a /rent page (fail-soft: no DB at build
  // time → skip rent URLs rather than failing the whole sitemap).
  let fmrFips = new Set<string>();
  let taxFips = new Set<string>();
  // geo_fips -> ISO lastmod, real per-county MAX(regional_econ.updated_at).
  // Empty (not fabricated) when the DB is unreachable at build time — see
  // the omission fallback in countyLastmod() below.
  let countyLastmodByFips = new Map<string, string>();
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
      // One set-based query for every US county's real last-modified time.
      // Scoped to geo_fips LIKE 'US-%' — regional_econ also carries a
      // handful of CA-CMA rows (Canadian metro data, unrelated to /us/*).
      const lastmodRows = (await sql`
        SELECT geo_fips, MAX(updated_at) AS lastmod
        FROM regional_econ
        WHERE geo_fips LIKE 'US-%'
        GROUP BY geo_fips
      `) as { geo_fips: string; lastmod: string }[];
      for (const r of lastmodRows) {
        countyLastmodByFips.set(r.geo_fips, new Date(r.lastmod).toISOString());
      }
    }
  } catch (err) {
    console.error("[sitemap] county tool/lastmod queries failed — tool URLs and county lastmod skipped:", err);
    countyLastmodByFips = new Map();
  }

  /** Real per-county lastmod, or null (never a fabricated fallback). */
  const countyLastmod = (fips: string): string | null => countyLastmodByFips.get(fips) ?? null;

  /** MAX lastmod across a set of counties, or null if none have one. */
  const maxLastmod = (fipsList: string[]): string | null => {
    let max: string | null = null;
    for (const fips of fipsList) {
      const lm = countyLastmodByFips.get(fips);
      if (lm && (!max || lm > max)) max = lm;
    }
    return max;
  };
  const allUsFips = US_COUNTIES.map((c) => c.fips);
  const globalUsLastmod = maxLastmod(allUsFips);

  const emitEntry = (url: string, lastmod: string | null, changefreq: string, priority: number) =>
    `<url><loc>${url}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}<changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`;

  const tagSlugs = [...new Set(BLOG_POSTS.flatMap((p) => p.tags.map((t) => slugify(t))))];
  const citySlugs = [...new Set(listings.map((l) => l.city.toLowerCase().replace(/\s+/g, "-")))];
  const propertySlugs = [...new Set(listings.map((l) => slugify(l.address)))];

  // listing.enrichedAt is a real per-listing timestamp (src/lib/types.ts —
  // set by the enrichment pipeline, e.g. src/lib/pipeline/us-enrich.ts).
  // Build per-property-slug and per-city MAX() maps in one pass; a handful
  // of listings share a property slug (dedup pairs) or a city, so this is
  // still a real per-record signal, just aggregated at the granularity the
  // page actually renders.
  const propertySlugLastmod = new Map<string, string>();
  const cityLastmod = new Map<string, string>();
  for (const l of listings) {
    if (!l.enrichedAt) continue; // no real timestamp for this listing — it contributes nothing rather than a guess
    const iso = new Date(l.enrichedAt).toISOString();
    const propSlug = slugify(l.address);
    const curProp = propertySlugLastmod.get(propSlug);
    if (!curProp || iso > curProp) propertySlugLastmod.set(propSlug, iso);
    const citySlug = l.city.toLowerCase().replace(/\s+/g, "-");
    const curCity = cityLastmod.get(citySlug);
    if (!curCity || iso > curCity) cityLastmod.set(citySlug, iso);
  }

  // Blog posts already carry real, hand-maintained dates (publishedAt /
  // updatedAt) — not a build stamp, no change needed. /blog and
  // /blog/tags/[tag] derive a real MAX() over those same per-post dates.
  const postDate = (post: (typeof BLOG_POSTS)[number]): string =>
    new Date(post.updatedAt || post.publishedAt).toISOString();
  const allPostDates = BLOG_POSTS.map(postDate);
  const blogIndexLastmod = allPostDates.length ? allPostDates.reduce((a, b) => (b > a ? b : a)) : null;
  const tagLastmod = (tag: string): string | null => {
    const dates = BLOG_POSTS.filter((p) => p.tags.some((t) => slugify(t) === tag)).map(postDate);
    return dates.length ? dates.reduce((a, b) => (b > a ? b : a)) : null;
  };

  const urls: string[] = [
    // Static marketing/legal pages: no real per-page modification signal
    // exists (no CMS, no DB row) — omitted per lastmod policy above rather
    // than guessed. TODO: see file header for what would be needed to stop
    // omitting these.
    emitEntry(BASE_URL, null, "daily", 1.0),
    emitEntry(`${BASE_URL}/dashboard`, null, "daily", 0.9),
    emitEntry(`${BASE_URL}/how-it-works`, null, "monthly", 0.7),
    emitEntry(`${BASE_URL}/insurance`, null, "weekly", 0.8),
    emitEntry(`${BASE_URL}/blog`, blogIndexLastmod, "weekly", 0.8),
    emitEntry(`${BASE_URL}/tools/assessment-gap`, null, "monthly", 0.7),
    emitEntry(`${BASE_URL}/privacy`, null, "yearly", 0.3),
    emitEntry(`${BASE_URL}/terms`, null, "yearly", 0.3),
    emitEntry(`${BASE_URL}/data-usage`, null, "yearly", 0.3),
    emitEntry(`${BASE_URL}/disclosures`, null, "yearly", 0.3),
    ...BLOG_POSTS.map((post) => emitEntry(`${BASE_URL}/blog/${post.slug}`, postDate(post), "monthly", 0.8)),
    ...tagSlugs.map((tag) => emitEntry(`${BASE_URL}/blog/tags/${tag}`, tagLastmod(tag), "weekly", 0.6)),
    ...citySlugs.map((city) => emitEntry(`${BASE_URL}/discover/${city}`, cityLastmod.get(city) ?? null, "daily", 0.8)),
    ...propertySlugs.map((slug) =>
      emitEntry(`${BASE_URL}/property/${slug}`, propertySlugLastmod.get(slug) ?? null, "weekly", 0.8)
    ),
    emitEntry(`${BASE_URL}/us`, globalUsLastmod, "monthly", 0.7),
    ...getAllStatesWithCounties().map((s) =>
      emitEntry(
        `${BASE_URL}/us/${s.stateSlug}`,
        maxLastmod(getCountiesByState(s.stateSlug).map((c) => c.fips)),
        "monthly",
        0.6
      )
    ),
    ...US_COUNTIES.map((c) =>
      emitEntry(
        `${BASE_URL}/us/${c.stateSlug}/${c.countySlug}`,
        countyLastmod(c.fips),
        "monthly",
        isTopMetroCounty(c.fips) ? 0.7 : 0.6
      )
    ),
    ...US_COUNTIES.filter((c) => fmrFips.has(`US-${c.fips}`) || fmrFips.has(c.fips)).map((c) =>
      emitEntry(
        `${BASE_URL}/us/${c.stateSlug}/${c.countySlug}/rent`,
        countyLastmod(c.fips),
        "monthly",
        isTopMetroCounty(c.fips) ? 0.7 : 0.6
      )
    ),
    ...US_COUNTIES.filter((c) => taxFips.has(`US-${c.fips}`) || taxFips.has(c.fips)).map((c) =>
      emitEntry(
        `${BASE_URL}/us/${c.stateSlug}/${c.countySlug}/property-tax`,
        countyLastmod(c.fips),
        "monthly",
        isTopMetroCounty(c.fips) ? 0.7 : 0.6
      )
    ),
    emitEntry(`${BASE_URL}/tools/appeal-checker`, null, "monthly", 0.7),
    emitEntry(`${BASE_URL}/resources`, null, "monthly", 0.6),
    emitEntry(`${BASE_URL}/us/rankings/investment`, globalUsLastmod, "weekly", 0.8),
    emitEntry(`${BASE_URL}/us/rankings/rent-to-price`, globalUsLastmod, "weekly", 0.8),
    ...getAllStatesWithCounties().flatMap((s) => {
      const stateLastmod = maxLastmod(getCountiesByState(s.stateSlug).map((c) => c.fips));
      return [
        emitEntry(`${BASE_URL}/us/rankings/investment/${s.stateSlug}`, stateLastmod, "monthly", 0.6),
        emitEntry(`${BASE_URL}/us/rankings/rent-to-price/${s.stateSlug}`, stateLastmod, "monthly", 0.6),
      ];
    }),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>`;

  // Two on-disk copies, byte-identical, written from the same buffer:
  //   - public/sitemap.xml       legacy path, still reachable/indexed, kept
  //                              live so nothing that already fetched it 404s.
  //   - public/sitemap-main.xml  the URL robots.ts actually advertises (see
  //                              src/app/robots.ts) — sitemap.xml is pinned
  //                              in a GSC fetch-failure state from an
  //                              earlier incident, so crawlers are pointed
  //                              at this fresh path instead.
  // Both are gitignored (see .gitignore): they're ~2.1MB regenerated
  // artifacts, and committing them turned every deploy into a ~47k-line
  // diff for no benefit — they're fully reproducible from KV + static data
  // at build time. Do not remove either write path without first checking
  // robots.ts for which URL is currently advertised.
  const out = join(process.cwd(), "public", "sitemap.xml");
  writeFileSync(out, xml);
  const out2 = join(process.cwd(), "public", "sitemap-main.xml");
  writeFileSync(out2, xml);
  console.log(`[sitemap] wrote ${out} + sitemap-main.xml: ${urls.length} URLs (${propertySlugs.length} unique properties from ${listings.length} listings)`);
}

main().catch((err) => {
  console.error("[sitemap] generation failed:", err);
  process.exit(1);
});
