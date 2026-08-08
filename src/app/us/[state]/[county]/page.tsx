import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { BASE_URL, SITE_NAME } from "@/lib/seo";
import { BreadcrumbJsonLd } from "@/components/json-ld";
import PartnerCta from "@/components/partner-cta";
import { assertAffiliateHealth } from "@/config/affiliate-vendors";
import { fmt, pct } from "@/lib/utils";
import {
  getCountyBySlug,
  getCountiesByState,
  US_COUNTIES,
  TOP_METRO_FIPS,
} from "@/lib/us-counties";
import { getCountyMarketPanel, type CountyMarketPanel } from "@/lib/db/regional-econ";

export const revalidate = 86400; // 24h ISR
export const dynamicParams = true; // any county not in generateStaticParams renders on-demand

export async function generateStaticParams() {
  return TOP_METRO_FIPS.map((fips) => {
    const county = US_COUNTIES.find((c) => c.fips === fips);
    return county ? { state: county.stateSlug, county: county.countySlug } : null;
  }).filter((p): p is { state: string; county: string } => p !== null);
}

// ---------------------------------------------------------------------------
// Shared small helpers
// ---------------------------------------------------------------------------

const HAZARD_LABELS: Record<string, string> = {
  avln: "Avalanche",
  cfld: "Coastal Flooding",
  cwav: "Cold Wave",
  drgt: "Drought",
  erqk: "Earthquake",
  hail: "Hail",
  hwav: "Heat Wave",
  hrcn: "Hurricane",
  istm: "Ice Storm",
  ifld: "Riverine Flooding",
  lnds: "Landslide",
  ltng: "Lightning",
  swnd: "Strong Wind",
  trnd: "Tornado",
  tsun: "Tsunami",
  vlcn: "Volcanic Activity",
  wfir: "Wildfire",
  wntw: "Winter Weather",
};

function femaRiskBand(score: number): { label: string; blurb: string } {
  if (score >= 80) return { label: "Very High", blurb: "among the highest-risk counties nationally" };
  if (score >= 60) return { label: "Relatively High", blurb: "higher composite risk than most US counties" };
  if (score >= 40) return { label: "Relatively Moderate", blurb: "roughly average composite risk nationally" };
  if (score >= 20) return { label: "Relatively Low", blurb: "lower composite risk than most US counties" };
  return { label: "Very Low", blurb: "among the lowest-risk counties nationally" };
}

function StatCard({
  label,
  value,
  sub,
  vintage,
}: {
  label: string;
  value: string;
  sub?: string;
  vintage?: number;
}) {
  return (
    <div className="border border-border rounded-xl p-4 bg-white">
      <div className="text-xs uppercase tracking-widest text-muted mb-2">{label}</div>
      <div className="font-mono text-xl font-semibold">{value}</div>
      {sub && <div className="text-xs text-muted mt-1">{sub}</div>}
      {vintage && <div className="text-xs text-muted/60 mt-1">{vintage} data</div>}
    </div>
  );
}

function fmrLabel(n: number | null): string {
  return n != null ? fmt(n) + "/mo" : "—";
}

async function loadCounty(stateSlug: string, countySlug: string) {
  const county = getCountyBySlug(stateSlug, countySlug);
  if (!county) return null;
  const panel = await getCountyMarketPanel(county.fips);
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
  const loaded = await loadCounty(stateSlug, countySlug);
  if (!loaded) return {};

  const { county, panel } = loaded;
  const title = `${county.county}, ${county.state} Housing Market: Home Values, Rents & Risk`;

  let description = `${county.county}, ${county.stateName} housing market data: home values, rents, price trends, and FEMA risk — sourced from Census ACS, FHFA, and FEMA.`;
  if (panel?.medianHomeValue != null) {
    const rentPart = panel.medianGrossRent != null ? ` and median rent ${fmt(panel.medianGrossRent)}/mo` : "";
    description = `${county.county}, ${county.state} median home value is ${fmt(panel.medianHomeValue)}${rentPart} (${panel.vintages["median_home_value"]} ACS). See price trends, vacancy, income, and FEMA risk data.`;
  }

  const url = `${BASE_URL}/us/${stateSlug}/${countySlug}`;

  return {
    title,
    description,
    alternates: { canonical: `/us/${stateSlug}/${countySlug}` },
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

export default async function CountyPage({
  params,
}: {
  params: Promise<{ state: string; county: string }>;
}) {
  const { state: stateSlug, county: countySlug } = await params;
  const county = getCountyBySlug(stateSlug, countySlug);
  if (!county) notFound();

  assertAffiliateHealth();

  const panel: CountyMarketPanel | null = await getCountyMarketPanel(county.fips);
  // Registry entry exists but no regional_econ rows for it — treat as missing,
  // not a broken page (shouldn't normally happen since the registry is built
  // from regional_econ itself, but guards against a stale JSON file).
  if (!panel) notFound();

  const siblings = getCountiesByState(stateSlug)
    .filter((c) => c.fips !== county.fips)
    .slice(0, 5);

  const hasHero =
    panel.medianHomeValue != null ||
    panel.medianGrossRent != null ||
    panel.vacancyRate != null ||
    panel.medianHouseholdIncome != null;
  const hasHpi = panel.hpiLatest != null;
  const hasFema = panel.femaRiskScore != null;
  const hasFmr = [panel.fmrStudio, panel.fmr1br, panel.fmr2br, panel.fmr3br, panel.fmr4br].some(
    (v) => v != null
  );
  const topHazards = Object.entries(panel.femaHazardScores)
    .filter(([, v]) => v != null)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  const sourcesUsed = new Set<string>();
  if (hasHero) sourcesUsed.add(`US Census ACS 5-Year Estimates (${panel.vintages["median_home_value"] ?? panel.vintages["median_household_income"] ?? ""})`);
  if (hasHpi) sourcesUsed.add(`FHFA All-Transactions House Price Index (${panel.vintages["hpi"]})`);
  if (hasFema) sourcesUsed.add(`FEMA National Risk Index (${panel.vintages["fema_risk_score"]})`);
  if (hasFmr) {
    const fmrVintage =
      panel.vintages["fmr_2br"] ?? panel.vintages["fmr_1br"] ?? panel.vintages["fmr_studio"];
    sourcesUsed.add(`HUD Fair Market Rents (${fmrVintage})`);
  }

  return (
    <main className="max-w-3xl mx-auto px-6 py-10">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", url: BASE_URL },
          { name: "US Markets", url: `${BASE_URL}/us` },
          { name: county.stateName, url: `${BASE_URL}/us/${stateSlug}` },
          { name: county.county, url: `${BASE_URL}/us/${stateSlug}/${countySlug}` },
        ]}
      />

      <div className="text-xs text-muted mb-6">
        <Link href="/us" className="hover:text-foreground transition-colors">
          US Markets
        </Link>
        <span className="mx-1.5">/</span>
        <Link href={`/us/${stateSlug}`} className="hover:text-foreground transition-colors">
          {county.stateName}
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-foreground">{county.county}</span>
      </div>

      <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-1">
        {county.county}, {county.stateName} Housing Market Data
      </h1>
      <p className="text-sm text-muted mb-8">
        Government-sourced home values, rents, price trends, and hazard risk for{" "}
        {county.county}, {county.state}.
      </p>

      {/* Hero stat row */}
      {hasHero && (
        <div className="grid grid-cols-2 gap-3 mb-8">
          {panel.medianHomeValue != null && (
            <StatCard
              label="Median Home Value"
              value={fmt(panel.medianHomeValue)}
              vintage={panel.vintages["median_home_value"]}
            />
          )}
          {panel.medianGrossRent != null && (
            <StatCard
              label="Median Gross Rent"
              value={fmt(panel.medianGrossRent) + "/mo"}
              vintage={panel.vintages["median_gross_rent"]}
            />
          )}
          {panel.vacancyRate != null && (
            <StatCard
              label="Vacancy Rate"
              value={pct(panel.vacancyRate)}
              vintage={panel.vintages["vacancy_rate"]}
            />
          )}
          {panel.medianHouseholdIncome != null && (
            <StatCard
              label="Median Household Income"
              value={fmt(panel.medianHouseholdIncome)}
              vintage={panel.vintages["median_household_income"]}
            />
          )}
        </div>
      )}

      {/* HPI */}
      {hasHpi && (
        <div className="border border-border rounded-xl p-5 bg-white mb-6">
          <div className="text-xs uppercase tracking-widest text-muted mb-3">
            Home Price Trend
          </div>
          <div className="flex items-baseline gap-3 mb-2">
            <span className="font-mono text-2xl font-semibold">{panel.hpiLatest!.toFixed(1)}</span>
            <span className="text-xs text-muted">
              FHFA House Price Index &middot; {panel.vintages["hpi"]}
            </span>
          </div>
          {panel.hpiTrend5y != null ? (
            <p className="text-sm text-muted leading-relaxed">
              Home prices in {county.county} have{" "}
              {panel.hpiTrend5y >= 0 ? (
                <span className="text-foreground font-medium">
                  risen about {pct(Math.abs(panel.hpiTrend5y))}
                </span>
              ) : (
                <span className="text-foreground font-medium">
                  fallen about {pct(Math.abs(panel.hpiTrend5y))}
                </span>
              )}{" "}
              over roughly the past five years, based on FHFA&apos;s repeat-sales
              index for this county.
            </p>
          ) : (
            <p className="text-sm text-muted leading-relaxed">
              Not enough historical index data to compute a five-year trend for
              this county yet.
            </p>
          )}
        </div>
      )}

      {/* FEMA risk */}
      {hasFema && (
        <div className="border border-border rounded-xl p-5 bg-white mb-6">
          <div className="text-xs uppercase tracking-widest text-muted mb-3">
            Natural Hazard Risk
          </div>
          <div className="flex items-baseline gap-3 mb-2">
            <span className="font-mono text-2xl font-semibold">
              {panel.femaRiskScore!.toFixed(1)}
              <span className="text-sm text-muted font-sans">/100</span>
            </span>
            <span className="text-xs text-muted">
              FEMA National Risk Index &middot; {panel.vintages["fema_risk_score"]}
            </span>
          </div>
          <p className="text-sm text-muted leading-relaxed">
            {county.county}&apos;s composite risk score is{" "}
            <span className="text-foreground font-medium">
              {femaRiskBand(panel.femaRiskScore!).label}
            </span>{" "}
            — {femaRiskBand(panel.femaRiskScore!).blurb}, per FEMA&apos;s National
            Risk Index (which combines expected annual loss, social
            vulnerability, and community resilience across 18 natural hazards).
            {panel.femaEalScore != null && (
              <> Expected Annual Loss score: {panel.femaEalScore.toFixed(1)}/100.</>
            )}
          </p>
          {topHazards.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {topHazards.map(([hazard, score]) => (
                <span
                  key={hazard}
                  className="text-[10px] px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full"
                >
                  {HAZARD_LABELS[hazard] ?? hazard} &middot; {score.toFixed(0)}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* FMR by bedroom */}
      {hasFmr && (
        <div className="border border-border rounded-xl p-5 bg-white mb-6">
          <div className="text-xs uppercase tracking-widest text-muted mb-3">
            HUD Fair Market Rent by Bedroom Count
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
            <div>
              <div className="text-muted text-xs">Studio</div>
              <div className="font-mono font-medium">{fmrLabel(panel.fmrStudio)}</div>
            </div>
            <div>
              <div className="text-muted text-xs">1BR</div>
              <div className="font-mono font-medium">{fmrLabel(panel.fmr1br)}</div>
            </div>
            <div>
              <div className="text-muted text-xs">2BR</div>
              <div className="font-mono font-medium">{fmrLabel(panel.fmr2br)}</div>
            </div>
            <div>
              <div className="text-muted text-xs">3BR</div>
              <div className="font-mono font-medium">{fmrLabel(panel.fmr3br)}</div>
            </div>
            <div>
              <div className="text-muted text-xs">4BR</div>
              <div className="font-mono font-medium">{fmrLabel(panel.fmr4br)}</div>
            </div>
          </div>
        </div>
      )}

      {/* Methodology note */}
      {sourcesUsed.size > 0 && (
        <p className="text-xs text-muted/70 leading-relaxed mb-10 pb-6 border-b border-border">
          Data sources: {Array.from(sourcesUsed).join(" · ")}. Figures are
          county-level aggregates, not specific to any individual property —
          use them as market context, not a substitute for a property-level
          estimate.
        </p>
      )}

      {/* CTA */}
      <div className="border border-border rounded-xl p-6 mb-10 text-center">
        <p className="text-sm font-medium text-foreground mb-1">
          Looking at a specific {county.county} property?
        </p>
        <p className="text-xs text-muted mb-4 max-w-md mx-auto">
          Get a modeled estimate for a specific {county.county} address, backed
          by this same county-level data.
        </p>
        <Link
          href="/"
          className="text-xs font-medium text-foreground underline underline-offset-2 hover:text-foreground/70 transition-colors"
        >
          Get a modeled estimate &rarr;
        </Link>
      </div>

      <div className="mb-10">
        <PartnerCta country="US" state={county.state} source="county-page" city={county.county} />
      </div>

      {/* Internal links: siblings + tools */}
      {siblings.length > 0 && (
        <div className="mb-8">
          <div className="text-xs font-medium text-muted uppercase tracking-wide mb-3">
            Other {county.stateName} counties
          </div>
          <div className="flex flex-wrap gap-2">
            {siblings.map((s) => (
              <Link
                key={s.fips}
                href={`/us/${stateSlug}/${s.countySlug}`}
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
          href="/tools/assessment-gap"
          className="text-foreground hover:underline underline-offset-2 transition-colors"
        >
          Try the Assessment Gap Calculator &rarr;
        </Link>
      </div>
    </main>
  );
}
