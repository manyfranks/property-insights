import type { Metadata } from "next";
import { headers } from "next/headers";
import { buildCityMetadata } from "@/lib/data/city-metadata";
import { getAllListings } from "@/lib/kv/listings";
import Link from "next/link";
import HomeCta from "@/components/home-cta";
import ProvinceExplorer from "@/components/province-explorer";
import HomeAddressSearch from "@/components/home-address-search";
import ExampleAnalysisCard from "@/components/example-analysis-card";

export const revalidate = 300; // Re-fetch from KV every 5 min

export const metadata: Metadata = {
  title: "Property Insights — Real Estate Offer Intelligence",
  description:
    "Find out what to offer on any property in Canada or the US. AI-powered analysis using government assessments, days on market, and seller motivation signals across BC, Alberta, Ontario, and US counties.",
  alternates: { canonical: "/" },
};

export default async function Home() {
  const listings = await getAllListings();
  const { cities, provinces } = buildCityMetadata(listings);

  // Vercel's edge geo headers — same ones src/app/api/geo/route.ts reads.
  // Null everywhere locally / off Vercel; ExampleAnalysisCard falls back to
  // its tier-based pool in that case. Reading headers() here is itself what
  // opts this route out of static rendering/ISR (revalidate above is
  // therefore a no-op for "/") — this is this route's own dynamic API call,
  // not something inherited from the root layout. (Previously this comment
  // attributed the dynamism to ClerkProvider reading auth state in
  // src/app/layout.tsx; that was stale — the actual culprit there was
  // `<Show>` rendered as a Server Component, fixed by moving it into
  // src/components/auth-nav.tsx as a "use client" boundary. See cache
  // investigation, 2026-08-19.)
  const hdrs = await headers();
  const rawCity = hdrs.get("x-vercel-ip-city");
  const geo = {
    country: hdrs.get("x-vercel-ip-country"),
    region: hdrs.get("x-vercel-ip-country-region"),
    city: rawCity ? decodeURIComponent(rawCity) : null,
  };

  return (
    <main className="relative flex flex-col items-center min-h-[calc(100vh-3.5rem)] px-6">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.03)_0%,transparent_70%)]" />
      <div className="w-full max-w-2xl text-center mt-[8vh] sm:mt-[14vh]">
        <h1 className="text-3xl sm:text-6xl font-semibold tracking-tight text-balance mb-3 text-foreground">
          Know what to offer before you bid.
        </h1>
        <p className="text-base sm:text-lg text-muted mb-8 sm:mb-14">
          Free, data-backed property analysis for the US and Canada.
        </p>

        {/* Address bar is the primary action on every viewport. The city-pill
            explorer stays below it on sm+ as a secondary browse option. */}
        <HomeAddressSearch />

        {/* Example output — the visual anchor under the input: shows exactly
            what typing an address yields, instead of explaining it in prose.
            Pulled from the real listings cache and rotated daily — see
            ExampleAnalysisCard for selection/rotation logic. */}
        <ExampleAnalysisCard listings={listings} geo={geo} />

        <div className="hidden sm:block mt-10">
          <ProvinceExplorer cities={cities} provinces={provinces} />
        </div>
      </div>

      <div className="w-full max-w-2xl mt-14 sm:mt-24">
        <ol className="flex flex-col sm:flex-row sm:items-center sm:justify-center gap-2.5 sm:gap-3 text-sm text-muted">
          <li className="flex items-center justify-center gap-2.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-white font-mono text-[11px] text-foreground">
              1
            </span>
            Search any address
          </li>
          <li aria-hidden className="hidden sm:block text-muted/40">&rarr;</li>
          <li className="flex items-center justify-center gap-2.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-white font-mono text-[11px] text-foreground">
              2
            </span>
            We pull assessments, comps, and market data
          </li>
          <li aria-hidden className="hidden sm:block text-muted/40">&rarr;</li>
          <li className="flex items-center justify-center gap-2.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-white font-mono text-[11px] text-foreground">
              3
            </span>
            Get a recommended offer range
          </li>
        </ol>

        <div className="mt-10 text-center">
          <HomeCta cities={cities} />
        </div>

        <p className="text-xs text-muted mt-12 text-center">
          Search any address, or request an assessment for any property in Canada or the US.
          Already own or buying? See how{" "}
          <Link href="/insurance" className="text-foreground hover:underline">
            property insurance matching
          </Link>{" "}
          works.
        </p>
      </div>
    </main>
  );
}
