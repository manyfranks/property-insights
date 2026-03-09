import Link from "next/link";

export default function Footer() {
  return (
    <footer className="border-t border-border mt-16">
      <div className="max-w-5xl mx-auto px-6 py-10">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 text-sm">
          <div>
            <div className="text-xs uppercase tracking-widest text-muted mb-3">Product</div>
            <div className="space-y-2">
              <Link href="/how-it-works" className="block text-muted hover:text-foreground transition-colors">
                How it works
              </Link>
              <Link href="/dashboard" className="block text-muted hover:text-foreground transition-colors">
                Discover
              </Link>
              <Link href="/blog" className="block text-muted hover:text-foreground transition-colors">
                Blog
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
            </div>
          </div>

          <div>
            <div className="text-xs uppercase tracking-widest text-muted mb-3">About</div>
            <p className="text-muted leading-relaxed">
              Property Insights is a free research tool for Canadian home buyers.
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

        <div className="mt-10 pt-6 border-t border-border text-center text-xs text-muted">
          &copy; {new Date().getFullYear()} Property Insights &middot; propertyinsights.xyz
        </div>
      </div>
    </footer>
  );
}
