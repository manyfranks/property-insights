import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { readAllListings, requireAllListings } from "@/lib/kv/listings";
import { buildCityMetadata, getCityBySlug } from "@/lib/data/city-metadata";
import { analyzeListing } from "@/lib/analyze";
import { isUSState } from "@/lib/assessment/us";
import { slugify, fmt } from "@/lib/utils";
import { BASE_URL, SITE_NAME } from "@/lib/seo";
import { getRelatedPosts, BLOG_POSTS } from "@/lib/blog";
import { computeMarketSnapshot } from "@/lib/discover/market-snapshot";
import { BreadcrumbJsonLd, ItemListJsonLd } from "@/components/json-ld";
import TierBadge from "@/components/tier-badge";
import PartnerCta from "@/components/partner-cta";
import type { AnalysisResult, Listing } from "@/lib/types";

/** The two guides always cross-linked from the "Guides for this market"
 * block below — excluded from the generic "Related reading" list further
 * down the page so the same post never appears twice. */
const CITY_GUIDE_SLUGS = [
  "property-assessment-vs-market-value-canada",
  "how-much-below-asking-price-to-offer-canada",
];

/**
 * Analyze a city's listings, applying each listing's precomputed
 * score/tier override where present. US Discover listings carry a preScore
 * augmented with county-median-value + price/sqft-outlier structural
 * signals that scoreV2 alone has no inputs for — prefer that over
 * analyzeListing()'s plain scoreV2 recompute. No-op for CA listings (their
 * preScore always matches a fresh scoreV2 call on the same listing).
 * Shared by generateMetadata and the page body so both surfaces derive the
 * exact same market snapshot numbers from one code path.
 */
function analyzeCityListings(cityListings: Listing[]): AnalysisResult[] {
  return cityListings.map((l) => {
    const a = analyzeListing(l);
    if (l.preScore != null && l.preTier) {
      return { ...a, score: { ...a.score, total: l.preScore, tier: l.preTier } };
    }
    return a;
  });
}

export const revalidate = 600; // 10 min ISR

export async function generateStaticParams() {
  // Build time. requireAllListings throws on an unreadable store, which
  // fails the build — deliberately. Returning [] here would look harmless
  // (params are dynamic, so pages still render on demand) but it silently
  // ships a deploy that prerendered none of the city pages, and it is the
  // same read the prebuild sitemap generator depends on. If KV cannot be
  // read at build time, the honest outcome is a failed deploy, not a quietly
  // thinner one.
  const listings = await requireAllListings({ context: "discover/[city] generateStaticParams" });
  const { cities } = buildCityMetadata(listings);
  return cities.map((c) => ({ city: c.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ city: string }>;
}): Promise<Metadata> {
  const { city: slug } = await params;
  const store = await readAllListings();
  if (store.status === "unavailable") {
    // The page component below decides this request's status code and
    // throws (500) on the same read. Emitting a "not found"-flavoured title
    // here would be a claim the store never supported — stay neutral.
    console.error(`[discover] metadata for /discover/${slug} degraded: ${store.reason}`);
    return {};
  }
  const listings = store.status === "ok" ? store.listings : [];
  const { cities } = buildCityMetadata(listings);
  const meta = getCityBySlug(slug, cities);

  if (!meta) return {};

  const cityListings = listings.filter((l) => l.city === meta.name);
  const snapshot = computeMarketSnapshot(meta.name, analyzeCityListings(cityListings));

  const title = `${meta.name} Real Estate Deals — ${meta.listingCount} Assessed Listings & Offer Intelligence`;

  let description = `Browse ${meta.listingCount} analyzed properties in ${meta.name}, ${meta.province}. See government assessment values, seller motivation scores, and AI-recommended offer prices.`;
  if (snapshot.medianDom != null) {
    const gapPart =
      snapshot.assessedCount > 0 && snapshot.aboveAssessedCount != null
        ? ` ${snapshot.aboveAssessedCount} of ${snapshot.assessedCount} tracked listings with an assessment on file are priced above assessed value.`
        : "";
    description = `${meta.listingCount} analyzed ${meta.name}, ${meta.province} listings with a median ${snapshot.medianDom}-day time on market.${gapPart} Government assessment values, seller motivation scores, and AI-recommended offer prices.`;
  }

  return {
    title,
    description,
    alternates: { canonical: `/discover/${slug}` },
    openGraph: {
      title,
      description,
      url: `${BASE_URL}/discover/${slug}`,
      siteName: SITE_NAME,
      type: "website",
      locale: "en_CA",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function DiscoverCityPage({
  params,
}: {
  params: Promise<{ city: string }>;
}) {
  const { city: slug } = await params;

  // Degraded-mode choice for this surface: THROW (500), never render and
  // never 404.
  //
  // The city list this page validates `slug` against is derived from the
  // listing array, so on an unreadable store buildCityMetadata([]) yields
  // zero cities, getCityBySlug returns undefined, and the `!meta` branch
  // below called notFound() — a 404 on every /discover/* URL for the whole
  // outage. A 404 is the one answer that asks a crawler to DELETE the URL,
  // and these are indexed pages; a 500 asks it to come back. Same reasoning
  // as /property/[slug]'s unavailable branch, which this now matches.
  //
  // requireAllListings throws ListingsStoreUnavailableError, which Next
  // renders as a 500. `absent` (verifiably empty store) still falls through
  // to notFound(), because then the city genuinely does not exist here.
  const listings = await requireAllListings({ context: `GET /discover/${slug}` });
  const { cities } = buildCityMetadata(listings);
  const meta = getCityBySlug(slug, cities);

  if (!meta) notFound();

  const cityListings = listings.filter((l) => l.city === meta.name);
  const analyses = analyzeCityListings(cityListings);

  // Market snapshot — computed entirely from this city's live analyses.
  // See src/lib/discover/market-snapshot.ts for the omission rules (a stat
  // is dropped, not zeroed/placeholder'd, when its inputs don't exist for
  // this market).
  const snapshot = computeMarketSnapshot(meta.name, analyses);

  // Sort by score descending
  analyses.sort((a, b) => b.score.total - a.score.total);

  return (
    <main className="max-w-5xl mx-auto px-6 py-10">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", url: BASE_URL },
          { name: "Discover", url: `${BASE_URL}/dashboard` },
          { name: meta.name, url: `${BASE_URL}/discover/${slug}` },
        ]}
      />
      <ItemListJsonLd
        items={analyses.map((a) => ({
          name: a.listing.address,
          url: `${BASE_URL}/property/${slugify(a.listing.address)}`,
        }))}
      />

      <Link
        href="/dashboard"
        className="text-sm text-muted hover:text-foreground transition-colors mb-6 inline-block"
      >
        &larr; All cities
      </Link>

      <h1 className="text-2xl font-semibold tracking-tight mb-1">
        {meta.name} Real Estate Deals
      </h1>
      <p className="text-sm text-muted mb-6">{meta.description}.</p>

      {/* Market snapshot — every number below is computed server-side from
          this city's own live listing/assessment/offer data (see
          src/lib/discover/market-snapshot.ts). No stat is invented; a stat
          whose inputs don't exist for this market (e.g. no assessment
          coverage) is omitted rather than shown as 0 or "—". */}
      <div className="border border-border rounded-xl p-5 bg-white mb-6">
        <div className="text-xs uppercase tracking-widest text-muted mb-3">
          {meta.name} Market Snapshot
        </div>
        <p className="text-sm text-foreground leading-relaxed mb-4">{snapshot.intro}</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
          {snapshot.stats.map((s) => (
            <div key={s.key} className="border border-border rounded-xl p-3 sm:p-4">
              <div className="text-xs text-muted mb-1">{s.label}</div>
              <div className="font-mono text-lg sm:text-xl font-semibold">{s.value}</div>
            </div>
          ))}
        </div>
        {snapshot.assessmentCoverageLimited && (
          <p className="text-xs text-muted/70 mt-4">
            Assessment coverage limited in this market — no listings currently
            have a matched government assessment record, so above/below-
            assessed comparisons aren&apos;t shown.
          </p>
        )}
      </div>

      {/* Guides for this market — always links the two core methodology
          guides, tied to this city's own numbers above, so every supported
          city gets this cross-link with zero per-city content authored. */}
      <div className="grid sm:grid-cols-2 gap-3 mb-10">
        {(() => {
          const assessmentGuide = BLOG_POSTS.find(
            (p) => p.slug === CITY_GUIDE_SLUGS[0]
          );
          const offerGuide = BLOG_POSTS.find((p) => p.slug === CITY_GUIDE_SLUGS[1]);
          return (
            <>
              {assessmentGuide && (
                <Link
                  href={`/blog/${assessmentGuide.slug}`}
                  className="block border border-border rounded-xl p-4 hover:shadow-md hover:-translate-y-0.5 transition-all bg-white"
                >
                  <div className="text-sm font-medium text-foreground mb-1">
                    {snapshot.assessmentCoverageLimited
                      ? `How assessed value works, for when ${meta.name} coverage fills in`
                      : `${meta.name}: assessment vs. market value, explained`}
                  </div>
                  <p className="text-xs text-muted leading-relaxed">
                    {snapshot.assessmentCoverageLimited
                      ? `${meta.name} doesn't have matched assessment records yet on this page — read how the assessment-to-market gap works so you can apply it once it does.`
                      : `${snapshot.aboveAssessedCount} of the ${snapshot.assessedCount} ${meta.name} listings with an assessment on file are priced above it — here's what that gap means for your offer.`}
                  </p>
                </Link>
              )}
              {offerGuide && (
                <Link
                  href={`/blog/${offerGuide.slug}`}
                  className="block border border-border rounded-xl p-4 hover:shadow-md hover:-translate-y-0.5 transition-all bg-white"
                >
                  <div className="text-sm font-medium text-foreground mb-1">
                    How much below asking to offer in {meta.name}
                  </div>
                  <p className="text-xs text-muted leading-relaxed">
                    {snapshot.medianDom != null
                      ? `With a median ${snapshot.medianDom}-day time on market across ${snapshot.listingCount} tracked ${meta.name} listings, see the data-driven framework for setting your offer.`
                      : `See the data-driven framework for setting your offer, using days-on-market and seller-signal data like the listings tracked here in ${meta.name}.`}
                  </p>
                </Link>
              )}
            </>
          );
        })()}
      </div>

      {/* Listings */}
      <div className="space-y-3">
        {analyses.map((a, i) => {
          const l = a.listing;
          const slug = slugify(l.address);
          // US listings have no persisted /property/[slug] page yet (no
          // per-property cache — see us-discover.ts's doc comment: only a
          // score comes out of the city-wide RentCast call, not a full
          // assessment bundle). Route them into the on-demand /assess flow
          // instead, using the same combined "address, city, state" string
          // convention the site's search bar already sends (see
          // navbar-search.tsx). CA listings keep the existing property page.
          const isUS = isUSState(l.province);
          const href = isUS
            ? `/assess?address=${encodeURIComponent(`${l.address}, ${l.city}, ${l.province}`)}`
            : `/property/${slug}`;
          return (
            <Link
              key={`${slug}-${i}`}
              href={href}
              className="group flex flex-col sm:flex-row sm:items-center gap-3 border border-border rounded-xl p-4 hover:shadow-md hover:-translate-y-0.5 transition-all bg-white"
            >
              <div className="flex-1 min-w-0">
                <div className="font-medium text-foreground truncate">{l.address}</div>
                <div className="text-xs text-muted mt-0.5">
                  {l.beds} bed &middot; {l.baths} bath &middot; {l.dom} DOM
                </div>
                {a.signals.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {a.signals.slice(0, 3).map((s) => (
                      <span key={s} className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded-full">
                        {s}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-4 sm:gap-5 shrink-0">
                <span className="font-mono text-sm font-medium">{fmt(l.price)}</span>
                {a.offer && (
                  <span className="font-mono text-sm text-green-600">{fmt(a.offer.savings)}</span>
                )}
                <span className="font-mono text-sm font-medium w-10 text-center">{a.score.total}</span>
                <TierBadge tier={a.score.tier} />
                <span className="text-muted group-hover:text-foreground transition-colors">&rarr;</span>
              </div>
            </Link>
          );
        })}
      </div>

      {/* Act on what you find */}
      <div className="mt-10">
        <PartnerCta
          country={isUSState(meta.province) ? "US" : "CA"}
          state={meta.province}
          source="discover"
          surface="discover"
          heading="Act on what you find"
          city={meta.name}
        />
      </div>

      {/* Related reading */}
      {(() => {
        const posts = getRelatedPosts(meta.province).filter(
          (p) => !CITY_GUIDE_SLUGS.includes(p.slug)
        );
        if (posts.length === 0) return null;
        return (
          <div className="mt-10">
            <div className="text-xs font-medium text-muted uppercase tracking-wide mb-3">
              Related reading
            </div>
            <div className="space-y-2">
              {posts.map((p) => (
                <Link
                  key={p.slug}
                  href={`/blog/${p.slug}`}
                  className="block text-sm text-foreground hover:underline underline-offset-2 transition-colors"
                >
                  {p.title}
                  <span className="text-xs text-muted ml-2">{p.readingTime}</span>
                </Link>
              ))}
            </div>
          </div>
        );
      })()}

      {/* CTA */}
      <div className="border border-border rounded-xl p-6 mt-10 text-center">
        <p className="text-sm font-medium text-foreground mb-1">
          Don&apos;t see your {meta.name} property?
        </p>
        <p className="text-xs text-muted mb-4 max-w-md mx-auto">
          Paste a Zoocasa listing URL or type any {meta.name} address into the
          search bar above. We&apos;ll run a full assessment and email you the report.
        </p>
        <Link
          href="/how-it-works"
          className="text-xs font-medium text-foreground underline underline-offset-2 hover:text-foreground/70 transition-colors"
        >
          Learn how it works
        </Link>
      </div>
    </main>
  );
}
