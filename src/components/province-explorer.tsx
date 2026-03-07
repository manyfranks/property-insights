"use client";

import { useState } from "react";
import Link from "next/link";
import type { CityMeta } from "@/lib/data/city-metadata";

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
  const [selected, setSelected] = useState("BC");

  const filtered = cities.filter((c) => c.province === selected);

  return (
    <div>
      {/* Province pills */}
      <div className="flex items-center justify-center gap-2 mb-8">
        {provinces.map((g) => (
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
      </div>

      {/* City cards grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-left">
        {filtered.map((city) => (
          <Link
            key={city.slug}
            href={`/discover/${city.slug}`}
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
              {city.listingCount > 0
                ? `${city.listingCount} listings`
                : "Live only"}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
