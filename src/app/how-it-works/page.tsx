import type { Metadata } from "next";
import Link from "next/link";
import { FaqJsonLd } from "@/components/json-ld";

const FAQ_ITEMS = [
  {
    question: "How does Property Insights calculate the recommended offer price?",
    answer: "We anchor to government-assessed property values, then adjust for days on market, listing language signals (estate sales, price drops, urgency language), and market position. The result is a data-backed offer range — not a guess.",
  },
  {
    question: "What is the motivation score?",
    answer: "A 0–100 index that measures seller pressure by combining days on market, price history, and AI analysis of the listing description. Higher scores suggest more room to negotiate.",
  },
  {
    question: "Can I assess a property that isn't in your listings?",
    answer: "Yes. Paste a Zoocasa listing URL into the search bar or type any Canadian street address. Sign up for a free account and we'll run a full assessment — including offer modeling — and email you the report.",
  },
  {
    question: "Which provinces are supported?",
    answer: "We currently cover British Columbia, Alberta, and Ontario. Assessment data comes from BC Assessment, Calgary and Edmonton SODA APIs, and Ontario MPAC records.",
  },
  {
    question: "How often is the data updated?",
    answer: "Listings refresh daily. Sold or delisted properties are automatically detected and removed each week.",
  },
];

export const metadata: Metadata = {
  title: "How It Works — Assessment-Backed Offer Intelligence",
  description:
    "Learn how Property Insights uses government assessment values, days on market, and AI listing analysis to calculate what you should offer on a Canadian property.",
  alternates: { canonical: "/how-it-works" },
};

export default function HowItWorksPage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-8 sm:py-16">
      {/* Hero */}
      <div className="text-center mb-8 sm:mb-20">
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground mb-3">
          Acquisition intelligence, not another listing site.
        </h1>
        <p className="text-sm sm:text-base text-muted max-w-xl mx-auto">
          Property Insights analyzes government assessments, days on market, and
          listing language to find where sellers are most likely to negotiate —
          then tells you exactly what to offer.
        </p>
      </div>

      {/* Two ways to use it */}
      <div className="mb-8 sm:mb-20">
        <h2 className="text-xs font-medium text-muted uppercase tracking-wide mb-5 sm:mb-8 text-center">
          Two ways to use it
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          {/* On-demand assessment first on mobile (higher conversion value) */}
          <div className="border border-border rounded-xl p-4 sm:p-6 order-first sm:order-last">
            <div className="w-10 h-10 rounded-full border border-border flex items-center justify-center mb-3 sm:mb-4">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-foreground" xmlns="http://www.w3.org/2000/svg">
                <path d="M3 10.5L12 3l9 7.5V21a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V10.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M12 11v4m-2-2h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </div>
            <h3 className="text-sm font-medium text-foreground mb-1">Assess any listing on demand</h3>
            <p className="text-sm text-muted leading-relaxed mb-3">
              Found a property you&apos;re interested in? Paste a Zoocasa listing
              URL into the search bar and press Enter — or type any Canadian
              street address. Sign up for free and we&apos;ll run the full
              analysis and email you a complete report.
            </p>
            <p className="text-xs text-muted">
              Works with any active residential listing across BC, Alberta, and Ontario.
            </p>
          </div>

          <div className="border border-border rounded-xl p-4 sm:p-6">
            <div className="w-10 h-10 rounded-full border border-border flex items-center justify-center mb-3 sm:mb-4">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-foreground" xmlns="http://www.w3.org/2000/svg">
                <rect x="3" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.5"/>
                <rect x="14" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.5"/>
                <rect x="3" y="14" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.5"/>
                <rect x="14" y="14" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.5"/>
              </svg>
            </div>
            <h3 className="text-sm font-medium text-foreground mb-1">Browse pre-analyzed listings</h3>
            <p className="text-sm text-muted leading-relaxed mb-3">
              We&apos;ve already scored and modeled offers for 250 properties
              across 10 Canadian cities. Filter by province and city, sort by
              motivation score, and click into any property for the full
              breakdown. No sign-up required.
            </p>
            <Link
              href="/"
              className="inline-block text-xs font-medium text-foreground underline underline-offset-2 hover:text-foreground/70 transition-colors"
            >
              Explore listings
            </Link>
          </div>
        </div>
      </div>

      {/* 3 Steps */}
      <div className="mb-8 sm:mb-20">
        <h2 className="text-xs font-medium text-muted uppercase tracking-wide mb-5 sm:mb-8 text-center">
          How the analysis works
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-10 text-center">
          <div>
            <div className="w-10 h-10 rounded-full border border-border flex items-center justify-center mx-auto mb-3 sm:mb-4">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-foreground" xmlns="http://www.w3.org/2000/svg">
                <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M16.5 16.5L21 21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </div>
            <h3 className="text-sm font-medium text-foreground mb-1">Find the data</h3>
            <p className="text-sm text-muted leading-relaxed">
              Government assessment values, active listings, and
              days-on-market history for every property.
            </p>
          </div>

          <div>
            <div className="w-10 h-10 rounded-full border border-border flex items-center justify-center mx-auto mb-3 sm:mb-4">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-foreground" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2L14 8.5L21 9.5L16 14L17.5 21L12 17.5L6.5 21L8 14L3 9.5L10 8.5L12 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
              </svg>
            </div>
            <h3 className="text-sm font-medium text-foreground mb-1">Score motivation</h3>
            <p className="text-sm text-muted leading-relaxed">
              AI scans listing descriptions for motivation signals — estate
              sales, price drops, urgency language — that keyword searches miss.
            </p>
          </div>

          <div>
            <div className="w-10 h-10 rounded-full border border-border flex items-center justify-center mx-auto mb-3 sm:mb-4">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-foreground" xmlns="http://www.w3.org/2000/svg">
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5"/>
                <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.5"/>
                <circle cx="12" cy="12" r="1" fill="currentColor"/>
              </svg>
            </div>
            <h3 className="text-sm font-medium text-foreground mb-1">Get the offer</h3>
            <p className="text-sm text-muted leading-relaxed">
              A recommended offer price backed by assessment gaps, market
              timing, and seller motivation — with full transparency.
            </p>
          </div>
        </div>

        <p className="text-xs text-muted text-center mt-6 sm:mt-8">
          Listings refresh daily. Sold or delisted properties are automatically removed each week.
        </p>
      </div>

      {/* What you see */}
      <div className="mb-8 sm:mb-20">
        <h2 className="text-xs font-medium text-muted uppercase tracking-wide mb-5 sm:mb-8 text-center">
          What you see on every property
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          <div className="border border-border rounded-xl p-4 sm:p-5">
            <div className="text-sm font-medium text-foreground mb-1">
              Recommended Offer
            </div>
            <p className="text-sm text-muted leading-relaxed">
              Assessment-anchored price adjusted for days on market, signals,
              and market position.
            </p>
          </div>

          <div className="border border-border rounded-xl p-4 sm:p-5">
            <div className="text-sm font-medium text-foreground mb-1">
              The Signal
            </div>
            <p className="text-sm text-muted leading-relaxed">
              AI-written investor briefing explaining why this property and
              offer make sense.
            </p>
          </div>

          <div className="border border-border rounded-xl p-4 sm:p-5">
            <div className="text-sm font-medium text-foreground mb-1">
              Motivation Score
            </div>
            <p className="text-sm text-muted leading-relaxed">
              0–100 seller pressure index combining DOM, price history, and
              listing language.
            </p>
          </div>

          <div className="border border-border rounded-xl p-4 sm:p-5">
            <div className="text-sm font-medium text-foreground mb-1">
              Score Breakdown
            </div>
            <p className="text-sm text-muted leading-relaxed">
              Every scoring factor with points — full transparency on how the
              offer was calculated.
            </p>
          </div>

          <div className="border border-border rounded-xl p-4 sm:p-5">
            <div className="text-sm font-medium text-foreground mb-1">
              Sold Comparables
            </div>
            <p className="text-sm text-muted leading-relaxed">
              Recently sold properties matched by size, type, and neighbourhood
              to contextualize the offer.
            </p>
          </div>

          <div className="border border-border rounded-xl p-4 sm:p-5">
            <div className="text-sm font-medium text-foreground mb-1">
              Tier Rating
            </div>
            <p className="text-sm text-muted leading-relaxed">
              Every property is rated Hot, Warm, or Cool based on its motivation
              score — so you can prioritize at a glance.
            </p>
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="text-center mb-16">
        <Link
          href="/"
          className="inline-block px-6 py-2.5 text-sm font-medium rounded-full bg-foreground text-white hover:bg-foreground/90 transition-colors"
        >
          Explore properties
        </Link>
      </div>

      <FaqJsonLd questions={FAQ_ITEMS} />
    </main>
  );
}
