import type { Metadata } from "next";
import { buildCityMetadata } from "@/lib/data/city-metadata";
import { getAllListings } from "@/lib/kv/listings";
import HomeCta from "@/components/home-cta";
import ProvinceExplorer from "@/components/province-explorer";
import HomeAddressSearch from "@/components/home-address-search";

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
            what typing an address yields, instead of explaining it in prose. */}
        <div className="mt-6 mx-auto max-w-sm border border-border rounded-xl bg-white p-4 text-left">
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="text-[10px] uppercase tracking-widest text-muted">Example analysis</span>
            <span className="text-[10px] text-muted/60">128 Oakwood Dr, Austin TX</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-2xl font-semibold text-foreground">$412,000</span>
            <span className="text-xs text-muted">recommended offer &middot; 4.3% below asking</span>
          </div>
        </div>

        <div className="hidden sm:block mt-10">
          <ProvinceExplorer cities={cities} provinces={provinces} />
        </div>
      </div>

      <div className="w-full max-w-2xl mt-14 sm:mt-24">
        <div className="flex flex-col sm:flex-row sm:justify-center gap-1.5 sm:gap-6 text-sm text-muted text-center">
          <span><span className="font-medium text-foreground">1</span> Search any address</span>
          <span><span className="font-medium text-foreground">2</span> We pull assessment, comps, and market data</span>
          <span><span className="font-medium text-foreground">3</span> Get a recommended offer range</span>
        </div>

        <div className="mt-10 text-center">
          <HomeCta cities={cities} />
        </div>

        <p className="text-xs text-muted mt-12 text-center">
          Search any address, or request an assessment for any property in Canada or the US.
        </p>
      </div>
    </main>
  );
}
