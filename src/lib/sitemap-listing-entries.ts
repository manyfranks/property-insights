/**
 * Shared entry-building logic for the two KV-derived sitemap children —
 * /property/{slug} and /discover/{city} — consumed by BOTH dynamic routes:
 *   - src/app/sitemap-property.xml/route.ts
 *   - src/app/sitemap-discover.xml/route.ts
 *
 * Pulled out into one module specifically so those two routes cannot drift
 * apart on slug dedup or lastmod sourcing. Both are thin wrappers: read
 * listings via requireAllListings, hand the result to the builder here,
 * write the string out as the response body. See each route's file header
 * for the full degraded-mode (503) and URL-stability rationale — this file
 * only owns the XML shape and the lastmod policy.
 *
 * lastmod policy (mirrors scripts/generate-sitemap.ts's "lastmod policy"
 * section — read that file's header for the full history): a real
 * per-record `listing.enrichedAt`, or omitted entirely. NEVER the request's
 * own wall-clock time — that is the exact build-stamp bug
 * scripts/test-sitemap-lastmod.ts exists to catch, just at request time
 * instead of build time. A listing with no enrichedAt contributes nothing
 * rather than a guessed value.
 *   - /property/{slug}: that listing's own enrichedAt. Two listings rarely
 *     share one address slug (dedup pairs) — MAX(enrichedAt) across them.
 *   - /discover/{city}: MAX(enrichedAt) across every listing in that city —
 *     the page is a live aggregation over exactly those listings, so this
 *     is a real, if derived, signal, not a fabricated one.
 *
 * Slugging: property slugs use slugify(address) (src/lib/utils.ts) and are
 * deduped with a Set, exactly like scripts/generate-sitemap.ts's
 * propertySlugs. City slugs use cityToSlug(city) — the same helper
 * /property/[slug] itself links through (src/app/property/[slug]/page.tsx)
 * and byte-identical to the inline `city.toLowerCase().replace(/\s+/g,
 * "-")` scripts/generate-sitemap.ts used before this split — deduped the
 * same way.
 */
import type { Listing } from "./types";
import { slugify, cityToSlug } from "./utils";
import { BASE_URL } from "./seo";

interface Entry {
  loc: string;
  lastmod: string | null;
  xml: string;
}

function makeEntry(url: string, lastmod: string | null, changefreq: string, priority: number): Entry {
  return {
    loc: url,
    lastmod,
    xml: `<url><loc>${url}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}<changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`,
  };
}

function renderUrlset(entries: Entry[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries
    .map((e) => e.xml)
    .join("\n")}\n</urlset>`;
}

/** MAX(enrichedAt) per property slug, ISO 8601. Listings with no enrichedAt are skipped. */
function propertyLastmodBySlug(listings: Listing[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const l of listings) {
    if (!l.enrichedAt) continue;
    const iso = new Date(l.enrichedAt).toISOString();
    const slug = slugify(l.address);
    const cur = map.get(slug);
    if (!cur || iso > cur) map.set(slug, iso);
  }
  return map;
}

/** MAX(enrichedAt) per city slug, ISO 8601. Listings with no enrichedAt are skipped. */
function cityLastmodBySlug(listings: Listing[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const l of listings) {
    if (!l.enrichedAt) continue;
    const iso = new Date(l.enrichedAt).toISOString();
    const city = cityToSlug(l.city);
    const cur = map.get(city);
    if (!cur || iso > cur) map.set(city, iso);
  }
  return map;
}

/** Distinct property slugs, same dedup as generate-sitemap.ts's propertySlugs. */
export function distinctPropertySlugs(listings: Listing[]): string[] {
  return [...new Set(listings.map((l) => slugify(l.address)))];
}

/** Distinct city slugs, same dedup as generate-sitemap.ts's citySlugs. */
export function distinctCitySlugs(listings: Listing[]): string[] {
  return [...new Set(listings.map((l) => cityToSlug(l.city)))];
}

/**
 * <urlset> for /property/{slug} — one <url> per distinct address slug,
 * changefreq/priority matching generate-sitemap.ts's propertyEntries
 * (weekly, 0.8).
 */
export function buildPropertyUrlset(listings: Listing[]): string {
  const lastmodBySlug = propertyLastmodBySlug(listings);
  const entries = distinctPropertySlugs(listings).map((slug) =>
    makeEntry(`${BASE_URL}/property/${slug}`, lastmodBySlug.get(slug) ?? null, "weekly", 0.8)
  );
  return renderUrlset(entries);
}

/**
 * <urlset> for /discover/{city} — one <url> per distinct city slug,
 * changefreq/priority matching generate-sitemap.ts's discoverEntries
 * (daily, 0.8).
 */
export function buildDiscoverUrlset(listings: Listing[]): string {
  const lastmodByCity = cityLastmodBySlug(listings);
  const entries = distinctCitySlugs(listings).map((city) =>
    makeEntry(`${BASE_URL}/discover/${city}`, lastmodByCity.get(city) ?? null, "daily", 0.8)
  );
  return renderUrlset(entries);
}
