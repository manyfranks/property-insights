/**
 * Build-time sitemap generator — writes a sitemap INDEX plus five child
 * sitemaps as STATIC files under public/.
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
 * --- sitemap split (2026-08-20) -------------------------------------------
 * sitemap-main.xml used to be one flat <urlset> holding all ~11,840 URLs
 * from every surface pooled together. That makes GSC's "Sitemaps" report
 * (submitted vs. indexed) an aggregate over the whole site — there was no
 * way to tell whether Google was actually crawling the differentiated
 * county data or spending its budget on address pages that compete with
 * Zillow/Redfin. It is now a <sitemapindex> pointing at five per-surface
 * child sitemaps (public/sitemap-{static,blog,discover,property,us}.xml),
 * so each surface gets its own row in that report. This is a structural
 * split only — the URL set is identical, just redistributed; see
 * scripts/test-sitemap-split.ts for the identity proof this generator is
 * checked against.
 *
 * public/sitemap-main.xml keeps its name and stays the URL robots.ts
 * advertises (see src/app/robots.ts) specifically so nothing has to change
 * there: /sitemap.xml is pinned in a GSC fetch-failure state from an
 * earlier incident, and re-pointing robots.txt at yet another fresh URL
 * would risk repeating that. Only its *format* changes, from <urlset> to
 * <sitemapindex>.
 *
 * public/sitemap.xml remains the flat, all-surfaces merge (unchanged
 * format) — legacy path, still reachable, kept live so nothing that
 * already fetched it 404s or has to be taught about the index.
 *
 * --- degraded-KV policy (2026-08 audit) ----------------------------------
 * This script must FAIL THE BUILD rather than write a sitemap from listings
 * it could not read. The reasoning is different from — and stronger than —
 * the dynamic /api/sitemap route's:
 *
 *   The files written below are STATIC ARTIFACTS baked into the deployment.
 *   The dynamic route self-heals on the next request once KV recovers; a
 *   baked public/sitemap-property.xml does not. If KV is unreadable during a
 *   Vercel build, getAllListings() returns [] (it no longer substitutes the
 *   static seed — see kv/listings.ts), every property and discover URL
 *   silently disappears, and the resulting well-formed "we have no property
 *   pages" assertion is served to Googlebot — which robots.ts points
 *   directly at sitemap-main.xml — until somebody notices and redeploys.
 *   Days of that is how indexed URLs get dropped, which is the exact loss
 *   this whole branch exists to stop.
 *
 * A failed deploy is trivially recoverable; a deployed empty sitemap is not.
 * So the read below uses readAllListings' typed three-state result (NOT
 * getListingsStoreHealth, which is process-global state and describes
 * whichever read stamped it last) and exits non-zero on `unavailable`.
 *
 * There is also an absolute floor on property URLs (SITEMAP_MIN_PROPERTY_URLS)
 * for the case KV reads cleanly but returns implausibly few rows — the
 * build-time analogue of writeAllListings' floor guard. It is absolute
 * rather than a comparison against the previous public/*.xml because every
 * one of those files is gitignored (see .gitignore), so on Vercel's fresh
 * checkout there is nothing to compare against and a relative check would
 * silently no-op in exactly the environment that matters.
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
 * absence of one) it had before, just filed into a different document.
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

interface Entry {
  loc: string;
  lastmod: string | null;
  xml: string;
}

/** One sitemap ceiling per the protocol; every child below sits far under this. */
const SITEMAP_URL_CEILING = 50_000;

/**
 * Floor on distinct /property/* URLs — see the degraded-KV policy in the
 * file header. The live store carries ~2,220 distinct property slugs, so 100
 * is far below any plausible day-to-day churn while still catching a store
 * that read "successfully" but came back essentially empty. Override with
 * SITEMAP_MIN_PROPERTY_URLS when a shrink is intentional (e.g. a deliberate
 * reset, or a fresh environment that genuinely has no listings yet); set it
 * to 0 to disable the check.
 */
const MIN_PROPERTY_URLS = Number(process.env.SITEMAP_MIN_PROPERTY_URLS ?? 100);

async function main() {
  const { readAllListings } = await import("../src/lib/kv/listings");
  const { BLOG_POSTS } = await import("../src/lib/blog");
  const { slugify } = await import("../src/lib/utils");
  const { BASE_URL } = await import("../src/lib/seo");
  const { US_COUNTIES, getAllStatesWithCounties, getCountiesByState, isTopMetroCounty } = await import(
    "../src/lib/us-counties"
  );

  // Unconfigured KV is its own failure here, and it has to be caught before
  // the read rather than after: readAllListings answers an unconfigured KV
  // with the 250-row static dev seed as a perfectly healthy `ok` (correct
  // for local dev — see kv/listings.ts), and 250 URLs would sail past the
  // floor check below and bake a sitemap asserting that 250 of the ~2,220
  // property pages exist and the rest do not. A build environment missing
  // KV credentials is a misconfiguration, not a small store.
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    if (process.env.SITEMAP_ALLOW_STATIC_SEED !== "1") {
      throw new Error(
        `refusing to generate a sitemap: KV_REST_API_URL/KV_REST_API_TOKEN are not set, so the listings ` +
          `read would return the static dev seed (src/lib/data/listings.ts) and this build would publish a ` +
          `sitemap omitting almost every real property URL. Set the KV credentials, or set ` +
          `SITEMAP_ALLOW_STATIC_SEED=1 to build a knowingly seed-based sitemap.`
      );
    }
    console.warn(
      "[sitemap] SITEMAP_ALLOW_STATIC_SEED=1 — generating from the static dev seed, NOT live KV. " +
        "The property/discover URLs in this build's sitemaps are not the real set."
    );
  }

  // Typed three-state read — see the degraded-KV policy in the file header.
  // `absent` (a verifiably empty store over a healthy connection) is allowed
  // through to the floor check below, which is where "empty" gets its
  // verdict; only "we could not read the store" fails here.
  const storeRead = await readAllListings();
  if (storeRead.status === "unavailable") {
    throw new Error(
      `refusing to generate a sitemap: the listings store could not be read (${storeRead.reason}). ` +
        `Writing public/sitemap-*.xml from an unread store would bake a sitemap with zero property URLs ` +
        `into this deployment and serve it to Googlebot until the next deploy. Fix KV and re-run the build.`
    );
  }
  const listings = storeRead.status === "ok" ? storeRead.listings : [];

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
  const citySlugs = [...new Set(listings.map((l) => l.city.toLowerCase().replace(/\s+/g, "-")))];
  const propertySlugs = [...new Set(listings.map((l) => slugify(l.address)))];

  // Floor guard — see the degraded-KV policy in the file header. This runs
  // before any writeFileSync, so a build that trips it leaves whatever
  // sitemaps already existed untouched rather than half-replacing them.
  if (MIN_PROPERTY_URLS > 0 && propertySlugs.length < MIN_PROPERTY_URLS) {
    throw new Error(
      `refusing to generate a sitemap: only ${propertySlugs.length} distinct property URL(s) from ` +
        `${listings.length} listing(s), under the ${MIN_PROPERTY_URLS}-URL floor. The store read cleanly, ` +
        `so this is a real collapse in the data, not an outage — publishing it would tell crawlers the ` +
        `missing property pages are gone. Set SITEMAP_MIN_PROPERTY_URLS if this shrink is intentional.`
    );
  }

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

  // --- Five surface groups — same URLs the old flat array held, just filed
  // into named buckets instead of one undifferentiated list. -------------

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

  const discoverEntries: Entry[] = citySlugs.map((city) =>
    makeEntry(`${BASE_URL}/discover/${city}`, cityLastmod.get(city) ?? null, "daily", 0.8)
  );

  const propertyEntries: Entry[] = propertySlugs.map((slug) =>
    makeEntry(`${BASE_URL}/property/${slug}`, propertySlugLastmod.get(slug) ?? null, "weekly", 0.8)
  );

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

  const groups: { name: string; file: string; entries: Entry[] }[] = [
    { name: "static", file: "sitemap-static.xml", entries: staticEntries },
    { name: "blog", file: "sitemap-blog.xml", entries: blogEntries },
    { name: "discover", file: "sitemap-discover.xml", entries: discoverEntries },
    { name: "property", file: "sitemap-property.xml", entries: propertyEntries },
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
  // filename itself doesn't change).
  const indexXml = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${groups
    .map((g) => {
      const lastmod = groupMaxLastmod(g.entries);
      return `<sitemap><loc>${BASE_URL}/${g.file}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</sitemap>`;
    })
    .join("\n")}\n</sitemapindex>`;

  // Flat, all-surfaces merge — unchanged format, same URL set, same
  // lastmod per URL as the split children. Kept for back-compat (see file
  // header). Both public/sitemap.xml and public/sitemap-main.xml are
  // gitignored (see .gitignore): they're regenerated build artifacts
  // (~2.1MB total), and committing them turned every deploy into a
  // ~47k-line diff for no benefit — they're fully reproducible from KV +
  // static data at build time. Do not remove either write path without
  // first checking robots.ts for which URL is currently advertised.
  const flatXml = renderUrlset(groups.flatMap((g) => g.entries));
  writeFileSync(join(publicDir, "sitemap.xml"), flatXml);
  writeFileSync(join(publicDir, "sitemap-main.xml"), indexXml);

  const perGroupCounts = groups.map((g) => `${g.name}=${g.entries.length}`).join(", ");
  console.log(
    `[sitemap] wrote sitemap-main.xml (index) + ${groups.length} child sitemaps + sitemap.xml (flat legacy): ` +
      `${totalUrls} URLs total (${perGroupCounts}) (${propertySlugs.length} unique properties from ${listings.length} listings)`
  );
}

main().catch((err) => {
  console.error("[sitemap] generation failed:", err);
  process.exit(1);
});
