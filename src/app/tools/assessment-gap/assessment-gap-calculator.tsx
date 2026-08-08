"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { getStatCanMedian } from "@/lib/data/statcan-chsp";
import PartnerCta from "@/components/partner-cta";

type Region = "" | "BC" | "AB" | "ON" | UsRegion;

// USPS codes for all 50 states + DC. US regions don't have a StatCan median
// lookup (that data is Canada-only, keyed by CSD/city name) — the median
// context line is simply omitted for these, see `cityMedian` below.
type UsRegion =
  | "AL" | "AK" | "AZ" | "AR" | "CA" | "CO" | "CT" | "DE" | "DC" | "FL"
  | "GA" | "HI" | "ID" | "IL" | "IN" | "IA" | "KS" | "KY" | "LA" | "ME"
  | "MD" | "MA" | "MI" | "MN" | "MS" | "MO" | "MT" | "NE" | "NV" | "NH"
  | "NJ" | "NM" | "NY" | "NC" | "ND" | "OH" | "OK" | "OR" | "PA" | "RI"
  | "SC" | "SD" | "TN" | "TX" | "UT" | "VT" | "VA" | "WA" | "WV" | "WI"
  | "WY";

const CA_REGIONS = new Set(["BC", "AB", "ON"]);

const US_STATES: { code: UsRegion; name: string }[] = [
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

interface Verdict {
  key: string;
  label: string;
  badgeClass: string;
  summary: string;
  detail: string;
}

function getVerdict(gapPct: number): Verdict {
  if (gapPct < 0) {
    return {
      key: "below",
      label: "Below Assessment",
      badgeClass: "bg-blue-50 text-blue-600",
      summary: "The asking price is below the government-assessed value.",
      detail:
        "This can signal a motivated or distressed seller, a slower local market, or simply an assessment that hasn't caught up to a recent runup. It's worth understanding why before assuming it's a bargain — check comparable sales and days on market.",
    };
  }
  if (gapPct < 10) {
    return {
      key: "near",
      label: "Near Assessment",
      badgeClass: "bg-green-100 text-green-700",
      summary: "The asking price closely tracks the assessed value.",
      detail:
        "This is roughly what you'd expect in a balanced market with a reasonably current assessment. It's a defensible starting point for an offer, though comparable sales still matter more than the assessment alone.",
    };
  }
  if (gapPct < 25) {
    return {
      key: "moderate",
      label: "Moderate Premium",
      badgeClass: "bg-amber-100 text-amber-700",
      summary: "The asking price carries a meaningful premium over assessed value.",
      detail:
        "Common in competitive or appreciating markets, or where the assessment lags current conditions. There's often still room to negotiate — lean on recent comparable sales to judge whether the premium is justified.",
    };
  }
  return {
    key: "steep",
    label: "Steep Premium",
    badgeClass: "bg-red-100 text-red-700",
    summary: "The asking price is far above the assessed value.",
    detail:
      "This can reflect a hot local market, an unusually low or outdated assessment, or an aggressive listing strategy. Don't anchor to the assessment alone here — verify against comparable sales before offering anywhere near asking.",
  };
}

export default function AssessmentGapCalculator() {
  const [assessed, setAssessed] = useState("");
  const [asking, setAsking] = useState("");
  const [region, setRegion] = useState<Region>("");
  const [city, setCity] = useState("");

  const assessedNum = parseFloat(assessed.replace(/[^0-9.]/g, ""));
  const askingNum = parseFloat(asking.replace(/[^0-9.]/g, ""));

  const result = useMemo(() => {
    if (!assessedNum || assessedNum <= 0 || !askingNum || askingNum <= 0) return null;
    const gapDollar = askingNum - assessedNum;
    const gapPct = (gapDollar / assessedNum) * 100;
    return { gapDollar, gapPct, verdict: getVerdict(gapPct) };
  }, [assessedNum, askingNum]);

  // StatCan CHSP median lookup is Canada-only data (keyed by CSD/city name) —
  // skip it entirely for US regions rather than surfacing a bogus match.
  const isUsRegion = region !== "" && !CA_REGIONS.has(region);

  // Partner CTAs: default to the CA vendor slate (the calculator is CA-focused
  // today) with no state gate; switch to US + the selected state once the
  // visitor picks a US region. PartnerCta handles an undefined state fine —
  // CA vendors are stateCoverage: "all".
  const partnerCountry = isUsRegion ? "US" : "CA";
  const partnerState = region || undefined;

  const cityMedian = useMemo(() => {
    if (!city.trim() || isUsRegion) return null;
    return getStatCanMedian(city.trim());
  }, [city, isUsRegion]);

  return (
    <div>
      {/* Form */}
      <div className="border border-border rounded-xl p-4 sm:p-6 bg-white">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label htmlFor="assessed" className="block text-xs font-medium text-muted uppercase tracking-wide mb-1.5">
              Assessed value
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
              <input
                id="assessed"
                type="text"
                inputMode="numeric"
                value={assessed}
                onChange={(e) => setAssessed(e.target.value)}
                placeholder="850,000"
                className="w-full pl-6 pr-3 py-2.5 text-sm rounded-lg border border-border bg-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-foreground/20 transition-all"
              />
            </div>
          </div>

          <div>
            <label htmlFor="asking" className="block text-xs font-medium text-muted uppercase tracking-wide mb-1.5">
              Asking price
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
              <input
                id="asking"
                type="text"
                inputMode="numeric"
                value={asking}
                onChange={(e) => setAsking(e.target.value)}
                placeholder="949,000"
                className="w-full pl-6 pr-3 py-2.5 text-sm rounded-lg border border-border bg-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-foreground/20 transition-all"
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="region" className="block text-xs font-medium text-muted uppercase tracking-wide mb-1.5">
              Region <span className="normal-case text-muted/70">(optional)</span>
            </label>
            <select
              id="region"
              value={region}
              onChange={(e) => setRegion(e.target.value as Region)}
              className="w-full text-sm border border-border rounded-lg px-3 py-2.5 bg-white text-foreground focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-foreground/20 transition-all"
            >
              <option value="">Select region</option>
              <optgroup label="Canada">
                <option value="BC">British Columbia</option>
                <option value="AB">Alberta</option>
                <option value="ON">Ontario</option>
              </optgroup>
              <optgroup label="United States">
                {US_STATES.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>

          <div>
            <label htmlFor="city" className="block text-xs font-medium text-muted uppercase tracking-wide mb-1.5">
              City <span className="normal-case text-muted/70">(optional)</span>
            </label>
            <input
              id="city"
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="e.g. Victoria"
              className="w-full px-3 py-2.5 text-sm rounded-lg border border-border bg-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-foreground/20 transition-all"
            />
          </div>
        </div>
      </div>

      {/* Results */}
      {result ? (
        <div className="mt-6 border border-border rounded-xl p-4 sm:p-6 bg-white">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
            <div>
              <div className="text-xs font-medium text-muted uppercase tracking-wide mb-1">Assessment gap</div>
              <div className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
                {result.gapDollar >= 0 ? "+" : "-"}${Math.abs(Math.round(result.gapDollar)).toLocaleString()}
                <span className="text-base font-medium text-muted ml-2">
                  ({result.gapPct >= 0 ? "+" : ""}{result.gapPct.toFixed(1)}%)
                </span>
              </div>
            </div>
            <span className={`inline-block self-start sm:self-auto text-xs font-semibold px-3 py-1.5 rounded-full ${result.verdict.badgeClass}`}>
              {result.verdict.label}
            </span>
          </div>

          <p className="text-sm text-foreground font-medium mb-1.5">{result.verdict.summary}</p>
          <p className="text-sm text-muted leading-relaxed">{result.verdict.detail}</p>

          {cityMedian && (
            <div className="mt-4 pt-4 border-t border-border">
              <p className="text-xs text-muted">
                Median assessed value in {cityMedian.csdName}:{" "}
                <span className="font-medium text-foreground">
                  ${cityMedian.medianAssessment.toLocaleString()}
                </span>{" "}
                (StatCan CHSP, {cityMedian.year})
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-6 text-center text-xs text-muted">
          Enter an assessed value and asking price above to see the gap.
        </div>
      )}

      {result && (
        <div className="mt-6">
          <PartnerCta country={partnerCountry} state={partnerState} source="calculator" />
        </div>
      )}

      <p className="mt-4 text-xs text-muted/80 leading-relaxed">
        Assessment-to-market relationships vary by municipality and assessment vintage — a property&apos;s
        assessment may be 6&ndash;18 months out of date relative to current market conditions. Use this as a
        starting signal, not a substitute for comparable sales.
      </p>

      {/* CTA */}
      <div className="text-center mt-10 mb-4">
        <Link
          href="/"
          className="inline-block px-6 py-2.5 text-sm font-medium rounded-full bg-foreground text-white hover:bg-foreground/90 transition-colors"
        >
          Get a full offer analysis for a specific address
        </Link>
      </div>
    </div>
  );
}
