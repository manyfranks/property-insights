"use client";

import { useState } from "react";
import Link from "next/link";
import type { CityMeta } from "@/lib/data/city-metadata";
import RequestCityPrompt from "./request-city-prompt";

interface ProvinceGroup {
  province: string;
  label: string;
  active: boolean;
}

interface ProvinceExplorerProps {
  cities: CityMeta[];
  provinces: ProvinceGroup[];
}

export default function ProvinceExplorer({ cities, provinces }: ProvinceExplorerProps) {
  // Only show cities that have cached listings
  const citiesWithListings = cities.filter((c) => c.listingCount > 0);

  // Separate active provinces (with listings) from inactive
  const activeProvinces = provinces.filter(
    (g) => g.active && citiesWithListings.some((c) => c.province === g.province)
  );
  const inactiveProvinces = provinces.filter(
    (g) => !g.active || !citiesWithListings.some((c) => c.province === g.province)
  );

  const [selected, setSelected] = useState(() =>
    activeProvinces.length > 0 ? activeProvinces[0].province : "BC"
  );

  const isInactive = inactiveProvinces.some((g) => g.province === selected);
  const filtered = citiesWithListings.filter((c) => c.province === selected);

  return (
    <div>
      {/* Province pills */}
      <div className="flex items-center justify-center gap-2 flex-wrap mb-8">
        {activeProvinces.map((g) => (
          <button
            key={g.province}
            onClick={() => setSelected(g.province)}
            className={`px-5 py-2 rounded-full text-sm font-medium transition-all ${
              selected === g.province
                ? "bg-foreground text-white"
                : "bg-white text-foreground border border-border hover:border-foreground/30"
            }`}
          >
            {g.label}
          </button>
        ))}
        {inactiveProvinces.map((g) => (
          <button
            key={g.province}
            onClick={() => setSelected(g.province)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
              selected === g.province
                ? "bg-border text-muted"
                : "text-muted/50 border border-transparent hover:text-muted"
            }`}
          >
            {g.label}
          </button>
        ))}
      </div>

      {/* Coming soon state for inactive provinces */}
      {isInactive ? (
        <div className="border border-dashed border-border rounded-xl py-12 px-6 text-center">
          <p className="text-sm text-muted">Coming soon</p>
        </div>
      ) : (
        /* City cards grid */
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-left">
          {filtered.map((city) => (
            <Link
              key={city.slug}
              href={`/dashboard?city=${encodeURIComponent(city.name)}`}
              className="group border border-border rounded-xl p-4 hover:shadow-md hover:-translate-y-0.5 transition-all bg-white"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-foreground text-sm group-hover:text-foreground/80">
                  {city.name}
                </span>
                <span className="text-muted group-hover:text-foreground transition-colors text-sm opacity-0 group-hover:opacity-100">
                  &rarr;
                </span>
              </div>
              <span className="text-xs text-muted mt-1 inline-block">
                {city.listingCount} listings
              </span>
            </Link>
          ))}
        </div>
      )}

      {/* Request a city prompt (signed-in users only) */}
      <RequestCityPrompt />
    </div>
  );
}
