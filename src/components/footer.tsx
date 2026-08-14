import Link from "next/link";

export default function Footer() {
  return (
    <footer className="border-t border-border mt-16">
      <div className="max-w-5xl mx-auto px-6 py-10">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 text-sm">
          <div>
            <div className="text-xs uppercase tracking-widest text-muted mb-3">Product</div>
            <div className="space-y-2">
              <Link href="/how-it-works" className="block text-muted hover:text-foreground transition-colors">
                How it works
              </Link>
              <Link href="/dashboard" className="block text-muted hover:text-foreground transition-colors">
                Discover
              </Link>
              <Link href="/insurance" className="block text-muted hover:text-foreground transition-colors">
                Property insurance
              </Link>
              <Link href="/blog" className="block text-muted hover:text-foreground transition-colors">
                Blog
              </Link>
              <Link href="/us" className="block text-muted hover:text-foreground transition-colors">
                US Markets
              </Link>
              <Link href="/pricing" className="block text-muted hover:text-foreground transition-colors">
                Pricing
              </Link>
              <Link href="/resources" className="block text-muted hover:text-foreground transition-colors">
                Recommended Tools
              </Link>
            </div>
          </div>

          <div>
            <div className="text-xs uppercase tracking-widest text-muted mb-3">Free Tools</div>
            <div className="space-y-2">
              <Link href="/tools/assessment-gap" className="block text-muted hover:text-foreground transition-colors">
                Assessment Gap Calculator
              </Link>
              <Link href="/tools/appeal-checker" className="block text-muted hover:text-foreground transition-colors">
                Property Tax Appeal Checker
              </Link>
              <Link href="/us/rankings/investment" className="block text-muted hover:text-foreground transition-colors">
                Best Counties to Invest
              </Link>
              <Link href="/us/rankings/rent-to-price" className="block text-muted hover:text-foreground transition-colors">
                1% Rule Rankings
              </Link>
            </div>
          </div>

          <div>
            <div className="text-xs uppercase tracking-widest text-muted mb-3">Legal</div>
            <div className="space-y-2">
              <Link href="/privacy" className="block text-muted hover:text-foreground transition-colors">
                Privacy Policy
              </Link>
              <Link href="/terms" className="block text-muted hover:text-foreground transition-colors">
                Terms of Service
              </Link>
              <Link href="/data-usage" className="block text-muted hover:text-foreground transition-colors">
                Data Usage
              </Link>
              <Link href="/privacy-choices" className="block text-muted hover:text-foreground transition-colors">
                Do Not Sell or Share My Personal Information
              </Link>
              <Link href="/disclosures" className="block text-muted hover:text-foreground transition-colors">
                Licensing &amp; Disclosures
              </Link>
            </div>
          </div>

          <div>
            <div className="text-xs uppercase tracking-widest text-muted mb-3">About</div>
            <p className="text-muted leading-relaxed">
              Property Insights is a free research tool for home buyers in Canada and the US.
              Built by{" "}
              <a
                href="https://useorio.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground hover:underline"
              >
                Orio
              </a>.
            </p>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-border text-center text-xs text-muted space-y-2">
          <p className="max-w-2xl mx-auto leading-relaxed">
            Property Insights is a property-intelligence platform, not a licensed insurer or
            broker. Coverage is provided by licensed third-party brokers. We may earn a referral
            fee from matches; this never affects your price or our analysis.
          </p>
          <p>&copy; {new Date().getFullYear()} Property Insights &middot; propertyinsights.xyz</p>
        </div>
      </div>
    </footer>
  );
}
