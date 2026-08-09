"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import PartnerCta from "@/components/partner-cta";

// USPS codes for all 50 states + DC — this tool is US-focused (property tax
// appeals are a US county-assessor concept), so unlike the assessment-gap
// calculator there's no Canada optgroup here.
type UsState =
  | "AL" | "AK" | "AZ" | "AR" | "CA" | "CO" | "CT" | "DE" | "DC" | "FL"
  | "GA" | "HI" | "ID" | "IL" | "IN" | "IA" | "KS" | "KY" | "LA" | "ME"
  | "MD" | "MA" | "MI" | "MN" | "MS" | "MO" | "MT" | "NE" | "NV" | "NH"
  | "NJ" | "NM" | "NY" | "NC" | "ND" | "OH" | "OK" | "OR" | "PA" | "RI"
  | "SC" | "SD" | "TN" | "TX" | "UT" | "VT" | "VA" | "WA" | "WV" | "WI"
  | "WY";

const US_STATES: { code: UsState; name: string }[] = [
  { code: "AL", name: "Alabama" }, { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" }, { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" }, { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" }, { code: "DE", name: "Delaware" },
  { code: "DC", name: "District of Columbia" }, { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" }, { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" }, { code: "IL", name: "Illinois" },
  { code: "IN", name: "Indiana" }, { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" }, { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" }, { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" }, { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" }, { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" }, { code: "MO", name: "Missouri" },
  { code: "MT", name: "Montana" }, { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" }, { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" }, { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" }, { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" }, { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" }, { code: "OR", name: "Oregon" },
  { code: "PA", name: "Pennsylvania" }, { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" }, { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" }, { code: "TX", name: "Texas" },
  { code: "UT", name: "Utah" }, { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" }, { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" }, { code: "WI", name: "Wisconsin" },
  { code: "WY", name: "Wyoming" },
];

// Typical US effective property-tax rate used to translate an over-assessed
// dollar amount into an estimated annual savings figure. This is a rough
// nationwide average (actual rates run roughly 0.3%-2.5% by county) — stated
// plainly in the UI as an assumption, not a promise.
const TYPICAL_EFFECTIVE_TAX_RATE = 0.011;

const CHECKLIST_STEPS = [
  {
    title: "Get your assessment notice",
    detail: "Find the notice your county assessor mailed showing this year's assessed value — it usually arrives before tax bills go out.",
  },
  {
    title: "Check the deadline",
    detail: "Appeal windows are short and vary by county — usually 30 to 60 days after assessment notices mail. Miss it and you wait until next year.",
  },
  {
    title: "Gather 3-5 comparable sales",
    detail: "Look for similar homes near you that sold recently for less than your assessed value — these are your strongest evidence.",
  },
  {
    title: "File with your county's board",
    detail: "Most counties have a formal appeals board or assessment review process, usually with an online form and a filing fee (if any) under $50.",
  },
  {
    title: "Or use a service that does it for you",
    detail: "Several companies handle the paperwork and comparables for you, often for a share of what you save — worth it if your time is tight.",
  },
];

interface Verdict {
  key: "fair" | "borderline" | "high";
  label: string;
  badgeClass: string;
  summary: string;
  detail: string;
}

function getVerdict(gapPct: number): Verdict {
  if (gapPct <= 0) {
    return {
      key: "fair",
      label: "Looks Fair",
      badgeClass: "bg-green-100 text-green-700",
      summary: "Your assessment looks fair or low — appealing probably isn't worth it.",
      detail:
        "Your assessed value is at or below what your home is actually worth. Appeals boards generally only lower assessments, so there's little upside here — but it's still worth a quick comparable-sales check every year or two in case that changes.",
    };
  }
  if (gapPct <= 7) {
    return {
      key: "borderline",
      label: "Borderline",
      badgeClass: "bg-amber-100 text-amber-700",
      summary: "Borderline — worth checking comparables.",
      detail:
        "Your assessed value is a bit above what your home is likely worth. This is within the range where county mass-appraisal models can reasonably land, but it's worth pulling 3-5 recent comparable sales to see if the gap is bigger than it looks.",
    };
  }
  return {
    key: "high",
    label: "Looks High",
    badgeClass: "bg-red-100 text-red-700",
    summary: "Your assessment looks high — an appeal could save you real money.",
    detail:
      "Your assessed value is meaningfully above what your home is likely worth. This is the range where a formal appeal, backed by comparable sales, has a real chance of lowering your assessment and your tax bill.",
  };
}

export default function AppealChecker() {
  const [assessed, setAssessed] = useState("");
  const [market, setMarket] = useState("");
  const [state, setState] = useState<UsState | "">("");

  const assessedNum = parseFloat(assessed.replace(/[^0-9.]/g, ""));
  const marketNum = parseFloat(market.replace(/[^0-9.]/g, ""));

  const result = useMemo(() => {
    if (!assessedNum || assessedNum <= 0 || !marketNum || marketNum <= 0) return null;

    const overAssessedAmount = assessedNum - marketNum;
    const gapPct = (overAssessedAmount / marketNum) * 100;
    const verdict = getVerdict(gapPct);

    let savingsLow: number | null = null;
    let savingsHigh: number | null = null;
    if (overAssessedAmount > 0) {
      const fullSavings = overAssessedAmount * TYPICAL_EFFECTIVE_TAX_RATE;
      // Appeals rarely close the full gap — show a range from a partial win
      // (half the over-assessed amount) up to a full win (the whole gap).
      savingsLow = fullSavings * 0.5;
      savingsHigh = fullSavings;
    }

    return { overAssessedAmount, gapPct, verdict, savingsLow, savingsHigh };
  }, [assessedNum, marketNum]);

  return (
    <div>
      {/* Form */}
      <div className="border border-border rounded-xl p-4 sm:p-6 bg-white">
        <div className="max-w-md space-y-5">
          <div>
            <label htmlFor="assessed" className="block text-xs font-medium text-muted uppercase tracking-wide mb-1.5">
              What is your property&apos;s assessed value?
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
              <input
                id="assessed"
                type="text"
                inputMode="numeric"
                value={assessed}
                onChange={(e) => setAssessed(e.target.value)}
                placeholder="450,000"
                className="w-full pl-6 pr-3 py-2.5 text-sm rounded-lg border border-border bg-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-foreground/20 transition-all"
              />
            </div>
          </div>

          <div>
            <label htmlFor="market" className="block text-xs font-medium text-muted uppercase tracking-wide mb-1.5">
              What do you think your home is actually worth?
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
              <input
                id="market"
                type="text"
                inputMode="numeric"
                value={market}
                onChange={(e) => setMarket(e.target.value)}
                placeholder="400,000"
                className="w-full pl-6 pr-3 py-2.5 text-sm rounded-lg border border-border bg-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-foreground/20 transition-all"
              />
            </div>
            <p className="mt-1.5 text-xs text-muted/80 leading-relaxed">
              Use a recent appraisal, a neighbor&apos;s sale, or our free estimate —{" "}
              <Link href="/" className="text-foreground underline underline-offset-2 hover:text-foreground/70 transition-colors">
                search your address
              </Link>
              .
            </p>
          </div>

          <div>
            <label htmlFor="state" className="block text-xs font-medium text-muted uppercase tracking-wide mb-1.5">
              State <span className="normal-case text-muted/70">(optional)</span>
            </label>
            <select
              id="state"
              value={state}
              onChange={(e) => setState(e.target.value as UsState | "")}
              className="w-full text-sm border border-border rounded-lg px-3 py-2.5 bg-white text-foreground focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-foreground/20 transition-all"
            >
              <option value="">Select state</option>
              {US_STATES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Results */}
      {result ? (
        <div className="mt-6 border border-border rounded-xl p-4 sm:p-6 bg-white">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
            <div>
              <div className="text-xs font-medium text-muted uppercase tracking-wide mb-1">
                Assessment vs. market value
              </div>
              <div className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
                {result.overAssessedAmount >= 0 ? "+" : "-"}$
                {Math.abs(Math.round(result.overAssessedAmount)).toLocaleString()}
                <span className="text-base font-medium text-muted ml-2">
                  ({result.gapPct >= 0 ? "+" : ""}
                  {result.gapPct.toFixed(1)}%)
                </span>
              </div>
            </div>
            <span
              className={`inline-block self-start sm:self-auto text-xs font-semibold px-3 py-1.5 rounded-full ${result.verdict.badgeClass}`}
            >
              {result.verdict.label}
            </span>
          </div>

          <p className="text-sm text-foreground font-medium mb-1.5">{result.verdict.summary}</p>
          <p className="text-sm text-muted leading-relaxed">{result.verdict.detail}</p>

          {result.savingsLow !== null && result.savingsHigh !== null && (
            <div className="mt-4 pt-4 border-t border-border">
              <div className="text-xs font-medium text-muted uppercase tracking-wide mb-1">
                Estimated annual savings
              </div>
              <p className="text-lg font-semibold tracking-tight text-foreground">
                ${Math.round(result.savingsLow).toLocaleString()} &ndash; $
                {Math.round(result.savingsHigh).toLocaleString()}
                <span className="text-sm font-normal text-muted"> / year</span>
              </p>
              <p className="mt-1.5 text-xs text-muted/80 leading-relaxed">
                Assumes a typical {(TYPICAL_EFFECTIVE_TAX_RATE * 100).toFixed(1)}% effective property-tax rate applied
                to the over-assessed amount, with a partial-to-full win range since most appeals don&apos;t close the
                entire gap. Actual rates run roughly 0.3%&ndash;2.5% depending on your county — check your own tax
                bill for the real number.
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-6 text-center text-xs text-muted">
          Enter an assessed value and market value above to see if an appeal is worth it.
        </div>
      )}

      {/* How to appeal checklist */}
      {result && (
        <div className="mt-6 border border-border rounded-xl p-4 sm:p-6 bg-white">
          <h3 className="text-sm font-semibold text-foreground mb-4">How to appeal</h3>
          <ol className="space-y-4">
            {CHECKLIST_STEPS.map((step, i) => (
              <li key={step.title} className="flex gap-3">
                <span className="shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-foreground text-white text-xs font-semibold">
                  {i + 1}
                </span>
                <div>
                  <p className="text-sm font-medium text-foreground">{step.title}</p>
                  <p className="text-sm text-muted leading-relaxed">{step.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {result && (
        <div className="mt-6">
          <PartnerCta
            country="US"
            state={state || undefined}
            source="calculator"
            surface="calculator"
            heading="Get help with your appeal"
          />
        </div>
      )}

      {/* Internal funnel box */}
      <div className="mt-6 border border-border rounded-xl p-4 sm:p-5 bg-white text-center">
        <p className="text-sm text-muted">
          Not sure what your home is worth?{" "}
          <Link href="/" className="font-medium text-foreground underline underline-offset-2 hover:text-foreground/70 transition-colors">
            Get a free estimate &rarr;
          </Link>
        </p>
      </div>
    </div>
  );
}
