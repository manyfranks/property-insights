import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { BASE_URL, SITE_NAME } from "@/lib/seo";
import { BreadcrumbJsonLd, FaqJsonLd } from "@/components/json-ld";
import PartnerCta from "@/components/partner-cta";
import { getAllStatesWithCounties, getCountiesByState } from "@/lib/us-counties";
import { getRentToPriceRankingsByState } from "@/lib/db/rent-to-price";
import RankingsTable, { type RentToPriceRow } from "../rankings-table";

// Same annual-release cadence rationale as the national page.
export const revalidate = 86400;

export async function generateStaticParams() {
  return getAllStatesWithCounties().map((s) => ({ state: s.stateSlug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ state: string }>;
}): Promise<Metadata> {
  const { state: stateSlug } = await params;
  const counties = getCountiesByState(stateSlug);
  if (counties.length === 0) return {};

  const { stateName } = counties[0];
  const title = `Rent-to-Price Ratios in ${stateName} by County (2026)`;
  const description = `Which ${stateName} counties come closest to the 1% rule in 2026? HUD rent vs. Census median home value, ranked by monthly rent-to-price ratio for every covered ${stateName} county.`;
  const url = `${BASE_URL}/us/rankings/rent-to-price/${stateSlug}`;

  return {
    title,
    description,
    alternates: { canonical: `/us/rankings/rent-to-price/${stateSlug}` },
    openGraph: {
      title,
      description,
      url,
      siteName: SITE_NAME,
      type: "website",
      locale: "en_US",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function RentToPriceStateRankingsPage({
  params,
}: {
  params: Promise<{ state: string }>;
}) {
  const { state: stateSlug } = await params;
  const counties = getCountiesByState(stateSlug);
  if (counties.length === 0) notFound();

  const { stateName, state } = counties[0];
  const rankings = await getRentToPriceRankingsByState(stateSlug);
  const total = rankings.counties.length;
  const passCount = rankings.passCount;
  const passPct = total > 0 ? ((passCount / total) * 100).toFixed(1) : "0.0";

  const rows: RentToPriceRow[] = rankings.counties.map((c, i) => ({
    rank: i + 1,
    countyName: c.county.county,
    countySlug: c.county.countySlug,
    stateSlug: c.county.stateSlug,
    state: c.county.state,
    monthlyRatio: c.monthlyRatio,
    passes: c.passesOnePercentRule,
    fmr2br: c.fmr2br,
    medianHomeValue: c.medianHomeValue,
    medianGrossRent: c.medianGrossRent,
  }));

  const faqs = [
    {
      question: "What is the 1% rule?",
      answer:
        "The 1% rule is a quick rental-property screening test: a property roughly clears it when its monthly rent is at or above 1% of its purchase price. It's a fast filter for whether a deal is worth a closer look, not a substitute for a full underwrite.",
    },
    {
      question: `Is the 1% rule realistic in ${stateName} in 2026?`,
      answer:
        total > 0
          ? `Based on current figures, ${passCount.toLocaleString()} of ${total.toLocaleString()} covered ${stateName} counties (${passPct}%) clear a 1% monthly ratio. ${
              passCount > 0
                ? "The counties that pass tend to be the state's lower-cost markets, where home values haven't outrun rents as much as in its larger metros."
                : "None of the covered counties currently clear it outright — home values have outpaced rents across the state's covered markets."
            }`
          : `We don't yet have both HUD rent and Census home-value data on record for a covered ${stateName} county.`,
    },
    {
      question: "How is the rent-to-price ratio calculated?",
      answer:
        "Monthly ratio = HUD Fair Market Rent for a 2-bedroom unit, divided by the county's Census ACS median home value. Both figures are gross — before taxes, insurance, maintenance, vacancy, or financing — so treat the ratio as a screening signal, not a full underwrite.",
    },
  ];

  return (
    <main className="max-w-5xl mx-auto px-6 py-10">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", url: BASE_URL },
          { name: "US Markets", url: `${BASE_URL}/us` },
          { name: "Rent-to-Price Rankings", url: `${BASE_URL}/us/rankings/rent-to-price` },
          { name: stateName, url: `${BASE_URL}/us/rankings/rent-to-price/${stateSlug}` },
        ]}
      />
      <FaqJsonLd questions={faqs} />

      <div className="text-xs text-muted mb-6">
        <Link href="/us" className="hover:text-foreground transition-colors">
          US Markets
        </Link>
        <span className="mx-1.5">/</span>
        <Link href="/us/rankings/rent-to-price" className="hover:text-foreground transition-colors">
          Rent-to-Price Rankings
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-foreground">{stateName}</span>
      </div>

      <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-2">
        Rent-to-Price Ratios in {stateName} by County (2026)
      </h1>
      <p className="text-sm text-muted mb-6 max-w-2xl leading-relaxed">
        HUD rent data vs. Census median home value for every covered {stateName} county, ranked by
        monthly rent-to-price ratio — a quick screen for how close each market comes to the classic
        &ldquo;1% rule.&rdquo;
      </p>

      <div className="border border-border rounded-xl p-6 bg-white mb-8">
        <div className="text-xs uppercase tracking-widest text-muted mb-2">
          {stateName} Counties Passing the 1% Rule
        </div>
        <div className="font-mono text-4xl font-semibold tracking-tight tabular-nums">
          {passCount.toLocaleString()}
          <span className="text-base text-muted font-sans"> / {total.toLocaleString()}</span>
        </div>
        <div className="text-xs text-muted mt-2">{passPct}% of covered {stateName} counties</div>
      </div>

      <div className="mb-3 flex items-baseline justify-between">
        <div className="text-xs uppercase tracking-widest text-muted">
          {stateName} Counties by Ratio
        </div>
        <div className="text-xs text-muted">Tap a column to sort</div>
      </div>
      <div className="mb-8">
        <RankingsTable rows={rows} />
      </div>

      <div className="mb-10 space-y-3 text-sm text-muted leading-relaxed border border-border rounded-xl p-6 bg-white">
        <div className="text-xs uppercase tracking-widest text-muted mb-1">Methodology</div>
        <p>
          Monthly ratio = HUD Fair Market Rent (2-bedroom) &divide; Census ACS median home value.
          FMR is a 2026-vintage figure; ACS median home values are a slower-moving 5-year-estimate
          series most recently updated for 2024 — so every ratio here is an approximation of
          today&rsquo;s true relationship, not a same-year snapshot.
        </p>
        <p className="text-xs text-muted/80">
          Screening data, not investment advice. Underwrite a specific property with its actual
          purchase price, financing terms, taxes, insurance, and maintenance costs before acting.
        </p>
      </div>

      <div className="mb-10 pb-6 border-b border-border">
        <div className="text-xs uppercase tracking-widest text-muted mb-4">
          Frequently Asked Questions
        </div>
        <div className="space-y-5">
          {faqs.map((f) => (
            <div key={f.question}>
              <div className="text-sm font-medium text-foreground mb-1">{f.question}</div>
              <p className="text-sm text-muted leading-relaxed">{f.answer}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mb-10">
        <PartnerCta
          mode="investor"
          country="US"
          state={state}
          source="state-page"
          surface="state-page"
          heading={`Tools for ${stateName} rental investors`}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <Link
          href="/us/rankings/rent-to-price"
          className="text-sm text-foreground hover:underline underline-offset-2 transition-colors"
        >
          &larr; National rankings
        </Link>
        <div className="flex flex-wrap items-center gap-4">
          <Link
            href="/us"
            className="text-xs font-medium text-foreground underline underline-offset-2 hover:text-foreground/70 transition-colors"
          >
            Browse the county rent lookup &rarr;
          </Link>
          <Link
            href="/"
            className="text-xs font-medium text-foreground underline underline-offset-2 hover:text-foreground/70 transition-colors"
          >
            Get an address-level estimate &rarr;
          </Link>
        </div>
      </div>
    </main>
  );
}
