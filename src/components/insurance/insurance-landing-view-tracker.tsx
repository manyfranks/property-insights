"use client";

/**
 * components/insurance/insurance-landing-view-tracker.tsx
 *
 * Invisible client island whose only job is emitting `insurance_landing_viewed`
 * (src/lib/signal.ts — see src/app/api/signal/route.ts's SIGNAL_EVENT_TYPES
 * for the allowlist) once per mount of the /insurance landing page.
 *
 * Split out from insurance-landing.tsx (a server component — see that
 * file's docstring) rather than folded into InsuranceLandingForm: the form
 * renders twice on the page (hero + final CTA, via the `variant` prop), so
 * firing a page-view signal from it would double-count every visit. This
 * component mounts exactly once, as a sibling under <InsuranceLanding>.
 *
 * country/region/rolloutStatus are computed server-side in
 * insurance-landing.tsx from the same visitor-geo + fallback logic the rest
 * of the page uses, so this always has a concrete region to report — see
 * that file for why a region is always resolvable (defaults to BC/TX when
 * geo headers are absent) rather than ever truly "unknown."
 */

import { useEffect, useRef } from "react";
import { signal } from "@/lib/signal";
import type { Country } from "@/config/affiliate-vendors";
import type { RolloutStatus } from "@/config/insurance-rollout";

export default function InsuranceLandingViewTracker({
  country,
  region,
  rolloutStatus,
}: {
  country: Country;
  region: string;
  rolloutStatus: RolloutStatus;
}) {
  // Guards against React StrictMode's dev-only double-invocation of effects
  // firing this twice for a single real mount.
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    signal("insurance_landing_viewed", { country, region, rolloutStatus });
  }, [country, region, rolloutStatus]);

  return null;
}
