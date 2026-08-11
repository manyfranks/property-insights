import type { Metadata } from "next";
import Link from "next/link";
import { BASE_URL, SITE_NAME } from "@/lib/seo";
import { BreadcrumbJsonLd, FaqJsonLd, ItemListJsonLd } from "@/components/json-ld";
import PartnerCta from "@/components/partner-cta";
import { getCountyInvestmentScores } from "@/lib/db/county-scores";
import RankingsTable, { type InvestmentScoreRow } from "./rankings-table";

// Heavy cross-county aggregate — county-scores.ts caches the underlying
// query for 24h via unstable_cache; this route-level revalidate keeps the
// rendered page itself in step with that same window.
export const revalidate = 86400;

const TOP_N = 100;

const TITLE = "Best Counties to Buy Rental Property (2026)";
const DESCRIPTION =
  "The top 100 US counties for rental property investment, ranked by a composite score blending gross rental yield, 5-year home-price appreciation, FEMA disaster risk, vacancy, and days-on-market — sourced from HUD, Census, FHFA, and FEMA.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/us/rankings/investment" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: `${BASE_URL}/us/rankings/investment`,
    siteName: SITE_NAME,
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

const FAQS: { question: string; answer: string }[] = [
  {
    question: "How is the investment score calculated?",
    answer:
      "Each county gets five component figures — gross rental yield, 5-year home-price appreciation, FEMA disaster risk, rental vacancy rate, and typical days-on-market — then every county in the dataset is ranked against every other county on each component (a percentile). The composite score blends those percentiles: 35% gross yield, 25% appreciation, 20% risk (inverted — lower risk scores higher), 10% vacancy (inverted), 10% days-on-market (inverted). A county needs a computable yield, appreciation figure, and risk score to be ranked at all; if vacancy or days-on-market data isn't available for a county, that component is scored as a neutral 50th percentile rather than penalizing or excluding it.",
  },
  {
    question: "What data sources feed this ranking?",
    answer:
      "Gross yield uses HUD Fair Market Rent (2BR, 2026) against Census ACS median home value (2024). Appreciation is the annualized FHFA All-Transactions House Price Index change over the most recent ~5 years on record (source series runs 1975–2025). Risk is FEMA's National Risk Index composite score (2025). Vacancy is the Census ACS rental vacancy rate (2024). Days-on-market is realtor.com's median DOM series via FRED (latest available month, 2023–2026 coverage). All are public government or federally-distributed data — nothing here is a private model.",
  },
  {
    question: "Is this investment advice?",
    answer:
      "No. This score is a screening tool built entirely from public county-level statistics — it's a starting point for narrowing a search, not a recommendation to buy in any specific county or property. Local market conditions, individual property quality, financing terms, and management costs all matter far more than a county-level average once you're evaluating a specific deal.",
  },
  {
    question: "Why isn't every US county in the ranking?",
    answer:
      "A county only appears if it has a computable gross yield, appreciation figure, and FEMA risk score — that requires HUD Fair Market Rent, Census ACS median home value, FHFA HPI history spanning at least ~5 years, and a FEMA National Risk Index score all being on record for the same county. Counties missing any of those three are left out rather than scored on incomplete data.",
  },
];

export default async function InvestmentRankingsPage() {
  const scores = await getCountyInvestmentScores();
  const top100 = scores.slice(0, TOP_N);

  const rows: InvestmentScoreRow[] = top100.map((c, i) => ({
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
        ]}
      />
      <ItemListJsonLd
        items={top100.map((c) => ({
          name: `${c.county}, ${c.state}`,
          url: `${BASE_URL}/us/${c.stateSlug}/${c.countySlug}`,
        }))}
      />
      <FaqJsonLd questions={FAQS} />

      <div className="text-xs text-muted mb-6">
        <Link href="/us" className="hover:text-foreground transition-colors">
          US Markets
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-foreground">Rankings</span>
      </div>

      <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-1">
        Best Counties to Buy Rental Property (2026)
      </h1>
      <p className="text-sm text-muted mb-8 max-w-2xl">
        The top {TOP_N} US counties to invest in real estate, ranked by a composite score built
        from gross rental yield, home-price appreciation, disaster risk, vacancy, and
        days-on-market — all from public government data sources. See the full methodology below.
      </p>

      <RankingsTable rows={rows} />

      <p className="text-xs text-muted mt-3 mb-10">
        This score is a screening tool built from public county-level data — not investment
        advice. Always underwrite a specific property before making an offer.
      </p>

      {/* Methodology (E-E-A-T: name every source + year + the weight formula) */}
      <div className="mb-10 pb-8 border-b border-border">
        <div className="text-xs uppercase tracking-widest text-muted mb-4">Methodology</div>
        <div className="space-y-4 text-sm text-muted leading-relaxed">
          <p>
            Every county in this ranking gets five component figures, computed from public data:
          </p>
          <ul className="list-disc pl-5 space-y-2">
            <li>
              <span className="text-foreground font-medium">Gross rental yield</span> — HUD Fair
              Market Rent for a 2-bedroom unit (2026), annualized, divided by Census ACS median
              home value (2024).
            </li>
            <li>
              <span className="text-foreground font-medium">5-year appreciation</span> — the
              annualized compound growth rate of the FHFA All-Transactions House Price Index,
              comparing the latest year on record to the closest year at least 4 years earlier
              (source series covers 1975–2025).
            </li>
            <li>
              <span className="text-foreground font-medium">Disaster risk</span> — FEMA&apos;s
              National Risk Index composite score (2025), where a higher score means higher
              composite hazard risk.
            </li>
            <li>
              <span className="text-foreground font-medium">Vacancy rate</span> — Census ACS
              rental vacancy rate (2024).
            </li>
            <li>
              <span className="text-foreground font-medium">Days on market</span> — realtor.com&apos;s
              median days-on-market via FRED, latest month on record (2023–2026 coverage, not
              every county has this series).
            </li>
          </ul>
          <p>
            Each component is converted to a percentile rank against every other scored county
            (0 = lowest in the country, 1 = highest), then blended into a single 0-100 composite
            score using fixed weights:{" "}
            <span className="font-mono text-foreground">35% yield</span>,{" "}
            <span className="font-mono text-foreground">25% appreciation</span>,{" "}
            <span className="font-mono text-foreground">20% risk (inverted)</span>,{" "}
            <span className="font-mono text-foreground">10% vacancy (inverted)</span>, and{" "}
            <span className="font-mono text-foreground">10% days-on-market (inverted)</span>.
            &quot;Inverted&quot; means a lower raw value scores a higher percentile — for risk,
            vacancy, and days-on-market, lower is better.
          </p>
          <p>
            A county must have a computable yield, appreciation figure, and risk score to be
            ranked at all. If a county has no vacancy or days-on-market figure on record, that
            one component is scored as a neutral 50th percentile instead of being excluded or
            penalized.
          </p>
        </div>
      </div>

      {/* FAQ */}
      <div className="mb-10 pb-8 border-b border-border">
        <div className="text-xs uppercase tracking-widest text-muted mb-4">
          Frequently Asked Questions
        </div>
        <div className="space-y-5">
          {FAQS.map((f) => (
            <div key={f.question}>
              <div className="text-sm font-medium text-foreground mb-1">{f.question}</div>
              <p className="text-sm text-muted leading-relaxed">{f.answer}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Funnel: partner CTA + internal cross-links */}
      <div className="mb-10">
        <PartnerCta
          mode="investor"
          country="US"
          source="state-page"
          surface="state-page"
          heading="Tools for rental investors"
        />
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
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
    </main>
  );
}
