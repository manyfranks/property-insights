import Link from "next/link";
import { CITY_METADATA, PROVINCE_GROUPS } from "@/lib/data/city-metadata";
import HomeCta from "@/components/home-cta";

export default function Home() {
  const activeProvinces = PROVINCE_GROUPS.filter((g) => g.active);

  return (
    <main className="flex flex-col items-center min-h-[calc(100vh-3.5rem)] px-6">
      <div className="w-full max-w-2xl text-center mt-[12vh]">
        <h1 className="text-3xl font-semibold tracking-tight mb-3 text-foreground">
          Find your next opportunity
        </h1>
        <p className="text-base text-muted mb-10">
          Data-driven acquisition intelligence for residential real estate.
        </p>

        {/* Province groups with city cards */}
        {activeProvinces.map((g) => {
          const cities = CITY_METADATA.filter((c) => c.province === g.province);
          if (cities.length === 0) return null;
          return (
            <div key={g.province} className="mb-8">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted mb-3">
                {g.label}
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-left">
                {cities.map((city) => (
                  <Link
                    key={city.slug}
                    href={`/discover/${city.slug}`}
                    className="group border border-border rounded-xl p-4 hover:shadow-md hover:-translate-y-0.5 transition-all bg-white"
                  >
                    <div className="font-medium text-foreground text-sm mb-1 group-hover:text-foreground/80">
                      {city.name}
                    </div>
                    <div className="text-xs text-muted mb-2 leading-snug">
                      {city.description}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted">
                        {city.listingCount > 0
                          ? `${city.listingCount} cached`
                          : "Live only"}
                      </span>
                      <span className="text-muted group-hover:text-foreground transition-colors text-sm">
                        &rarr;
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          );
        })}

        {/* Subscription CTA */}
        <div className="mt-10">
          <HomeCta />
        </div>

        <p className="text-xs text-muted mt-10">
          Search any preloaded address from the navbar above.
        </p>
      </div>
    </main>
  );
}
