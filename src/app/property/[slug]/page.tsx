import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getListingBySlug } from "@/lib/kv/listings";
import { analyzeListingAsync } from "@/lib/analyze";
import { AnchorPlausibility, Assessment, Listing, OfferResult, PrecomputedOffer } from "@/lib/types";
import { cityToSlug, fmt, pct, slugify } from "@/lib/utils";
import { BASE_URL } from "@/lib/seo";
import { PropertyJsonLd, BreadcrumbJsonLd } from "@/components/json-ld";
import TierBadge from "@/components/tier-badge";
import ExpandableSection from "@/components/expandable-section";
import TrackView from "@/components/track-view";
import PartnerCta from "@/components/partner-cta";
import PartnerCtaRow from "@/components/partner-cta-row";
import { assertAffiliateHealth } from "@/config/affiliate-vendors";
import { isUSState } from "@/lib/assessment/us";
import type {
  UsAdvantageBundle,
  EquityTenureSignal,
  ValuationTriangulation,
  InvestorYield,
  RiskMomentumContext,
  OverAssessmentFlag,
} from "@/lib/pipeline/us-advantage";
// Value (not type-only) import: the CA Investor Yield card below reuses this
// pure function (gross yield / 1%-rule math has no country-specific logic —
// it's just price + monthly rent in, a verdict out). us-advantage.ts's own
// imports are all `import type`, so this pulls in zero RentCast runtime code
// — safe for the CA path, which must make zero RentCast calls.
import { computeInvestorYield } from "@/lib/pipeline/us-advantage";
import { getCmaFipsForCity, getCmaMomentum, getCmaRent, type CmaMomentum } from "@/lib/db/regional-econ";
import type { UsCompSupport } from "@/lib/pipeline/us-assess";
import { AssessmentJourneyPanel } from "@/components/assessment-journey";
import { parseAssessmentGoal, parseSubjectScope } from "@/lib/property-intelligence/journey";

// ISR: serve cached page for 10 minutes, revalidate in background
export const revalidate = 600;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const listing = await getListingBySlug(slug);
  if (!listing) return { title: "Property Not Found" };

  const price = `$${(listing.price / 1000).toFixed(0)}K`;
  const title = `${listing.address}, ${listing.city} ${listing.province} — ${price}`;
  const description = `Property analysis for ${listing.address} in ${listing.city}, ${listing.province}. ${listing.beds} bed, ${listing.baths} bath. Listed at ${fmt(listing.price)}. Get assessment data, offer modeling, and seller motivation signals.`;
  const url = `${BASE_URL}/property/${slug}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      type: "article",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

function ScoreBreakdown({ breakdown }: { breakdown: Record<string, number> }) {
  const entries = Object.entries(breakdown).sort((a, b) => b[1] - a[1]);
  return (
    <div className="space-y-1.5">
      {entries.map(([label, pts]) => (
        <div key={label} className="flex items-center justify-between text-sm">
          <span className="text-muted">{label}</span>
          <span className="font-mono font-medium">+{pts}</span>
        </div>
      ))}
    </div>
  );
}

function OfferCascade({ offer }: { offer: OfferResult }) {
  const isLanguage = offer.anchorType === "language";
  const steps = [
    {
      num: 1,
      title: isLanguage ? "Language Anchor" : "Assessment Anchor",
      value: fmt(offer.anchor),
      detail: offer.anchorTag,
      sub: isLanguage ? "Based on listing signals and market duration" : `List/Assessed: ${offer.listToAssessedRatio.toFixed(2)}x`,
      color: isLanguage ? "border-indigo-200 bg-indigo-50" : "border-blue-200 bg-blue-50",
    },
    {
      num: 2,
      title: "DOM Adjustment",
      value: fmt(offer.domAdjusted),
      detail: offer.domTag,
      sub: `Multiplier: ${offer.domMultiplier}x`,
      color: "border-amber-200 bg-amber-50",
    },
    {
      num: 3,
      title: "Signal Stack",
      value: fmt(offer.signalAdjusted),
      detail: offer.signalTags.length > 0 ? offer.signalTags.join(", ") : "No signals",
      sub: "",
      color: "border-purple-200 bg-purple-50",
    },
    {
      num: 4,
      title: "Final Offer",
      value: fmt(offer.finalOffer),
      detail: `${pct(offer.percentOfList)} of list`,
      sub: `Save ${fmt(offer.savings)}`,
      color: "border-green-200 bg-green-50",
    },
  ];

  return (
    <div className="space-y-3">
      {steps.map((step) => (
        <div key={step.num} className={`border rounded-xl p-4 ${step.color}`}>
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xs text-muted font-medium mb-0.5">Step {step.num}</div>
              <div className="text-sm font-semibold">{step.title}</div>
              <div className="text-xs text-muted mt-1">{step.detail}</div>
              {step.sub && <div className="text-xs text-muted">{step.sub}</div>}
            </div>
            <div className="font-mono text-lg font-semibold">{step.value}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function domColor(dom: number): string {
  if (dom >= 90) return "bg-red-500";
  if (dom >= 45) return "bg-amber-500";
  return "bg-green-500";
}

// ---------------------------------------------------------------------------
// Canada Advantage — CMHC rent / StatCan NHPI cards (src/lib/db/regional-econ.ts)
//
// Mirrors the US Advantage cards' visual style (UsInvestorYieldCard /
// UsRiskMomentumCard further below) but built on CA's own data: CMHC's
// Rental Market Survey average rent by bedroom count, and StatCan's New
// Housing Price Index. Both cards hide gracefully (return null) when the
// listing's city has no mapped CMA or the CMA has no data on record yet —
// this is a coverage layer for the 8 CMAs the CA pipeline currently
// operates in, not a guarantee for every CA listing.
// ---------------------------------------------------------------------------

/** Nearest CMHC bedroom bucket for a listing's bed count (Listing.beds is a
 * free-form string, e.g. "3", "3.5") — 0=studio, 3="3 Bedroom +" (CMHC's own
 * top bucket, see regional-econ.ts's cmaRentMetric). */
function bedsForCmaRent(beds: string): number {
  const parsed = Math.round(parseFloat(beds));
  if (!Number.isFinite(parsed)) return 2; // most-common rental size as a fallback
  return Math.max(0, Math.min(3, parsed));
}

function CaInvestorYieldCard({
  investorYield,
  cmaName,
  rentVintage,
}: {
  investorYield: InvestorYield | null;
  cmaName: string;
  rentVintage: number;
}) {
  if (!investorYield) return null;
  return (
    <div className="border border-border rounded-xl p-4 bg-white">
      <div className="text-xs uppercase tracking-widest text-muted mb-3">Investor Yield</div>
      <p className="text-sm text-foreground leading-relaxed">{investorYield.verdict}</p>
      <p className="text-xs text-muted/70 pt-2 mt-2 border-t border-border">
        Modeled from CMHC&apos;s {rentVintage} Rental Market Survey average rent for the {cmaName} CMA — not
        property-specific. Treat as an estimate, not a rent guarantee.
      </p>
    </div>
  );
}

function caMomentumNote(momentum: CmaMomentum, cmaName: string): string {
  const parts: string[] = [];
  if (momentum.trend12moPct != null) {
    const pct = momentum.trend12moPct * 100;
    const dir = pct > 1 ? "rising" : pct < -1 ? "falling" : "roughly flat";
    parts.push(
      `New-construction home prices in the ${cmaName} CMA are ${dir} — ${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% over the past 12 months`
    );
  }
  if (momentum.trend36moPct != null) {
    const pct36 = momentum.trend36moPct * 100;
    parts.push(`${pct36 >= 0 ? "+" : ""}${pct36.toFixed(1)}% over the past 3 years`);
  }
  if (parts.length === 0) return `No StatCan New Housing Price Index trend available yet for the ${cmaName} CMA.`;
  return parts.join("; ") + ".";
}

function CaMarketMomentumCard({ momentum, cmaName }: { momentum: CmaMomentum | null; cmaName: string }) {
  if (!momentum) return null;
  return (
    <div className="border border-border rounded-xl p-4 bg-white">
      <div className="text-xs uppercase tracking-widest text-muted mb-3">Market Momentum</div>
      <p className="text-sm text-foreground leading-relaxed">{caMomentumNote(momentum, cmaName)}</p>
      <p className="text-xs text-muted/70 pt-2 mt-2 border-t border-border">
        StatCan New Housing Price Index ({momentum.nhpiVintage.year}-
        {String(momentum.nhpiVintage.month).padStart(2, "0")}) for the {cmaName} CMA — tracks new-construction
        pricing, not resale comparables. Directional context only.
      </p>
    </div>
  );
}

export default async function PropertyPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const listing = await getListingBySlug(slug);
  if (!listing) notFound();

  const queryValue = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
  const assessmentOrigin = queryValue(query.assessmentOrigin) === "1";
  const journeyEnabled = assessmentOrigin && (
    process.env.PROPERTY_JOURNEYS_ENABLED === "true" || queryValue(query.journeys) === "1"
  );
  const assessmentGoal = parseAssessmentGoal(queryValue(query.assessmentGoal));
  const confirmedSubjectScope = parseSubjectScope(queryValue(query.subjectScope));

  // US listings (US Discover cron — src/lib/pipeline/us-discover.ts) go
  // through an entirely separate render path: analyzeListingAsync() below
  // is built around the CA pipeline (Zoocasa assessment lookup, CA offer
  // model) and previously mis-rendered every US listing as a permanent
  // "Generating analysis" placeholder (a US listing always has preSignals
  // set by the Discover scorer, which sent analyzeListingAsync down its
  // "hasPre" fast path — but never had preNarrative, so narrative stayed
  // empty forever). See renderUSPropertyPage() below. The CA path from here
  // down is unchanged.
  if (isUSState(listing.province)) {
    return renderUSPropertyPage(listing, slug);
  }

  assertAffiliateHealth();

  const analysis = await analyzeListingAsync(listing);
  const { assessment, score, offer, signals, llmSignals, llmConfidence, narrative } = analysis;
  const listingHistory = analysis.history;

  // Canada Advantage — CMHC rent / StatCan NHPI context for this listing's
  // CMA, if it's one of the 8 the CA pipeline covers (see
  // src/lib/db/regional-econ.ts's CA_CMA_TARGETS). Both reads are no-ops
  // (return null immediately) when DATABASE_URL isn't configured, so this
  // never blocks rendering — same graceful-degradation shape as the
  // assessment lookup above.
  const caCma = getCmaFipsForCity(listing.city);
  const [caMomentum, caRent] = caCma
    ? await Promise.all([getCmaMomentum(caCma.fips), getCmaRent(caCma.fips, bedsForCmaRent(listing.beds))])
    : [null, null];
  const caInvestorYield = caRent
    ? computeInvestorYield({ priceForYield: listing.price, monthlyRent: caRent.monthlyRent, countyFmr2br: null })
    : null;

  return (
    <main className="max-w-3xl mx-auto px-6 py-6 sm:py-10">
      <PropertyJsonLd
        url={`${BASE_URL}/property/${slugify(listing.address)}`}
        address={listing.address}
        city={listing.city}
        province={listing.province}
        beds={listing.beds}
        baths={listing.baths}
        price={listing.price}
        description={listing.description}
      />
      <BreadcrumbJsonLd
        items={[
          { name: "Home", url: BASE_URL },
          { name: listing.city, url: `${BASE_URL}/dashboard?city=${cityToSlug(listing.city)}` },
          { name: listing.address, url: `${BASE_URL}/property/${slugify(listing.address)}` },
        ]}
      />
      <TrackView slug={slugify(listing.address)} city={listing.city} price={listing.price} />
      <AssessmentJourneyPanel
        enabled={journeyEnabled}
        initialGoal={assessmentGoal}
        country="CA"
        subjectScope={confirmedSubjectScope ?? listing.assessmentSubject?.scope ?? "unknown"}
        capabilities={listing.propertyCapabilities}
        gateUnsupported
      >
      {/* A. Back link */}
      <Link
        href={`/discover/${cityToSlug(listing.city)}`}
        className="text-sm text-muted hover:text-foreground transition-colors"
      >
        &larr; {listing.city}
      </Link>

      {/* B. Header */}
      <div className="mt-6 mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {listing.url ? (
              <a
                href={listing.url}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
              >
                {listing.address}
              </a>
            ) : (
              listing.address
            )}
          </h1>
          <p className="text-sm text-muted mt-0.5">
            {listing.city}, {listing.province}
          </p>
        </div>
        <TierBadge tier={score.tier} />
      </div>

      {/* C. Hero Card — Recommended Offer */}
      <div className="border border-border rounded-xl p-5 sm:p-8 mb-6 text-center bg-white">
        {offer ? (
          <>
            <div className="text-xs uppercase tracking-widest text-muted mb-2">
              {offer.anchorType === "language" ? "Estimated Offer" : "Recommended Offer"}
            </div>
            <div className="text-4xl sm:text-5xl font-mono font-bold mb-2">
              {fmt(offer.finalOffer)}
            </div>
            <div className="text-sm text-green-600 mb-4">
              Save {fmt(offer.savings)} &middot; {pct(offer.percentOfList)} of list
            </div>
            {offer.anchorType === "language" && (
              <p className="text-xs text-muted mb-4 max-w-sm mx-auto">
                Based on listing language and market duration. No government assessment available.
              </p>
            )}
            <div className="border-t border-border pt-4 flex justify-center gap-4 sm:gap-8 text-center">
              <div>
                <div className="text-xs text-muted">List Price</div>
                <div className="font-mono font-medium">{fmt(listing.price)}</div>
              </div>
              {offer.anchorType === "assessment" && (
                <>
                  <div>
                    <div className="text-xs text-muted">Assessed</div>
                    <div className="font-mono font-medium">
                      {assessment ? fmt(assessment.totalValue) : "N/A"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted">Ratio</div>
                    <div className="font-mono font-medium">
                      {offer.listToAssessedRatio.toFixed(2)}x
                    </div>
                  </div>
                </>
              )}
              {offer.anchorType === "language" && (
                <>
                  <div>
                    <div className="text-xs text-muted">Signals</div>
                    <div className="font-mono font-medium">
                      {offer.signalTags.length || "0"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted">DOM</div>
                    <div className="font-mono font-medium">{listing.dom}d</div>
                  </div>
                </>
              )}
            </div>
          </>
        ) : (
          <div className="py-4">
            <div className="text-xs uppercase tracking-widest text-muted mb-2">
              List Price
            </div>
            <div className="font-mono text-4xl sm:text-5xl font-bold mb-3">
              {fmt(listing.price)}
            </div>
          </div>
        )}
      </div>

      {/* D. The Signal — LLM narrative */}
      <div className="bg-gray-50/50 rounded-xl p-6 mb-6">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs uppercase tracking-widest text-muted">The Signal</div>
          {llmConfidence != null && llmConfidence > 0 && (
            <span className="text-xs text-muted font-mono">
              {Math.round(llmConfidence * 100)}% confidence
            </span>
          )}
        </div>
        {narrative ? (
          <div className="space-y-3">
            {narrative.split(/\n\n+/).map((para, i) => (
              <p key={i} className="text-sm text-foreground leading-relaxed">{para.trim()}</p>
            ))}
          </div>
        ) : (
          <p className="text-sm text-foreground leading-relaxed">
            {offer
              ? "Generating analysis — check back shortly."
              : `This ${listing.beds}-bed property in ${listing.city} has been on market for ${listing.dom} days${signals.length > 0 || (llmSignals && llmSignals.length > 0) ? ` with ${(signals.length + (llmSignals?.length ?? 0))} motivation signal${(signals.length + (llmSignals?.length ?? 0)) > 1 ? "s" : ""} detected` : ""}.${score.tier === "HOT" ? " It scores in the HOT tier — worth a closer look." : score.tier === "WARM" ? " It scores in the WARM tier." : " It\u2019s currently in the WATCH tier."}`}
          </p>
        )}
      </div>

      {/* E. Expandable: Offer Cascade */}
      {offer && (
        <div className="mb-4">
          <ExpandableSection title="How we calculated this" defaultOpen={false}>
            <OfferCascade offer={offer} />
          </ExpandableSection>
        </div>
      )}

      {/* F. Expandable: Score Breakdown */}
      <div className="mb-4">
        <ExpandableSection title="Score breakdown" defaultOpen={false}>
          <ScoreBreakdown breakdown={score.breakdown} />
        </ExpandableSection>
      </div>

      {/* G. Bento Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        {/* Property Details */}
        <div className="border border-border rounded-xl p-4 bg-white">
          <div className="text-xs uppercase tracking-widest text-muted mb-3">Property</div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <span className="text-muted text-xs">Beds</span>
              <div className="font-medium">{listing.beds}</div>
            </div>
            <div>
              <span className="text-muted text-xs">Baths</span>
              <div className="font-medium">{listing.baths}</div>
            </div>
            <div>
              <span className="text-muted text-xs">Sqft</span>
              <div className="font-medium">{listing.sqft || "N/A"}</div>
            </div>
            <div>
              <span className="text-muted text-xs">Built</span>
              <div className="font-medium">{listing.yearBuilt || "N/A"}</div>
            </div>
            <div>
              <span className="text-muted text-xs">Lot</span>
              <div className="font-medium">{listing.lotSize || "N/A"}</div>
            </div>
            <div>
              <span className="text-muted text-xs">Taxes</span>
              <div className="font-medium">{listing.taxes || "N/A"}</div>
            </div>
          </div>
          {listing.mlsNumber && (
            <div className="text-xs text-muted mt-3 pt-2 border-t border-border">
              MLS# {listing.mlsNumber}
            </div>
          )}
        </div>

        {/* Assessment */}
        <div className="border border-border rounded-xl p-4 bg-white">
          <div className="text-xs uppercase tracking-widest text-muted mb-3">Assessment</div>
          {assessment ? (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted">Total Value</span>
                <span className="font-mono font-medium">{fmt(assessment.totalValue)}</span>
              </div>
              {assessment.landValue > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted">Land</span>
                  <span className="font-mono">{fmt(assessment.landValue)}</span>
                </div>
              )}
              {assessment.buildingValue > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted">Building</span>
                  <span className="font-mono">{fmt(assessment.buildingValue)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted">Year</span>
                <span>{assessment.assessmentYear}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Source</span>
                <span className="text-xs">
                  {assessment.source === "government" && "Government"}
                  {assessment.source === "cache" && "Government (cached)"}
                  {assessment.source === "tax_reverse" && "Estimated from taxes"}
                  {assessment.source === "area_median" && "Area median"}
                  {!assessment.source && "Government"}
                </span>
              </div>
              {offer && (
                <div className="flex justify-between pt-1 border-t border-border">
                  <span className="text-muted">List/Assessed</span>
                  <span className="font-mono font-medium">{offer.listToAssessedRatio.toFixed(2)}x</span>
                </div>
              )}
              {(assessment.source === "tax_reverse" || assessment.source === "area_median") && (
                <p className="text-xs text-muted/70 pt-1">
                  {assessment.source === "tax_reverse"
                    ? "Estimated from listed property taxes and municipal tax rates. Not a government-verified assessment."
                    : "Based on StatCan city-level median, not property-specific. Treat as approximate."}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted">Assessment not yet cached for this address.</p>
          )}
        </div>

        {/* Comparables */}
        {listing.preComparables && listing.preComparables.confidence !== "none" && (
          <div className="border border-border rounded-xl p-4 bg-white">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs uppercase tracking-widest text-muted">Comparables</div>
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                listing.preComparables.confidence === "high"
                  ? "bg-emerald-100 text-emerald-700"
                  : listing.preComparables.confidence === "medium"
                    ? "bg-amber-100 text-amber-700"
                    : "bg-zinc-100 text-zinc-500"
              }`}>
                {listing.preComparables.confidence === "high"
                  ? "Anchored by comps"
                  : listing.preComparables.confidence === "medium"
                    ? "Supported by similar sales"
                    : "Limited data"}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm mb-3">
              {listing.preComparables.medianSoldToList && (
                <div>
                  <div className="text-muted text-xs">Median sold/list</div>
                  <div className="font-mono font-medium">{(listing.preComparables.medianSoldToList * 100).toFixed(1)}%</div>
                </div>
              )}
              {listing.preComparables.medianPricePerSqft && (
                <div>
                  <div className="text-muted text-xs">Median $/sqft</div>
                  <div className="font-mono font-medium">${listing.preComparables.medianPricePerSqft}</div>
                </div>
              )}
              {listing.preComparables.impliedValue && (
                <div>
                  <div className="text-muted text-xs">Implied value</div>
                  <div className="font-mono font-medium">{fmt(listing.preComparables.impliedValue)}</div>
                </div>
              )}
              {listing.preComparables.impliedValue && (
                <div>
                  <div className="text-muted text-xs">vs list</div>
                  <div className="font-mono font-medium">{((listing.preComparables.impliedValue / listing.price - 1) * 100).toFixed(1)}%</div>
                </div>
              )}
            </div>
            <div className="space-y-2">
              {listing.preComparables.comparables.map((c, i) => (
                <div key={i} className="border border-border/50 rounded-lg p-2.5 text-xs">
                  <div className="flex justify-between items-start mb-1">
                    <span className="font-medium">{c.address}</span>
                    <span className="text-muted ml-2 whitespace-nowrap">{c.distanceKm}km</span>
                  </div>
                  <div className="flex justify-between text-muted">
                    <span>{c.bedrooms}bd{c.sqft ? ` · ${c.sqft}sqft` : ""}{c.eraBucket ? ` · ${c.eraBucket}` : ""}</span>
                    <span className="font-mono">{(c.soldToListRatio * 100).toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between mt-0.5">
                    <span className="text-muted">List {fmt(c.listPrice)}</span>
                    <span className="font-mono font-medium">Sold {fmt(c.soldPrice)}</span>
                  </div>
                </div>
              ))}
            </div>
            {listing.preComparables.compValidation && (
              <div className={`text-xs mt-2 px-2 py-1 rounded ${
                listing.preComparables.compValidation === "confirmed"
                  ? "bg-emerald-50 text-emerald-700"
                  : listing.preComparables.compValidation === "conservative"
                    ? "bg-blue-50 text-blue-700"
                    : "bg-amber-50 text-amber-700"
              }`}>
                {listing.preComparables.compValidation === "confirmed" && "Comps align with offer range"}
                {listing.preComparables.compValidation === "conservative" && "Comps suggest room for deeper discount"}
                {listing.preComparables.compValidation === "aggressive" && "Offer is below comp-implied range"}
              </div>
            )}
            {listing.preComparables.dataGaps.length > 0 && (
              <p className="text-xs text-muted/60 mt-2">
                {listing.preComparables.dataGaps.join(" · ")}
              </p>
            )}
          </div>
        )}

        {/* Market Activity */}
        <div className="border border-border rounded-xl p-4 bg-white">
          <div className="text-xs uppercase tracking-widest text-muted mb-3">Market Activity</div>
          <div className="flex items-center gap-3 mb-3">
            <span className={`w-2.5 h-2.5 rounded-full ${domColor(listing.dom)}`} />
            <span className="font-mono text-2xl font-bold">{listing.dom}</span>
            <span className="text-sm text-muted">days on market</span>
          </div>
          {offer && (
            <div className="text-xs text-muted mb-2">{offer.domTag}</div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {listing.priceReduced && (
              <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full">
                Price reduced
              </span>
            )}
            {listing.estateKeywords && (
              <span className="text-xs px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full">
                Estate sale
              </span>
            )}
            {listing.hasSuite && (
              <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full">
                Suite potential
              </span>
            )}
          </div>
        </div>

        {/* Motivation Signals */}
        <div className="border border-border rounded-xl p-4 bg-white">
          <div className="text-xs uppercase tracking-widest text-muted mb-3">Motivation Signals</div>
          <div className="flex items-center gap-3 mb-3">
            <span className="font-mono text-2xl font-bold">{score.total}</span>
            <span className="text-sm text-muted">/100</span>
            <TierBadge tier={score.tier} />
          </div>
          {(() => {
            // Deduplicate: normalize to lowercase for comparison, keep first occurrence
            const seen = new Set<string>();
            const allSignals: { text: string; isLlm: boolean }[] = [];
            for (const s of signals) {
              const key = s.toLowerCase().trim();
              if (!seen.has(key)) { seen.add(key); allSignals.push({ text: s, isLlm: false }); }
            }
            for (const s of (llmSignals || [])) {
              const key = s.toLowerCase().trim();
              // Also check if deterministic signal already covers this
              const isDupe = seen.has(key) || [...seen].some(k => key.includes(k) || k.includes(key));
              if (!isDupe) { seen.add(key); allSignals.push({ text: s, isLlm: true }); }
            }
            if (allSignals.length === 0) return null;
            return (
              <div className="flex flex-wrap gap-1.5">
                {allSignals.map((s) => (
                  <span
                    key={s.text}
                    title={s.text.length > 40 ? s.text : undefined}
                    className={`text-xs px-2 py-0.5 rounded-full max-w-[200px] truncate ${
                      s.isLlm ? "bg-indigo-100 text-indigo-700" : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {s.text.length > 40 ? s.text.slice(0, 37) + "..." : s.text}
                  </span>
                ))}
              </div>
            );
          })()}
        </div>

        {/* Canada Advantage: Investor Yield + Market Momentum (CMHC rent / StatCan NHPI) */}
        {caCma && (
          <CaInvestorYieldCard investorYield={caInvestorYield} cmaName={caCma.cmaName} rentVintage={caRent?.vintage ?? 0} />
        )}
        {caCma && <CaMarketMomentumCard momentum={caMomentum} cmaName={caCma.cmaName} />}
      </div>

      {/* H. Description */}
      {listing.description && (
        <div className="mb-6">
          <div className="text-xs uppercase tracking-widest text-muted mb-2">Listing Description</div>
          <p className="text-sm text-muted leading-relaxed">{listing.description}</p>
        </div>
      )}

      {/* I. Next Steps */}
      <div className="mb-6">
        <PartnerCta
          country="CA"
          state={listing.province}
          source="property-page"
          surface="result-buyer"
          heading="Act on this analysis"
          propertySlug={slugify(listing.address)}
          city={listing.city}
        />
      </div>

      {/* J. Footer links */}
      {listing.url && (
        <div className="pt-6 border-t border-border flex justify-center">
          <a
            href={listing.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-muted hover:text-foreground transition-colors"
          >
            View on Zoocasa &rarr;
          </a>
        </div>
      )}
      </AssessmentJourneyPanel>
    </main>
  );
}

// ===========================================================================
// US listings — src/lib/pipeline/us-discover.ts / us-enrich.ts
//
// Renders straight from the CACHED Listing, no live calls. Two states:
//   1. Enriched (listing.preNarrative set — see us-enrich.ts) — full offer
//      hero, THE SIGNAL, listing facts, assessment, US Advantage sections
//      (equity/tenure, triangulation, investor yield, risk/momentum,
//      over-assessment), comparables, and the partner CTA.
//   2. Sparse (top-N enrichment budget didn't reach this listing, or
//      RentCast has no record for the address — e.g. new construction)
//      — an honest "limited data" state with a link to run a full
//      on-demand assessment (/assess?address=...), never a fake or
//      indefinitely-pending narrative.
// ===========================================================================

/** Snake_case PrecomputedOffer (KV-persisted) -> camelCase OfferResult for
 * display — mirrors analyze.ts's preOfferToResult() (not exported there;
 * duplicated here rather than touching that CA-owned file).
 *
 * `anchorType` prefers the real anchor-plausibility verdict
 * (src/lib/pipeline/us-assess.ts's assessAnchorPlausibility, persisted as
 * listing.preAnchorDecision) when available: a demoted assessment was
 * re-anchored to the language/DOM model even though `assessment.found` is
 * still true (the assessed value is still real, just not trustworthy as an
 * anchor for THIS listing) — falling back to `assessment?.found` alone
 * would mislabel that offer as assessment-anchored. Older cached listings
 * without preAnchorDecision keep the original heuristic. */
function usOfferResult(pre: PrecomputedOffer, assessment: Assessment | null, anchorDecision?: AnchorPlausibility): OfferResult {
  const isLanguageAnchored = anchorDecision ? anchorDecision.anchorSource === "language" : !assessment?.found;
  return {
    anchor: pre.anchor,
    anchorTag: pre.anchor_tag,
    anchorType: isLanguageAnchored ? "language" : "assessment",
    listToAssessedRatio: pre.ratio,
    domAdjusted: pre.dom_adjusted,
    domMultiplier: pre.dom_mult,
    domTag: pre.dom_tag,
    signalAdjusted: pre.signal_adjusted,
    signalTags: pre.signal_tags,
    finalOffer: pre.final_offer,
    percentOfList: pre.pct_of_list,
    savings: pre.savings,
    inTargetRange: false, // not rendered for US listings
  };
}

function usAssessmentSourceLabel(assessment: Assessment): string {
  // liveCountySource: this assessment came from a real-time county-assessor
  // lookup (src/lib/assessment/us-county's lookupCountyLive, wired into
  // src/lib/pipeline/us-assess.ts's buildUsAssessment), not RentCast's
  // taxAssessments field — see Assessment.liveCountySource's doc comment
  // (src/lib/types.ts) for why the two share source:"government" but
  // aren't equally trustworthy (docs/plans/10-RENTCAST-DATA-QUALITY.md).
  if (assessment.liveCountySource) {
    return assessment.liveCountyValueKind === "market_value"
      ? "County assessor market value (live)"
      : "County tax assessment (live)";
  }
  switch (assessment.source) {
    case "government":
    case "cache":
      return "County tax assessment";
    case "avm":
      return "RentCast AVM estimate (modeled)";
    case "area_median":
      return "County ACS median (not property-specific)";
    default:
      return "County record";
  }
}

function UsAssessmentCard({
  assessment,
  offer,
  anchorDecision,
}: {
  assessment: Assessment | null;
  offer: OfferResult | null;
  anchorDecision?: AnchorPlausibility;
}) {
  return (
    <div className="border border-border rounded-xl p-4 bg-white">
      <div className="text-xs uppercase tracking-widest text-muted mb-3">Assessment</div>
      {assessment ? (
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted">Total Value</span>
            <span className="font-mono font-medium">{fmt(assessment.totalValue)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Year</span>
            <span>{assessment.assessmentYear}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Source</span>
            <span className="text-xs">{usAssessmentSourceLabel(assessment)}</span>
          </div>
          {offer && (
            <div className="flex justify-between pt-1 border-t border-border">
              <span className="text-muted">List/Assessed</span>
              <span className="font-mono font-medium">{offer.listToAssessedRatio.toFixed(2)}x</span>
            </div>
          )}
          {assessment.source === "avm" && (
            <p className="text-xs text-muted/70 pt-1">
              Modeled valuation, not a government-verified tax assessment.
            </p>
          )}
          {assessment.assessmentBasis === "acquisition_value" && (
            <p className="text-xs text-muted/70 pt-1">
              This state assesses on acquisition value (purchase price + a small annual cap), not market
              value — expect it to lag market price by design.
            </p>
          )}
          {anchorDecision?.verdict === "context_only" && (
            <p className="text-xs text-amber-700 pt-1">
              Assessed value appears decoupled from market value — common with agricultural exemptions, assessment
              caps, or partial parcels. Not used as the offer anchor.
            </p>
          )}
          {anchorDecision?.verdict === "anchor" && anchorDecision.reason === "asking_outlier" && (
            <p className="text-xs text-blue-700 pt-1">
              RentCast&apos;s AVM independently backs up this assessed value — the asking price looks like the
              outlier here, not the assessment.
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted">No assessed value on record for this address.</p>
      )}
    </div>
  );
}

function UsPropertyFactsCard({ listing }: { listing: Listing }) {
  return (
    <div className="border border-border rounded-xl p-4 bg-white">
      <div className="text-xs uppercase tracking-widest text-muted mb-3">Property</div>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <span className="text-muted text-xs">Beds</span>
          <div className="font-medium">{listing.beds || "N/A"}</div>
        </div>
        <div>
          <span className="text-muted text-xs">Baths</span>
          <div className="font-medium">{listing.baths || "N/A"}</div>
        </div>
        <div>
          <span className="text-muted text-xs">Sqft</span>
          <div className="font-medium">{listing.sqft || "N/A"}</div>
        </div>
        <div>
          <span className="text-muted text-xs">Built</span>
          <div className="font-medium">{listing.yearBuilt || "N/A"}</div>
        </div>
        <div>
          <span className="text-muted text-xs">Lot</span>
          <div className="font-medium">{listing.lotSize || "N/A"}</div>
        </div>
        <div>
          <span className="text-muted text-xs">Taxes</span>
          <div className="font-medium">{listing.taxes ? `$${listing.taxes}` : "N/A"}</div>
        </div>
      </div>
      {listing.mlsNumber && (
        <div className="text-xs text-muted mt-3 pt-2 border-t border-border">MLS# {listing.mlsNumber}</div>
      )}
    </div>
  );
}

function UsEquityTenureCard({ equitySignal }: { equitySignal: EquityTenureSignal | null }) {
  if (!equitySignal || equitySignal.tier === "moderate_hold") return null;
  return (
    <div className="border border-border rounded-xl p-4 bg-white">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs uppercase tracking-widest text-muted">Seller Equity/Tenure</div>
        <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">{equitySignal.label}</span>
      </div>
      <p className="text-sm text-foreground leading-relaxed">{equitySignal.narrative}</p>
    </div>
  );
}

function UsTriangulationCard({ triangulation }: { triangulation: ValuationTriangulation }) {
  // excludedAnchors was added to ValuationTriangulation after some
  // already-persisted KV listings were seeded — their cached
  // preUsAdvantage.triangulation blob predates the field entirely, so guard
  // rather than assume it's always an array (matches narrative-lint.ts's
  // same defensive treatment of this exact field).
  const excludedAnchors = triangulation.excludedAnchors ?? [];
  if (triangulation.anchors.length === 0 && excludedAnchors.length === 0) return null;
  return (
    <div className="border border-border rounded-xl p-4 bg-white">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs uppercase tracking-widest text-muted">Valuation Triangulation</div>
        <span
          className={`text-xs px-2 py-0.5 rounded-full ${
            triangulation.confidence === "high"
              ? "bg-emerald-100 text-emerald-700"
              : triangulation.confidence === "medium"
                ? "bg-amber-100 text-amber-700"
                : "bg-zinc-100 text-zinc-500"
          }`}
        >
          {triangulation.confidence} confidence
        </span>
      </div>
      <div className="space-y-1.5 mb-2">
        {triangulation.anchors.map((a) => (
          <div key={a.label} className="flex items-center justify-between text-sm">
            <span className="text-muted">{a.label}</span>
            <span className="font-mono font-medium">{fmt(a.value)}</span>
          </div>
        ))}
        {excludedAnchors.map((a) => (
          <div key={`excluded-${a.label}`} className="flex items-center justify-between text-sm text-muted/60">
            <span className="line-through decoration-muted/50">{a.label}</span>
            <span className="font-mono line-through decoration-muted/50">{fmt(a.value)}</span>
            <span className="text-xs ml-2 shrink-0 px-1.5 py-0.5 rounded bg-zinc-100">excluded</span>
          </div>
        ))}
      </div>
      {triangulation.triangulatedValue != null && (
        <div className="flex items-center justify-between text-sm pt-1.5 border-t border-border mb-2">
          <span className="text-muted">Triangulated value</span>
          <span className="font-mono font-semibold">{fmt(triangulation.triangulatedValue)}</span>
        </div>
      )}
      <p className="text-xs text-muted">{triangulation.agreementNote}</p>
    </div>
  );
}

function UsInvestorYieldCard({ investorYield }: { investorYield: InvestorYield | null }) {
  if (!investorYield) return null;
  return (
    <div className="border border-border rounded-xl p-4 bg-white">
      <div className="text-xs uppercase tracking-widest text-muted mb-3">Investor Yield</div>
      <p className="text-sm text-foreground leading-relaxed">{investorYield.verdict}</p>
    </div>
  );
}

function UsRiskMomentumCard({ riskMomentum }: { riskMomentum: RiskMomentumContext }) {
  if (riskMomentum.momentum === "unknown" && riskMomentum.topPerils.length === 0 && !riskMomentum.vacancyElevated) {
    return null;
  }
  return (
    <div className="border border-border rounded-xl p-4 bg-white">
      <div className="text-xs uppercase tracking-widest text-muted mb-3">County Risk &amp; Momentum</div>
      <p className="text-sm text-foreground leading-relaxed">{riskMomentum.note}</p>
    </div>
  );
}

function UsOverAssessmentCallout({ overAssessment }: { overAssessment: OverAssessmentFlag }) {
  if (!overAssessment.triggered || !overAssessment.note) return null;
  return (
    <div className="border border-amber-200 bg-amber-50 rounded-xl p-4 text-sm text-amber-800 mb-6">
      {overAssessment.note}
    </div>
  );
}

function UsComparablesCard({ comparables }: { comparables: UsCompSupport }) {
  if (comparables.confidence === "none" || comparables.comparables.length === 0) return null;
  return (
    <div className="border border-border rounded-xl p-4 bg-white">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs uppercase tracking-widest text-muted">Comparables</div>
        <span
          className={`text-xs px-2 py-0.5 rounded-full ${
            comparables.confidence === "high"
              ? "bg-emerald-100 text-emerald-700"
              : comparables.confidence === "medium"
                ? "bg-amber-100 text-amber-700"
                : "bg-zinc-100 text-zinc-500"
          }`}
        >
          {comparables.confidence === "high" ? "Anchored by comps" : comparables.confidence === "medium" ? "Supported by similar sales" : "Limited data"}
        </span>
      </div>
      <p className="text-xs text-muted mb-3">{comparables.marketNote}</p>
      <div className="space-y-2">
        {comparables.comparables.slice(0, 5).map((c, i) => (
          <div key={i} className="border border-border/50 rounded-lg p-2.5 text-xs">
            <div className="flex justify-between items-start mb-1">
              <span className="font-medium">{c.address || "Comparable property"}</span>
              {c.distanceMi != null && <span className="text-muted ml-2 whitespace-nowrap">{c.distanceMi.toFixed(1)}mi</span>}
            </div>
            <div className="flex justify-between text-muted">
              <span>
                {c.beds ?? "?"}bd{c.sqft ? ` · ${c.sqft}sqft` : ""}
              </span>
              {c.price != null && <span className="font-mono font-medium text-foreground">{fmt(c.price)}</span>}
            </div>
          </div>
        ))}
      </div>
      {comparables.dataGaps.length > 0 && <p className="text-xs text-muted/60 mt-2">{comparables.dataGaps.join(" · ")}</p>}
    </div>
  );
}

/** Honest "not enough data yet" state for a US listing the top-N enrichment
 * budget hasn't reached (or RentCast has no record for) — a link to a full
 * on-demand assessment, never an indefinite "generating" placeholder. */
function renderUSSparseListing(listing: Listing, slug: string) {
  const fullAddress = `${listing.address}, ${listing.city}, ${listing.province}`;
  const assessUrl = `/assess?address=${encodeURIComponent(fullAddress)}`;

  return (
    <main className="max-w-3xl mx-auto px-6 py-6 sm:py-10">
      <PropertyJsonLd
        url={`${BASE_URL}/property/${slug}`}
        address={listing.address}
        city={listing.city}
        province={listing.province}
        beds={listing.beds}
        baths={listing.baths}
        price={listing.price}
        description={listing.description}
      />
      <TrackView slug={slug} city={listing.city} price={listing.price} />

      <Link
        href={`/discover/${cityToSlug(listing.city)}`}
        className="text-sm text-muted hover:text-foreground transition-colors"
      >
        &larr; {listing.city}
      </Link>

      <div className="mt-6 mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">{listing.address}</h1>
        <p className="text-sm text-muted mt-0.5">
          {listing.city}, {listing.province}
        </p>
      </div>

      <div className="border border-border rounded-xl p-5 sm:p-8 mb-6 text-center bg-white">
        <div className="text-xs uppercase tracking-widest text-muted mb-2">List Price</div>
        <div className="font-mono text-4xl sm:text-5xl font-bold mb-3">{fmt(listing.price)}</div>
        <div className="text-sm text-muted">
          {listing.beds || "?"} bed / {listing.baths || "?"} bath{listing.sqft ? ` · ${listing.sqft} sqft` : ""} ·{" "}
          {listing.dom}d on market
        </div>
      </div>

      <div className="mb-6">
        <PartnerCtaRow country="US" state={listing.province} source="property-page" surface="result-buyer" propertySlug={slug} city={listing.city} />
      </div>

      <div className="bg-gray-50/50 rounded-xl p-6 mb-6">
        <div className="text-xs uppercase tracking-widest text-muted mb-2">Limited Data</div>
        <p className="text-sm text-foreground leading-relaxed mb-4">
          We haven&apos;t run a full assessment on this address yet — tax records, valuation triangulation, and a
          written analysis aren&apos;t available for it from the batch scan that surfaced it. Run a full
          on-demand assessment to pull RentCast&apos;s property record, AVM valuation, and county context for
          this exact address.
        </p>
        <Link
          href={assessUrl}
          className="inline-block px-4 py-2 text-sm font-medium rounded-lg bg-foreground text-white hover:bg-foreground/90 transition-all"
        >
          Run a full assessment &rarr;
        </Link>
      </div>

      <div className="mb-6">
        <PartnerCta
          country="US"
          state={listing.province}
          source="property-page"
          surface="result-buyer"
          heading="Act on this analysis"
          propertySlug={slug}
          city={listing.city}
        />
      </div>
    </main>
  );
}

function renderUSPropertyPage(listing: Listing, slug: string) {
  if (!listing.preNarrative) {
    return renderUSSparseListing(listing, slug);
  }

  const assessment = listing.preAssessment ?? null;
  const anchorDecision = listing.preAnchorDecision;
  const offer = listing.preOffer ? usOfferResult(listing.preOffer, assessment, anchorDecision) : null;
  const tier = listing.preTier ?? "WATCH";
  const score = listing.preScore ?? 0;
  const signals = listing.preSignals ?? [];
  const advantage: UsAdvantageBundle | undefined = listing.preUsAdvantage;
  const comparables = listing.preUsComparables;
  const confidence = listing.preNarrativeConfidence;

  return (
    <main className="max-w-3xl mx-auto px-6 py-6 sm:py-10">
      <PropertyJsonLd
        url={`${BASE_URL}/property/${slug}`}
        address={listing.address}
        city={listing.city}
        province={listing.province}
        beds={listing.beds}
        baths={listing.baths}
        price={listing.price}
        description={listing.description}
      />
      <BreadcrumbJsonLd
        items={[
          { name: "Home", url: BASE_URL },
          { name: listing.city, url: `${BASE_URL}/discover/${cityToSlug(listing.city)}` },
          { name: listing.address, url: `${BASE_URL}/property/${slug}` },
        ]}
      />
      <TrackView slug={slug} city={listing.city} price={listing.price} />

      <Link
        href={`/discover/${cityToSlug(listing.city)}`}
        className="text-sm text-muted hover:text-foreground transition-colors"
      >
        &larr; {listing.city}
      </Link>

      <div className="mt-6 mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{listing.address}</h1>
          <p className="text-sm text-muted mt-0.5">
            {listing.city}, {listing.province}
          </p>
        </div>
        <TierBadge tier={tier} />
      </div>

      {/* Hero — offer or list price */}
      <div className="border border-border rounded-xl p-5 sm:p-8 mb-6 text-center bg-white">
        {offer ? (
          <>
            <div className="text-xs uppercase tracking-widest text-muted mb-2">
              {offer.anchorType === "language" ? "Estimated Offer" : "Recommended Offer"}
            </div>
            <div className="text-4xl sm:text-5xl font-mono font-bold mb-2">{fmt(offer.finalOffer)}</div>
            <div className="text-sm text-green-600 mb-4">
              Save {fmt(offer.savings)} &middot; {pct(offer.percentOfList)} of list
            </div>
            {offer.anchorType === "language" && !anchorDecision && (
              <p className="text-xs text-muted mb-4 max-w-sm mx-auto">
                Based on market duration and structural signals. No assessed value available for this address.
              </p>
            )}
            {anchorDecision?.verdict === "context_only" && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4 max-w-sm mx-auto">
                Assessed value appears decoupled from market value — common with agricultural exemptions, assessment
                caps, or partial parcels. Not used as the offer anchor.
              </p>
            )}
            {anchorDecision?.verdict === "anchor" && anchorDecision.reason === "asking_outlier" && (
              <p className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 mb-4 max-w-sm mx-auto">
                RentCast&apos;s AVM independently backs up the assessed value — the asking price looks like the
                outlier here, not the assessment.
              </p>
            )}
            <div className="border-t border-border pt-4 flex justify-center gap-4 sm:gap-8 text-center">
              <div>
                <div className="text-xs text-muted">List Price</div>
                <div className="font-mono font-medium">{fmt(listing.price)}</div>
              </div>
              {offer.anchorType === "assessment" && (
                <div>
                  <div className="text-xs text-muted">Assessed</div>
                  <div className="font-mono font-medium">{assessment ? fmt(assessment.totalValue) : "N/A"}</div>
                </div>
              )}
              <div>
                <div className="text-xs text-muted">DOM</div>
                <div className="font-mono font-medium">{listing.dom}d</div>
              </div>
            </div>
          </>
        ) : (
          <div className="py-4">
            <div className="text-xs uppercase tracking-widest text-muted mb-2">List Price</div>
            <div className="font-mono text-4xl sm:text-5xl font-bold mb-3">{fmt(listing.price)}</div>
          </div>
        )}
      </div>

      <div className="mb-6">
        <PartnerCtaRow country="US" state={listing.province} source="property-page" surface="result-buyer" propertySlug={slug} city={listing.city} />
      </div>

      {/* THE SIGNAL */}
      <div className="bg-gray-50/50 rounded-xl p-6 mb-6">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs uppercase tracking-widest text-muted">The Signal</div>
          {confidence != null && confidence > 0 && (
            <span className="text-xs text-muted font-mono">{Math.round(confidence * 100)}% confidence</span>
          )}
        </div>
        <div className="space-y-3">
          {listing.preNarrative.split(/\n\n+/).map((para, i) => (
            <p key={i} className="text-sm text-foreground leading-relaxed">
              {para.trim()}
            </p>
          ))}
        </div>
      </div>

      {offer && (
        <div className="mb-4">
          <ExpandableSection title="How we calculated this" defaultOpen={false}>
            <OfferCascade offer={offer} />
          </ExpandableSection>
        </div>
      )}

      {advantage && <UsOverAssessmentCallout overAssessment={advantage.overAssessment} />}

      <div className="mb-4">
        <ExpandableSection title="Score breakdown" defaultOpen={false}>
          {/* Per-rule breakdown isn't persisted for US listings (only the
              total + signals list are — see us-enrich.ts); the total score
              is still shown via the Motivation Signals card below. */}
          <ScoreBreakdown breakdown={{ "Total score": score }} />
        </ExpandableSection>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <UsPropertyFactsCard listing={listing} />
        <UsAssessmentCard assessment={assessment} offer={offer} anchorDecision={anchorDecision} />
        {comparables && <UsComparablesCard comparables={comparables} />}
        {advantage && <UsEquityTenureCard equitySignal={advantage.equitySignal} />}
        {advantage && <UsTriangulationCard triangulation={advantage.triangulation} />}
        {advantage && <UsInvestorYieldCard investorYield={advantage.investorYield} />}
        {advantage && <UsRiskMomentumCard riskMomentum={advantage.riskMomentum} />}

        <div className="border border-border rounded-xl p-4 bg-white">
          <div className="text-xs uppercase tracking-widest text-muted mb-3">Market Activity</div>
          <div className="flex items-center gap-3 mb-3">
            <span className={`w-2.5 h-2.5 rounded-full ${domColor(listing.dom)}`} />
            <span className="font-mono text-2xl font-bold">{listing.dom}</span>
            <span className="text-sm text-muted">days on market</span>
          </div>
          {offer && <div className="text-xs text-muted mb-2">{offer.domTag}</div>}
          {listing.priceReduced && (
            <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full">Price reduced</span>
          )}
        </div>

        <div className="border border-border rounded-xl p-4 bg-white">
          <div className="text-xs uppercase tracking-widest text-muted mb-3">Motivation Signals</div>
          <div className="flex items-center gap-3 mb-3">
            <span className="font-mono text-2xl font-bold">{score}</span>
            <span className="text-sm text-muted">/100</span>
            <TierBadge tier={tier} />
          </div>
          {signals.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {signals.map((s) => (
                <span
                  key={s}
                  title={s.length > 40 ? s : undefined}
                  className="text-xs px-2 py-0.5 rounded-full max-w-[200px] truncate bg-gray-100 text-gray-600"
                >
                  {s.length > 40 ? s.slice(0, 37) + "..." : s}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mb-6">
        <PartnerCta
          country="US"
          state={listing.province}
          source="property-page"
          surface="result-buyer"
          heading="Act on this analysis"
          propertySlug={slug}
          city={listing.city}
        />
      </div>
    </main>
  );
}
