import type { Assessment } from "@/lib/types";
import type { CountyMarketPanel } from "@/lib/db/regional-econ";
import { fmt, pct } from "@/lib/utils";
import PartnerCta from "@/components/partner-cta";

/**
 * Shape returned by POST /api/assess for country==="US" — mirrors the JSON
 * built in src/app/api/assess/route.ts's handleUSAssessment(). Rendered
 * inline by AssessmentProgress (no slug/redirect — there's no /property/
 * page to send US results to, since there's no Listing to persist).
 */
export interface UsAssessResult {
  ok: true;
  country: "US";
  address: string;
  city: string;
  state: string;
  countyName: string;
  countyFips: string;
  assessment: Assessment | null;
  marketPanel: CountyMarketPanel | null;
  offerAvailable: false;
  offerUnavailableReason?: string;
  emailSent: boolean;
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

export default function UsAssessmentResult({ data }: { data: UsAssessResult }) {
  const { assessment, marketPanel } = data;

  const hasFmr =
    marketPanel &&
    [marketPanel.fmrStudio, marketPanel.fmr1br, marketPanel.fmr2br, marketPanel.fmr3br, marketPanel.fmr4br].some(
      (v) => v != null
    );
  const hasFema = marketPanel && (marketPanel.femaRiskScore != null || marketPanel.femaEalScore != null);
  const hasHpi = marketPanel && marketPanel.hpiLatest != null;

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">{data.address}</h1>
        <p className="text-sm text-muted mt-0.5">
          {data.countyName}, {data.state}
        </p>
      </div>

      {/* Hero — county median home value */}
      <div className="border border-border rounded-xl p-5 sm:p-8 mb-6 text-center bg-white">
        {assessment?.found ? (
          <>
            <div className="text-xs uppercase tracking-widest text-muted mb-2">
              County Median Home Value — Modeled Estimate
            </div>
            <div className="text-4xl sm:text-5xl font-mono font-bold mb-2">
              {fmt(assessment.totalValue)}
            </div>
            <p className="text-xs text-muted/70 max-w-sm mx-auto">
              Based on US Census ACS county-level median ({assessment.assessmentYear}), not
              property-specific. Treat as approximate.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted py-4">
            No assessment data available for this county yet.
          </p>
        )}
      </div>

      {/* Offer availability note — honest "why not" instead of silently omitting */}
      <div className="border border-amber-200 bg-amber-50 rounded-xl p-4 mb-6 text-sm text-amber-800">
        Offer modeling isn&apos;t available here — it needs a specific listing (asking price,
        days on market), and this is a county-level lookup with no listing attached.
      </div>

      {/* County Market Snapshot */}
      {marketPanel ? (
        <div className="mb-6">
          <div className="text-xs uppercase tracking-widest text-muted mb-3">
            County Market Snapshot
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {marketPanel.medianGrossRent != null && (
              <StatCard
                label="Median Gross Rent"
                value={fmt(marketPanel.medianGrossRent) + "/mo"}
                vintage={marketPanel.vintages["median_gross_rent"]}
              />
            )}
            {marketPanel.vacancyRate != null && (
              <StatCard
                label="Vacancy Rate"
                value={pct(marketPanel.vacancyRate)}
                vintage={marketPanel.vintages["vacancy_rate"]}
              />
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
              <div className="text-xs uppercase tracking-widest text-muted mb-3">
                HUD Fair Market Rent
              </div>
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
      ) : (
        <p className="text-sm text-muted mb-6">
          County market data isn&apos;t available for this area yet.
        </p>
      )}

      {/* Next Steps */}
      <div className="mb-6">
        <div className="text-xs uppercase tracking-widest text-muted mb-3">Next Steps</div>
        <PartnerCta country="US" state={data.state} source="assess-result" city={data.city} />
      </div>

      <p className="text-xs text-muted/60 text-center pt-4 border-t border-border">
        Data: US Census ACS 5-Year Estimates
        {marketPanel?.vintages["hpi"] ? " · FHFA House Price Index" : ""}
        {hasFema ? " · FEMA National Risk Index" : ""}
        {hasFmr ? " · HUD Fair Market Rents" : ""}
      </p>
    </div>
  );
}
