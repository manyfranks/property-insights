import Link from "next/link";

export default function NotFound() {
  return (
    <main className="max-w-xl mx-auto px-6 py-16 sm:py-24 text-center">
      <div className="w-10 h-10 rounded-full border border-border flex items-center justify-center mx-auto mb-4">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 10.5L12 3l9 7.5V21a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V10.5z" />
          <path d="M9 21V12h6v9" />
        </svg>
      </div>
      <h1 className="text-2xl font-semibold tracking-tight text-foreground mb-2">
        Page not found
      </h1>
      <p className="text-sm text-muted mb-8 max-w-sm mx-auto">
        The page you&apos;re looking for doesn&apos;t exist or may have been removed.
      </p>
      <div className="flex items-center justify-center gap-3">
        <Link
          href="/"
          className="px-5 py-2 text-sm font-medium rounded-full bg-foreground text-white hover:bg-foreground/90 transition-colors"
        >
          Explore properties
        </Link>
        <Link
          href="/blog"
          className="px-5 py-2 text-sm font-medium rounded-full border border-border text-foreground hover:bg-gray-50 transition-colors"
        >
          Read the blog
        </Link>
      </div>
    </main>
  );
}
