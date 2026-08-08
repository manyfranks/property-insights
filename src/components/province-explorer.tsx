"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { CityMeta } from "@/lib/data/city-metadata";
import { POPULAR_US_STATES, POPULAR_MARKETS, getUsStateByRegionCode } from "@/lib/data/city-metadata";
import { getCountiesByState, isTopMetroCounty } from "@/lib/us-counties";
import { useVisitorGeo } from "@/lib/geo/visitor-geo";
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

/** What the panel below the pill row is currently showing. */
type Selection =
  | { kind: "CA"; province: string }
  | { kind: "US"; stateSlug: string; stateName: string };

/** Which pill row is on display: the geo-aware curated row, or a manual full browse of one country. */
type BrowseMode = "curated" | "CA" | "US";

const CARD_CLASS =
  "group border border-border rounded-xl p-4 hover:shadow-md hover:-translate-y-0.5 transition-all bg-white";

const ACTIVE_PILL = "bg-foreground text-white";
const INACTIVE_PILL = "bg-white text-foreground border border-border hover:border-foreground/30";

function pillClass(active: boolean) {
  return `px-5 py-2 rounded-full text-sm font-medium transition-all ${active ? ACTIVE_PILL : INACTIVE_PILL}`;
}

export default function ProvinceExplorer({ cities, provinces }: ProvinceExplorerProps) {
  // Only show cities that have cached listings
  const citiesWithListings = useMemo(() => cities.filter((c) => c.listingCount > 0), [cities]);

  const activeProvinces = useMemo(
    () =>
      provinces.filter(
        (g) => g.active && citiesWithListings.some((c) => c.province === g.province)
      ),
    [provinces, citiesWithListings]
  );
  const activeProvinceCodes = useMemo(
    () => new Set(activeProvinces.map((g) => g.province)),
    [activeProvinces]
  );
  const comingSoonProvinces = useMemo(
    () => provinces.filter((g) => !activeProvinceCodes.has(g.province)),
    [provinces, activeProvinceCodes]
  );

  const { geo, loading: geoLoading, isOverride, setRegionOverride } = useVisitorGeo();

  // The geo-derived "leading" curated market, if the visitor's region maps to
  // real data (an active CA province, or any US state — every state has
  // county data). Null while unresolved or unplaceable (e.g. QC/SK visitor).
  const leadingMarket = useMemo(() => {
    if (geo.country === "CA" && geo.region && activeProvinceCodes.has(geo.region)) {
      // Prefer whichever curated pill for this province has more listings,
      // so we lead with an existing pill rather than a near-duplicate one.
      const candidates = POPULAR_MARKETS.filter(
        (m) => m.kind === "province" && m.target === geo.region
      );
      if (candidates.length === 0) return null;
      return candidates
        .map((m) => ({
          m,
          count: citiesWithListings.find((c) => c.name === m.city)?.listingCount ?? 0,
        }))
        .sort((a, b) => b.count - a.count)[0].m;
    }
    if (geo.country === "US" && geo.region) {
      const state = getUsStateByRegionCode(geo.region);
      if (!state) return null;
      const existing = POPULAR_MARKETS.find((m) => m.kind === "state" && m.target === state.slug);
      if (existing) return existing;
      return { country: "US" as const, label: state.name, kind: "state" as const, target: state.slug };
    }
    return null;
  }, [geo, activeProvinceCodes, citiesWithListings]);

  const orderedMarkets = useMemo(() => {
    if (!leadingMarket) return POPULAR_MARKETS;
    const rest = POPULAR_MARKETS.filter(
      (m) => !(m.kind === leadingMarket.kind && m.target === leadingMarket.target)
    );
    return [leadingMarket, ...rest];
  }, [leadingMarket]);

  const geoDefaultSelection = useMemo<Selection>(() => {
    if (leadingMarket) {
      return leadingMarket.kind === "province"
        ? { kind: "CA", province: leadingMarket.target }
        : { kind: "US", stateSlug: leadingMarket.target, stateName: leadingMarket.label };
    }
    const first = POPULAR_MARKETS[0];
    return { kind: "CA", province: first.target };
  }, [leadingMarket]);

  // Multiple curated pills can share a province (Victoria & Vancouver are
  // both BC), so pill highlighting tracks the specific pill clicked, not
  // just the resulting province/state selection.
  const marketKey = (m: { kind: string; target: string; label: string }) => `${m.kind}-${m.target}-${m.label}`;
  const geoDefaultMarketKey = leadingMarket ? marketKey(leadingMarket) : marketKey(POPULAR_MARKETS[0]);

  const [selection, setSelection] = useState<Selection>(geoDefaultSelection);
  const [selectedMarketKey, setSelectedMarketKey] = useState(geoDefaultMarketKey);
  const [mode, setMode] = useState<BrowseMode>("curated");
  const [touched, setTouched] = useState(false); // true once the visitor has clicked something

  // Once geo resolves (cache hit or /api/geo response), adopt it as the
  // default selection — but only if the visitor hasn't already interacted,
  // so we never yank the panel out from under a manual click.
  useEffect(() => {
    if (touched || geoLoading) return;
    setSelection(geoDefaultSelection);
    setSelectedMarketKey(geoDefaultMarketKey);
  }, [touched, geoLoading, geoDefaultSelection, geoDefaultMarketKey]);

  // A persisted manual country choice (from the Canada | US toggle on a
  // previous visit) starts the visitor straight in that country's full
  // browse view, rather than the curated row.
  useEffect(() => {
    if (touched || geoLoading) return;
    if (isOverride && (geo.country === "CA" || geo.country === "US")) {
      setMode(geo.country);
    }
  }, [touched, geoLoading, isOverride, geo.country]);

  function selectMarket(market: (typeof POPULAR_MARKETS)[number]) {
    setTouched(true);
    setSelectedMarketKey(marketKey(market));
    setSelection(
      market.kind === "province"
        ? { kind: "CA", province: market.target }
        : { kind: "US", stateSlug: market.target, stateName: market.label }
    );
  }

  function selectProvince(province: string) {
    setTouched(true);
    setSelection({ kind: "CA", province });
  }

  function selectUsState(stateSlug: string, stateName: string) {
    setTouched(true);
    setSelection({ kind: "US", stateSlug, stateName });
  }

  function toggleCountry(country: "CA" | "US") {
    setTouched(true);
    setMode(country);
    setRegionOverride({ country, region: null });
    if (country === "CA" && selection.kind !== "CA") {
      const fallback = activeProvinces[0]?.province ?? "BC";
      setSelection({ kind: "CA", province: fallback });
    } else if (country === "US" && selection.kind !== "US") {
      const fallback = POPULAR_US_STATES[0];
      setSelection({ kind: "US", stateSlug: fallback.slug, stateName: fallback.name });
    }
  }

  function showPopular() {
    setTouched(true);
    setMode("curated");
    setRegionOverride(null);
  }

  const caCities =
    selection.kind === "CA" ? citiesWithListings.filter((c) => c.province === selection.province) : [];

  const usCounties = selection.kind === "US" ? getCountiesByState(selection.stateSlug) : [];
  const usCountiesOrdered = useMemo(() => {
    if (selection.kind !== "US") return [];
    return [...usCounties].sort((a, b) => {
      const aTop = isTopMetroCounty(a.fips) ? 0 : 1;
      const bTop = isTopMetroCounty(b.fips) ? 0 : 1;
      if (aTop !== bTop) return aTop - bTop;
      return a.county.localeCompare(b.county);
    });
  }, [usCounties, selection]);

  return (
    <div>
      {/* Manual country toggle — small, secondary control for exploring beyond the curated row */}
      <div className="flex items-center justify-center gap-1 mb-4 text-xs">
        <button
          onClick={showPopular}
          className={`px-3 py-1 rounded-full transition-colors ${
            mode === "curated" ? "text-foreground font-medium" : "text-muted hover:text-foreground"
          }`}
        >
          Popular
        </button>
        <span className="text-border">|</span>
        <button
          onClick={() => toggleCountry("CA")}
          className={`px-3 py-1 rounded-full transition-colors ${
            mode === "CA" ? "text-foreground font-medium" : "text-muted hover:text-foreground"
          }`}
        >
          🇨🇦 Canada
        </button>
        <span className="text-border">|</span>
        <button
          onClick={() => toggleCountry("US")}
          className={`px-3 py-1 rounded-full transition-colors ${
            mode === "US" ? "text-foreground font-medium" : "text-muted hover:text-foreground"
          }`}
        >
          🇺🇸 US
        </button>
      </div>

      {/* Pill row */}
      <div className="flex items-center justify-center gap-2 flex-wrap mb-3">
        {mode === "curated" &&
          orderedMarkets.map((m, i) => {
            const active = selectedMarketKey === marketKey(m);
            const isLeading = leadingMarket !== null && i === 0;
            return (
              <button key={marketKey(m)} onClick={() => selectMarket(m)} className={pillClass(active)}>
                <span className="mr-1.5" aria-hidden="true">
                  {m.country === "CA" ? "🇨🇦" : "🇺🇸"}
                </span>
                {m.label}
                {isLeading && <span className="ml-1.5 text-xs opacity-70">· near you</span>}
              </button>
            );
          })}

        {mode === "CA" &&
          activeProvinces.map((g) => (
            <button
              key={g.province}
              onClick={() => selectProvince(g.province)}
              className={pillClass(selection.kind === "CA" && selection.province === g.province)}
            >
              {g.label}
            </button>
          ))}

        {mode === "US" &&
          POPULAR_US_STATES.map((s) => (
            <button
              key={s.slug}
              onClick={() => selectUsState(s.slug, s.name)}
              className={pillClass(selection.kind === "US" && selection.stateSlug === s.slug)}
            >
              {s.name}
            </button>
          ))}
      </div>

      {mode === "CA" && comingSoonProvinces.length > 0 && (
        <p className="text-xs text-muted text-center mb-5">
          More provinces soon: {comingSoonProvinces.map((g) => g.label).join(" · ")}
        </p>
      )}
      {mode !== "CA" && <div className="mb-5" />}

      {/* Panel */}
      {selection.kind === "CA" ? (
        caCities.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-left">
            {caCities.map((city) => (
              <Link key={city.slug} href={`/discover/${city.slug}`} className={CARD_CLASS}>
                <div className="flex items-center justify-between">
                  <span className="font-medium text-foreground text-sm group-hover:text-foreground/80">
                    {city.name}
                  </span>
                  <span className="text-muted group-hover:text-foreground transition-colors text-sm opacity-0 group-hover:opacity-100">
                    &rarr;
                  </span>
                </div>
                <span className="text-xs text-muted mt-1 inline-block">{city.listingCount} listings</span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="border border-dashed border-border rounded-xl py-12 px-6 text-center">
            <p className="text-sm text-muted">Coming soon</p>
          </div>
        )
      ) : (
        <div className="border border-border rounded-xl p-6 text-center">
          <p className="text-sm text-muted mb-5">
            County-level market data for {selection.stateName}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-left mb-6">
            {usCountiesOrdered.slice(0, 6).map((c) => (
              <Link key={c.fips} href={`/us/${c.stateSlug}/${c.countySlug}`} className={CARD_CLASS}>
                <div className="flex items-center justify-between">
                  <span className="font-medium text-foreground text-sm group-hover:text-foreground/80">
                    {c.county}
                  </span>
                  <span className="text-muted group-hover:text-foreground transition-colors text-sm opacity-0 group-hover:opacity-100">
                    &rarr;
                  </span>
                </div>
              </Link>
            ))}
          </div>
          <div className="flex items-center justify-center gap-4">
            <Link
              href={`/us/${selection.stateSlug}`}
              className="text-sm font-medium text-foreground underline underline-offset-2 hover:text-foreground/70 transition-colors"
            >
              All {selection.stateName} counties &rarr;
            </Link>
            <Link
              href="/us"
              className="text-sm font-medium text-foreground underline underline-offset-2 hover:text-foreground/70 transition-colors"
            >
              Browse all US states &rarr;
            </Link>
          </div>
        </div>
      )}

      {/* Request a city prompt (signed-in users only) */}
      <RequestCityPrompt />
    </div>
  );
}
