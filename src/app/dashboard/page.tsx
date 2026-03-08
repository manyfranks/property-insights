import type { Metadata } from "next";
import { getAllListings } from "@/lib/kv/listings";
import { analyzeListing } from "@/lib/analyze";
import { slugify } from "@/lib/utils";
import DashboardClient from "@/components/dashboard-client";

export const metadata: Metadata = {
  title: "Discover Properties — Analyzed Listings Across Canada",
  description:
    "Browse analyzed Canadian real estate listings with offer modeling, assessment data, and seller motivation scores. Filter by city across BC, Alberta, and Ontario.",
  alternates: { canonical: "/dashboard" },
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ city?: string }>;
}) {
  const { city: initialCity } = await searchParams;
  const listings = await getAllListings();
  const analyses = listings.map((l) => analyzeListing(l));

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
      <p className="text-sm text-muted mb-8">
        {analyses.length} properties analyzed &middot; BC, AB, ON
      </p>

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
