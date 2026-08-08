import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { BASE_URL, SITE_NAME } from "@/lib/seo";
import { BreadcrumbJsonLd, FaqJsonLd } from "@/components/json-ld";
import PartnerCta from "@/components/partner-cta";
import StatCard from "@/components/stat-card";
import { assertAffiliateHealth } from "@/config/affiliate-vendors";
import { fmt, pct } from "@/lib/utils";
import { getCountyBySlug, getCountiesByState } from "@/lib/us-counties";
import {
  getCountyRentPanel,
  getCountyFipsWithFmrAmong,
  type CountyRentPanel,
} from "@/lib/db/regional-econ";

export const revalidate = 86400; // 24h ISR — HUD FMR is an annual data source

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function fmrLabel(n: number | null): string {
  return n != null ? fmt(n) + "/mo" : "—";
}

async function loadCountyRent(stateSlug: string, countySlug: string) {
  const county = getCountyBySlug(stateSlug, countySlug);
  if (!county) return null;
  const panel = await getCountyRentPanel(county.fips);
  if (!panel) return null; // no fmr_2br on record — no /rent page for this county
  return { county, panel };
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export async function generateMetadata({
  params,
}: {
  params: Promise<{ state: string; county: string }>;
}): Promise<Metadata> {
  const { state: stateSlug, county: countySlug } = await params;
  const loaded = await loadCountyRent(stateSlug, countySlug);
  if (!loaded) return {};

  const { county, panel } = loaded;
  const vintage = panel.vintages["fmr_2br"];
  const title = `Average Rent in ${county.county}, ${county.state} (${vintage}) — By Bedroom`;
  const description = `The average rent in ${county.county}, ${county.state} is ${fmt(panel.fmr2br)}/mo for a 2-bedroom (HUD Fair Market Rent, ${vintage}). See studio, 1BR, 3BR, and 4BR rates for ${county.county}.`;
  const url = `${BASE_URL}/us/${stateSlug}/${countySlug}/rent`;

  return {
    title,
    description,
    alternates: { canonical: `/us/${stateSlug}/${countySlug}/rent` },
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

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function CountyRentPage({
  params,
}: {
  params: Promise<{ state: string; county: string }>;
}) {
  const { state: stateSlug, county: countySlug } = await params;
  const county = getCountyBySlug(stateSlug, countySlug);
  if (!county) notFound();

  assertAffiliateHealth();

  const panel: CountyRentPanel | null = await getCountyRentPanel(county.fips);
  if (!panel) notFound();

  const vintage = panel.vintages["fmr_2br"];

  const allSiblings = getCountiesByState(stateSlug).filter((c) => c.fips !== county.fips);
  const siblingFmrFips = await getCountyFipsWithFmrAmong(allSiblings.map((c) => c.fips));
  const siblings = allSiblings.filter((c) => siblingFmrFips.has(c.fips)).slice(0, 5);

  const annualRent2br = panel.fmr2br * 12;
  const grossYield =
    panel.medianHomeValue != null && panel.medianHomeValue > 0
      ? annualRent2br / panel.medianHomeValue
      : null;

  const faqs: { question: string; answer: string; linkToCounty?: boolean }[] = [
    {
      question: `What is the average rent in ${county.county}?`,
      answer: `The average (HUD Fair Market Rent) for a 2-bedroom home in ${county.county}, ${county.state} is ${fmt(panel.fmr2br)}/month, as of ${vintage}. A studio runs about ${fmrLabel(panel.fmrStudio)}, a 1-bedroom about ${fmrLabel(panel.fmr1br)}, a 3-bedroom about ${fmrLabel(panel.fmr3br)}, and a 4-bedroom about ${fmrLabel(panel.fmr4br)}.`,
    },
    {
      question: "What is Fair Market Rent?",
      answer:
        "Fair Market Rent (FMR) is a rent estimate published annually by the US Department of Housing and Urban Development (HUD) for every county in the country. It represents the 40th-percentile gross rent — meaning rent plus utilities — for standard-quality rental units in that area. HUD uses it to set payment standards for Section 8 housing vouchers, but it also works well as a general, government-sourced baseline for what a typical rental actually costs.",
    },
    {
      question: `Is ${county.county} a good market for rental investors?`,
      answer:
        grossYield != null
          ? `Based on current figures, a 2-bedroom rental in ${county.county} generates a gross rental yield of about ${pct(grossYield)} (annual rent of ${fmt(annualRent2br)} against a median home value of ${fmt(panel.medianHomeValue!)}). That's a starting point, not a full underwrite — see the full ${county.county} market page for home values, price trends, and hazard risk before running the numbers on a specific property.`
          : `${county.county}'s HUD Fair Market Rents give a reliable rent baseline, but we don't have a median home value on record for this county to compute a yield estimate. See the full ${county.county} market page for the rest of the available market data.`,
      linkToCounty: true,
    },
    {
      question: "How often are these rent figures updated?",
      answer: `HUD republishes Fair Market Rents once a year, ahead of the federal fiscal year. The figures on this page are the ${vintage} data — the most recent HUD has published for ${county.county}.`,
    },
  ];

  return (
    <main className="max-w-3xl mx-auto px-6 py-10">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", url: BASE_URL },
          { name: "US Markets", url: `${BASE_URL}/us` },
          { name: county.stateName, url: `${BASE_URL}/us/${stateSlug}` },
          { name: county.county, url: `${BASE_URL}/us/${stateSlug}/${countySlug}` },
          { name: "Rent", url: `${BASE_URL}/us/${stateSlug}/${countySlug}/rent` },
        ]}
      />
      <FaqJsonLd questions={faqs} />

      <div className="text-xs text-muted mb-6">
        <Link href="/us" className="hover:text-foreground transition-colors">
          US Markets
        </Link>
        <span className="mx-1.5">/</span>
        <Link href={`/us/${stateSlug}`} className="hover:text-foreground transition-colors">
          {county.stateName}
        </Link>
        <span className="mx-1.5">/</span>
        <Link href={`/us/${stateSlug}/${countySlug}`} className="hover:text-foreground transition-colors">
          {county.county}
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-foreground">Rent</span>
      </div>

      <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-1">
        Average Rent in {county.county}, {county.state} ({vintage})
      </h1>
      <p className="text-sm text-muted mb-8">
        HUD Fair Market Rent by bedroom count for {county.county}, {county.stateName} —
        the government baseline for what a typical rental actually costs here.
      </p>

      {/* Hero stat: 2BR is the headline figure */}
      <div className="border border-border rounded-xl p-6 bg-white mb-4">
        <div className="text-xs uppercase tracking-widest text-muted mb-2">
          Average 2-Bedroom Rent
        </div>
        <div className="font-mono text-4xl font-semibold tracking-tight">
          {fmt(panel.fmr2br)}
          <span className="text-base text-muted font-sans">/mo</span>
        </div>
        <div className="text-xs text-muted mt-2">HUD Fair Market Rent &middot; {vintage} data</div>
      </div>

      {/* Other bedroom sizes as stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        <StatCard label="Studio" value={fmrLabel(panel.fmrStudio)} vintage={panel.vintages["fmr_studio"]} />
        <StatCard label="1 Bedroom" value={fmrLabel(panel.fmr1br)} vintage={panel.vintages["fmr_1br"]} />
        <StatCard label="3 Bedroom" value={fmrLabel(panel.fmr3br)} vintage={panel.vintages["fmr_3br"]} />
        <StatCard label="4 Bedroom" value={fmrLabel(panel.fmr4br)} vintage={panel.vintages["fmr_4br"]} />
      </div>

      {/* Full table */}
      <div className="border border-border rounded-xl bg-white mb-8 overflow-hidden">
        <div className="text-xs uppercase tracking-widest text-muted px-5 pt-4 pb-1">
          Rent by Bedroom Size
        </div>
        <table className="w-full text-sm">
          <tbody>
            {(
              [
                { label: "Studio", value: panel.fmrStudio, year: panel.vintages["fmr_studio"] },
                { label: "1 Bedroom", value: panel.fmr1br, year: panel.vintages["fmr_1br"] },
                { label: "2 Bedroom", value: panel.fmr2br, year: panel.vintages["fmr_2br"] },
                { label: "3 Bedroom", value: panel.fmr3br, year: panel.vintages["fmr_3br"] },
                { label: "4 Bedroom", value: panel.fmr4br, year: panel.vintages["fmr_4br"] },
              ] as { label: string; value: number | null; year?: number }[]
            ).map((row, i, arr) => (
              <tr key={row.label} className={i < arr.length - 1 ? "border-b border-border" : ""}>
                <td className="px-5 py-3 text-foreground">{row.label}</td>
                <td className="px-5 py-3 text-right font-mono tabular-nums font-medium">
                  {fmrLabel(row.value)}
                </td>
                <td className="px-5 py-3 text-right text-xs text-muted/70 w-20">
                  {row.year ? `${row.year}` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Plain-language explainer */}
      <div className="mb-8 space-y-4 text-sm text-muted leading-relaxed">
        <p>
          These figures are <span className="text-foreground font-medium">HUD Fair Market Rents</span> —
          published every year by the US Department of Housing and Urban Development for every
          county in the country. They&apos;re set at the 40th percentile of gross rents (rent plus
          utilities) for standard-quality units, which means roughly 40% of typical rentals in{" "}
          {county.county} go for less than these numbers, and 60% go for more.
        </p>
        <p>
          HUD uses these figures to set payment standards for Section 8 housing vouchers, which is
          why they&apos;re rebuilt from real local rental market data every year rather than
          estimated from a national model. That makes them a reliable, government-sourced baseline
          — not a marketing number from a listings site.
        </p>
        <p>
          Use them as a sanity check: if you&apos;re quoting, budgeting, or underwriting a rental in{" "}
          {county.county}, these are close to what a typical {county.county} rental actually goes
          for by bedroom count, before you adjust for a specific property&apos;s condition, location,
          or amenities.
        </p>
      </div>

      {/* Gross-yield context */}
      {grossYield != null && (
        <div className="border border-border rounded-xl p-5 bg-white mb-8">
          <div className="text-xs uppercase tracking-widest text-muted mb-3">
            Rent vs. Home Value
          </div>
          <p className="text-sm text-foreground leading-relaxed">
            A typical 2-bedroom rents for <span className="font-mono">{fmt(panel.fmr2br)}</span>/mo
            in {county.county} against a median home value of{" "}
            <span className="font-mono">{fmt(panel.medianHomeValue!)}</span> — a gross yield of
            about <span className="font-mono">{pct(grossYield)}</span>.
          </p>
        </div>
      )}

      {/* FAQ */}
      <div className="mb-10 pb-6 border-b border-border">
        <div className="text-xs uppercase tracking-widest text-muted mb-4">
          Frequently Asked Questions
        </div>
        <div className="space-y-5">
          {faqs.map((f) => (
            <div key={f.question}>
              <div className="text-sm font-medium text-foreground mb-1">{f.question}</div>
              <p className="text-sm text-muted leading-relaxed">
                {f.answer}{" "}
                {f.linkToCounty && (
                  <Link
                    href={`/us/${stateSlug}/${countySlug}`}
                    className="text-foreground underline underline-offset-2 hover:text-foreground/70 transition-colors"
                  >
                    Full {county.county} market data &rarr;
                  </Link>
                )}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Tools for this market — after the data sections, before the internal
          search box (matches the county page's CTA ordering convention). */}
      <div className="mb-10">
        <PartnerCta
          country="US"
          state={county.state}
          source="rent-page"
          surface="rent-page"
          heading={`Rent tools for ${county.county}`}
          city={county.county}
        />
      </div>

      {/* Internal search box — same destination as the county page's box */}
      <div className="border border-border rounded-xl p-6 mb-10 text-center">
        <p className="text-sm font-medium text-foreground mb-1">
          Own or eyeing a specific {county.county} property?
        </p>
        <p className="text-xs text-muted mb-4 max-w-md mx-auto">
          Get its estimated rent and value, backed by this same county-level data.
        </p>
        <Link
          href="/"
          className="text-xs font-medium text-foreground underline underline-offset-2 hover:text-foreground/70 transition-colors"
        >
          Get its estimated rent and value &rarr;
        </Link>
      </div>

      {/* Cross-links */}
      <div className="mb-8 flex flex-wrap gap-x-6 gap-y-2">
        <Link
          href={`/us/${stateSlug}/${countySlug}`}
          className="text-sm text-foreground hover:underline underline-offset-2 transition-colors"
        >
          Full {county.county} market data &rarr;
        </Link>
        <Link
          href={`/us/rankings/rent-to-price/${stateSlug}`}
          className="text-sm text-foreground hover:underline underline-offset-2 transition-colors"
        >
          Which {county.stateName} counties pass the 1% rule &rarr;
        </Link>
      </div>

      {siblings.length > 0 && (
        <div className="mb-8">
          <div className="text-xs font-medium text-muted uppercase tracking-wide mb-3">
            Rent in other {county.stateName} counties
          </div>
          <div className="flex flex-wrap gap-2">
            {siblings.map((s) => (
              <Link
                key={s.fips}
                href={`/us/${stateSlug}/${s.countySlug}/rent`}
                className="text-xs px-3 py-1.5 border border-border rounded-full text-muted hover:text-foreground hover:border-foreground/20 transition-colors"
              >
                {s.county}
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="text-sm">
        <Link
          href={`/us/${stateSlug}`}
          className="text-foreground hover:underline underline-offset-2 transition-colors"
        >
          All {county.stateName} counties &rarr;
        </Link>
      </div>
    </main>
  );
}
