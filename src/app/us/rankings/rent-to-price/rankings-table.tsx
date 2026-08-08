"use client";

/**
 * Sortable rent-to-price ranking table — local to /us/rankings/rent-to-price
 * (national page + [state] sub-page). Not shared with any other rankings
 * surface; keep it that way (see the investment rankings owner's separate
 * component under /us/rankings/investment/).
 *
 * Server pages pass in the already-ranked (by ratio desc) row list; the "#"
 * column always shows that original national rank, even when the user
 * re-sorts by another column — the rank is a property of the county, not of
 * the current view.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { fmt } from "@/lib/utils";

export interface RentToPriceRow {
  /** original rank in the full (ratio-desc) ranking this table was sliced from */
  rank: number;
  countyName: string;
  countySlug: string;
  stateSlug: string;
  /** USPS state code, e.g. "TX" */
  state: string;
  /** fmr2br / medianHomeValue, as a fraction (0.0083 = 0.83%) */
  monthlyRatio: number;
  passes: boolean;
  fmr2br: number;
  medianHomeValue: number;
  medianGrossRent: number | null;
}

type SortKey =
  | "rank"
  | "county"
  | "state"
  | "monthlyRatio"
  | "fmr2br"
  | "medianHomeValue"
  | "medianGrossRent";

function pctPrecise(n: number): string {
  return (n * 100).toFixed(2) + "%";
}

const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: "rank", label: "#", numeric: true },
  { key: "county", label: "County" },
  { key: "state", label: "State" },
  { key: "monthlyRatio", label: "Monthly Ratio", numeric: true },
  { key: "fmr2br", label: "2BR Rent", numeric: true },
  { key: "medianHomeValue", label: "Median Home Value", numeric: true },
  { key: "medianGrossRent", label: "Actual Rent (ACS)", numeric: true },
];

export default function RankingsTable({ rows }: { rows: RentToPriceRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "rank":
          cmp = a.rank - b.rank;
          break;
        case "county":
          cmp = a.countyName.localeCompare(b.countyName);
          break;
        case "state":
          cmp = a.state.localeCompare(b.state);
          break;
        case "monthlyRatio":
          cmp = a.monthlyRatio - b.monthlyRatio;
          break;
        case "fmr2br":
          cmp = a.fmr2br - b.fmr2br;
          break;
        case "medianHomeValue":
          cmp = a.medianHomeValue - b.medianHomeValue;
          break;
        case "medianGrossRent":
          cmp = (a.medianGrossRent ?? -1) - (b.medianGrossRent ?? -1);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // sensible default direction per column: numeric ranking metrics start
      // high-to-low (desc), rank/text columns start low-to-high (asc)
      setSortDir(key === "rank" || key === "county" || key === "state" ? "asc" : "desc");
    }
  }

  if (rows.length === 0) {
    return (
      <div className="border border-border rounded-xl bg-white p-8 text-center text-sm text-muted">
        No counties with both HUD rent and Census home-value data on record here yet.
      </div>
    );
  }

  return (
    <div className="border border-border rounded-xl bg-white overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead>
            <tr className="border-b border-border bg-background/60">
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className={`px-4 py-3 text-xs uppercase tracking-widest text-muted font-medium ${
                    col.numeric ? "text-right" : "text-left"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => handleSort(col.key)}
                    className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                  >
                    {col.label}
                    {sortKey === col.key && (
                      <span aria-hidden="true" className="text-[10px]">
                        {sortDir === "asc" ? "▲" : "▼"}
                      </span>
                    )}
                  </button>
                </th>
              ))}
              <th scope="col" className="px-4 py-3 text-xs uppercase tracking-widest text-muted font-medium text-center">
                1% Rule
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr
                key={r.stateSlug + r.countySlug}
                className={i < sorted.length - 1 ? "border-b border-border" : ""}
              >
                <td className="px-4 py-3 font-mono tabular-nums text-muted">{r.rank}</td>
                <td className="px-4 py-3">
                  <Link
                    href={`/us/${r.stateSlug}/${r.countySlug}/rent`}
                    className="text-foreground font-medium hover:underline underline-offset-2"
                  >
                    {r.countyName}
                  </Link>
                </td>
                <td className="px-4 py-3 text-muted">{r.state}</td>
                <td className="px-4 py-3 text-right font-mono tabular-nums font-medium">
                  {pctPrecise(r.monthlyRatio)}
                </td>
                <td className="px-4 py-3 text-right font-mono tabular-nums">{fmt(r.fmr2br)}</td>
                <td className="px-4 py-3 text-right font-mono tabular-nums">
                  {fmt(r.medianHomeValue)}
                </td>
                <td className="px-4 py-3 text-right font-mono tabular-nums text-muted">
                  {r.medianGrossRent != null ? fmt(r.medianGrossRent) : "—"}
                </td>
                <td className="px-4 py-3 text-center">
                  {r.passes ? (
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-cta-accent/10 text-cta-accent text-xs font-semibold">
                      &#10003;
                    </span>
                  ) : (
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-border/60 text-muted text-xs font-semibold">
                      &#10007;
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
