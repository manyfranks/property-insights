import type { AnchorPlausibility, Assessment, Listing, OfferResult, ScoreResult } from "@/lib/types";
import type { CountyMarketPanel } from "@/lib/db/regional-econ";
import type { UsCompSupport } from "@/lib/pipeline/us-assess";
import type { AssessmentSubject } from "@/lib/property-intelligence/subject";
import type { PropertyClassification } from "@/lib/property-intelligence/classification";
import type { PropertyCapabilities } from "@/lib/property-intelligence/capabilities";
import type { AssessmentGoal } from "@/lib/property-intelligence/journey";
import {
  assessmentAudience,
  buildRentalScreenModel,
  shouldWithholdPropertyEvidence,
  type RentalMoneyEvidence,
} from "@/lib/property-intelligence/investor-journey";
import type {
  EquityTenureSignal,
  ValuationTriangulation,
  InvestorYield,
  RiskMomentumContext,
  OverAssessmentFlag,
} from "@/lib/pipeline/us-advantage";
import { fmt, pct } from "@/lib/utils";
import PartnerCta from "@/components/partner-cta";
import PartnerCtaRow from "@/components/partner-cta-row";
import InsuranceModule from "@/components/insurance/insurance-module";
import { lineForGoal } from "@/components/insurance/goal-line-map";
import ExpandableSection from "@/components/expandable-section";
import TierBadge from "@/components/tier-badge";
import {
  US_COUNTY_FALLBACK_LABEL,
  usCountyFallbackDisclosure,
  usOfferModelUnavailableMessage,
  usPropertyDataUnavailableMessage,
  type UsPropertyDataUnavailableReason,
} from "@/lib/property-intelligence/p0-fallback";

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
  assessmentSubject: AssessmentSubject;
  propertyClassification: PropertyClassification;
  propertyCapabilities: PropertyCapabilities;
  assessmentGoal: AssessmentGoal | null;
  assessmentId: string | null;
  marketPanel: CountyMarketPanel | null;
  emailSent: boolean;
}

// US Advantage layer fields (src/lib/pipeline/us-advantage.ts) — signals
// with no CA equivalent, present on both the listed and off-market shapes
// (off-market uses the AVM value in place of an asking price).
interface UsAdvantageFields {
  equitySignal: EquityTenureSignal | null;
  triangulation: ValuationTriangulation;
  investorYield: InvestorYield | null;
  riskMomentum: RiskMomentumContext;
  overAssessment: OverAssessmentFlag;
}

export interface UsListedResult extends UsResultBase, UsAdvantageFields {
  offerAvailable: true;
  listing: Listing;
  score: ScoreResult;
  signals: string[];
  offer: OfferResult | null;
  // Anchor plausibility verdict (src/lib/pipeline/us-assess.ts's
  // assessAnchorPlausibility) — null when there was no assessed value to
  // evaluate. Drives the demoted-assessment caveat below.
  anchorDecision: AnchorPlausibility | null;
  comparables: UsCompSupport;
  // THE SIGNAL — LLM narrative (src/lib/pipeline/us-narrative.ts), generated
  // in handleUSAssessment's listed branch only (route.ts). narrative is
  // always populated (LLM or the deterministic fallback); narrativeSignals/
  // narrativeConfidence are LLM-only and empty/0 when the fallback fired.
  narrative: string;
  narrativeSignals: string[];
  narrativeConfidence: number;
}

export interface UsOffMarketResult extends UsResultBase, UsAdvantageFields {
  offerAvailable: false;
  offerUnavailableReason: "not_listed";
  offerUnavailableMessage: string;
  avm: { value: number; rangeLow: number | null; rangeHigh: number | null } | null;
  rent: { value: number; rangeLow: number | null; rangeHigh: number | null } | null;
}

export interface UsFallbackResult extends UsResultBase {
  offerAvailable: false;
  offerUnavailableReason: "no_listing_data";
  /** Evidence-availability reason only; never a property classification. */
  propertyDataUnavailableReason: UsPropertyDataUnavailableReason;
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
  // liveCountySource: real-time county-assessor lookup (src/lib/assessment/
  // us-county's lookupCountyLive, wired into src/lib/pipeline/us-assess.ts's
  // buildUsAssessment) rather than RentCast's taxAssessments field — see
  // Assessment.liveCountySource's doc comment (src/lib/types.ts).
  if (assessment.liveCountySource) {
    return assessment.liveCountyValueKind === "market_value"
      ? "County assessor market value (live)"
      : "County tax assessment (live)";
  }
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

function FooterCredits({
  marketPanel,
  includeRentCast = true,
}: {
  marketPanel: CountyMarketPanel | null;
  includeRentCast?: boolean;
}) {
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
      {includeRentCast ? " · RentCast property, valuation, and listing data" : ""}
    </p>
  );
}

// ---------------------------------------------------------------------------
// US Advantage layer — shared rendering pieces (src/lib/pipeline/us-advantage.ts).
// These are the signals CA structurally can't produce: seller equity/tenure
// from sale history, 3-4-anchor valuation triangulation, investor yield, and
// county risk/momentum. Every number here is a modeled estimate — carries
// the same disclaimer treatment as the rest of the US result.
// ---------------------------------------------------------------------------

const EQUITY_TIER_STYLE: Record<EquityTenureSignal["tier"], { badge: string; label: string }> = {
  loss_sale_distress: { badge: "bg-rose-100 text-rose-700", label: "Loss-Sale Distress" },
  short_hold_flip: { badge: "bg-amber-100 text-amber-700", label: "Short-Hold Resale Pattern" },
  long_tenure_high_equity: { badge: "bg-emerald-100 text-emerald-700", label: "Long-Tenure Equity" },
  moderate_hold: { badge: "bg-zinc-100 text-zinc-600", label: "Moderate Hold" },
};

/**
 * "Crown jewel" signal — the structural replacement for CA's keyword-driven
 * motivation signals (see us-advantage.ts's module doc). Rendered as its own
 * bento card, not just a chip, since it's derived from real transaction
 * history (sale date + price), not text pattern-matching.
 */
function EquityTenureCard({ equitySignal }: { equitySignal: EquityTenureSignal | null }) {
  if (!equitySignal) {
    return (
      <div className="border border-border rounded-xl p-4 bg-white">
        <div className="text-xs uppercase tracking-widest text-muted mb-3">Seller Equity &amp; Tenure</div>
        <p className="text-xs text-muted/70">
          No prior sale on record for this address from RentCast — hold length and equity position can&apos;t be
          estimated.
        </p>
      </div>
    );
  }

  const style = EQUITY_TIER_STYLE[equitySignal.tier];

  return (
    <div className="border border-border rounded-xl p-4 bg-white">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs uppercase tracking-widest text-muted">Seller Equity &amp; Tenure</div>
        <span className={`text-xs px-2 py-0.5 rounded-full ${style.badge}`}>{style.label}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm mb-3">
        <div>
          <div className="text-muted text-xs">Hold period</div>
          <div className="font-mono font-medium">{equitySignal.holdYears.toFixed(1)}yr</div>
        </div>
        <div>
          <div className="text-muted text-xs">Last sale</div>
          <div className="font-mono font-medium">{fmt(equitySignal.lastSalePrice)}</div>
        </div>
        <div>
          <div className="text-muted text-xs">Implied change</div>
          <div className="font-mono font-medium">
            {equitySignal.impliedAppreciationPct >= 0 ? "+" : ""}
            {pct(equitySignal.impliedAppreciationPct)}
          </div>
        </div>
        <div>
          <div className="text-muted text-xs">HPI corroboration</div>
          <div className="font-medium text-xs">
            {equitySignal.hpiCorroboration === "consistent"
              ? "Consistent w/ county trend"
              : equitySignal.hpiCorroboration === "below_hpi_trend"
                ? "Below county trend"
                : equitySignal.hpiCorroboration === "above_hpi_trend"
                  ? "Above county trend"
                  : "No county HPI data"}
          </div>
        </div>
      </div>
      <p className="text-xs text-muted leading-relaxed">{equitySignal.narrative}</p>
      <p className="text-xs text-muted/60 mt-2">
        Modeled from RentCast sale history — the appreciation figure doesn&apos;t account for any mortgage balance or
        paydown.
      </p>
    </div>
  );
}

const TRIANGULATION_CONFIDENCE_BADGE: Record<ValuationTriangulation["confidence"], string> = {
  high: "bg-emerald-100 text-emerald-700",
  medium: "bg-amber-100 text-amber-700",
  low: "bg-rose-100 text-rose-700",
  insufficient: "bg-zinc-100 text-zinc-500",
};

/**
 * Valuation triangulation — CA anchors an offer on exactly 2 points
 * (assessment, asking); RentCast's data supports 3-4 independent anchors.
 * Rendered as methodology detail, not a headline number, since
 * offer-model.ts's own anchor (see OfferCascade) is still what drives the
 * actual offer — this is the confidence check layered on top.
 */
function TriangulationDetail({ triangulation }: { triangulation: ValuationTriangulation }) {
  // excludedAnchors was added to ValuationTriangulation after some
  // already-persisted KV listings were seeded — their cached
  // preUsAdvantage.triangulation blob predates the field entirely, so guard
  // rather than assume it's always an array (matches narrative-lint.ts's
  // same defensive treatment of this exact field).
  const excludedAnchors = triangulation.excludedAnchors ?? [];
  if (triangulation.anchors.length === 0 && excludedAnchors.length === 0) {
    return <p className="text-sm text-muted">No valuation anchors available for this address.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">
          {triangulation.triangulatedValue != null ? fmt(triangulation.triangulatedValue) : "—"}
        </span>
        <span className={`text-xs px-2 py-0.5 rounded-full ${TRIANGULATION_CONFIDENCE_BADGE[triangulation.confidence]}`}>
          {triangulation.confidence === "insufficient" ? "Limited data" : `${triangulation.confidence} confidence`}
        </span>
      </div>
      <div className="space-y-1.5">
        {triangulation.anchors.map((a) => (
          <div key={a.kind} className="flex items-center justify-between text-sm">
            <span className="text-muted">{a.label}</span>
            <span className="font-mono font-medium">{fmt(a.value)}</span>
          </div>
        ))}
        {excludedAnchors.map((a) => (
          <div key={`excluded-${a.kind}`} className="flex items-center justify-between text-sm text-muted/60">
            <span className="line-through decoration-muted/50">{a.label}</span>
            <span className="font-mono line-through decoration-muted/50">{fmt(a.value)}</span>
            <span className="text-xs ml-2 shrink-0 px-1.5 py-0.5 rounded bg-zinc-100">excluded</span>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted leading-relaxed pt-1 border-t border-border">{triangulation.agreementNote}</p>
    </div>
  );
}

/**
 * Investor yield — no CA equivalent (no per-property rent estimate exists
 * there). Only renders when RentCast returned a rent estimate for this
 * address and there's a price to compute yield against.
 */
function InvestorYieldCard({ investorYield }: { investorYield: InvestorYield | null }) {
  if (!investorYield) {
    return (
      <div className="border border-border rounded-xl p-4 bg-white">
        <div className="text-xs uppercase tracking-widest text-muted mb-3">Investor Yield</div>
        <p className="text-xs text-muted/70">No rent estimate available for this address to compute yield.</p>
      </div>
    );
  }

  return (
    <div className="border border-border rounded-xl p-4 bg-white">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs uppercase tracking-widest text-muted">Investor Yield</div>
        <span
          className={`text-xs px-2 py-0.5 rounded-full ${
            investorYield.onePercentRuleMet ? "bg-emerald-100 text-emerald-700" : "bg-zinc-100 text-zinc-500"
          }`}
        >
          {investorYield.onePercentRuleMet ? "Meets 1% rule" : "Below 1% rule"}
        </span>
      </div>
      <div className="flex items-baseline gap-2 mb-3">
        <span className="font-mono text-2xl font-bold">{pct(investorYield.grossYieldPct)}</span>
        <span className="text-sm text-muted">gross yield</span>
      </div>
      <p className="text-xs text-muted leading-relaxed">{investorYield.verdict}</p>
      <p className="text-xs text-muted/60 mt-2">Modeled estimate — based on RentCast&apos;s rent AVM, not a signed lease.</p>
    </div>
  );
}

function RentalScreen({
  model,
}: {
  model: NonNullable<ReturnType<typeof buildRentalScreenModel>>;
}) {
  const badgeClass = model.availability === "supported"
    ? "bg-emerald-100 text-emerald-700"
    : model.availability === "limited"
      ? "bg-amber-100 text-amber-700"
      : "bg-zinc-100 text-zinc-600";

  return (
    <section className="border border-border rounded-xl p-5 sm:p-6 mb-6 bg-white" data-p5-rental-screen={model.availability}>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted">Rental screen · Preview</div>
          <h2 className="text-xl font-semibold mt-1">Rent and gross-yield evidence</h2>
        </div>
        <span className={`text-xs px-2 py-1 rounded-full ${badgeClass}`}>{model.availability}</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <RentalEvidenceCard evidence={model.addressRent} unavailableLabel="Address rent unavailable" />
        <div className="border border-border rounded-lg p-4 bg-gray-50/50">
          <div className="text-xs uppercase tracking-widest text-muted mb-2">Gross rental yield</div>
          {model.yield ? (
            <>
              <div className="font-mono text-2xl font-semibold">{pct(model.yield.grossYieldPct)}</div>
              <p className="text-xs text-muted mt-1">
                {pct(model.yield.rentToPriceRatio)} monthly rent-to-price · {model.yield.onePercentRuleMet ? "meets" : "below"} 1% rule
              </p>
            </>
          ) : (
            <p className="text-sm text-muted">A property-specific yield cannot be calculated from the verified evidence.</p>
          )}
        </div>
        <RentalEvidenceCard evidence={model.regionalRent} unavailableLabel="Regional benchmark unavailable" />
      </div>

      <p className="text-xs text-muted/70 mt-4">
        Gross screening only: financing, vacancy, maintenance, management, utilities, insurance, taxes, and other
        operating costs are not deducted. This is not a cash-flow or cap-rate projection.
      </p>
    </section>
  );
}

function RentalEvidenceCard({
  evidence,
  unavailableLabel,
}: {
  evidence: RentalMoneyEvidence | null;
  unavailableLabel: string;
}) {
  return (
    <div className="border border-border rounded-lg p-4 bg-gray-50/50">
      <div className="text-xs uppercase tracking-widest text-muted mb-2">{evidence?.label ?? unavailableLabel}</div>
      {evidence ? (
        <>
          <div className="font-mono text-2xl font-semibold">{fmt(evidence.value)}/mo</div>
          {evidence.rangeLow != null && evidence.rangeHigh != null && (
            <p className="text-xs text-muted mt-1">Modeled range: {fmt(evidence.rangeLow)}–{fmt(evidence.rangeHigh)}</p>
          )}
          <p className="text-xs text-muted/70 mt-2">
            {evidence.source}{evidence.geography ? ` · ${evidence.geography}` : ""}{evidence.vintage ? ` · ${evidence.vintage}` : ""}
          </p>
        </>
      ) : (
        <p className="text-sm text-muted">Not available for the resolved assessment subject.</p>
      )}
    </div>
  );
}

function UsLimitedListedRentalView({
  data,
  model,
}: {
  data: UsListedResult;
  model: NonNullable<ReturnType<typeof buildRentalScreenModel>>;
}) {
  const { listing, marketPanel, riskMomentum } = data;
  const audience = assessmentAudience("rental_investment");
  const rentReason = data.propertyCapabilities.items.addressRentEstimate.reason;
  const unitRentMismatch =
    rentReason === "unsupported_scope" &&
    (data.propertyClassification.buildingForm.value === "apartment" ||
      data.propertyClassification.buildingForm.value === "low-rise multi-unit");

  return (
    <div data-p5-us-rental-limited="true">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{data.address}</h1>
          <p className="text-sm text-muted mt-0.5">{listing.city}, {listing.province}</p>
        </div>
        <TierBadge tier={data.score.tier} />
      </div>

      <RentalScreen model={model} />

      <section className="border border-amber-200 bg-amber-50 rounded-xl p-5 mb-6">
        <div className="text-xs uppercase tracking-widest text-amber-700 mb-2">Property yield withheld</div>
        <h2 className="text-lg font-semibold text-amber-950 mb-2">
          {unitRentMismatch ? "The rent and price do not describe the same asset." : "A verified property yield is unavailable."}
        </h2>
        <p className="text-sm text-amber-900">
          {unitRentMismatch
            ? "For this multi-family listing, RentCast's rent AVM describes one unit while the listing price describes the whole building. A building yield requires total scheduled rent or a unit-by-unit rent roll."
            : rentReason === "missing_field"
              ? "No address-level rent estimate is available for the resolved listing, so regional rent context cannot be divided by the property price."
              : "The available rent estimate does not match the resolved listing scope, so it cannot be divided by the property price."}
        </p>
      </section>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard label="List price" value={fmt(listing.price)} sub="Resolved listing" />
        <StatCard label="Beds" value={listing.beds || "—"} sub="Listing total" />
        <StatCard label="Baths" value={listing.baths || "—"} sub="Listing total" />
        <StatCard label="Sqft" value={listing.sqft || "—"} sub="Listing total" />
      </div>

      <div className="mb-6">
        <RiskMomentumCard riskMomentum={riskMomentum} />
      </div>

      <div className="mb-6">
        <PartnerCta
          country="US"
          state={data.state}
          source="assess-result"
          mode={audience.mode}
          surface={audience.surface}
          heading="Continue your rental analysis"
          city={data.city}
        />
      </div>

      <div className="mb-2 pt-4 border-t border-border">
        <div className="text-xs uppercase tracking-widest text-muted mb-3">County Context</div>
        <MarketPanelSection marketPanel={marketPanel} />
      </div>
      <FooterCredits marketPanel={marketPanel} />
    </div>
  );
}

function regionalRentEvidence(data: UsResultBase): RentalMoneyEvidence | null {
  const value = data.marketPanel?.fmr2br;
  if (value == null) return null;
  return {
    value,
    label: "Regional benchmark · 2BR",
    source: "HUD Fair Market Rent",
    geography: `${data.countyName} County`,
    vintage: data.marketPanel?.vintages.fmr_2br ?? null,
  };
}

const MOMENTUM_BADGE: Record<RiskMomentumContext["momentum"], string> = {
  accelerating: "bg-amber-100 text-amber-700",
  steady: "bg-zinc-100 text-zinc-600",
  cooling: "bg-emerald-100 text-emerald-700",
  unknown: "bg-zinc-100 text-zinc-500",
};

const MOMENTUM_LABEL: Record<RiskMomentumContext["momentum"], string> = {
  accelerating: "Accelerating",
  steady: "Steady growth",
  cooling: "Cooling",
  unknown: "No trend data",
};

/**
 * Risk & momentum — county HPI trend, vacancy, and top FEMA perils
 * condensed into one offer-adjacent note. No CA equivalent (no county risk
 * panel exists there).
 */
function RiskMomentumCard({ riskMomentum }: { riskMomentum: RiskMomentumContext }) {
  return (
    <div className="border border-border rounded-xl p-4 bg-white">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs uppercase tracking-widest text-muted">Risk &amp; Momentum</div>
        <span className={`text-xs px-2 py-0.5 rounded-full ${MOMENTUM_BADGE[riskMomentum.momentum]}`}>
          {MOMENTUM_LABEL[riskMomentum.momentum]}
        </span>
      </div>
      {riskMomentum.topPerils.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {riskMomentum.topPerils.map((p) => (
            <span key={p.hazard} className="text-xs px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 capitalize">
              {p.label} {p.score.toFixed(0)}/100
            </span>
          ))}
        </div>
      )}
      <p className="text-xs text-muted leading-relaxed">{riskMomentum.note}</p>
    </div>
  );
}

/**
 * Demoted-assessment caveat (src/lib/pipeline/us-assess.ts's
 * assessAnchorPlausibility) — short, honest, no scary jargon. Only renders
 * when the gate actually found something worth flagging: verdict
 * "context_only" (assessed value demoted, offer re-anchored elsewhere) or
 * the "asking_outlier" flavor of "anchor" (assessed value confirmed by the
 * AVM; the asking price is the one that's off).
 */
function AnchorCaveat({ anchorDecision }: { anchorDecision: AnchorPlausibility | null }) {
  if (!anchorDecision || !anchorDecision.reason) return null;

  if (anchorDecision.verdict === "context_only") {
    return (
      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4 max-w-sm mx-auto">
        Assessed value appears decoupled from market value — common with agricultural exemptions, assessment caps,
        or partial parcels. Not used as the offer anchor.
      </p>
    );
  }

  // "anchor" with a reason is the asking_outlier case — assessed value is
  // fine, the asking price is the outlier.
  return (
    <p className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 mb-4 max-w-sm mx-auto">
      RentCast&apos;s AVM independently backs up the assessed value — the asking price looks like the outlier here,
      not the assessment. Strong footing for a low offer.
    </p>
  );
}

/**
 * Over-assessment flag — highlighted callout, not a bento card, positioned
 * near the CTA block so it makes the Ownwell tax-appeal CTA
 * (src/config/affiliate-vendors.ts) contextually relevant instead of a
 * generic pitch. Only renders when the flag actually triggered.
 */
function OverAssessmentCallout({ overAssessment }: { overAssessment: OverAssessmentFlag }) {
  if (!overAssessment.triggered || !overAssessment.note) return null;
  return (
    <div className="border border-blue-200 bg-blue-50 rounded-xl p-4 mb-4 text-sm text-blue-800">
      <span className="font-medium">Possible over-assessment: </span>
      {overAssessment.note}
    </div>
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

function UsListedView({ data, activeGoal }: { data: UsListedResult; activeGoal: AssessmentGoal | null }) {
  const {
    listing,
    assessment,
    offer,
    score,
    signals,
    comparables,
    marketPanel,
    equitySignal,
    triangulation,
    investorYield,
    riskMomentum,
    overAssessment,
    narrative,
    narrativeConfidence,
    anchorDecision,
  } = data;
  const audience = assessmentAudience(activeGoal);
  const rentalScreen = buildRentalScreenModel({
    goal: activeGoal,
    capabilities: data.propertyCapabilities,
    addressRent: investorYield?.monthlyRent
      ? {
          value: investorYield.monthlyRent,
          label: "Address-level rent estimate",
          source: "RentCast rent AVM · modeled, not a signed lease",
        }
      : null,
    regionalRent: regionalRentEvidence(data),
    yield: investorYield,
  });

  if (
    activeGoal === "rental_investment" &&
    rentalScreen &&
    !data.propertyCapabilities.items.grossYieldScreen.available
  ) {
    return <UsLimitedListedRentalView data={data} model={rentalScreen} />;
  }

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

      {rentalScreen && <RentalScreen model={rentalScreen} />}

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
            <AnchorCaveat anchorDecision={anchorDecision} />
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

      <div className="mb-6">
        <PartnerCtaRow country="US" state={data.state} source="assess-result" mode={audience.mode} surface={audience.surface} city={data.city} />
      </div>

      {/* THE SIGNAL — LLM narrative (src/lib/pipeline/us-narrative.ts), mirrors
          the Canadian /property/[slug] page's "The Signal" section layout. */}
      <div className="bg-gray-50/50 rounded-xl p-6 mb-6">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs uppercase tracking-widest text-muted">The Signal</div>
          {narrativeConfidence != null && narrativeConfidence > 0 && (
            <span className="text-xs text-muted font-mono">{Math.round(narrativeConfidence * 100)}% confidence</span>
          )}
        </div>
        {narrative ? (
          <div className="space-y-3">
            {narrative.split(/\n\n+/).map((para, i) => (
              <p key={i} className="text-sm text-foreground leading-relaxed">
                {para.trim()}
              </p>
            ))}
          </div>
        ) : (
          <p className="text-sm text-foreground leading-relaxed">Generating analysis — check back shortly.</p>
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

      <div className="mb-4">
        <ExpandableSection title="Valuation triangulation" defaultOpen={false}>
          <TriangulationDetail triangulation={triangulation} />
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
              {anchorDecision?.verdict === "context_only" && (
                <p className="text-xs text-amber-700 pt-1">
                  Assessed value appears decoupled from market value — common with agricultural exemptions,
                  assessment caps, or partial parcels. Not used as the offer anchor.
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

        <EquityTenureCard equitySignal={equitySignal} />
        {!rentalScreen && <InvestorYieldCard investorYield={investorYield} />}
        <RiskMomentumCard riskMomentum={riskMomentum} />
      </div>

      <OverAssessmentCallout overAssessment={overAssessment} />

      <div className="mb-6">
        <PartnerCta
          country="US"
          state={data.state}
          source="assess-result"
          mode={audience.mode}
          surface={audience.surface}
          heading="Act on this analysis"
          city={data.city}
        />
      </div>

      {/* Insurance module (Insurance Path Stage 2, Screen 1) */}
      <div className="mb-6">
        <InsuranceModule
          country="US"
          region={data.state}
          address={data.address}
          source="assess-result"
          mode={audience.mode}
          surface={audience.surface}
          listingId={listing.mlsNumber}
          yearBuilt={listing.yearBuilt}
          estimatedValue={assessment?.totalValue ?? listing.price}
          estimatedRent={investorYield?.monthlyRent}
          initialLine={lineForGoal(activeGoal)}
        />
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

function UsOffMarketView({ data, activeGoal }: { data: UsOffMarketResult; activeGoal: AssessmentGoal | null }) {
  const { assessment, avm, rent, marketPanel, equitySignal, triangulation, investorYield, riskMomentum, overAssessment } =
    data;
  const audience = assessmentAudience(activeGoal);
  const rentalScreen = buildRentalScreenModel({
    goal: activeGoal,
    capabilities: data.propertyCapabilities,
    addressRent: rent
      ? {
          value: rent.value,
          rangeLow: rent.rangeLow,
          rangeHigh: rent.rangeHigh,
          label: "Address-level rent estimate",
          source: "RentCast rent AVM · modeled, not a signed lease",
        }
      : null,
    regionalRent: regionalRentEvidence(data),
    yield: investorYield,
  });

  if (
    activeGoal === "rental_investment" &&
    rentalScreen &&
    !data.propertyCapabilities.items.grossYieldScreen.available
  ) {
    const audience = assessmentAudience("rental_investment");
    const rentReason = data.propertyCapabilities.items.addressRentEstimate.reason;
    const unitRentMismatch =
      rentReason === "unsupported_scope" &&
      (data.propertyClassification.buildingForm.value === "apartment" ||
        data.propertyClassification.buildingForm.value === "low-rise multi-unit");
    return (
      <div data-p5-us-rental-limited="true">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">{data.address}</h1>
          <p className="text-sm text-muted mt-0.5">{data.countyName}, {data.state}</p>
        </div>
        <RentalScreen model={rentalScreen} />
        <section className="border border-amber-200 bg-amber-50 rounded-xl p-5 mb-6">
          <div className="text-xs uppercase tracking-widest text-amber-700 mb-2">Property yield withheld</div>
          <h2 className="text-lg font-semibold text-amber-950 mb-2">
            {unitRentMismatch ? "The rent and value do not describe the same asset." : "A verified property yield is unavailable."}
          </h2>
          <p className="text-sm text-amber-900">
            {unitRentMismatch
              ? "For this multi-family property, RentCast's rent AVM describes one unit while its value AVM describes the whole building. A building yield requires total scheduled rent or a unit-by-unit rent roll."
              : rentReason === "missing_field"
                ? "No address-level rent estimate is available for the resolved property, so regional rent context cannot be divided by the property value."
                : "The available rent estimate does not match the resolved property scope, so it cannot be divided by the property value."}
          </p>
        </section>
        <div className="mb-6"><RiskMomentumCard riskMomentum={riskMomentum} /></div>
        <div className="mb-6">
          <PartnerCta
            country="US"
            state={data.state}
            source="assess-result"
            mode={audience.mode}
            surface={audience.surface}
            heading="Continue your rental analysis"
            city={data.city}
          />
        </div>
        <div className="mb-2 pt-4 border-t border-border">
          <div className="text-xs uppercase tracking-widest text-muted mb-3">County Context</div>
          <MarketPanelSection marketPanel={marketPanel} />
        </div>
        <FooterCredits marketPanel={marketPanel} />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">{data.address}</h1>
        <p className="text-sm text-muted mt-0.5">
          {data.countyName}, {data.state}
        </p>
      </div>

      {rentalScreen && <RentalScreen model={rentalScreen} />}

      <div className="border border-border rounded-xl p-5 sm:p-8 mb-6 text-center bg-white">
        {assessment?.found ? (
          <>
            <div className="text-xs uppercase tracking-widest text-muted mb-2">
              {assessment.source === "avm" ? "Estimated Value — RentCast AVM" : assessmentSourceLabel(assessment)}
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
                : assessment.liveCountySource
                  ? `${assessment.assessmentYear} property-specific ${
                      assessment.liveCountyValueKind === "market_value" ? "market value" : "tax-assessed value"
                    } published by the county assessor.`
                  : `${assessment.assessmentYear} county tax assessment.`}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted py-4">No value estimate available for this address yet.</p>
        )}
      </div>

      <div className="mb-6">
        <PartnerCtaRow country="US" state={data.state} source="assess-result" mode={audience.mode} surface={audience.surface} city={data.city} />
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

      <div className="mb-4">
        <ExpandableSection title="Valuation triangulation" defaultOpen={false}>
          <TriangulationDetail triangulation={triangulation} />
        </ExpandableSection>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <EquityTenureCard equitySignal={equitySignal} />
        {!rentalScreen && <InvestorYieldCard investorYield={investorYield} />}
        <RiskMomentumCard riskMomentum={riskMomentum} />
      </div>

      <OverAssessmentCallout overAssessment={overAssessment} />

      <div className="pt-2">
        <MarketPanelSection marketPanel={marketPanel} />
      </div>

      <div className="mb-6">
        <PartnerCta
          country="US"
          state={data.state}
          source="assess-result"
          mode={audience.mode}
          surface={audience.surface}
          heading="Act on this analysis"
          city={data.city}
        />
      </div>

      {/* Insurance module (Insurance Path Stage 2, Screen 1) */}
      <div className="mb-6">
        <InsuranceModule
          country="US"
          region={data.state}
          address={data.address}
          source="assess-result"
          mode={audience.mode}
          surface={audience.surface}
          estimatedValue={assessment?.totalValue}
          estimatedRent={rent?.value}
          initialLine={lineForGoal(activeGoal)}
        />
      </div>

      <FooterCredits marketPanel={marketPanel} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fallback variant (RentCast quota exhausted / down / no record) — the
// original county-median-only experience.
// ---------------------------------------------------------------------------

function UsFallbackView({ data, activeGoal }: { data: UsFallbackResult; activeGoal: AssessmentGoal | null }) {
  const { assessment, marketPanel } = data;
  const unavailable = usPropertyDataUnavailableMessage(
    data.propertyDataUnavailableReason,
    !!assessment?.liveCountySource
  );
  const audience = assessmentAudience(activeGoal);
  const rentalScreen = buildRentalScreenModel({
    goal: activeGoal,
    capabilities: data.propertyCapabilities,
    regionalRent: regionalRentEvidence(data),
  });

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">{data.address}</h1>
        <p className="text-sm text-muted mt-0.5">
          {data.countyName}, {data.state}
        </p>
      </div>

      {rentalScreen && <RentalScreen model={rentalScreen} />}

      <div
        className="border border-amber-200 bg-amber-50 rounded-xl p-4 mb-6 text-amber-900"
        data-property-data-unavailable-reason={data.propertyDataUnavailableReason}
      >
        <div className="text-sm font-semibold">{unavailable.title}</div>
        <p className="text-sm mt-1 text-amber-800">{unavailable.detail}</p>
      </div>

      <div className="border border-border rounded-xl p-5 sm:p-8 mb-6 text-center bg-white">
        {assessment?.found ? (
          <>
            <div className="text-xs uppercase tracking-widest text-muted mb-2">
              {assessment.liveCountySource ? assessmentSourceLabel(assessment) : US_COUNTY_FALLBACK_LABEL}
            </div>
            <div className="text-4xl sm:text-5xl font-mono font-bold mb-2">{fmt(assessment.totalValue)}</div>
            <p className="text-xs text-muted/70 max-w-sm mx-auto">
              {assessment.liveCountySource
                ? `${assessment.assessmentYear} property-specific ${
                    assessment.liveCountyValueKind === "market_value" ? "market value" : "tax-assessed value"
                  } published by the county assessor. It is not an active listing or appraisal.`
                : usCountyFallbackDisclosure(assessment.assessmentYear)}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted py-4">No assessment data available for this county yet.</p>
        )}
      </div>

      <div className="mb-6">
        <PartnerCtaRow country="US" state={data.state} source="assess-result" mode={audience.mode} surface={audience.surface} city={data.city} />
      </div>

      <div className="border border-amber-200 bg-amber-50 rounded-xl p-4 mb-6 text-sm text-amber-800">
        {usOfferModelUnavailableMessage(
          data.propertyDataUnavailableReason,
          !!assessment?.liveCountySource
        )}
      </div>

      <MarketPanelSection marketPanel={marketPanel} />

      <div className="mb-6">
        <PartnerCta
          country="US"
          state={data.state}
          source="assess-result"
          mode={audience.mode}
          surface={audience.surface}
          heading="Act on this analysis"
          city={data.city}
        />
      </div>

      <FooterCredits marketPanel={marketPanel} includeRentCast={false} />
    </div>
  );
}

function UsUnresolvedSubjectView({ data }: { data: UsAssessResult }) {
  const isBuilding = data.assessmentSubject.scope === "building";
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">{data.address}</h1>
        <p className="text-sm text-muted mt-0.5">
          {data.countyName}, {data.state}
        </p>
      </div>

      <section className="border border-amber-200 bg-amber-50 rounded-xl p-5 sm:p-6 mb-6" data-subject-evidence-withheld="true">
        <div className="text-xs uppercase tracking-widest text-amber-700 mb-2">Exact property required</div>
        <h2 className="text-lg font-semibold text-amber-950 mb-2">
          {isBuilding ? "This address contains multiple units." : "We could not resolve the exact assessment subject."}
        </h2>
        <p className="text-sm text-amber-900">
          {isBuilding
            ? "The building-level address does not identify which unit you mean. A unit in this building may be actively listed even when the whole building is not."
            : "The available property, listing, and address evidence do not describe the same subject."}
        </p>
        <p className="text-xs text-amber-800 mt-2">
          We withheld the returned value and rent rather than applying building or unit data to the wrong property.
        </p>
        <a
          href={`/assess?${new URLSearchParams({ address: data.address, journeys: "1" }).toString()}`}
          className="inline-flex mt-4 px-4 py-2 text-sm font-medium rounded-lg bg-amber-950 text-white hover:bg-amber-900 transition-colors"
        >
          Choose the exact unit or property &rarr;
        </a>
      </section>

      <div className="mb-2 pt-2">
        <div className="text-xs uppercase tracking-widest text-muted mb-3">Regional context only</div>
        <MarketPanelSection marketPanel={data.marketPanel} />
      </div>
      <FooterCredits marketPanel={data.marketPanel} includeRentCast={false} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export default function UsAssessmentResult({
  data,
  activeGoal = null,
}: {
  data: UsAssessResult;
  activeGoal?: AssessmentGoal | null;
}) {
  const withholdPropertyEvidence = shouldWithholdPropertyEvidence(
    data.assessmentSubject,
    data.propertyCapabilities
  );
  return (
    <div
      className="max-w-3xl mx-auto"
      data-assessment-subject-scope={data.assessmentSubject.scope}
      data-assessment-subject-selected-by={data.assessmentSubject.selectedBy}
      data-assessment-subject-confidence={data.assessmentSubject.resolutionConfidence}
      data-assessment-subject-needs-clarification={String(data.assessmentSubject.requiresClarification)}
      data-property-classification-confidence={data.propertyClassification.overallConfidence}
      data-property-parcel-use={data.propertyClassification.parcelUse.value}
      data-property-listing-scope={data.propertyClassification.listingScope.value}
      data-capability-address-sale={data.propertyCapabilities.items.addressSaleValuation.reason}
      data-capability-address-rent={data.propertyCapabilities.items.addressRentEstimate.reason}
      data-capability-offer={data.propertyCapabilities.items.offerAnalysis.reason}
      data-capability-insurance-prefill={data.propertyCapabilities.items.insurancePrefill.reason}
      data-p5-active-composition={activeGoal === "rental_investment" ? "rental" : "legacy"}
    >
      {withholdPropertyEvidence ? (
        <UsUnresolvedSubjectView data={data} />
      ) : data.offerAvailable ? (
        <UsListedView data={data} activeGoal={activeGoal} />
      ) : data.offerUnavailableReason === "not_listed" ? (
        <UsOffMarketView data={data} activeGoal={activeGoal} />
      ) : (
        <UsFallbackView data={data} activeGoal={activeGoal} />
      )}
    </div>
  );
}
