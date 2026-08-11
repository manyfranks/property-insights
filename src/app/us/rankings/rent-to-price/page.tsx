import type { Metadata } from "next";
import Link from "next/link";
import { BASE_URL, SITE_NAME } from "@/lib/seo";
import { BreadcrumbJsonLd, FaqJsonLd } from "@/components/json-ld";
import PartnerCta from "@/components/partner-cta";
import { getRentToPriceRankings } from "@/lib/db/rent-to-price";
import RankingsTable, { type RentToPriceRow } from "./rankings-table";

// HUD FMR and Census ACS medians only change on their annual release
// cadence, so a daily ISR regen (matching /us/[state]/[county]/rent's
// revalidate) is more than fresh enough and lets every visitor between
// regens hit the cached render instead of re-querying the full county scan.
export const revalidate = 86400;

const TOP_N = 100;

function toRow(
  c: Awaited<ReturnType<typeof getRentToPriceRankings>>["counties"][number],
  rank: number
): RentToPriceRow {
  return {
    rank,
    countyName: c.county.county,
    countySlug: c.county.countySlug,
    stateSlug: c.county.stateSlug,
    state: c.county.state,
    monthlyRatio: c.monthlyRatio,
    passes: c.passesOnePercentRule,
    fmr2br: c.fmr2br,
    medianHomeValue: c.medianHomeValue,
    medianGrossRent: c.medianGrossRent,
  };
}

export async function generateMetadata(): Promise<Metadata> {
  const title = "Rent-to-Price Ratio by County: Where the 1% Rule Still Works (2026)";
  const description =
    "Ranked: the US counties with the best rent to price ratio in 2026. See which counties that pass the 1 percent rule, with HUD rent and Census home-value data for every county.";
  const url = `${BASE_URL}/us/rankings/rent-to-price`;

  return {
    title,
    description,
    alternates: { canonical: "/us/rankings/rent-to-price" },
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

export default async function RentToPriceRankingsPage() {
  const rankings = await getRentToPriceRankings();
  const total = rankings.counties.length;
  const passCount = rankings.passCount;
  const passPct = total > 0 ? ((passCount / total) * 100).toFixed(1) : "0.0";
  const fmrYear = rankings.fmrYears[0];
  const homeValueYear = rankings.homeValueYears[0];

  const top100 = rankings.counties.slice(0, TOP_N).map((c, i) => toRow(c, i + 1));

  const faqs = [
    {
      question: "What is the 1% rule?",
      answer:
        "The 1% rule is a quick rental-property screening test: a property roughly clears it when its monthly rent is at or above 1% of its purchase price (a $200,000 home renting for $2,000/month or more, for example). It's a back-of-envelope filter for whether a deal is worth a closer look — not a substitute for a full underwrite that accounts for taxes, insurance, maintenance, vacancy, and financing costs.",
    },
    {
      question: "Is the 1% rule still realistic in 2026?",
      answer:
        `Not in most of the country. Home prices have outpaced rents in the large majority of US counties, so a strict 1% monthly ratio is now the exception rather than the norm — on this page, ${passCount.toLocaleString()} of ${total.toLocaleString()} counties (${passPct}%) clear it. The counties that still pass tend to be lower-cost markets in the Midwest and South rather than the large coastal metros, where home values have climbed far faster than rents.`,
    },
    {
      question: "How is the rent-to-price ratio calculated on this page?",
      answer:
        "Monthly ratio = HUD's Fair Market Rent for a 2-bedroom unit, divided by the county's Census ACS median home value. Annual yield is that monthly ratio times 12. Both are gross figures — before taxes, insurance, maintenance, vacancy, or financing — meant for screening markets, not underwriting a specific property.",
    },
    {
      question: "Why do the rent and home-value figures come from different years?",
      answer:
        `HUD republishes Fair Market Rent every year (this page uses the ${fmrYear ?? "latest"} figures); Census ACS median home values are a slower-moving 5-year-estimate series (this page uses ${homeValueYear ?? "the latest available"} data). That cross-vintage gap means the ratio is an approximation — in a market where home prices have risen quickly since ${homeValueYear ?? "the ACS vintage"}, the true current ratio is probably lower than what's shown here; in a market where prices have fallen or stalled, it's probably higher.`,
    },
  ];

  return (
    <main className="max-w-5xl mx-auto px-6 py-10">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", url: BASE_URL },
          { name: "US Markets", url: `${BASE_URL}/us` },
          { name: "Rent-to-Price Rankings", url: `${BASE_URL}/us/rankings/rent-to-price` },
        ]}
      />
      <FaqJsonLd questions={faqs} />

      <div className="text-xs text-muted mb-6">
        <Link href="/us" className="hover:text-foreground transition-colors">
          US Markets
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-foreground">Rent-to-Price Rankings</span>
      </div>

      <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-2">
        Rent-to-Price Ratio by County: Where the 1% Rule Still Works (2026)
      </h1>
      <p className="text-sm text-muted mb-6 max-w-2xl leading-relaxed">
        The &ldquo;1% rule&rdquo; is a quick investor screen: a rental roughly clears it when its
        monthly rent is at least 1% of what it would cost to buy. Ranked below are every US county
        with both HUD rent data and a Census median home value, sorted by how close their typical
        numbers get to that bar.
      </p>

      {/* Headline stat */}
      <div className="border border-border rounded-xl p-6 bg-white mb-8">
        <div className="text-xs uppercase tracking-widest text-muted mb-2">
          Counties Passing the 1% Rule
        </div>
        <div className="font-mono text-4xl font-semibold tracking-tight tabular-nums">
          {passCount.toLocaleString()}
          <span className="text-base text-muted font-sans"> / {total.toLocaleString()}</span>
        </div>
        <div className="text-xs text-muted mt-2">
          {passPct}% of covered counties &middot; ranked by monthly rent-to-price ratio
        </div>
      </div>

      {/* Top 100 table */}
      <div className="mb-3 flex items-baseline justify-between">
        <div className="text-xs uppercase tracking-widest text-muted">
          Top {Math.min(TOP_N, total).toLocaleString()} Counties
        </div>
        <div className="text-xs text-muted">Tap a column to sort</div>
      </div>
      <div className="mb-8">
        <RankingsTable rows={top100} />
      </div>

      {/* Methodology + vintage caveat */}
      <div className="mb-10 space-y-4 text-sm text-muted leading-relaxed border border-border rounded-xl p-6 bg-white">
        <div className="text-xs uppercase tracking-widest text-muted mb-1">Methodology</div>
        <p>
          <span className="text-foreground font-medium">Monthly ratio</span> = HUD Fair Market
          Rent (2-bedroom{fmrYear ? `, ${fmrYear} data` : ""}) &divide; Census ACS median home
          value{homeValueYear ? ` (${homeValueYear} data)` : ""}. Annual yield is that ratio times
          12. Where available, we also show the Census ACS median gross rent — an actual-rents
          figure, distinct from HUD&rsquo;s Fair Market Rent estimate — as a secondary reference
          column.
        </p>
        <p>
          <span className="text-foreground font-medium">Honest caveat: these are cross-vintage
          figures.</span>{" "}
          HUD Fair Market Rent is republished every year and reflects {fmrYear ?? "the latest"}{" "}
          conditions. Census ACS median home values are a slower-moving 5-year-estimate series and
          reflect {homeValueYear ?? "an earlier"} conditions — typically a year or two older than
          the rent figure it&rsquo;s divided against. That gap means every ratio on this page is an
          approximation of today&rsquo;s true rent-to-price relationship, not a same-year snapshot.
          Treat it as a screening signal for which markets are worth a closer look, not a precise
          yield calculation for a specific property.
        </p>
        <p className="text-xs text-muted/80">
          Screening data, not investment advice. Always underwrite a specific property with its
          actual purchase price, financing terms, taxes, insurance, and maintenance costs before
          acting.
        </p>
      </div>

      {/* FAQ */}
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

      {/* Funnel: tools + internal links */}
      <div className="mb-10">
        <PartnerCta
          mode="investor"
          country="US"
          source="state-page"
          surface="state-page"
          heading="Tools for rental investors"
        />
      </div>

      <div className="border border-border rounded-xl p-6 mb-10 text-center">
        <p className="text-sm font-medium text-foreground mb-1">
          Looking for a specific market or property?
        </p>
        <p className="text-xs text-muted mb-4 max-w-md mx-auto">
          Browse rent data for every covered county, or get an instant estimate for a specific
          address.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-4">
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
