import type { Metadata } from "next";
import { BASE_URL, SITE_NAME } from "@/lib/seo";
import { BreadcrumbJsonLd, FaqJsonLd } from "@/components/json-ld";
import AssessmentGapCalculator from "./assessment-gap-calculator";

const FAQ_ITEMS = [
  {
    question: "What is a property assessment?",
    answer:
      "A property assessment is a government-issued estimate of a property's value, used mainly to calculate annual property taxes. In BC it's set by BC Assessment, in Alberta by municipal assessors, and in Ontario by MPAC. Assessments are typically based on market value as of a fixed date each year, not the current moment.",
  },
  {
    question: "Why does assessed value differ from market value?",
    answer:
      "Assessed values are calculated on a fixed valuation date and only updated annually, so they lag behind fast-moving markets by months or even years. Local demand, renovations, and unique property features also move faster than mass-appraisal assessment models can track, which is why the same property can show a very different assessed value than what buyers are actually willing to pay.",
  },
  {
    question: "What's a normal assessment gap?",
    answer:
      "In a balanced market, asking prices typically sit within about 0–10% of assessed value. Gaps of 10–25% are common in competitive or fast-appreciating markets, while gaps above 25% usually signal either a very hot local market, an outdated assessment, or aggressive listing strategy. Normal ranges vary by city and property type, so treat these as general guardrails.",
  },
  {
    question: "How should I use the gap when making an offer?",
    answer:
      "Use the assessment as one reference point, not the whole picture. A small or negative gap suggests the asking price is a reasonable anchor for an offer; a large gap means you should lean more heavily on recent comparable sales, days on market, and seller motivation signals before deciding how close to asking to offer.",
  },
  {
    question: "Is assessed value a good anchor for an offer?",
    answer:
      "It's a useful, consistent starting point because it's independently determined and publicly available for almost every property. But it shouldn't be the only input — combine it with comparable sales, days on market, and listing context to arrive at a realistic offer range, which is the approach Property Insights uses in its full offer model.",
  },
];

export const metadata: Metadata = {
  title: "BC Assessment vs Asking Price — Assessment Gap Calculator",
  description:
    "Free calculator: compare a property's government assessed value to its asking price and instantly see the assessment gap, with plain-English interpretation of what it signals.",
  alternates: { canonical: "/tools/assessment-gap" },
  openGraph: {
    title: "BC Assessment vs Asking Price — Assessment Gap Calculator",
    description:
      "Paste an assessed value and asking price to see the gap in dollars and percent, with an instant read on what it signals about seller pricing strategy.",
    url: `${BASE_URL}/tools/assessment-gap`,
    siteName: SITE_NAME,
    type: "website",
    locale: "en_CA",
  },
  twitter: {
    card: "summary_large_image",
    title: "BC Assessment vs Asking Price — Assessment Gap Calculator",
    description:
      "Paste an assessed value and asking price to see the gap in dollars and percent, with an instant read on seller pricing strategy.",
  },
};

export default function AssessmentGapPage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-8 sm:py-16">
      {/* Hero */}
      <div className="text-center mb-8 sm:mb-14">
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground mb-3">
          Assessment Gap Calculator
        </h1>
        <p className="text-sm sm:text-base text-muted max-w-xl mx-auto">
          Compare a property&apos;s government assessed value to its asking price
          and see exactly how big the gap is — in dollars, in percent, and in
          plain English.
        </p>
      </div>

      <AssessmentGapCalculator />

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
          { name: "Tools", url: `${BASE_URL}/tools/assessment-gap` },
          { name: "Assessment Gap Calculator", url: `${BASE_URL}/tools/assessment-gap` },
        ]}
      />
    </main>
  );
}
