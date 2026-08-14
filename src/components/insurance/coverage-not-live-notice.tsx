/**
 * components/insurance/coverage-not-live-notice.tsx
 *
 * Rendered by src/app/coverage-profile/page.tsx instead of the wizard when
 * the requested region/line combination clears the exclusions gate (it's
 * NOT in INSURANCE_STATE_EXCLUSIONS / INSURANCE_LINE_EXCLUSIONS — see
 * CoverageExcludedNotice for that case) but isn't `isLive()` yet per
 * src/config/insurance-rollout.ts.
 *
 * Deliberately a separate component from CoverageExcludedNotice, not a
 * shared "no wizard for you" variant — the two mean different things.
 * Excluded = a permanent regulatory ban (QC/NB/WA, BC strata) that is never
 * coming. Not-live = a region already on the rollout roadmap (e.g. AB/ON)
 * whose referral-fee legality is still unresolved, so the intake flow is
 * held back deliberately rather than being switched on — but the region
 * itself is not, and will not be, excluded. Blurring the two would either
 * wrongly promise a permanently-excluded region is coming, or wrongly write
 * off a rolling-out region as a dead end. See insurance-rollout.ts's doc
 * comment for the isLive()/exclusions split this notice depends on.
 *
 * Copy is scanned by scripts/check-insurance-copy.ts, like every other file
 * under src/components/insurance/ — no solicitation-flavored language.
 */

import Link from "next/link";
import type { Country } from "@/config/affiliate-vendors";
import { CA_REGIONS, STATUS_LABEL, statusFor } from "@/config/insurance-rollout";

function regionDisplayName(country: Country, region: string): string {
  if (country === "CA") {
    return CA_REGIONS.find((r) => r.code === region)?.name ?? region;
  }
  return region;
}

/** Pulls the next region(s) up from the rollout config rather than hard-
 *  coding names, so this notice can't drift from the same CA_REGIONS list
 *  the /insurance rollout strip and the isLive() gate both read. */
function rolloutSentence(country: Country): string {
  if (country === "CA") {
    const next = CA_REGIONS.find((r) => r.status === "next");
    const soon = CA_REGIONS.find((r) => r.status === "soon");
    if (next && soon) return `${next.name} is next, then ${soon.name}.`;
    if (next) return `${next.name} is next.`;
    return "More provinces are opening on a rolling basis.";
  }
  return "We're live in British Columbia today, with U.S. states opening on a rolling basis.";
}

export function CoverageNotLiveNotice({ country, region }: { country: Country; region: string }) {
  const displayName = regionDisplayName(country, region);
  const status = statusFor(country, region);

  return (
    <main className="max-w-xl mx-auto px-6 py-20 sm:py-28 text-center">
      <div className="text-[10px] font-mono uppercase tracking-widest text-muted mb-3">
        Coverage profile &middot; {STATUS_LABEL[status]}
      </div>
      <h1 className="text-2xl font-semibold tracking-tight text-foreground mb-3 text-wrap-balance">
        Insurance matching isn&apos;t live in {displayName} yet.
      </h1>
      <p className="text-sm text-muted max-w-md mx-auto mb-2 leading-relaxed">
        We&apos;re rolling out region by region, live today in British Columbia. {rolloutSentence(country)}
      </p>
      <p className="text-sm text-muted max-w-md mx-auto mb-8 leading-relaxed">
        Nothing on this page has been shared with a broker. Join the waitlist on the insurance page and
        we&apos;ll let you know the moment {displayName} is live.
      </p>
      <Link
        href="/insurance"
        className="inline-flex min-h-11 items-center px-5 py-2.5 text-sm font-medium rounded-lg border border-border text-foreground hover:bg-gray-50 transition-colors"
      >
        Join the waitlist
      </Link>
    </main>
  );
}
