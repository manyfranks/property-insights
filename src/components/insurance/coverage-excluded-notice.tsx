/**
 * components/insurance/coverage-excluded-notice.tsx
 *
 * Rendered by src/app/coverage-profile/page.tsx instead of the wizard when
 * the requested region/line combination is in
 * INSURANCE_STATE_EXCLUSIONS or INSURANCE_LINE_EXCLUSIONS
 * (src/config/affiliate-vendors.ts). A visible notice, not a silent 404 or
 * an empty flow — the region gate is a compliance boundary, so a visitor
 * who lands here should be told plainly why nothing happened, per the
 * fail-loud rule this branch is built around.
 */

import Link from "next/link";

export function CoverageExcludedNotice({ region }: { region: string }) {
  return (
    <main className="max-w-xl mx-auto px-6 py-20 sm:py-28 text-center">
      <div className="text-[10px] font-mono uppercase tracking-widest text-muted mb-3">Coverage profile</div>
      <h1 className="text-2xl font-semibold tracking-tight text-foreground mb-3 text-wrap-balance">
        Insurance matching isn&apos;t available in {region} yet.
      </h1>
      <p className="text-sm text-muted max-w-md mx-auto mb-8 leading-relaxed">
        We only ever direct a property owner to a licensed insurance partner, and we don&apos;t have a compliant referral path in
        this jurisdiction yet. Nothing on this page has been shared with a partner.
      </p>
      <Link
        href="/"
        className="inline-flex min-h-11 items-center px-5 py-2.5 text-sm font-medium rounded-lg border border-border text-foreground hover:bg-gray-50 transition-colors"
      >
        Back to Property Insights
      </Link>
    </main>
  );
}
