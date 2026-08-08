import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { BASE_URL, SITE_NAME } from "@/lib/seo";
import { BreadcrumbJsonLd, ItemListJsonLd } from "@/components/json-ld";
import { getAllStatesWithCounties, getCountiesByState } from "@/lib/us-counties";

export const revalidate = 86400; // 24h ISR

export async function generateStaticParams() {
  return getAllStatesWithCounties().map((s) => ({ state: s.stateSlug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ state: string }>;
}): Promise<Metadata> {
  const { state: stateSlug } = await params;
  const counties = getCountiesByState(stateSlug);
  if (counties.length === 0) return {};

  const { stateName } = counties[0];
  const title = `${stateName} Housing Market Data by County`;
  const description = `Home values, rents, price trends, and FEMA risk for ${counties.length.toLocaleString()} ${stateName} counties, sourced from Census ACS, FHFA, and FEMA.`;

  return {
    title,
    description,
    alternates: { canonical: `/us/${stateSlug}` },
    openGraph: {
      title,
      description,
      url: `${BASE_URL}/us/${stateSlug}`,
      siteName: SITE_NAME,
      type: "website",
      locale: "en_US",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function UsStatePage({
  params,
}: {
  params: Promise<{ state: string }>;
}) {
  const { state: stateSlug } = await params;
  const counties = getCountiesByState(stateSlug);

  if (counties.length === 0) notFound();

  const { stateName, state } = counties[0];

  return (
    <main className="max-w-5xl mx-auto px-6 py-10">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", url: BASE_URL },
          { name: "US Markets", url: `${BASE_URL}/us` },
          { name: stateName, url: `${BASE_URL}/us/${stateSlug}` },
        ]}
      />
      <ItemListJsonLd
        items={counties.slice(0, 100).map((c) => ({
          name: c.county,
          url: `${BASE_URL}/us/${stateSlug}/${c.countySlug}`,
        }))}
      />

      <Link
        href="/us"
        className="text-sm text-muted hover:text-foreground transition-colors mb-6 inline-block"
      >
        &larr; All states
      </Link>

      <h1 className="text-2xl font-semibold tracking-tight mb-1">
        {stateName} ({state}) Housing Market Data
      </h1>
      <p className="text-sm text-muted mb-8 max-w-2xl">
        {counties.length.toLocaleString()} {counties.length === 1 ? "county" : "counties"} with
        government-sourced home values, rents, and risk data. Select a county for
        the full market breakdown.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {counties.map((c) => (
          <Link
            key={c.fips}
            href={`/us/${stateSlug}/${c.countySlug}`}
            className="group border border-border rounded-xl p-4 bg-white hover:border-foreground/20 hover:shadow-sm transition-all"
          >
            <div className="font-medium text-foreground group-hover:underline text-sm">
              {c.county}
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
