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
        <h1 className="text-3xl sm:text-6xl font-semibold tracking-tight mb-3 text-foreground">
          Know what to offer before you bid.
        </h1>
        <p className="text-lg text-muted mb-8 sm:mb-14">
          Free property analysis backed by government assessment and market data across the US and Canada.
        </p>

        {/* Address bar is the primary action on every viewport. The city-pill
            explorer stays below it on sm+ as a secondary browse option. */}
        <HomeAddressSearch />
        <div className="hidden sm:block mt-10">
          <ProvinceExplorer cities={cities} provinces={provinces} />
        </div>
      </div>

      <div className="w-full max-w-2xl mt-16 sm:mt-24">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-left">
          {[
            {
              step: "1",
              title: "Search any address",
              body: "US or Canada, on or off market.",
            },
            {
              step: "2",
              title: "We pull the data",
              body: "Assessment records, comps, rents, and market signals.",
            },
            {
              step: "3",
              title: "Get your number",
              body: "A recommended offer range you can act on.",
            },
          ].map((item) => (
            <div key={item.step} className="border border-border rounded-xl p-5 bg-white">
              <span className="text-xs font-medium text-muted">{item.step}</span>
              <h3 className="text-sm font-semibold text-foreground mt-1 mb-1">{item.title}</h3>
              <p className="text-xs text-muted">{item.body}</p>
            </div>
          ))}
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
