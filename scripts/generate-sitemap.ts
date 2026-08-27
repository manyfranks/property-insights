/**
 * Build-time sitemap generator — writes a sitemap INDEX plus THREE
 * code/DB-defined child sitemaps as STATIC files under public/
 * (public/sitemap-{static,blog,us}.xml).
 *
 * The index (public/sitemap-main.xml) still names FIVE children — it also
 * points at public/sitemap-{property,discover}.xml, which this script does
 * NOT write. Those two are dynamic routes now:
 *   - src/app/sitemap-property.xml/route.ts
 *   - src/app/sitemap-discover.xml/route.ts
 * See the "--- property/discover moved to dynamic routes ---" section below
 * for why, and DO NOT re-add "property"/"discover" to the `groups` array —
 * a static file written to public/sitemap-property.xml would silently
 * shadow the dynamic route at that exact path (Next.js serves a matching
 * file in public/ before an app route ever sees the request), undoing the
 * whole point of the split with no error anywhere.
 *
 * Why the remaining three stay static: GSC's sitemap fetcher repeatedly
 * failed ("Couldn't fetch") against the dynamic /api/sitemap function
 * behind a next.config rewrite, even though curl and GSC's own live
 * URL-inspection succeeded. A static CDN-served file removes every dynamic
 * variable (cold starts, middleware, rewrite). Runs as `prebuild` on every
 * deploy. static/blog/us are code/DB config that only changes on deploy
 * anyway (unlike the KV listings store, which a daily cron mutates), so
 * build-time staleness is a non-issue for them — that asymmetry is exactly
 * why property/discover are the two that moved off this path and these
 * three did not.
 *
 * Also dedupes property slugs — the KV store briefly accumulated duplicate
 * addresses (pre-hardening Zoocasa scope pollution), and duplicate <loc>
 * entries are a sitemap-quality negative. (This dedup now lives in
 * src/lib/sitemap-listing-entries.ts, shared by the two dynamic routes —
 * this script no longer computes property/city slugs itself.)
 *
 * As of the property/discover split below, this script no longer touches
 * the KV listings store at all. DATABASE_URL (regional_econ, for the `us`
 * surface) is its only external dependency.
 *
 * --- sitemap split (2026-08-20) -------------------------------------------
 * sitemap-main.xml used to be one flat <urlset> holding all ~11,840 URLs
 * from every surface pooled together. That makes GSC's "Sitemaps" report
 * (submitted vs. indexed) an aggregate over the whole site — there was no
 * way to tell whether Google was actually crawling the differentiated
 * county data or spending its budget on address pages that compete with
 * Zillow/Redfin. It is now a <sitemapindex> pointing at five per-surface
 * child sitemaps (public/sitemap-{static,blog,discover,property,us}.xml,
 * two of which are now dynamic routes rather than files — see above), so
 * each surface gets its own row in that report. This is a structural split
 * only — the URL set is identical, just redistributed; see
 * scripts/test-sitemap-split.ts for the identity proof this generator used
 * to be checked against for the surfaces that are still static here.
 *
 * public/sitemap-main.xml keeps its name and stays the URL robots.ts
 * advertises (see src/app/robots.ts) specifically so nothing has to change
 * there: /sitemap.xml is pinned in a GSC fetch-failure state from an
 * earlier incident, and re-pointing robots.txt at yet another fresh URL
 * would risk repeating that. Only its *format* changes, from <urlset> to
 * <sitemapindex>.
 *
 * public/sitemap.xml remains the flat, all-surfaces merge for the three
 * surfaces this script still writes (static/blog/us) — legacy path, still
 * reachable, kept live so nothing that already fetched it 404s or has to be
 * taught about the index. It no longer includes property/discover URLs (see
 * below) — it never re-reads KV, so baking them in here would recreate,
 * inside this one file, the exact staleness bug the property/discover split
 * exists to fix.
 *
 * --- property/discover moved to dynamic routes (2026-08-27) --------------
 * public/sitemap-property.xml and public/sitemap-discover.xml used to be
 * written here from a KV listings read guarded by a "degraded-KV policy"
 * (build-fails-rather-than-bakes-emptiness) and a MIN_PROPERTY_URLS floor.
 * Both surfaces are derived from the KV listings store, which a daily cron
 * adds to and removes from — baking them into a deploy meant listings
 * acquired after that deploy were invisible to Google until the NEXT
 * deploy. They are now dynamic routes reading KV fresh on every crawl:
 *   - src/app/sitemap-property.xml/route.ts
 *   - src/app/sitemap-discover.xml/route.ts
 * sharing their entry-building logic (slug dedup, per-record lastmod) via
 * src/lib/sitemap-listing-entries.ts so the two routes can't drift apart.
 * Their own degraded-KV contract — 503 + Retry-After on an unreadable
 * store, mirroring src/app/api/sitemap/route.ts — lives in those route
 * files now, not here; see scripts/test-listings-degraded.ts section 2 for
 * the regression test and scripts/test-sitemap-dynamic.ts for the
 * happy-path + shape checks.
 *
 * The five URLs the index (public/sitemap-main.xml) names DO NOT CHANGE —
 * only two of them now resolve to an app route instead of a static file at
 * the same path. Concretely, this script:
 *   - no longer reads KV listings, computes property/city slugs, or runs
 *     the old MIN_PROPERTY_URLS floor / unavailable-KV build-failure checks
 *     (nothing left in this script needs the listings read once
 *     property/discover are removed from `groups` — see the two routes
 *     above for where that guard now lives, as a per-request 503 instead of
 *     a failed build);
 *   - still emits <sitemap><loc>.../sitemap-property.xml</loc></sitemap>
 *     and the discover equivalent in the index, WITHOUT a <lastmod> — this
 *     script has no live listings data to compute one from anymore, and the
 *     lastmod policy below says omit rather than guess rather than, say,
 *     reusing the `us` group's lastmod;
 *   - no longer includes property/discover URLs in the flat
 *     public/sitemap.xml back-compat merge, for the same reason.
 * ---------------------------------------------------------------------------
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
 * synthesized from a data vintage year. See makeEntry() below — passing
 * `null` omits the tag rather than falling back to `now`. The split above
 * changes nothing about this: every URL keeps exactly the lastmod (or
 * absence of one) it had before, just filed into a different document (or,
 * for property/discover, generated at request time by a different file —
 * see src/lib/sitemap-listing-entries.ts, which applies this exact same
 * rule per-request instead of per-build).
 *
 * Per-surface sourcing:
 *   - /property/[slug],
 *     /discover/[city]  Moved to src/lib/sitemap-listing-entries.ts (see
 *                        the 2026-08-27 section above) — real per-listing
 *                        enrichedAt, MAX'd per property slug or per city.
 *                        This script no longer computes either.
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

interface Entry {
  loc: string;
  lastmod: string | null;
  xml: string;
}

/** One sitemap ceiling per the protocol; every child below sits far under this. */
const SITEMAP_URL_CEILING = 50_000;

async function main() {
  const { BLOG_POSTS } = await import("../src/lib/blog");
  const { slugify } = await import("../src/lib/utils");
  const { BASE_URL } = await import("../src/lib/seo");
  const { US_COUNTIES, getAllStatesWithCounties, getCountiesByState, isTopMetroCounty } = await import(
    "../src/lib/us-counties"
  );

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

  const makeEntry = (url: string, lastmod: string | null, changefreq: string, priority: number): Entry => ({
    loc: url,
    lastmod,
    xml: `<url><loc>${url}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}<changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`,
  });

  const tagSlugs = [...new Set(BLOG_POSTS.flatMap((p) => p.tags.map((t) => slugify(t))))];

  // listing.enrichedAt is a real per-listing timestamp (src/lib/types.ts —
  // set by the enrichment pipeline, e.g. src/lib/pipeline/us-enrich.ts).
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

  // --- Three static groups this script still writes, plus the two dynamic
  // URLs the index also names (see the 2026-08-27 section above). ---------

  const staticEntries: Entry[] = [
    // No real per-page modification signal exists for any of these (no
    // CMS, no DB row) — omitted per lastmod policy above rather than
    // guessed. TODO: see file header for what would be needed to stop
    // omitting these.
    makeEntry(BASE_URL, null, "daily", 1.0),
    makeEntry(`${BASE_URL}/dashboard`, null, "daily", 0.9),
    makeEntry(`${BASE_URL}/how-it-works`, null, "monthly", 0.7),
    makeEntry(`${BASE_URL}/insurance`, null, "weekly", 0.8),
    makeEntry(`${BASE_URL}/tools/assessment-gap`, null, "monthly", 0.7),
    makeEntry(`${BASE_URL}/privacy`, null, "yearly", 0.3),
    makeEntry(`${BASE_URL}/terms`, null, "yearly", 0.3),
    makeEntry(`${BASE_URL}/data-usage`, null, "yearly", 0.3),
    makeEntry(`${BASE_URL}/disclosures`, null, "yearly", 0.3),
    makeEntry(`${BASE_URL}/tools/appeal-checker`, null, "monthly", 0.7),
    makeEntry(`${BASE_URL}/resources`, null, "monthly", 0.6),
  ];

  const blogEntries: Entry[] = [
    makeEntry(`${BASE_URL}/blog`, blogIndexLastmod, "weekly", 0.8),
    ...BLOG_POSTS.map((post) => makeEntry(`${BASE_URL}/blog/${post.slug}`, postDate(post), "monthly", 0.8)),
    ...tagSlugs.map((tag) => makeEntry(`${BASE_URL}/blog/tags/${tag}`, tagLastmod(tag), "weekly", 0.6)),
  ];

  const usEntries: Entry[] = [
    makeEntry(`${BASE_URL}/us`, globalUsLastmod, "monthly", 0.7),
    ...getAllStatesWithCounties().map((s) =>
      makeEntry(
        `${BASE_URL}/us/${s.stateSlug}`,
        maxLastmod(getCountiesByState(s.stateSlug).map((c) => c.fips)),
        "monthly",
        0.6
      )
    ),
    ...US_COUNTIES.map((c) =>
      makeEntry(
        `${BASE_URL}/us/${c.stateSlug}/${c.countySlug}`,
        countyLastmod(c.fips),
        "monthly",
        isTopMetroCounty(c.fips) ? 0.7 : 0.6
      )
    ),
    ...US_COUNTIES.filter((c) => fmrFips.has(`US-${c.fips}`) || fmrFips.has(c.fips)).map((c) =>
      makeEntry(
        `${BASE_URL}/us/${c.stateSlug}/${c.countySlug}/rent`,
        countyLastmod(c.fips),
        "monthly",
        isTopMetroCounty(c.fips) ? 0.7 : 0.6
      )
    ),
    ...US_COUNTIES.filter((c) => taxFips.has(`US-${c.fips}`) || taxFips.has(c.fips)).map((c) =>
      makeEntry(
        `${BASE_URL}/us/${c.stateSlug}/${c.countySlug}/property-tax`,
        countyLastmod(c.fips),
        "monthly",
        isTopMetroCounty(c.fips) ? 0.7 : 0.6
      )
    ),
    makeEntry(`${BASE_URL}/us/rankings/investment`, globalUsLastmod, "weekly", 0.8),
    makeEntry(`${BASE_URL}/us/rankings/rent-to-price`, globalUsLastmod, "weekly", 0.8),
    ...getAllStatesWithCounties().flatMap((s) => {
      const stateLastmod = maxLastmod(getCountiesByState(s.stateSlug).map((c) => c.fips));
      return [
        makeEntry(`${BASE_URL}/us/rankings/investment/${s.stateSlug}`, stateLastmod, "monthly", 0.6),
        makeEntry(`${BASE_URL}/us/rankings/rent-to-price/${s.stateSlug}`, stateLastmod, "monthly", 0.6),
      ];
    }),
  ];

  // Only the three surfaces this script still writes as static files. The
  // index below also names sitemap-discover.xml and sitemap-property.xml
  // (dynamic routes) WITHOUT going through this array — see indexChildren.
  const groups: { name: string; file: string; entries: Entry[] }[] = [
    { name: "static", file: "sitemap-static.xml", entries: staticEntries },
    { name: "blog", file: "sitemap-blog.xml", entries: blogEntries },
    { name: "us", file: "sitemap-us.xml", entries: usEntries },
  ];

  for (const g of groups) {
    if (g.entries.length > SITEMAP_URL_CEILING) {
      throw new Error(
        `[sitemap] "${g.name}" child has ${g.entries.length} URLs, over the ${SITEMAP_URL_CEILING}-URL sitemap ceiling — split it further before shipping.`
      );
    }
  }

  const renderUrlset = (entries: Entry[]): string =>
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries
      .map((e) => e.xml)
      .join("\n")}\n</urlset>`;

  /** MAX lastmod across a group's entries, or null if none carry one — never fabricated. */
  const groupMaxLastmod = (entries: Entry[]): string | null => {
    let max: string | null = null;
    for (const e of entries) {
      if (e.lastmod && (!max || e.lastmod > max)) max = e.lastmod;
    }
    return max;
  };

  const publicDir = join(process.cwd(), "public");
  let totalUrls = 0;
  for (const g of groups) {
    writeFileSync(join(publicDir, g.file), renderUrlset(g.entries));
    totalUrls += g.entries.length;
  }

  // Sitemap index — this is what public/sitemap-main.xml now contains
  // (format change only; see the 2026-08-20 header note above for why the
  // filename itself doesn't change). Ordered static, blog, discover,
  // property, us — the same order the flat list held before the 2026-08-20
  // split, preserved here purely for continuity, not because order is
  // meaningful to a <sitemapindex>. discover/property carry no <lastmod>:
  // this script has no live listings data to compute one from (see the
  // 2026-08-27 section above) and the policy is to omit rather than guess.
  const indexChildren: { file: string; lastmod: string | null }[] = [
    { file: "sitemap-static.xml", lastmod: groupMaxLastmod(staticEntries) },
    { file: "sitemap-blog.xml", lastmod: groupMaxLastmod(blogEntries) },
    { file: "sitemap-discover.xml", lastmod: null },
    { file: "sitemap-property.xml", lastmod: null },
    { file: "sitemap-us.xml", lastmod: groupMaxLastmod(usEntries) },
  ];
  const indexXml = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${indexChildren
    .map((c) => {
      const loc = `${BASE_URL}/${c.file}`;
      return `<sitemap><loc>${loc}</loc>${c.lastmod ? `<lastmod>${c.lastmod}</lastmod>` : ""}</sitemap>`;
    })
    .join("\n")}\n</sitemapindex>`;

  // Flat, three-surface merge (static/blog/us only — see the 2026-08-27
  // section above for why property/discover are excluded) — unchanged
  // format, same lastmod per URL as the split children. Kept for back-compat
  // (see file header). Both public/sitemap.xml and public/sitemap-main.xml
  // are gitignored (see .gitignore): they're regenerated build artifacts,
  // and committing them turned every deploy into a huge diff for no
  // benefit — they're fully reproducible from DB + static data at build
  // time. Do not remove either write path without first checking
  // robots.ts for which URL is currently advertised.
  const flatXml = renderUrlset(groups.flatMap((g) => g.entries));
  writeFileSync(join(publicDir, "sitemap.xml"), flatXml);
  writeFileSync(join(publicDir, "sitemap-main.xml"), indexXml);

  const perGroupCounts = groups.map((g) => `${g.name}=${g.entries.length}`).join(", ");
  console.log(
    `[sitemap] wrote sitemap-main.xml (index, names 5 children) + ${groups.length} static child sitemaps + ` +
      `sitemap.xml (flat legacy, static/blog/us only): ${totalUrls} URLs total (${perGroupCounts}). ` +
      `sitemap-discover.xml and sitemap-property.xml are dynamic routes, not written here — ` +
      `see src/app/sitemap-{discover,property}.xml/route.ts.`
  );
}

main().catch((err) => {
  console.error("[sitemap] generation failed:", err);
  process.exit(1);
});
