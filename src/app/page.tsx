import { CITY_METADATA, PROVINCE_GROUPS } from "@/lib/data/city-metadata";
import HomeCta from "@/components/home-cta";
import ProvinceExplorer from "@/components/province-explorer";

export default function Home() {
  const activeProvinces = PROVINCE_GROUPS.filter((g) => g.active);

  return (
    <main className="flex flex-col items-center min-h-[calc(100vh-3.5rem)] px-6">
      <div className="w-full max-w-2xl text-center mt-[14vh]">
        <h1 className="text-3xl font-semibold tracking-tight mb-3 text-foreground">
          Smarter property acquisition starts here
        </h1>
        <p className="text-base text-muted mb-12">
          Data-driven insights for residential real estate across Canada.
        </p>

        <ProvinceExplorer cities={CITY_METADATA} provinces={activeProvinces} />

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
