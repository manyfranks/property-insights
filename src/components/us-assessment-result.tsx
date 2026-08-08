import type { Assessment, Listing, OfferResult, ScoreResult } from "@/lib/types";
import type { CountyMarketPanel } from "@/lib/db/regional-econ";
import type { UsCompSupport } from "@/lib/pipeline/us-assess";
import { fmt, pct } from "@/lib/utils";
import PartnerCta from "@/components/partner-cta";
import ExpandableSection from "@/components/expandable-section";
import TierBadge from "@/components/tier-badge";

/**
 * Response shapes for POST /api/assess when country==="US" — mirrors the
 * JSON built in src/app/api/assess/route.ts's handleUSAssessment(). All
 * three share the same base fields; they diverge on offerAvailable /
 * offerUnavailableReason, which is also the render discriminator below.
 *
 *   - Listed: RentCast found an active listing — same pipeline as Canada
 *     (score, signals, offer, comps), rendered the same way CA's
 *     /property/[slug] page does.
 *   - Off-market: RentCast has property/AVM data but no active listing —
 *     AVM value + assessed value + rent, honestly labeled as modeled.
 *   - Fallback: RentCast quota exhausted / API down / no record at all —
 *     the original county-median-only experience.
 */
interface UsResultBase {
  ok: true;
  country: "US";
  address: string;
  city: string;
  state: string;
  countyName: string;
  countyFips: string;
  assessment: Assessment | null;
  marketPanel: CountyMarketPanel | null;
  emailSent: boolean;
}

export interface UsListedResult extends UsResultBase {
  offerAvailable: true;
  listing: Listing;
  score: ScoreResult;
  signals: string[];
  offer: OfferResult | null;
  comparables: UsCompSupport;
}

export interface UsOffMarketResult extends UsResultBase {
  offerAvailable: false;
  offerUnavailableReason: "not_listed";
  offerUnavailableMessage: string;
  avm: { value: number; rangeLow: number | null; rangeHigh: number | null } | null;
  rent: { value: number; rangeLow: number | null; rangeHigh: number | null } | null;
}

export interface UsFallbackResult extends UsResultBase {
  offerAvailable: false;
  offerUnavailableReason: "no_listing_data";
}

export type UsAssessResult = UsListedResult | UsOffMarketResult | UsFallbackResult;

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

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

function assessmentSourceLabel(assessment: Assessment): string {
  switch (assessment.source) {
    case "government":
      return "County tax assessment";
    case "avm":
      return "RentCast AVM estimate (modeled)";
    case "area_median":
      return "County area median (modeled)";
    default:
      return "Estimate";
  }
}

function MarketPanelSection({ marketPanel }: { marketPanel: CountyMarketPanel | null }) {
  const hasFmr =
    marketPanel &&
    [marketPanel.fmrStudio, marketPanel.fmr1br, marketPanel.fmr2br, marketPanel.fmr3br, marketPanel.fmr4br].some(
      (v) => v != null
    );
  const hasFema = marketPanel && (marketPanel.femaRiskScore != null || marketPanel.femaEalScore != null);
  const hasHpi = marketPanel && marketPanel.hpiLatest != null;

  if (!marketPanel) {
    return <p className="text-sm text-muted mb-6">County market data isn&apos;t available for this area yet.</p>;
  }

  return (
    <div className="mb-6">
      <div className="text-xs uppercase tracking-widest text-muted mb-3">County Market Snapshot</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {marketPanel.medianGrossRent != null && (
          <StatCard
            label="Median Gross Rent"
            value={fmt(marketPanel.medianGrossRent) + "/mo"}
            vintage={marketPanel.vintages["median_gross_rent"]}
          />
        )}
        {marketPanel.vacancyRate != null && (
          <StatCard label="Vacancy Rate" value={pct(marketPanel.vacancyRate)} vintage={marketPanel.vintages["vacancy_rate"]} />
        )}
        {marketPanel.medianHouseholdIncome != null && (
          <StatCard
            label="Median Household Income"
            value={fmt(marketPanel.medianHouseholdIncome)}
            vintage={marketPanel.vintages["median_household_income"]}
          />
        )}
        {hasHpi && (
          <StatCard
            label="Home Price Index"
            value={marketPanel.hpiLatest!.toFixed(1)}
            sub={
              marketPanel.hpiTrend5y != null
                ? `${marketPanel.hpiTrend5y >= 0 ? "+" : ""}${pct(marketPanel.hpiTrend5y)} over ~5yr`
                : undefined
            }
            vintage={marketPanel.vintages["hpi"]}
          />
        )}
        {hasFema && (
          <StatCard
            label="FEMA Risk Score"
            value={marketPanel.femaRiskScore != null ? `${marketPanel.femaRiskScore.toFixed(1)}/100` : "—"}
            sub={
              marketPanel.femaEalScore != null
                ? `Expected Annual Loss score: ${marketPanel.femaEalScore.toFixed(1)}/100`
                : undefined
            }
            vintage={marketPanel.vintages["fema_risk_score"]}
          />
        )}
      </div>

      {hasFmr && (
        <div className="border border-border rounded-xl p-4 bg-white mt-4">
          <div className="text-xs uppercase tracking-widest text-muted mb-3">HUD Fair Market Rent</div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
            <div>
              <div className="text-muted text-xs">Studio</div>
              <div className="font-mono font-medium">{fmrLabel(marketPanel.fmrStudio)}</div>
            </div>
            <div>
              <div className="text-muted text-xs">1BR</div>
              <div className="font-mono font-medium">{fmrLabel(marketPanel.fmr1br)}</div>
            </div>
            <div>
              <div className="text-muted text-xs">2BR</div>
              <div className="font-mono font-medium">{fmrLabel(marketPanel.fmr2br)}</div>
            </div>
            <div>
              <div className="text-muted text-xs">3BR</div>
              <div className="font-mono font-medium">{fmrLabel(marketPanel.fmr3br)}</div>
            </div>
            <div>
              <div className="text-muted text-xs">4BR</div>
              <div className="font-mono font-medium">{fmrLabel(marketPanel.fmr4br)}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FooterCredits({ marketPanel }: { marketPanel: CountyMarketPanel | null }) {
  const hasFema = marketPanel && (marketPanel.femaRiskScore != null || marketPanel.femaEalScore != null);
  const hasFmr =
    marketPanel &&
    [marketPanel.fmrStudio, marketPanel.fmr1br, marketPanel.fmr2br, marketPanel.fmr3br, marketPanel.fmr4br].some(
      (v) => v != null
    );
  return (
    <p className="text-xs text-muted/60 text-center pt-4 border-t border-border">
      Data: US Census ACS 5-Year Estimates
      {marketPanel?.vintages["hpi"] ? " · FHFA House Price Index" : ""}
      {hasFema ? " · FEMA National Risk Index" : ""}
      {hasFmr ? " · HUD Fair Market Rents" : ""}
      {" · RentCast property, valuation, and listing data"}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Listed variant — same experience as the Canadian /property/[slug] page
// ---------------------------------------------------------------------------

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

function domColor(dom: number): string {
  if (dom >= 90) return "bg-red-500";
  if (dom >= 45) return "bg-amber-500";
  return "bg-green-500";
}

function UsListedView({ data }: { data: UsListedResult }) {
  const { listing, assessment, offer, score, signals, comparables, marketPanel } = data;

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{data.address}</h1>
          <p className="text-sm text-muted mt-0.5">
            {listing.city}, {listing.province}
          </p>
        </div>
        <TierBadge tier={score.tier} />
      </div>

      {/* Hero — recommended offer */}
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
            {assessment?.evidenceClass === "modeled" && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4 max-w-sm mx-auto">
                Anchored on a RentCast modeled value estimate (AVM), not a government tax assessment — treat as
                approximate.
              </p>
            )}
            <div className="border-t border-border pt-4 flex justify-center gap-4 sm:gap-8 text-center">
              <div>
                <div className="text-xs text-muted">List Price</div>
                <div className="font-mono font-medium">{fmt(listing.price)}</div>
              </div>
              <div>
                <div className="text-xs text-muted">{assessment?.source === "avm" ? "AVM Value" : "Assessed"}</div>
                <div className="font-mono font-medium">{assessment ? fmt(assessment.totalValue) : "N/A"}</div>
              </div>
              <div>
                <div className="text-xs text-muted">Ratio</div>
                <div className="font-mono font-medium">{offer.listToAssessedRatio.toFixed(2)}x</div>
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

      {offer && (
        <div className="mb-4">
          <ExpandableSection title="How we calculated this" defaultOpen={false}>
            <OfferCascade offer={offer} />
          </ExpandableSection>
        </div>
      )}

      <div className="mb-4">
        <ExpandableSection title="Score breakdown" defaultOpen={false}>
          <ScoreBreakdown breakdown={score.breakdown} />
        </ExpandableSection>
      </div>

      {/* Bento grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
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
              <div className="font-medium">{listing.taxes ? fmt(Number(listing.taxes)) : "N/A"}</div>
            </div>
          </div>
          {listing.mlsNumber && (
            <div className="text-xs text-muted mt-3 pt-2 border-t border-border">MLS# {listing.mlsNumber}</div>
          )}
        </div>

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
                <span className="text-xs">{assessmentSourceLabel(assessment)}</span>
              </div>
              {offer && (
                <div className="flex justify-between pt-1 border-t border-border">
                  <span className="text-muted">List/Assessed</span>
                  <span className="font-mono font-medium">{offer.listToAssessedRatio.toFixed(2)}x</span>
                </div>
              )}
              {assessment.source === "avm" && (
                <p className="text-xs text-muted/70 pt-1">
                  Modeled estimate from RentCast&apos;s automated valuation model — not a government-verified
                  assessment.
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted">No assessment data available for this address.</p>
          )}
        </div>

        {comparables.comparables.length > 0 && (
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
                {comparables.confidence === "high"
                  ? "Anchored by comps"
                  : comparables.confidence === "medium"
                    ? "Supported by similar properties"
                    : "Limited data"}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm mb-3">
              {comparables.medianPricePerSqft && (
                <div>
                  <div className="text-muted text-xs">Median $/sqft</div>
                  <div className="font-mono font-medium">${comparables.medianPricePerSqft}</div>
                </div>
              )}
              {comparables.impliedValue && (
                <div>
                  <div className="text-muted text-xs">Implied value</div>
                  <div className="font-mono font-medium">{fmt(comparables.impliedValue)}</div>
                </div>
              )}
            </div>
            <div className="space-y-2">
              {comparables.comparables.slice(0, 5).map((c, i) => (
                <div key={i} className="border border-border/50 rounded-lg p-2.5 text-xs">
                  <div className="flex justify-between items-start mb-1">
                    <span className="font-medium">{c.address || "Nearby comparable"}</span>
                    {c.distanceMi != null && <span className="text-muted ml-2 whitespace-nowrap">{c.distanceMi.toFixed(1)}mi</span>}
                  </div>
                  <div className="flex justify-between text-muted">
                    <span>
                      {c.beds ?? "?"}bd{c.sqft ? ` · ${c.sqft}sqft` : ""}
                      {c.status ? ` · ${c.status}` : ""}
                    </span>
                    {c.price != null && <span className="font-mono">{fmt(c.price)}</span>}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted/60 mt-2">
              RentCast AVM comparables — valuation inputs (price, distance, correlation), not confirmed sold
              transactions.
              {comparables.dataGaps.length > 0 ? ` ${comparables.dataGaps.join(" · ")}.` : ""}
            </p>
          </div>
        )}

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
            <span className="font-mono text-2xl font-bold">{score.total}</span>
            <span className="text-sm text-muted">/100</span>
            <TierBadge tier={score.tier} />
          </div>
          {signals.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {signals.map((s) => (
                <span key={s} className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                  {s}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted/70">
              No listing-language signals detected — RentCast doesn&apos;t provide MLS remarks text, so only
              structural signals (days on market, price history) are scored for US listings.
            </p>
          )}
        </div>
      </div>

      <div className="mb-6">
        <div className="text-xs uppercase tracking-widest text-muted mb-3">Next Steps</div>
        <PartnerCta country="US" state={data.state} source="assess-result" city={data.city} />
      </div>

      <div className="mb-2 pt-4 border-t border-border">
        <div className="text-xs uppercase tracking-widest text-muted mb-3">County Context</div>
        <MarketPanelSection marketPanel={marketPanel} />
      </div>

      <FooterCredits marketPanel={marketPanel} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Off-market variant
// ---------------------------------------------------------------------------

function UsOffMarketView({ data }: { data: UsOffMarketResult }) {
  const { assessment, avm, rent, marketPanel } = data;

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">{data.address}</h1>
        <p className="text-sm text-muted mt-0.5">
          {data.countyName}, {data.state}
        </p>
      </div>

      <div className="border border-border rounded-xl p-5 sm:p-8 mb-6 text-center bg-white">
        {assessment?.found ? (
          <>
            <div className="text-xs uppercase tracking-widest text-muted mb-2">
              {assessment.source === "avm" ? "Estimated Value — RentCast AVM" : "County Tax Assessment"}
            </div>
            <div className="text-4xl sm:text-5xl font-mono font-bold mb-2">{fmt(assessment.totalValue)}</div>
            {avm && (assessment.source !== "avm" || avm.rangeLow || avm.rangeHigh) && avm.rangeLow != null && avm.rangeHigh != null && (
              <p className="text-sm text-muted mb-2">
                Estimated range: {fmt(avm.rangeLow)} – {fmt(avm.rangeHigh)}
              </p>
            )}
            <p className="text-xs text-muted/70 max-w-sm mx-auto">
              {assessment.source === "avm"
                ? "Modeled estimate from RentCast's automated valuation model. Not a government-verified assessment — treat as approximate."
                : `${assessment.assessmentYear} county tax assessment.`}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted py-4">No value estimate available for this address yet.</p>
        )}
      </div>

      <div className="border border-amber-200 bg-amber-50 rounded-xl p-4 mb-6 text-sm text-amber-800">
        {data.offerUnavailableMessage}
      </div>

      {(assessment?.source === "avm" || rent) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          {assessment?.source === "government" && avm && (
            <StatCard label="RentCast AVM Estimate" value={fmt(avm.value)} sub="Modeled — see disclaimer above" />
          )}
          {rent && (
            <StatCard
              label="Estimated Monthly Rent"
              value={fmt(rent.value) + "/mo"}
              sub={rent.rangeLow != null && rent.rangeHigh != null ? `Range: ${fmt(rent.rangeLow)} – ${fmt(rent.rangeHigh)}` : "Modeled estimate"}
            />
          )}
        </div>
      )}

      <div className="pt-2">
        <MarketPanelSection marketPanel={marketPanel} />
      </div>

      <div className="mb-6">
        <div className="text-xs uppercase tracking-widest text-muted mb-3">Next Steps</div>
        <PartnerCta country="US" state={data.state} source="assess-result" city={data.city} />
      </div>

      <FooterCredits marketPanel={marketPanel} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fallback variant (RentCast quota exhausted / down / no record) — the
// original county-median-only experience.
// ---------------------------------------------------------------------------

function UsFallbackView({ data }: { data: UsFallbackResult }) {
  const { assessment, marketPanel } = data;

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">{data.address}</h1>
        <p className="text-sm text-muted mt-0.5">
          {data.countyName}, {data.state}
        </p>
      </div>

      <div className="border border-border rounded-xl p-5 sm:p-8 mb-6 text-center bg-white">
        {assessment?.found ? (
          <>
            <div className="text-xs uppercase tracking-widest text-muted mb-2">
              County Median Home Value — Modeled Estimate
            </div>
            <div className="text-4xl sm:text-5xl font-mono font-bold mb-2">{fmt(assessment.totalValue)}</div>
            <p className="text-xs text-muted/70 max-w-sm mx-auto">
              Based on US Census ACS county-level median ({assessment.assessmentYear}), not property-specific. Treat
              as approximate.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted py-4">No assessment data available for this county yet.</p>
        )}
      </div>

      <div className="border border-amber-200 bg-amber-50 rounded-xl p-4 mb-6 text-sm text-amber-800">
        Offer modeling isn&apos;t available here — it needs a specific listing (asking price, days on market), and
        this is a county-level lookup with no listing attached.
      </div>

      <MarketPanelSection marketPanel={marketPanel} />

      <div className="mb-6">
        <div className="text-xs uppercase tracking-widest text-muted mb-3">Next Steps</div>
        <PartnerCta country="US" state={data.state} source="assess-result" city={data.city} />
      </div>

      <FooterCredits marketPanel={marketPanel} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export default function UsAssessmentResult({ data }: { data: UsAssessResult }) {
  return (
    <div className="max-w-3xl mx-auto">
      {data.offerAvailable ? (
        <UsListedView data={data} />
      ) : data.offerUnavailableReason === "not_listed" ? (
        <UsOffMarketView data={data} />
      ) : (
        <UsFallbackView data={data} />
      )}
    </div>
  );
}
