import Link from "next/link";

export default function HowItWorksPage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-8 sm:py-16">
      {/* Hero */}
      <div className="text-center mb-12 sm:mb-20">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground mb-3">
          Acquisition intelligence, not another listing site.
        </h1>
        <p className="text-base text-muted max-w-xl mx-auto">
          Property Insights analyzes government assessments, days on market, and
          listing language to find where sellers are most likely to negotiate —
          then tells you exactly what to offer.
        </p>
      </div>

      {/* 3 Steps */}
      <div className="mb-12 sm:mb-20">
        <h2 className="text-xs font-medium text-muted uppercase tracking-wide mb-8 text-center">
          How it works
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 sm:gap-10 text-center">
          <div>
            <div className="w-10 h-10 rounded-full border border-border flex items-center justify-center mx-auto mb-4">
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
            <div className="w-10 h-10 rounded-full border border-border flex items-center justify-center mx-auto mb-4">
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
            <div className="w-10 h-10 rounded-full border border-border flex items-center justify-center mx-auto mb-4">
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
      </div>

      {/* What you see */}
      <div className="mb-12 sm:mb-20">
        <h2 className="text-xs font-medium text-muted uppercase tracking-wide mb-8 text-center">
          What you see on every property
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="border border-border rounded-xl p-5">
            <div className="text-sm font-medium text-foreground mb-1">
              Recommended Offer
            </div>
            <p className="text-sm text-muted leading-relaxed">
              Assessment-anchored price adjusted for days on market, signals,
              and market position.
            </p>
          </div>

          <div className="border border-border rounded-xl p-5">
            <div className="text-sm font-medium text-foreground mb-1">
              The Signal
            </div>
            <p className="text-sm text-muted leading-relaxed">
              AI-written investor briefing explaining why this property and
              offer make sense.
            </p>
          </div>

          <div className="border border-border rounded-xl p-5">
            <div className="text-sm font-medium text-foreground mb-1">
              Motivation Score
            </div>
            <p className="text-sm text-muted leading-relaxed">
              0–100 seller pressure index combining DOM, price history, and
              listing language.
            </p>
          </div>

          <div className="border border-border rounded-xl p-5">
            <div className="text-sm font-medium text-foreground mb-1">
              Score Breakdown
            </div>
            <p className="text-sm text-muted leading-relaxed">
              Every scoring factor with points — full transparency on how the
              offer was calculated.
            </p>
          </div>
        </div>
      </div>

      {/* Request any property */}
      <div className="mb-12 sm:mb-20">
        <h2 className="text-xs font-medium text-muted uppercase tracking-wide mb-8 text-center">
          Don&apos;t see your property?
        </h2>

        <div className="border border-border rounded-xl p-6 sm:p-8 text-center">
          <div className="w-10 h-10 rounded-full border border-border flex items-center justify-center mx-auto mb-4">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-foreground" xmlns="http://www.w3.org/2000/svg">
              <path d="M3 10.5L12 3l9 7.5V21a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V10.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M12 11v4m-2-2h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </div>
          <h3 className="text-base font-medium text-foreground mb-2">
            Submit any Canadian property for assessment
          </h3>
          <p className="text-sm text-muted leading-relaxed max-w-md mx-auto mb-4">
            Found a listing on Realtor.ca or Zoocasa? Search for the address in the
            navigation bar above. If we don&apos;t have it yet, sign up and
            we&apos;ll look it up, run the full assessment with offer modeling, and
            email you the analysis.
          </p>
          <p className="text-xs text-muted max-w-sm mx-auto">
            Works with any active residential listing across BC, Alberta, and Ontario.
          </p>
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

      {/* Footer */}
      <div className="text-center pt-8 border-t border-border">
        <p className="text-xs text-muted">
          Built by Matt Francis &middot; propertyinsights.xyz
        </p>
      </div>
    </main>
  );
}
