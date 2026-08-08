"use client";

/**
 * Sortable investment-score ranking table — local to
 * /us/rankings/investment (national page + [state] sub-page). Not shared
 * with any other rankings surface; a near-identical sibling table lives at
 * /us/rankings/rent-to-price/rankings-table.tsx (a different owner's
 * component, different columns/sort keys) — keep this one local too rather
 * than merging them, per the investment rankings' own file boundary.
 *
 * Server pages pass in the already-ranked (by score desc) row list; the "#"
 * column always shows that original rank, even when the user re-sorts by
 * another column — the rank is a property of the county in the full
 * ranking, not of the current view.
 */

import { useMemo, useState } from "react";
import Link from "next/link";

export interface InvestmentScoreRow {
  /** original rank in the full (score-desc) ranking this table was sliced from */
  rank: number;
  countyName: string;
  countySlug: string;
  stateSlug: string;
  /** USPS state code, e.g. "TX" */
  state: string;
  score: number;
  grossYield: number;
  appreciation5yr: number;
  riskScore: number;
  vacancyRate: number | null;
}

type SortKey =
  | "rank"
  | "county"
  | "state"
  | "score"
  | "grossYield"
  | "appreciation5yr"
  | "riskScore"
  | "vacancyRate";

function pct2(n: number): string {
  return (n * 100).toFixed(2) + "%";
}

function pct1(n: number): string {
  return (n * 100).toFixed(1) + "%";
}

const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: "rank", label: "#", numeric: true },
  { key: "county", label: "County" },
  { key: "state", label: "State" },
  { key: "score", label: "Score", numeric: true },
  { key: "grossYield", label: "Gross Yield", numeric: true },
  { key: "appreciation5yr", label: "5-Yr Appreciation", numeric: true },
  { key: "riskScore", label: "Risk", numeric: true },
  { key: "vacancyRate", label: "Vacancy", numeric: true },
];

export default function RankingsTable({ rows }: { rows: InvestmentScoreRow[] }) {
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
        case "score":
          cmp = a.score - b.score;
          break;
        case "grossYield":
          cmp = a.grossYield - b.grossYield;
          break;
        case "appreciation5yr":
          cmp = a.appreciation5yr - b.appreciation5yr;
          break;
        case "riskScore":
          cmp = a.riskScore - b.riskScore;
          break;
        case "vacancyRate":
          cmp = (a.vacancyRate ?? -1) - (b.vacancyRate ?? -1);
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
      // high-to-low (desc) except risk/vacancy where lower is better (asc);
      // rank/text columns start low-to-high (asc)
      const lowIsBetter = key === "rank" || key === "county" || key === "state" || key === "riskScore" || key === "vacancyRate";
      setSortDir(lowIsBetter ? "asc" : "desc");
    }
  }

  if (rows.length === 0) {
    return (
      <div className="border border-border rounded-xl bg-white p-8 text-center text-sm text-muted">
        No counties with enough data on record to compute a score here yet.
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
                    href={`/us/${r.stateSlug}/${r.countySlug}`}
                    className="text-foreground font-medium hover:underline underline-offset-2"
                  >
                    {r.countyName}
                  </Link>
                </td>
                <td className="px-4 py-3 text-muted">{r.state}</td>
                <td className="px-4 py-3 text-right font-mono tabular-nums font-semibold text-foreground">
                  {r.score.toFixed(1)}
                </td>
                <td className="px-4 py-3 text-right font-mono tabular-nums">{pct2(r.grossYield)}</td>
                <td className="px-4 py-3 text-right font-mono tabular-nums">
                  {pct2(r.appreciation5yr)}
                </td>
                <td className="px-4 py-3 text-right font-mono tabular-nums text-muted">
                  {r.riskScore.toFixed(1)}
                </td>
                <td className="px-4 py-3 text-right font-mono tabular-nums text-muted">
                  {r.vacancyRate != null ? pct1(r.vacancyRate) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
