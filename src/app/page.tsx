import { CITY_METADATA, PROVINCE_GROUPS } from "@/lib/data/city-metadata";
import HomeCta from "@/components/home-cta";
import ProvinceExplorer from "@/components/province-explorer";

export default function Home() {
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

        <ProvinceExplorer cities={CITY_METADATA} provinces={PROVINCE_GROUPS} />

        <div className="mt-14">
          <HomeCta />
        </div>

        <p className="text-xs text-muted mt-12">
          Search any preloaded address from the navbar above.
        </p>
      </div>
    </main>
  );
}
