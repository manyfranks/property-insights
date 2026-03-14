import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getAllListings } from "@/lib/kv/listings";
import { buildCityMetadata, getCityBySlug } from "@/lib/data/city-metadata";
import { analyzeListing } from "@/lib/analyze";
import { slugify, fmt } from "@/lib/utils";
import { BASE_URL, SITE_NAME } from "@/lib/seo";
import { getRelatedPosts } from "@/lib/blog";
import { BreadcrumbJsonLd } from "@/components/json-ld";
import TierBadge from "@/components/tier-badge";

export const revalidate = 600; // 10 min ISR

export async function generateStaticParams() {
  const listings = await getAllListings();
  const { cities } = buildCityMetadata(listings);
  return cities.map((c) => ({ city: c.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ city: string }>;
}): Promise<Metadata> {
  const { city: slug } = await params;
  const listings = await getAllListings();
  const { cities } = buildCityMetadata(listings);
  const meta = getCityBySlug(slug, cities);

  if (!meta) return {};

  const title = `${meta.name} Real Estate — Assessed Listings & Offer Intelligence`;
  const description = `Browse ${meta.listingCount} analyzed properties in ${meta.name}, ${meta.province}. See government assessment values, seller motivation scores, and AI-recommended offer prices.`;

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
  const listings = await getAllListings();
  const { cities } = buildCityMetadata(listings);
  const meta = getCityBySlug(slug, cities);

  if (!meta) notFound();

  const cityListings = listings.filter((l) => l.city === meta.name);
  const analyses = cityListings.map((l) => analyzeListing(l));

  // City stats
  const withSavings = analyses.filter((a) => a.offer && (a.offer.savings ?? 0) > 0);
  const avgSavings = withSavings.length > 0
    ? Math.round(withSavings.reduce((sum, a) => sum + (a.offer?.savings ?? 0), 0) / withSavings.length)
    : 0;
  const inRange = withSavings.length;
  const avgDom = analyses.length > 0
    ? Math.round(analyses.reduce((sum, a) => sum + a.listing.dom, 0) / analyses.length)
    : 0;
  const aboveAssessed = analyses.filter(
    (a) => a.assessment?.totalValue && a.listing.price > a.assessment.totalValue
  ).length;

  // Sort by score descending
  analyses.sort((a, b) => b.score.total - a.score.total);

  const stats = [
    { label: "Listings", value: String(analyses.length) },
    { label: "Avg Savings", value: fmt(avgSavings) },
    { label: "In Range", value: String(inRange) },
    { label: "Avg DOM", value: String(avgDom) },
  ];

  return (
    <main className="max-w-5xl mx-auto px-6 py-10">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", url: BASE_URL },
          { name: "Discover", url: `${BASE_URL}/dashboard` },
          { name: meta.name, url: `${BASE_URL}/discover/${slug}` },
        ]}
      />

      <Link
        href="/dashboard"
        className="text-sm text-muted hover:text-foreground transition-colors mb-6 inline-block"
      >
        &larr; All cities
      </Link>

      <h1 className="text-2xl font-semibold tracking-tight mb-1">
        {meta.name} Real Estate
      </h1>
      <p className="text-sm text-muted mb-6">
        {meta.description}. {analyses.length} properties analyzed with offer
        modeling and motivation scoring.
        {aboveAssessed > 0 && (
          <> {aboveAssessed} currently listed above assessed value.</>
        )}
      </p>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-8">
        {stats.map((s) => (
          <div key={s.label} className="border border-border rounded-xl p-3 sm:p-4">
            <div className="text-xs text-muted mb-1">{s.label}</div>
            <div className="font-mono text-lg sm:text-xl font-semibold">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Listings */}
      <div className="space-y-3">
        {analyses.map((a, i) => {
          const l = a.listing;
          const slug = slugify(l.address);
          return (
            <Link
              key={`${slug}-${i}`}
              href={`/property/${slug}`}
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

      {/* Related reading */}
      {(() => {
        const posts = getRelatedPosts(meta.province);
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
