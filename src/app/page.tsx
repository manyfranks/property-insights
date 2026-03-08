import type { Metadata } from "next";
import { buildCityMetadata } from "@/lib/data/city-metadata";
import { getAllListings } from "@/lib/kv/listings";
import HomeCta from "@/components/home-cta";
import ProvinceExplorer from "@/components/province-explorer";

export const revalidate = 300; // Re-fetch from KV every 5 min

export const metadata: Metadata = {
  title: "Property Insights — Canadian Real Estate Offer Intelligence",
  description:
    "Find out what to offer on any Canadian property. AI-powered analysis using government assessments, days on market, and seller motivation signals across BC, Alberta, and Ontario.",
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
          Smarter property acquisition starts here
        </h1>
        <p className="text-lg text-muted mb-8 sm:mb-14">
          Data-driven insights for residential real estate across Canada.
        </p>

        <ProvinceExplorer cities={cities} provinces={provinces} />

        <div className="mt-14">
          <HomeCta cities={cities} />
        </div>

        <p className="text-xs text-muted mt-12">
          Search any address from the navbar, or request an assessment for any Canadian property.
        </p>
      </div>
    </main>
  );
}
