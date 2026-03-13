"use client";

import { useState, useMemo, useCallback } from "react";
import Link from "next/link";
import TierBadge from "./tier-badge";

/** Fire-and-forget search event to track city interest */
function trackSearch(city: string) {
  fetch("/api/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "search", data: { city } }),
  }).catch(() => {});
}

interface DashboardRow {
  address: string;
  slug: string;
  city: string;
  province: string;
  price: number;
  assessed: number | null;
  offer: number | null;
  savings: number | null;
  dom: number;
  tier: string;
  beds: string;
  baths: string;
  signals: string[];
  score: number;
}

type SortKey = "address" | "city" | "price" | "assessed" | "offer" | "savings" | "dom" | "tier";
type SortDir = "asc" | "desc";

const TIER_ORDER: Record<string, number> = { HOT: 0, WARM: 1, WATCH: 2 };
const PAGE_SIZE = 20;

function fmt(n: number): string {
  return "$" + n.toLocaleString();
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      className={`inline-block ml-1 -mt-px transition-colors ${active ? "text-foreground" : "text-transparent"}`}
    >
      <path
        d={dir === "asc" ? "M6 3L10 8H2L6 3Z" : "M6 9L2 4H10L6 9Z"}
        fill="currentColor"
      />
    </svg>
  );
}

export default function DashboardClient({ rows, stats, initialCity }: {
  rows: DashboardRow[];
  stats: { total: number; withOffers: number; inRange: number; avgSavings: number };
  initialCity?: string | null;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("savings");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(0);
  const [cityFilter, setCityFilter] = useState<string | null>(initialCity ?? null);

  const selectCity = useCallback((city: string | null) => {
    setCityFilter(city);
    setPage(0);
    if (city) trackSearch(city);
  }, []);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "address" || key === "city" ? "asc" : "desc");
    }
    setPage(0);
  }

  const filtered = useMemo(() => {
    if (!cityFilter) return rows;
    return rows.filter((r) => r.city === cityFilter);
  }, [rows, cityFilter]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "address": cmp = a.address.localeCompare(b.address); break;
        case "city": cmp = a.city.localeCompare(b.city); break;
        case "price": cmp = a.price - b.price; break;
        case "assessed": cmp = (a.assessed ?? -1) - (b.assessed ?? -1); break;
        case "offer": cmp = (a.offer ?? -1) - (b.offer ?? -1); break;
        case "savings": cmp = (a.savings ?? -1) - (b.savings ?? -1); break;
        case "dom": cmp = a.dom - b.dom; break;
        case "tier": cmp = (TIER_ORDER[a.tier] ?? 9) - (TIER_ORDER[b.tier] ?? 9); break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const cities = useMemo(() => {
    const unique = [...new Set(rows.map((r) => r.city))];
    return unique.sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const paged = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  type SortOption = { label: string; key: SortKey; dir: SortDir };
  const SORT_OPTIONS: SortOption[] = [
    { label: "Savings: high first", key: "savings", dir: "desc" },
    { label: "Price: low first", key: "price", dir: "asc" },
    { label: "Price: high first", key: "price", dir: "desc" },
    { label: "DOM: high first", key: "dom", dir: "desc" },
    { label: "Tier: hot first", key: "tier", dir: "asc" },
    { label: "Offer: low first", key: "offer", dir: "asc" },
  ];

  // City-specific stats (computed only when drill-down is active)
  const cityStats = useMemo(() => {
    if (!cityFilter) return null;
    const withSavings = filtered.filter((r) => r.savings && r.savings > 0);
    const avgSavings = withSavings.length > 0
      ? Math.round(withSavings.reduce((sum, r) => sum + (r.savings ?? 0), 0) / withSavings.length)
      : 0;
    const inRange = filtered.filter((r) => r.offer && r.savings && r.savings > 0).length;
    const avgDom = filtered.length > 0
      ? Math.round(filtered.reduce((sum, r) => sum + r.dom, 0) / filtered.length)
      : 0;
    return { listings: filtered.length, avgSavings, inRange, avgDom };
  }, [cityFilter, filtered]);

  // City drill-down view (discover-style cards)
  if (cityFilter && cityStats) {
    return (
      <div>
        <button
          onClick={() => selectCity(null)}
          className="text-sm text-muted hover:text-foreground transition-colors mb-6"
        >
          &larr; All listings
        </button>

        <h2 className="text-2xl font-semibold tracking-tight mb-1">{cityFilter}</h2>
        <p className="text-sm text-muted mb-6">
          {filtered.length} properties ranked by motivation score
        </p>

        {/* City-specific stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-6">
          {[
            { label: "Listings", value: cityStats.listings },
            { label: "Avg Savings", value: fmt(cityStats.avgSavings) },
            { label: "In Range", value: cityStats.inRange },
            { label: "Avg DOM", value: cityStats.avgDom },
          ].map((s) => (
            <div key={s.label} className="border border-border rounded-xl p-3 sm:p-4">
              <div className="text-xs text-muted mb-1">{s.label}</div>
              <div className="font-mono text-lg sm:text-xl font-semibold">{s.value}</div>
            </div>
          ))}
        </div>

        <div className="space-y-3">
          {filtered
            .sort((a, b) => b.score - a.score)
            .map((r, i) => (
              <Link
                key={`${r.slug}-${i}`}
                href={`/property/${r.slug}`}
                className="group flex flex-col sm:flex-row sm:items-center gap-3 border border-border rounded-xl p-4 hover:shadow-md hover:-translate-y-0.5 transition-all bg-white"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-foreground truncate">{r.address}</div>
                  <div className="text-xs text-muted mt-0.5">
                    {r.beds} bed &middot; {r.dom} DOM
                  </div>
                  {r.signals.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {r.signals.slice(0, 3).map((s) => (
                        <span key={s} className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded-full">
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-4 sm:gap-5 shrink-0">
                  <span className="font-mono text-sm font-medium">{fmt(r.price)}</span>
                  <span className="font-mono text-sm font-medium w-10 text-center">{r.score}</span>
                  <TierBadge tier={r.tier} />
                  <span className="text-muted group-hover:text-foreground transition-colors">&rarr;</span>
                </div>
              </Link>
            ))}
        </div>
      </div>
    );
  }

  // Table view
  const thClass = "px-4 py-3 font-medium text-muted cursor-pointer select-none hover:text-foreground transition-colors whitespace-nowrap";

  return (
    <div>
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        {[
          { label: "Properties", value: stats.total },
          { label: "With Offers", value: stats.withOffers },
          { label: "In Target Range", value: stats.inRange },
          { label: "Avg Savings", value: fmt(stats.avgSavings) },
        ].map((s) => (
          <div key={s.label} className="border border-border rounded-xl p-4">
            <div className="text-xs text-muted mb-1">{s.label}</div>
            <div className="font-mono text-xl font-semibold">{typeof s.value === "number" ? s.value : s.value}</div>
          </div>
        ))}
      </div>

      {/* Mobile filter/sort bar */}
      <div className="sm:hidden mb-4 space-y-3">
        {/* City pills */}
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-6 px-6 scrollbar-none">
          <button
            onClick={() => selectCity(null)}
            className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-medium transition-all ${
              !cityFilter
                ? "bg-foreground text-white"
                : "border border-border text-muted hover:text-foreground"
            }`}
          >
            All
          </button>
          {cities.map((city) => (
            <button
              key={city}
              onClick={() => selectCity(city)}
              className="shrink-0 px-3.5 py-1.5 rounded-full text-xs font-medium border border-border text-muted hover:text-foreground transition-all"
            >
              {city}
            </button>
          ))}
        </div>

        {/* Sort select */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted">{sorted.length} properties</span>
          <select
            value={`${sortKey}:${sortDir}`}
            onChange={(e) => {
              const [k, d] = e.target.value.split(":") as [SortKey, SortDir];
              setSortKey(k);
              setSortDir(d);
              setPage(0);
            }}
            className="text-xs border border-border rounded-lg px-2.5 py-1.5 bg-white text-foreground focus:outline-none focus:ring-2 focus:ring-foreground/10"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={`${opt.key}:${opt.dir}`} value={`${opt.key}:${opt.dir}`}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Mobile cards */}
      <div className="space-y-2 sm:hidden">
        {paged.map((r, i) => (
          <Link
            key={`m-${r.slug}-${i}`}
            href={`/property/${r.slug}`}
            className="block border border-border rounded-xl p-3 hover:shadow-md hover:-translate-y-0.5 transition-all bg-white"
          >
            <div className="flex items-start justify-between gap-2 mb-1.5">
              <div className="font-medium text-sm text-foreground leading-snug min-w-0 truncate">{r.address}</div>
              <TierBadge tier={r.tier} />
            </div>
            <div className="flex items-center gap-3 text-xs text-muted mb-2">
              <button
                onClick={(e) => { e.preventDefault(); selectCity(r.city); }}
                className="hover:text-foreground hover:underline transition-colors"
              >
                {r.city}
              </button>
              <span>{r.beds} bed</span>
              <span>{r.dom} DOM</span>
            </div>
            <div className="flex items-center gap-4 text-xs">
              <div>
                <span className="text-muted">List </span>
                <span className="font-mono font-medium text-foreground">{fmt(r.price)}</span>
              </div>
              {r.offer && (
                <div>
                  <span className="text-muted">Offer </span>
                  <span className="font-mono font-medium text-foreground">{fmt(r.offer)}</span>
                </div>
              )}
              {r.savings && r.savings > 0 && (
                <div className="font-mono text-green-600 ml-auto">{fmt(r.savings)} below</div>
              )}
            </div>
          </Link>
        ))}
      </div>

      {/* Desktop table */}
      <div className="border border-border rounded-xl overflow-hidden hidden sm:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-gray-50/50">
                <th className={`text-left ${thClass}`} onClick={() => toggleSort("address")}>
                  Address<SortIcon active={sortKey === "address"} dir={sortDir} />
                </th>
                <th className={`text-left ${thClass}`} onClick={() => toggleSort("city")}>
                  City<SortIcon active={sortKey === "city"} dir={sortDir} />
                </th>
                <th className={`text-right ${thClass}`} onClick={() => toggleSort("price")}>
                  List<SortIcon active={sortKey === "price"} dir={sortDir} />
                </th>
                <th className={`text-right ${thClass}`} onClick={() => toggleSort("assessed")}>
                  Assessed<SortIcon active={sortKey === "assessed"} dir={sortDir} />
                </th>
                <th className={`text-right ${thClass}`} onClick={() => toggleSort("offer")}>
                  Offer<SortIcon active={sortKey === "offer"} dir={sortDir} />
                </th>
                <th className={`text-right ${thClass}`} onClick={() => toggleSort("savings")}>
                  Savings<SortIcon active={sortKey === "savings"} dir={sortDir} />
                </th>
                <th className={`text-center ${thClass}`} onClick={() => toggleSort("dom")}>
                  DOM<SortIcon active={sortKey === "dom"} dir={sortDir} />
                </th>
                <th className={`text-center ${thClass}`} onClick={() => toggleSort("tier")}>
                  Tier<SortIcon active={sortKey === "tier"} dir={sortDir} />
                </th>
              </tr>
            </thead>
            <tbody>
              {paged.map((r, i) => (
                <tr key={`${r.slug}-${i}`} className="border-b border-border last:border-b-0 hover:bg-gray-50/50 transition-colors">
                  <td className="px-4 py-3">
                    <Link href={`/property/${r.slug}`} className="font-medium text-foreground hover:underline">
                      {r.address}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => selectCity(r.city)}
                      className="text-muted hover:text-foreground hover:underline transition-colors"
                    >
                      {r.city}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right font-mono">{fmt(r.price)}</td>
                  <td className="px-4 py-3 text-right font-mono">{r.assessed ? fmt(r.assessed) : "-"}</td>
                  <td className="px-4 py-3 text-right font-mono font-medium">{r.offer ? fmt(r.offer) : "-"}</td>
                  <td className="px-4 py-3 text-right font-mono text-green-600">{r.savings ? fmt(r.savings) : "-"}</td>
                  <td className="px-4 py-3 text-center font-mono">{r.dom}</td>
                  <td className="px-4 py-3 text-center"><TierBadge tier={r.tier} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-xs text-muted">
            {page * PAGE_SIZE + 1}&ndash;{Math.min((page + 1) * PAGE_SIZE, sorted.length)} of {sorted.length}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-gray-50 disabled:opacity-30 transition-all"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-gray-50 disabled:opacity-30 transition-all"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
