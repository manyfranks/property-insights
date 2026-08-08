import type { Metadata } from "next";
import Link from "next/link";
import { BASE_URL, SITE_NAME } from "@/lib/seo";
import { BreadcrumbJsonLd } from "@/components/json-ld";
import { getAllStatesWithCounties, US_COUNTIES } from "@/lib/us-counties";

export const revalidate = 86400; // 24h ISR — regional_econ data updates infrequently (annual/quarterly sources)

const TITLE = "US Housing Market Data by County — Property Insights";
const DESCRIPTION = `Home values, rents, price trends, and FEMA flood/wildfire risk for ${US_COUNTIES.length.toLocaleString()} US counties, sourced from Census ACS, FHFA, and FEMA.`;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/us" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: `${BASE_URL}/us`,
    siteName: SITE_NAME,
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default function UsHubPage() {
  const states = getAllStatesWithCounties();

  return (
    <main className="max-w-5xl mx-auto px-6 py-10">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", url: BASE_URL },
          { name: "US Markets", url: `${BASE_URL}/us` },
        ]}
      />

      <h1 className="text-2xl font-semibold tracking-tight mb-1">
        US Housing Market Data
      </h1>
      <p className="text-sm text-muted mb-8 max-w-2xl">
        Government-sourced home values, rents, vacancy rates, price trends, and
        FEMA hazard risk for {US_COUNTIES.length.toLocaleString()} counties across
        all 50 states and DC. Pick a state to browse counties, or jump straight to
        a specific county&apos;s market page.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {states.map((s) => (
          <Link
            key={s.stateSlug}
            href={`/us/${s.stateSlug}`}
            className="group border border-border rounded-xl p-4 bg-white hover:border-foreground/20 hover:shadow-sm transition-all"
          >
            <div className="font-medium text-foreground group-hover:underline">
              {s.stateName}
            </div>
            <div className="text-xs text-muted mt-1">
              {s.countyCount.toLocaleString()} {s.countyCount === 1 ? "county" : "counties"}
            </div>
          </Link>
        ))}
      </div>

      <div className="border border-border rounded-xl p-6 mt-10 text-center">
        <p className="text-sm font-medium text-foreground mb-1">
          Looking for a specific property?
        </p>
        <p className="text-xs text-muted mb-4 max-w-md mx-auto">
          Type any US address into the search bar to get a modeled value estimate
          backed by the same county-level data.
        </p>
        <Link
          href="/"
          className="text-xs font-medium text-foreground underline underline-offset-2 hover:text-foreground/70 transition-colors"
        >
          Get an estimate &rarr;
        </Link>
      </div>
    </main>
  );
}
