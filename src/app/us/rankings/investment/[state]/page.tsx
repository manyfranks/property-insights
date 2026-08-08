import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { BASE_URL, SITE_NAME } from "@/lib/seo";
import { BreadcrumbJsonLd, ItemListJsonLd } from "@/components/json-ld";
import PartnerCta from "@/components/partner-cta";
import { getAllStatesWithCounties } from "@/lib/us-counties";
import { getStateInvestmentScores } from "@/lib/db/county-scores";
import RankingsTable, { type InvestmentScoreRow } from "../rankings-table";

// Same heavy-aggregate caching story as the national page — county-scores.ts
// caches the underlying query for 24h; this keeps the route in step with it.
// Deliberately NOT using generateStaticParams here: the table is built from
// a DB query (like /us/[state]/[county]), so this stays a dynamic (ƒ) route
// that resolves per-request against the 24h cache, rather than a build-time
// static page that could drift from it.
export const revalidate = 86400;

async function loadState(stateSlug: string) {
  const allStates = getAllStatesWithCounties();
  const stateMeta = allStates.find((s) => s.stateSlug === stateSlug);
  if (!stateMeta) return null;
  const scores = await getStateInvestmentScores(stateSlug);
  return { stateMeta, scores };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ state: string }>;
}): Promise<Metadata> {
  const { state: stateSlug } = await params;
  const loaded = await loadState(stateSlug);
  if (!loaded) return {};

  const { stateMeta } = loaded;
  const title = `Best Counties for Rental Property in ${stateMeta.stateName} (2026)`;
  const description = `The best counties to buy rental property in ${stateMeta.stateName}, ranked by a composite score blending gross rental yield, 5-year home-price appreciation, FEMA disaster risk, vacancy, and days-on-market — sourced from HUD, Census, FHFA, and FEMA.`;
  const url = `${BASE_URL}/us/rankings/investment/${stateSlug}`;

  return {
    title,
    description,
    alternates: { canonical: `/us/rankings/investment/${stateSlug}` },
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

export default async function StateInvestmentRankingsPage({
  params,
}: {
  params: Promise<{ state: string }>;
}) {
  const { state: stateSlug } = await params;
  const loaded = await loadState(stateSlug);
  if (!loaded) notFound();

  const { stateMeta, scores } = loaded;

  const rows: InvestmentScoreRow[] = scores.map((c, i) => ({
    rank: i + 1,
    countyName: c.county,
    countySlug: c.countySlug,
    stateSlug: c.stateSlug,
    state: c.state,
    score: c.score,
    grossYield: c.grossYield,
    appreciation5yr: c.appreciation5yr,
    riskScore: c.riskScore,
    vacancyRate: c.vacancyRate,
  }));

  return (
    <main className="max-w-5xl mx-auto px-6 py-10">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", url: BASE_URL },
          { name: "US Markets", url: `${BASE_URL}/us` },
          { name: "Rankings", url: `${BASE_URL}/us/rankings/investment` },
          { name: stateMeta.stateName, url: `${BASE_URL}/us/rankings/investment/${stateSlug}` },
        ]}
      />
      <ItemListJsonLd
        items={scores.map((c) => ({
          name: `${c.county}, ${c.state}`,
          url: `${BASE_URL}/us/${c.stateSlug}/${c.countySlug}`,
        }))}
      />

      <div className="text-xs text-muted mb-6">
        <Link href="/us" className="hover:text-foreground transition-colors">
          US Markets
        </Link>
        <span className="mx-1.5">/</span>
        <Link href="/us/rankings/investment" className="hover:text-foreground transition-colors">
          Rankings
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-foreground">{stateMeta.stateName}</span>
      </div>

      <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-1">
        Best Counties for Rental Property in {stateMeta.stateName} (2026)
      </h1>
      <p className="text-sm text-muted mb-8 max-w-2xl">
        {rows.length > 0
          ? `${rows.length} ${stateMeta.stateName} ${rows.length === 1 ? "county" : "counties"} ranked by a composite score built from gross rental yield, home-price appreciation, disaster risk, vacancy, and days-on-market.`
          : `We don't have enough data on record yet to score any ${stateMeta.stateName} counties — check back after the next data refresh, or see the national ranking below.`}
      </p>

      <RankingsTable rows={rows} />

      <p className="text-xs text-muted mt-3 mb-10">
        This score is a screening tool built from public county-level data — not investment
        advice. Always underwrite a specific property before making an offer.
      </p>

      <div className="mb-10">
        <PartnerCta
          country="US"
          state={stateMeta.state}
          source="state-page"
          surface="state-page"
          heading={`Tools for ${stateMeta.stateName} rental investors`}
        />
      </div>

      <div className="grid sm:grid-cols-2 gap-3 mb-10">
        <div className="border border-border rounded-xl p-5 bg-white">
          <p className="text-sm font-medium text-foreground mb-1">
            Check rents for any county
          </p>
          <p className="text-xs text-muted mb-3">
            HUD Fair Market Rent by bedroom size, for any of 3,000+ US counties.
          </p>
          <Link
            href="/us"
            className="text-xs font-medium text-foreground underline underline-offset-2 hover:text-foreground/70 transition-colors"
          >
            See average rents for any county &rarr;
          </Link>
        </div>
        <div className="border border-border rounded-xl p-5 bg-white">
          <p className="text-sm font-medium text-foreground mb-1">
            Own or eyeing a specific property?
          </p>
          <p className="text-xs text-muted mb-3">
            Get its estimated rent and value, backed by this same county-level data.
          </p>
          <Link
            href="/"
            className="text-xs font-medium text-foreground underline underline-offset-2 hover:text-foreground/70 transition-colors"
          >
            Get its estimated rent and value &rarr;
          </Link>
        </div>
      </div>

      <div className="text-sm">
        <Link
          href="/us/rankings/investment"
          className="text-foreground hover:underline underline-offset-2 transition-colors"
        >
          National rankings &rarr;
        </Link>
      </div>
    </main>
  );
}
