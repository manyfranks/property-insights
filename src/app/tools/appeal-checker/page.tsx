import type { Metadata } from "next";
import Link from "next/link";
import { BASE_URL, SITE_NAME } from "@/lib/seo";
import { BreadcrumbJsonLd, FaqJsonLd } from "@/components/json-ld";
import AppealChecker from "./appeal-checker";

const FAQ_ITEMS = [
  {
    question: "How do I know if my property assessment is too high?",
    answer:
      "Compare your assessed value to what your home would actually sell for today — a recent appraisal, a comparable neighbor's sale, or a market estimate. If your assessed value is meaningfully above that number, especially by more than about 7-10%, it's usually worth a closer look. Assessments are set on a fixed valuation date and can lag a fast-moving market by a year or more.",
  },
  {
    question: "How much can a property tax appeal save?",
    answer:
      "It depends on the size of the gap between your assessed value and actual market value, plus your local tax rate. As a rough guide, every $10,000 your assessment is reduced saves roughly $80-150 a year at typical US effective tax rates (about 0.8%-1.5%). Successful appeals often reduce the assessed value by 5-15%, though results vary widely by county and case.",
  },
  {
    question: "Is it worth appealing?",
    answer:
      "If the gap between assessed value and market value is small, probably not — the time and any filing fee may not be worth it. If your assessment looks high by 7% or more, it's usually worth at least pulling comparable sales to check. Many appeals cost little more than an afternoon, and some services only charge if you actually save money.",
  },
  {
    question: "What's the deadline?",
    answer:
      "Deadlines are set by each county and typically fall 30-60 days after assessment notices are mailed, though some jurisdictions allow longer or shorter windows. Check your notice for the exact date, or search '[your county] property tax appeal deadline' — missing it usually means waiting until the next assessment cycle.",
  },
];

export const metadata: Metadata = {
  title: "Is My Property Assessment Too High? Free Appeal Checker | Property Insights",
  description:
    "Free tool: enter your assessed value and what your home is actually worth to see if you should appeal your property tax assessment, plus a plain-language 5-step guide to filing an appeal.",
  alternates: { canonical: "/tools/appeal-checker" },
  openGraph: {
    title: "Is My Property Assessment Too High? Free Appeal Checker | Property Insights",
    description:
      "Enter your assessed value and estimated market value to see instantly whether appealing your property tax assessment is worth it — plus estimated savings and how to file.",
    url: `${BASE_URL}/tools/appeal-checker`,
    siteName: SITE_NAME,
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Is My Property Assessment Too High? Free Appeal Checker | Property Insights",
    description:
      "Enter your assessed value and estimated market value to see instantly whether appealing your property tax assessment is worth it.",
  },
};

export default function AppealCheckerPage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-8 sm:py-16">
      {/* Hero */}
      <div className="text-center mb-8 sm:mb-14">
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground mb-3">
          Is My Property Assessment Too High?
        </h1>
        <p className="text-sm sm:text-base text-muted max-w-xl mx-auto">
          Enter your assessed value and what you think your home is actually
          worth. We&apos;ll tell you plainly whether appealing your property
          tax assessment is likely worth it — and roughly how much it could
          save you.
        </p>
      </div>

      <AppealChecker />

      {/* Explainer */}
      <div className="mt-16 sm:mt-24">
        <h2 className="text-xs font-medium text-muted uppercase tracking-wide mb-5 sm:mb-8 text-center">
          Understanding your assessment
        </h2>
        <div className="space-y-5 sm:space-y-6 text-sm text-muted leading-relaxed">
          <div className="border-b border-border pb-5 sm:pb-6">
            <h3 className="text-sm font-medium text-foreground mb-1.5">
              Assessed value vs. market value
            </h3>
            <p>
              Assessed value is a government estimate of your property&apos;s
              worth, set by your county assessor and used to calculate your
              property tax bill. Market value is what a buyer would actually
              pay for your home today. The two are related but not the same —
              assessors use mass-appraisal models across thousands of
              properties at once, so any single home can be over- or
              under-assessed relative to what it would really sell for.
            </p>
          </div>
          <div className="border-b border-border pb-5 sm:pb-6">
            <h3 className="text-sm font-medium text-foreground mb-1.5">
              Why assessments lag the market
            </h3>
            <p>
              Most counties only reassess property values on a fixed annual
              or multi-year cycle, using a valuation date that can be months
              or even years in the past. If your local market has moved a lot
              since that date — up or down — your assessed value can drift
              noticeably out of step with what your home is actually worth
              right now.
            </p>
          </div>
          <div>
            <h3 className="text-sm font-medium text-foreground mb-1.5">
              Want the data side of this?
            </h3>
            <p>
              This tool focuses on whether an appeal is worth pursuing. For a
              closer look at how a property&apos;s assessed value compares to
              its asking or sale price — useful when you&apos;re evaluating a
              purchase, not just your own tax bill — see our{" "}
              <Link
                href="/tools/assessment-gap"
                className="text-foreground underline underline-offset-2 hover:text-foreground/70 transition-colors"
              >
                Assessment Gap Calculator
              </Link>
              .
            </p>
          </div>
        </div>
      </div>

      {/* FAQ */}
      <div className="mt-16 sm:mt-24">
        <h2 className="text-xs font-medium text-muted uppercase tracking-wide mb-5 sm:mb-8 text-center">
          Frequently asked questions
        </h2>
        <div className="space-y-5 sm:space-y-6">
          {FAQ_ITEMS.map((item) => (
            <div key={item.question} className="border-b border-border pb-5 sm:pb-6 last:border-b-0">
              <h3 className="text-sm font-medium text-foreground mb-1.5">{item.question}</h3>
              <p className="text-sm text-muted leading-relaxed">{item.answer}</p>
            </div>
          ))}
        </div>
      </div>

      <FaqJsonLd questions={FAQ_ITEMS} />
      <BreadcrumbJsonLd
        items={[
          { name: "Home", url: BASE_URL },
          { name: "Tools", url: `${BASE_URL}/tools/appeal-checker` },
          { name: "Appeal Checker", url: `${BASE_URL}/tools/appeal-checker` },
        ]}
      />
    </main>
  );
}
