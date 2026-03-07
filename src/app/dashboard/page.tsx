import Link from "next/link";
import { PRELOADED_LISTINGS } from "@/lib/data/listings";
import { analyzeListing } from "@/lib/analyze";
import { slugify, fmt } from "@/lib/utils";
import TierBadge from "@/components/tier-badge";

export default function DashboardPage() {
  const analyses = PRELOADED_LISTINGS
    .map((l) => analyzeListing(l))
    .sort((a, b) => (b.offer?.savings ?? 0) - (a.offer?.savings ?? 0));

  const withOffers = analyses.filter((a) => a.offer);
  const avgSavings = withOffers.length > 0
    ? Math.round(withOffers.reduce((sum, a) => sum + (a.offer?.savings ?? 0), 0) / withOffers.length)
    : 0;
  const inRange = withOffers.filter((a) => a.offer?.inTargetRange).length;

  return (
    <main className="max-w-5xl mx-auto px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight mb-1">Dashboard</h1>
      <p className="text-sm text-muted mb-8">
        {analyses.length} properties analyzed &middot; BC, AB, ON
      </p>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <div className="border border-border rounded-xl p-4">
          <div className="text-xs text-muted mb-1">Properties</div>
          <div className="font-mono text-xl font-semibold">{analyses.length}</div>
        </div>
        <div className="border border-border rounded-xl p-4">
          <div className="text-xs text-muted mb-1">With Assessments</div>
          <div className="font-mono text-xl font-semibold">{withOffers.length}</div>
        </div>
        <div className="border border-border rounded-xl p-4">
          <div className="text-xs text-muted mb-1">In Target Range</div>
          <div className="font-mono text-xl font-semibold">{inRange}</div>
        </div>
        <div className="border border-border rounded-xl p-4">
          <div className="text-xs text-muted mb-1">Avg Savings</div>
          <div className="font-mono text-xl font-semibold">{fmt(avgSavings)}</div>
        </div>
      </div>

      {/* Table */}
      <div className="border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-gray-50/50">
                <th className="text-left px-4 py-3 font-medium text-muted">Address</th>
                <th className="text-left px-4 py-3 font-medium text-muted">City</th>
                <th className="text-right px-4 py-3 font-medium text-muted">List</th>
                <th className="text-right px-4 py-3 font-medium text-muted">Assessed</th>
                <th className="text-right px-4 py-3 font-medium text-muted">Offer</th>
                <th className="text-right px-4 py-3 font-medium text-muted">Savings</th>
                <th className="text-center px-4 py-3 font-medium text-muted">DOM</th>
                <th className="text-center px-4 py-3 font-medium text-muted">Tier</th>
              </tr>
            </thead>
            <tbody>
              {analyses.map((a) => (
                <tr key={a.listing.address} className="border-b border-border last:border-b-0 hover:bg-gray-50/50 transition-colors">
                  <td className="px-4 py-3">
                    <Link
                      href={`/property/${slugify(a.listing.address)}`}
                      className="font-medium text-foreground hover:underline"
                    >
                      {a.listing.address}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted">{a.listing.city}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmt(a.listing.price)}</td>
                  <td className="px-4 py-3 text-right font-mono">
                    {a.assessment ? fmt(a.assessment.totalValue) : "-"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-medium">
                    {a.offer ? fmt(a.offer.finalOffer) : "-"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-green-600">
                    {a.offer ? fmt(a.offer.savings) : "-"}
                  </td>
                  <td className="px-4 py-3 text-center font-mono">{a.listing.dom}</td>
                  <td className="px-4 py-3 text-center">
                    <TierBadge tier={a.score.tier} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-8 text-center text-xs text-muted">
        Built by Matt Francis &middot; 2026
      </div>
    </main>
  );
}
