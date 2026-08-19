import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { BASE_URL, SITE_NAME } from "@/lib/seo";
import { BreadcrumbJsonLd, FaqJsonLd } from "@/components/json-ld";
import PartnerCta from "@/components/partner-cta";
import StatCard from "@/components/stat-card";
import { assertAffiliateHealth } from "@/config/affiliate-vendors";
import { fmt } from "@/lib/utils";
import {
  getCountyBySlug,
  getCountiesByState,
  US_COUNTIES,
  TOP_METRO_FIPS,
} from "@/lib/us-counties";
import {
  getCountyPropertyTaxPanel,
  getStateMedianEffectiveRate,
  getCountyFipsWithPropertyTaxAmong,
  type CountyPropertyTaxPanel,
} from "@/lib/db/property-tax";
import PropertyTaxCalculator from "./property-tax-calculator";

export const revalidate = 86400; // 24h ISR — ACS is an annual data source
// Without generateStaticParams a dynamic segment has no known paths at
// build time, so Next serves it fully server-rendered on every request —
// `revalidate` above is silently inert in that state (measured: uncacheable
// at the edge, x-vercel-cache MISS on every hit — cache investigation,
// 2026-08-19). Seed the same top-metro set /us/[state]/[county]/page.tsx
// prebuilds; dynamicParams keeps every other county rendering on-demand and
// getting cached from its first real hit onward instead of staying dynamic
// forever.
export const dynamicParams = true; // any county not in generateStaticParams renders on-demand

export async function generateStaticParams() {
  return TOP_METRO_FIPS.map((fips) => {
    const county = US_COUNTIES.find((c) => c.fips === fips);
    return county ? { state: county.stateSlug, county: county.countySlug } : null;
  }).filter((p): p is { state: string; county: string } => p !== null);
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** ratio -> "1.12%", 2 decimal places (matches the meta-title spec) */
function ratePct(rate: number): string {
  return (rate * 100).toFixed(2) + "%";
}

/** 5-digit-FIPS-derived 2-digit state FIPS prefix, e.g. "US-06075" -> "06" */
function stateFipsPrefix(countyFips: string): string {
  return countyFips.replace(/^US-/, "").slice(0, 2);
}

async function loadCountyPropertyTax(stateSlug: string, countySlug: string) {
  const county = getCountyBySlug(stateSlug, countySlug);
  if (!county) return null;
  const panel = await getCountyPropertyTaxPanel(county.fips);
  if (!panel) return null; // no median_re_taxes_paid + median_home_value pair on record
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
  const loaded = await loadCountyPropertyTax(stateSlug, countySlug);
  if (!loaded) return {};

  const { county, panel } = loaded;
  const vintage = panel.vintages.median_re_taxes_paid;
  const title = `${county.county}, ${county.state} Property Tax Rate (${vintage}): ${ratePct(panel.effectiveRate)}`;
  const description = `${county.county}, ${county.state} property owners pay an effective tax rate of about ${ratePct(panel.effectiveRate)} — a median annual bill of ${fmt(Math.round(panel.medianReTaxesPaid))} on a median home value of ${fmt(Math.round(panel.medianHomeValue))} (Census ACS, ${vintage}). Calculate your estimated bill.`;
  const url = `${BASE_URL}/us/${stateSlug}/${countySlug}/property-tax`;

  return {
    title,
    description,
    alternates: { canonical: `/us/${stateSlug}/${countySlug}/property-tax` },
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

export default async function CountyPropertyTaxPage({
  params,
}: {
  params: Promise<{ state: string; county: string }>;
}) {
  const { state: stateSlug, county: countySlug } = await params;
  const county = getCountyBySlug(stateSlug, countySlug);
  if (!county) notFound();

  assertAffiliateHealth();

  const panel: CountyPropertyTaxPanel | null = await getCountyPropertyTaxPanel(county.fips);
  if (!panel) notFound();

  const vintage = panel.vintages.median_re_taxes_paid;
  const stateMedianRate = await getStateMedianEffectiveRate(stateFipsPrefix(county.fips));

  const vsStateLabel = (() => {
    if (stateMedianRate == null || stateMedianRate <= 0) return null;
    const diffPct = (panel.effectiveRate / stateMedianRate - 1) * 100;
    if (Math.abs(diffPct) < 1) return `about even with the ${county.stateName} median`;
    const direction = diffPct > 0 ? "above" : "below";
    return `${Math.abs(diffPct).toFixed(0)}% ${direction} the ${county.stateName} median`;
  })();

  const allSiblings = getCountiesByState(stateSlug).filter((c) => c.fips !== county.fips);
  const siblingFips = await getCountyFipsWithPropertyTaxAmong(allSiblings.map((c) => c.fips));
  const siblings = allSiblings.filter((c) => siblingFips.has(c.fips)).slice(0, 5);

  const faqs: { question: string; answer: string; link?: { href: string; label: string } }[] = [
    {
      question: `What is the property tax rate in ${county.county}?`,
      answer: `The effective property tax rate in ${county.county}, ${county.state} is about ${ratePct(panel.effectiveRate)} — meaning a typical owner pays roughly ${ratePct(panel.effectiveRate)} of their home's value in property taxes each year. That works out to a median annual bill of ${fmt(Math.round(panel.medianReTaxesPaid))} on a median home value of ${fmt(Math.round(panel.medianHomeValue))} (Census ACS, ${vintage}).`,
    },
    {
      question: "What is an effective property tax rate, exactly?",
      answer:
        "It's the actual annual tax bill divided by the home's market value — a real-world, apples-to-apples number, as opposed to a jurisdiction's official mill rate or nominal rate, which gets applied to an assessed value that's often a different number than market value. Effective rate is the figure that lets you compare tax burden across counties and states fairly.",
    },
    {
      question: "Why might my actual bill differ from this estimate?",
      answer:
        "Three things commonly cause a gap: assessment ratios (many counties tax a fraction of market value, not the full amount), exemptions (homestead, senior, veteran, and other exemptions reduce the taxable value for eligible owners), and local mill rates (the tax rate itself varies by city, school district, and special taxing districts within the same county). This page's figure is a county-wide median from Census survey data, not a parcel-specific calculation — think of it as a reliable starting point, not your actual bill.",
    },
    {
      question: `Is my ${county.county} assessment too high?`,
      answer:
        "If your assessed value looks out of line with what similar homes nearby are actually worth, it's worth checking — an inflated assessment means you're overpaying in taxes every year until it's corrected.",
      link: { href: "/tools/appeal-checker", label: `Check your ${county.county} assessment in 30 seconds` },
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
          { name: "Property Tax", url: `${BASE_URL}/us/${stateSlug}/${countySlug}/property-tax` },
        ]}
      />
      <FaqJsonLd questions={faqs.map((f) => ({ question: f.question, answer: f.answer }))} />

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
        <span className="text-foreground">Property Tax</span>
      </div>

      <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-1">
        Property Taxes in {county.county}, {county.state}
      </h1>
      <p className="text-sm text-muted mb-8">
        Effective property tax rate, median annual bill, and a calculator for{" "}
        {county.county}, {county.stateName} — sourced from Census ACS survey data.
      </p>

      {/* Hero stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
        <StatCard
          label="Effective Tax Rate"
          value={ratePct(panel.effectiveRate)}
          sub="of home value, per year"
          vintage={vintage}
        />
        <StatCard
          label="Median Annual Bill"
          value={fmt(Math.round(panel.medianReTaxesPaid))}
          sub={`${fmt(Math.round(panel.medianReTaxesPaid / 12))}/mo equivalent`}
          vintage={vintage}
        />
        <StatCard
          label="vs. State Median"
          value={vsStateLabel ? (panel.effectiveRate >= (stateMedianRate ?? 0) ? "Higher" : "Lower") : "—"}
          sub={vsStateLabel ?? "no state comparison available"}
        />
      </div>

      {/* Mini calculator */}
      <div className="mb-8">
        <PropertyTaxCalculator
          countyName={county.county}
          effectiveRate={panel.effectiveRate}
          defaultValue={panel.medianHomeValue}
        />
      </div>

      {/* Plain-language explainer */}
      <div className="mb-8 space-y-4 text-sm text-muted leading-relaxed">
        <p>
          The <span className="text-foreground font-medium">effective tax rate</span> is simply
          the median annual property tax bill divided by the median home value — in{" "}
          {county.county}, that&apos;s {fmt(Math.round(panel.medianReTaxesPaid))} divided by{" "}
          {fmt(Math.round(panel.medianHomeValue))}, or {ratePct(panel.effectiveRate)}. It&apos;s the
          most useful number for comparing tax burden across counties, because it&apos;s based on
          what people actually pay relative to what their home is actually worth.
        </p>
        <p>
          Your own bill can differ from this estimate for a few reasons. Some counties only tax a
          percentage of a home&apos;s market value (its &ldquo;assessment ratio&rdquo;), not the full
          amount. Homestead, senior, veteran, and other exemptions can lower the taxable value for
          eligible owners. And the actual rate applied — often called a &ldquo;mill rate&rdquo;
          (dollars of tax per $1,000 of assessed value) — varies by city, school district, and any
          special taxing districts a specific property sits inside, even within the same county.
        </p>
        <p>
          Use the figures on this page as a reliable starting estimate — for an exact number, check
          your county assessor&apos;s office or a recent tax bill for the specific property.
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
              <p className="text-sm text-muted leading-relaxed">
                {f.answer}{" "}
                {f.link && (
                  <Link
                    href={f.link.href}
                    className="text-foreground underline underline-offset-2 hover:text-foreground/70 transition-colors"
                  >
                    {f.link.label} &rarr;
                  </Link>
                )}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Funnel: calculator surface prioritizes tax-appeal first */}
      <div className="mb-6">
        <PartnerCta
          country="US"
          state={county.state}
          source="county-page"
          surface="calculator"
          heading="Lower your property costs"
          city={county.county}
        />
      </div>

      {/* Internal appeal-checker box */}
      <div className="border border-border rounded-xl p-6 mb-10 text-center">
        <p className="text-sm font-medium text-foreground mb-1">
          Think your assessment is too high?
        </p>
        <p className="text-xs text-muted mb-4 max-w-md mx-auto">
          If your {county.county} assessment looks out of line with comparable homes, you may be
          overpaying every year until it&apos;s corrected.
        </p>
        <Link
          href="/tools/appeal-checker"
          className="text-xs font-medium text-foreground underline underline-offset-2 hover:text-foreground/70 transition-colors"
        >
          Check in 30 seconds &rarr;
        </Link>
      </div>

      {/* Internal search box — same destination convention as sibling county pages */}
      <div className="border border-border rounded-xl p-6 mb-10 text-center">
        <p className="text-sm font-medium text-foreground mb-1">
          Own or eyeing a specific {county.county} property?
        </p>
        <p className="text-xs text-muted mb-4 max-w-md mx-auto">
          Get its estimated value and offer range, backed by this same county-level data.
        </p>
        <Link
          href="/"
          className="text-xs font-medium text-foreground underline underline-offset-2 hover:text-foreground/70 transition-colors"
        >
          Get its estimated value &rarr;
        </Link>
      </div>

      {/* Cross-links */}
      <div className="mb-3 flex flex-wrap gap-x-6 gap-y-2">
        <Link
          href={`/us/${stateSlug}/${countySlug}`}
          className="text-sm text-foreground hover:underline underline-offset-2 transition-colors"
        >
          Full {county.county} market data &rarr;
        </Link>
        <Link
          href={`/us/${stateSlug}/${countySlug}/rent`}
          className="text-sm text-foreground hover:underline underline-offset-2 transition-colors"
        >
          {county.county} rent data &rarr;
        </Link>
      </div>

      {siblings.length > 0 && (
        <div className="mb-8 mt-5">
          <div className="text-xs font-medium text-muted uppercase tracking-wide mb-3">
            Property tax in other {county.stateName} counties
          </div>
          <div className="flex flex-wrap gap-2">
            {siblings.map((s) => (
              <Link
                key={s.fips}
                href={`/us/${stateSlug}/${s.countySlug}/property-tax`}
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
