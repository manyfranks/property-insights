/**
 * zoocasa-neighbourhood.ts
 *
 * PROOF OF CONCEPT — no auth, no login, plain unauthenticated HTTP.
 *
 * Zoocasa's city search pages (e.g. GET /calgary-ab-real-estate?saleOrRent=sale&type=house)
 * degraded: `props.pageProps.props.listings` in the page's __NEXT_DATA__ is now a generic,
 * province-wide feed of ~27 rows that is byte-identical across every city in the province
 * (Alberta is dominated by Edmonton inventory, so a "Calgary" request returns Edmonton rows).
 * That array is GATED/BROKEN as a per-city listing source. Do not use it as data — ever.
 *
 * However, the SAME page still carries a working, current, correctly city-scoped listing
 * set in a different part of __NEXT_DATA__: `props.pageProps.props.internalLinks`, an array
 * of footer link blocks. The block whose title ends with "Latest Listings" (e.g. "Calgary
 * Latest Listings") holds ~10 real, current, correctly-scoped detail-page paths shaped
 * `/{city}-{prov}-real-estate/{neighbourhood-slug}/{listing-slug}`. Neighbourhood pages
 * (`/{city}-{prov}-real-estate/{neighbourhood-slug}`) carry the SAME kind of "Latest
 * Listings" block, scoped to that neighbourhood — fanning out across a handful of
 * neighbourhood pages yields far more than the 10 listed on the city page itself.
 *
 * This file depends on that page structure:
 *   - `<script id="__NEXT_DATA__" type="application/json">` containing the Next.js props.
 *   - `props.pageProps.props.internalLinks: { title: string; links: { label: string; link: string }[] }[]`
 *   - A block whose `title` ends with "Latest Listings" (case-insensitive) → for-sale detail links.
 *   - A block whose `title` ends with "Neighbourhoods" (case-insensitive) → neighbourhood page links.
 * If Zoocasa renames these blocks, changes the URL shape, or drops internalLinks entirely,
 * every assumption below breaks — and per house rule ("fail loud, never fake") this module
 * THROWS rather than silently returning an empty/degraded result. It never reads
 * `props.pageProps.props.listings` as data; the only permitted use of that field would be to
 * *detect* the gated state, and this file doesn't even do that today (throwing on a missing/
 * empty internalLinks block is a sufficient, simpler signal).
 */

import { fetchDetailByUrl } from "./zoocasa";
import type { Listing } from "./types";

// ---------------------------------------------------------------------------
// Fetch primitives (deliberately NOT imported from zoocasa.ts — those helpers
// are unexported; this is a small, self-contained copy of the same approach).
// ---------------------------------------------------------------------------

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

async function fetchPage(url: string, timeoutMs = 15000): Promise<string> {
  const res = await fetch(url, {
    headers: FETCH_HEADERS,
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`Zoocasa returned ${res.status} for ${url}`);
  }
  return res.text();
}

/** Extract and parse the __NEXT_DATA__ JSON blob embedded in a Zoocasa page. */
function extractNextDataProps(html: string, sourceUrl: string): Record<string, unknown> {
  const match = html.match(
    /<script\s+id="__NEXT_DATA__"\s+type="application\/json">([\s\S]*?)<\/script>/
  );
  if (!match) {
    throw new Error(
      `zoocasa-neighbourhood: could not find __NEXT_DATA__ script tag on ${sourceUrl} — page structure changed`
    );
  }
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(match[1]);
  } catch (err) {
    throw new Error(
      `zoocasa-neighbourhood: __NEXT_DATA__ on ${sourceUrl} was not valid JSON — ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
  const props = data.props as Record<string, unknown> | undefined;
  const pageProps = props?.pageProps as Record<string, unknown> | undefined;
  const innerProps = pageProps?.props as Record<string, unknown> | undefined;
  if (!innerProps) {
    throw new Error(
      `zoocasa-neighbourhood: __NEXT_DATA__ on ${sourceUrl} is missing props.pageProps.props — page structure changed`
    );
  }
  return innerProps;
}

// ---------------------------------------------------------------------------
// internalLinks shapes
// ---------------------------------------------------------------------------

interface InternalLink {
  label: string;
  link: string;
}

interface InternalLinkBlock {
  title: string;
  links: InternalLink[];
}

function isInternalLinkBlock(x: unknown): x is InternalLinkBlock {
  if (!x || typeof x !== "object") return false;
  const b = x as Record<string, unknown>;
  return typeof b.title === "string" && Array.isArray(b.links);
}

function getInternalLinks(innerProps: Record<string, unknown>, sourceUrl: string): InternalLinkBlock[] {
  const raw = innerProps.internalLinks;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(
      `zoocasa-neighbourhood: internalLinks missing/empty on ${sourceUrl} — page structure changed ` +
        `(cannot distinguish "no listings" from "page shape changed", so failing loud instead of returning [])`
    );
  }
  const blocks = raw.filter(isInternalLinkBlock);
  if (blocks.length === 0) {
    throw new Error(
      `zoocasa-neighbourhood: internalLinks on ${sourceUrl} did not match the expected ` +
        `{ title, links: [{label, link}] } block shape — page structure changed`
    );
  }
  return blocks;
}

/** A block whose title ends with the given suffix, case-insensitive (city name prefixes it). */
function findBlockBySuffix(blocks: InternalLinkBlock[], suffix: string): InternalLinkBlock | undefined {
  const s = suffix.toLowerCase();
  return blocks.find((b) => b.title.trim().toLowerCase().endsWith(s));
}

// A valid listing-detail path has 3+ segments: /{city-prov-real-estate}/{neighbourhood}/{listing-slug}[...].
// Neighbourhood-block links only have 2 segments (/{city-prov-real-estate}/{neighbourhood}) — this guards
// against ever mistaking a neighbourhood link for a listing detail link.
const DETAIL_PATH_RE = /^\/[a-z][a-z0-9-]*-[a-z]{2}-real-estate\/[^/]+\/[^/]+/i;

function isDetailPath(link: string): boolean {
  return DETAIL_PATH_RE.test(link);
}

/** Middle path segment of a listing-detail link, i.e. the neighbourhood slug. */
function neighbourhoodSlugFromDetailPath(link: string): string | null {
  const m = link.match(/^\/[a-z][a-z0-9-]*-[a-z]{2}-real-estate\/([^/]+)\/[^/]+/i);
  return m ? m[1] : null;
}

function citySlug(city: string): string {
  return city.toLowerCase().replace(/\s+/g, "-");
}

function provSlug(province: string): string {
  return province.toLowerCase();
}

// ---------------------------------------------------------------------------
// Bounded concurrency helper — small, polite worker pool.
// ---------------------------------------------------------------------------

async function mapBounded<T, R>(
  items: T[],
  concurrency: number,
  delayMs: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<{ results: R[]; errors: { item: T; error: unknown }[] }> {
  const results: R[] = [];
  const errors: { item: T; error: unknown }[] = [];
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++;
      const item = items[idx];
      try {
        const r = await fn(item, idx);
        results.push(r);
      } catch (error) {
        errors.push({ item, error });
      }
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return { results, errors };
}

// ---------------------------------------------------------------------------
// Public API: discoverListingUrls
// ---------------------------------------------------------------------------

export interface DiscoveredListing {
  url: string;
  label: string;
  neighbourhood: string;
}

// Multiplier applied to a caller-supplied `target` to decide how many distinct
// URLs to collect before we stop expanding neighbourhood pages. Downstream
// freshness/sqft filters winnow the raw discovery set, so we deliberately
// over-collect relative to `target` rather than cutting exactly at it. Picked
// at 2x so the real production target (25, see pipeline/ca-cities.ts) lands
// meaningfully below the flat maxUrls=60 safety ceiling (cap 50) — a factor
// of 3 (cap 75) would just saturate at 60 every time and defeat the point of
// passing `target` at all, while still leaving real headroom for filtering.
const TARGET_HEADROOM_FACTOR = 2;

export async function discoverListingUrls(
  city: string,
  province: string,
  opts?: {
    /** Hard ceiling on distinct URLs collected. Always the final safety cap,
     *  even when `target` would otherwise allow more. Default 60. */
    maxUrls?: number;
    concurrency?: number;
    /**
     * The city's configured ingestion target (see `CityConfig.target` in
     * pipeline/ca-cities.ts — a plain number here to avoid importing that
     * module and coupling to it). When set, discovery stops fetching further
     * neighbourhood pages once it has collected
     * `min(maxUrls, target * TARGET_HEADROOM_FACTOR)` distinct URLs, instead
     * of always chasing the flat `maxUrls` ceiling. This keeps a 25-target
     * city from crawling every neighbourhood page it doesn't need to, which
     * matters once 10 cities have to run inside one cron budget.
     */
    target?: number;
    /**
     * Absolute epoch-ms deadline for the neighbourhood-page FAN-OUT phase
     * only. The initial city-page fetch below (the one and only fetch that
     * must throw on structural failure — see file header) always runs
     * regardless of this deadline; only the "expand into neighbourhood
     * pages for more URLs" loop is time-boxed. If the deadline is reached
     * mid-expansion we stop fetching further neighbourhood pages and return
     * whatever was collected so far — a soft, logged, PARTIAL result, never
     * a thrown error, because "found less than we wanted" and "found
     * nothing because the source is broken" are different failure modes
     * and only the second one should be loud. (If the city page itself
     * yields zero usable links, that still throws below regardless of the
     * deadline — that is a structural failure, not a budget one.) A caller
     * processing many cities under one shared wall-clock budget (e.g. the
     * daily cron's 300s function limit) can pass the same absolute
     * `deadlineMs` to every city and have later cities automatically get
     * less expansion time as the budget is consumed, instead of one slow
     * city starving the rest of a fixed per-call timeout.
     */
    deadlineMs?: number;
  }
): Promise<DiscoveredListing[]> {
  const maxUrls = opts?.maxUrls ?? 60;
  const concurrency = Math.min(opts?.concurrency ?? 5, 6);
  // Effective stop point for the fan-out loop: target-scaled when a target is
  // given, otherwise the flat maxUrls ceiling (unchanged legacy behaviour).
  const effectiveCap = opts?.target
    ? Math.min(maxUrls, Math.max(1, Math.round(opts.target * TARGET_HEADROOM_FACTOR)))
    : maxUrls;

  const cityUrl = `https://www.zoocasa.com/${citySlug(city)}-${provSlug(province)}-real-estate?saleOrRent=sale&type=house`;

  // This fetch is deliberately NOT gated by deadlineMs — it is the one call
  // whose failure must always throw loud (see file header + the throws
  // below), so a caller can never end up with a silently empty result just
  // because the deadline had already elapsed before we even tried.
  const cityHtml = await fetchPage(cityUrl);
  const cityProps = extractNextDataProps(cityHtml, cityUrl);
  const cityBlocks = getInternalLinks(cityProps, cityUrl);

  const latestBlock = findBlockBySuffix(cityBlocks, "latest listings");
  if (!latestBlock) {
    const titles = cityBlocks.map((b) => b.title).join(", ");
    throw new Error(
      `zoocasa-neighbourhood: no "…Latest Listings" block found on ${cityUrl} — ` +
        `found blocks: [${titles}] — page structure changed`
    );
  }

  // Collect: found[url] -> { label, neighbourhood }
  const found = new Map<string, { label: string; neighbourhood: string }>();

  function collectFromBlock(block: InternalLinkBlock, fallbackNeighbourhood?: string) {
    for (const l of block.links) {
      if (!l?.link || !isDetailPath(l.link)) continue;
      const url = `https://www.zoocasa.com${l.link}`;
      const neighbourhood =
        neighbourhoodSlugFromDetailPath(l.link) ?? fallbackNeighbourhood ?? "unknown";
      if (!found.has(url)) {
        found.set(url, { label: l.label, neighbourhood });
      }
    }
  }

  collectFromBlock(latestBlock);

  // Neighbourhood pages to expand: primarily the "…Neighbourhoods" block links,
  // with neighbourhood slugs derived from the latest-listings detail paths as a fallback
  // (covers the case where the Neighbourhoods block is missing/renamed but listings still
  // reveal which neighbourhoods exist).
  const neighbourhoodPageUrls = new Set<string>();

  const neighbourhoodsBlock = findBlockBySuffix(cityBlocks, "neighbourhoods");
  if (neighbourhoodsBlock) {
    for (const l of neighbourhoodsBlock.links) {
      if (l?.link) {
        neighbourhoodPageUrls.add(`https://www.zoocasa.com${l.link}`);
      }
    }
  }

  for (const { neighbourhood } of found.values()) {
    if (neighbourhood !== "unknown") {
      neighbourhoodPageUrls.add(
        `https://www.zoocasa.com/${citySlug(city)}-${provSlug(province)}-real-estate/${neighbourhood}`
      );
    }
  }

  const neighbourhoodPages = Array.from(neighbourhoodPageUrls);

  // Tracks whether we stopped expansion because the time budget ran out
  // (as opposed to having simply hit effectiveCap/maxUrls) — used purely to
  // pick the right log message afterwards; it never turns into a throw.
  let stoppedForBudget = false;

  const { errors: nbhdErrors } = await mapBounded(
    neighbourhoodPages,
    concurrency,
    150,
    async (nbhdUrl) => {
      // Once we've already collected enough URLs, skip fetching further neighbourhood pages
      // (workers still in flight will finish their current page, but no new fetches start).
      if (found.size >= effectiveCap) return;
      // Soft time budget: stop starting new neighbourhood-page fetches once
      // the deadline has passed. Deliberately NOT an error/throw — see the
      // deadlineMs doc comment on discoverListingUrls for why this must stay
      // a logged partial result rather than a failure.
      if (opts?.deadlineMs !== undefined && Date.now() >= opts.deadlineMs) {
        stoppedForBudget = true;
        return;
      }
      const html = await fetchPage(nbhdUrl);
      const props = extractNextDataProps(html, nbhdUrl);
      const blocks = getInternalLinks(props, nbhdUrl);
      const nbhdLatest = findBlockBySuffix(blocks, "latest listings");
      if (!nbhdLatest) {
        // Not fatal at the neighbourhood-page level — the city-level Latest Listings block
        // already succeeded, so treat this as a soft miss (recorded via mapBounded's errors)
        // rather than aborting the whole discovery run over one page's shape drift.
        throw new Error(`no "…Latest Listings" block on neighbourhood page ${nbhdUrl}`);
      }
      const fallbackSlug = nbhdUrl.split("/").filter(Boolean).pop();
      collectFromBlock(nbhdLatest, fallbackSlug);
    }
  );

  if (found.size === 0) {
    throw new Error(
      `zoocasa-neighbourhood: found zero listing-detail URLs for ${city}, ${province} after ` +
        `checking the city page and ${neighbourhoodPages.length} neighbourhood page(s) — page structure changed`
    );
  }

  if (neighbourhoodPages.length > 0 && nbhdErrors.length === neighbourhoodPages.length) {
    // Every neighbourhood page failed to parse — likely a real structure change, not noise.
    // We still have the city page's own Latest Listings links, so don't throw, but this is
    // worth surfacing loudly to the caller via console so a POC run doesn't silently under-count.
    console.warn(
      `zoocasa-neighbourhood: WARNING — all ${neighbourhoodPages.length} neighbourhood page(s) for ` +
        `${city}, ${province} failed to yield a Latest Listings block; relying on city-page links only.`
    );
  }

  if (stoppedForBudget) {
    // Partial-by-design, not a failure: log it plainly so a cron run's logs make
    // clear WHY a city came back under its target, without throwing (found.size
    // is non-zero here — the zero case above already would have thrown).
    console.warn(
      `zoocasa-neighbourhood: time budget (deadlineMs) reached while expanding neighbourhood pages ` +
        `for ${city}, ${province}; returning ${found.size} URL(s) collected so far instead of continuing ` +
        `to fan out. This is an accepted partial result, not a structural failure.`
    );
  }

  return Array.from(found.entries())
    .slice(0, effectiveCap)
    .map(([url, v]) => ({ url, label: v.label, neighbourhood: v.neighbourhood }));
}

// ---------------------------------------------------------------------------
// Public API: fetchNeighbourhoodListings
// ---------------------------------------------------------------------------

export async function fetchNeighbourhoodListings(
  city: string,
  province: string,
  opts?: {
    limit?: number;
    concurrency?: number;
    /** Forwarded to discoverListingUrls — see its doc comment. */
    target?: number;
    /**
     * Forwarded to discoverListingUrls' fan-out phase, AND independently
     * applied to this function's own detail-page fetch loop below (fetching
     * each discovered listing's detail page is real per-listing network
     * cost too — for a ~25-target city, bounding only discovery and letting
     * detail fetches run unbounded would still blow a shared cron budget).
     * Same semantics as discoverListingUrls: reaching the deadline mid-loop
     * stops further detail fetches and returns what was already fetched as
     * a logged partial result, never a silent/thrown empty result UNLESS
     * literally nothing was fetched (see the zero-check below, unchanged).
     */
    deadlineMs?: number;
  }
): Promise<Listing[]> {
  const concurrency = Math.min(opts?.concurrency ?? 5, 6);

  const discovered = await discoverListingUrls(city, province, {
    concurrency,
    target: opts?.target,
    deadlineMs: opts?.deadlineMs,
  });
  const toFetch = opts?.limit ? discovered.slice(0, opts.limit) : discovered;

  let detailBudgetHit = false;

  const { results, errors } = await mapBounded(
    toFetch,
    concurrency,
    150,
    async (d): Promise<Listing | null> => {
      // Soft time budget for the detail-fetch phase — see the deadlineMs doc
      // comment above. A skip here returns null (filtered out below) rather
      // than throwing, so it is never miscounted as a per-listing fetch
      // failure in the warning below.
      if (opts?.deadlineMs !== undefined && Date.now() >= opts.deadlineMs) {
        detailBudgetHit = true;
        return null;
      }
      // fetchDetailByUrl() fetches the literal URL as-is (the neighbourhood-scoped, 3-segment
      // path), so it correctly loads the real listing page. Its internal parseZoocasaUrl() only
      // uses city/province as a fallback when the page's own listing JSON omits them, and its
      // "slug" field (which would mis-parse to the neighbourhood segment for a 3-segment path)
      // is not used by fetchDetailByUrl at all — so this is safe despite the mismatch.
      const { listing } = await fetchDetailByUrl(d.url);
      return listing;
    }
  );

  const fetched = results.filter((r): r is Listing => r !== null);
  const skippedForBudget = results.length - fetched.length;

  if (errors.length > 0) {
    console.warn(
      `zoocasa-neighbourhood: ${errors.length}/${toFetch.length} detail fetches failed for ${city}, ${province}:`
    );
    for (const { item, error } of errors) {
      console.warn(`  - ${item.url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (detailBudgetHit) {
    console.warn(
      `zoocasa-neighbourhood: time budget (deadlineMs) reached during detail-page fetches for ` +
        `${city}, ${province}; skipped ${skippedForBudget}/${toFetch.length} remaining fetch(es) and ` +
        `returning ${fetched.length} listing(s) collected so far. Accepted partial result, not a failure.`
    );
  }

  if (fetched.length === 0) {
    throw new Error(
      `zoocasa-neighbourhood: fetched zero listings for ${city}, ${province} — ` +
        `${errors.length} detail-page fetch(es) failed` +
        (skippedForBudget > 0 ? ` and ${skippedForBudget} were skipped for time budget` : "") +
        ` (out of ${toFetch.length} discovered URL(s))`
    );
  }

  const seen = new Set<string>();
  const deduped: Listing[] = [];
  for (const listing of fetched) {
    const key = `${listing.address}|${listing.city}|${listing.province}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(listing);
  }

  return deduped;
}
