"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getCityBySlug } from "@/lib/data/city-metadata";
import { PROVINCE_CITIES } from "@/lib/data/city-bounds";
import { slugify, fmt } from "@/lib/utils";
import TierBadge from "@/components/tier-badge";
import DiscoverEmptyState from "@/components/discover-empty-state";

interface DiscoverResult {
  listing: {
    address: string;
    city: string;
    province: string;
    price: number;
    beds: string;
    baths: string;
    dom: number;
  };
  score: { total: number; tier: string };
  signals: string[];
}

export default function DiscoverCityPage() {
  const params = useParams();
  const citySlug = params.city as string;
  const cityMeta = getCityBySlug(citySlug);

  const [results, setResults] = useState<DiscoverResult[]>([]);
  const [source, setSource] = useState<"live" | "cached" | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const cityName = cityMeta?.name || "";
  const province = cityMeta?.province || "BC";

  useEffect(() => {
    if (!cityName) {
      setLoading(false);
      setError("Unknown city");
      return;
    }

    const cities = PROVINCE_CITIES[province] || [];
    if (!cities.includes(cityName)) {
      setLoading(false);
      setError("City not available yet");
      return;
    }

    async function fetchListings() {
      try {
        const res = await fetch("/api/discover", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ city: cityName, province }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Discovery failed");
        setResults(data.results || []);
        setSource(data.source || "cached");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setLoading(false);
      }
    }

    fetchListings();
  }, [cityName, province]);

  return (
    <main className="max-w-5xl mx-auto px-6 py-10">
      <Link href="/" className="text-sm text-muted hover:text-foreground transition-colors">
        &larr; All cities
      </Link>

      <div className="mt-6 mb-8">
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {cityMeta?.name || citySlug}
          </h1>
          {source && (
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                source === "live"
                  ? "bg-green-100 text-green-700"
                  : "bg-blue-100 text-blue-700"
              }`}
            >
              {source === "live" ? "Live" : "Cached"}
            </span>
          )}
        </div>
        {cityMeta && (
          <p className="text-sm text-muted">{cityMeta.description}</p>
        )}
      </div>

      {/* Loading skeletons */}
      {loading && (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="border border-border rounded-xl p-4 animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-2/3 mb-2" />
              <div className="h-3 bg-gray-100 rounded w-1/3" />
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="border border-border rounded-xl p-8 text-center">
          <p className="text-sm text-muted">{error}</p>
          <Link href="/" className="text-sm text-foreground hover:underline mt-2 inline-block">
            Back to cities
          </Link>
        </div>
      )}

      {/* Empty state → signup funnel */}
      {!loading && !error && results.length === 0 && (
        <DiscoverEmptyState citySlug={citySlug} cityName={cityMeta?.name || citySlug} />
      )}

      {/* Results as cards */}
      {results.length > 0 && (
        <>
          <p className="text-sm text-muted mb-4">
            {results.length} properties ranked by motivation score
          </p>
          <div className="space-y-3">
            {results.map((r, i) => (
              <Link
                key={i}
                href={`/property/${slugify(r.listing.address)}`}
                className="group flex flex-col sm:flex-row sm:items-center gap-3 border border-border rounded-xl p-4 hover:shadow-md hover:-translate-y-0.5 transition-all bg-white"
              >
                {/* Left: address + meta */}
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-foreground truncate">
                    {r.listing.address}
                  </div>
                  <div className="text-xs text-muted mt-0.5">
                    {r.listing.city} &middot; {r.listing.beds} bed &middot; {r.listing.dom} DOM
                  </div>
                  {r.signals.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {r.signals.slice(0, 3).map((s) => (
                        <span
                          key={s}
                          className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded-full"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Right: price + score + tier + arrow */}
                <div className="flex items-center gap-4 sm:gap-5 shrink-0">
                  <span className="font-mono text-sm font-medium">
                    {fmt(r.listing.price)}
                  </span>
                  <span className="font-mono text-sm font-medium w-10 text-center">
                    {r.score.total}
                  </span>
                  <TierBadge tier={r.score.tier} />
                  <span className="text-muted group-hover:text-foreground transition-colors">
                    &rarr;
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
