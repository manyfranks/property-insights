import type { Metadata } from "next";
import Link from "next/link";
import { readAllListings } from "@/lib/kv/listings";
import { analyzeListing } from "@/lib/analyze";
import { isUSState } from "@/lib/assessment/us";
import { slugify } from "@/lib/utils";
import DashboardClient from "@/components/dashboard-client";

export const metadata: Metadata = {
  title: "Discover Properties — Analyzed Listings Across Canada",
  description:
    "Browse analyzed Canadian real estate listings with offer modeling, assessment data, and seller motivation scores. Filter by city across BC, Alberta, and Ontario.",
  alternates: { canonical: "/dashboard" },
};

function pillClass(active: boolean): string {
  return `px-3.5 py-1.5 rounded-full text-xs font-medium transition-all ${
    active ? "bg-foreground text-white" : "border border-border text-muted hover:text-foreground"
  }`;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ city?: string; country?: string }>;
}) {
  const { city: initialCity, country } = await searchParams;

  // Degraded-mode choice for this surface: a VISIBLE, explicit panel instead
  // of the table, and no 500.
  //
  // Every number on this page is derived from the listing array, so an
  // unreadable store used to render the page's own headline claim — "0
  // properties analyzed" — as a statement of fact, with an empty table under
  // it and nothing anywhere saying a read had failed. A visitor cannot tell
  // that from a product with no data in it. This page is a browse surface
  // with no crawl-signal role (it carries no per-listing URLs a crawler
  // would drop) and no primary action that survives without the data, so the
  // honest rendering is the whole page replaced by a statement of what went
  // wrong — the "fall back visibly" tier, not a hard error page that says
  // less.
  const store = await readAllListings();
  if (store.status === "unavailable") {
    console.error(`[dashboard] listings store unreadable: ${store.reason}`);
    return (
      <main className="max-w-5xl mx-auto px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight mb-1">Discover</h1>
        <div
          role="alert"
          className="mt-6 rounded-xl border border-border bg-white px-5 py-5 text-sm text-muted"
        >
          <p className="font-medium text-foreground">We couldn&apos;t load the listings right now.</p>
          <p className="mt-2 leading-relaxed">
            This is a temporary problem reading our own data store — not an empty catalogue. Nothing
            here has been removed. Please try again in a few minutes.
          </p>
          <p className="mt-3 leading-relaxed">
            In the meantime you can still{" "}
            <Link href="/" className="text-foreground underline">
              search a specific address
            </Link>
            , which does not depend on this data.
          </p>
        </div>
      </main>
    );
  }
  const listings = store.status === "ok" ? store.listings : [];

  // Country filter (CA | US) — DashboardClient's table has a fixed column
  // set with no province/state column (predates the US expansion), and
  // it's not in this task's file ownership, so reshaping it is out of
  // scope. A lightweight server-rendered country toggle is the lower-
  // surgery way to make US Discover listings (src/lib/pipeline/us-discover.ts)
  // reachable here without touching that shared component: it filters the
  // rows passed into DashboardClient, nothing inside DashboardClient changes.
  const usCount = listings.filter((l) => isUSState(l.province)).length;
  const caCount = listings.length - usCount;
  const countryFilter = country === "US" || country === "CA" ? country : null;
  const scopedListings = countryFilter
    ? listings.filter((l) => (isUSState(l.province) ? "US" : "CA") === countryFilter)
    : listings;

  const analyses = scopedListings.map((l) => {
    const a = analyzeListing(l);
    // US Discover listings carry a pre-computed score augmented with
    // county-median-value and price/sqft-outlier structural signals that
    // scoreV2 alone has no inputs for — prefer that over analyzeListing()'s
    // plain scoreV2 recompute. No-op for CA listings.
    if (l.preScore != null && l.preTier) {
      return { ...a, score: { ...a.score, total: l.preScore, tier: l.preTier } };
    }
    return a;
  });

  const rows = analyses.map((a) => ({
    address: a.listing.address,
    slug: slugify(a.listing.address),
    city: a.listing.city,
    province: a.listing.province,
    price: a.listing.price,
    assessed: a.assessment?.totalValue ?? null,
    offer: a.offer?.finalOffer ?? null,
    savings: a.offer?.savings ?? null,
    dom: a.listing.dom,
    tier: a.score.tier,
    beds: a.listing.beds,
    baths: a.listing.baths,
    signals: a.signals,
    score: a.score.total,
  }));

  const withOffers = analyses.filter((a) => a.offer);
  const avgSavings = withOffers.length > 0
    ? Math.round(withOffers.reduce((sum, a) => sum + (a.offer?.savings ?? 0), 0) / withOffers.length)
    : 0;
  const inRange = withOffers.filter((a) => a.offer?.inTargetRange).length;

  return (
    <main className="max-w-5xl mx-auto px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight mb-1">Discover</h1>
      <p className="text-sm text-muted mb-4">
        {analyses.length} properties analyzed &middot; BC, AB, ON
        {usCount > 0 && " + US metros"}
      </p>

      {usCount > 0 && (
        <div className="flex gap-2 mb-6">
          <Link href="/dashboard" className={pillClass(!countryFilter)}>
            All ({listings.length})
          </Link>
          <Link href="/dashboard?country=CA" className={pillClass(countryFilter === "CA")}>
            Canada ({caCount})
          </Link>
          <Link href="/dashboard?country=US" className={pillClass(countryFilter === "US")}>
            United States ({usCount})
          </Link>
        </div>
      )}

      <DashboardClient
        rows={rows}
        stats={{
          total: analyses.length,
          withOffers: withOffers.length,
          inRange,
          avgSavings,
        }}
        initialCity={initialCity || null}
      />

    </main>
  );
}
