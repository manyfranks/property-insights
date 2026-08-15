"use client";

/**
 * use-posthog-consent.ts
 *
 * Shared client-side gate for the direct `posthog.capture()` call sites
 * that live outside the identify/init spine (src/components/posthog-identify.tsx,
 * instrumentation-client.ts). Those two already handle the Do-Not-Sell/Share
 * opt-out (instrumentation-client.ts never calls posthog.init() for an
 * opted-out visitor, so every posthog.capture() call is a silent no-op for
 * them regardless of this hook) and identify() consent. What was missing is
 * the same consent check at the individual capture() sites sprinkled across
 * feature components — this hook is that check, written once instead of
 * three times.
 *
 * THE POLICY (three states — see hasAnalyticsConsent's doc comment in
 * src/lib/consent.ts for the underlying house rule):
 *
 *   1. Signed OUT (anonymous visitor)        → capture ALLOWED.
 *      Anonymous tracking is the spine's default posture — allowed unless
 *      the visitor opted out via GPC/pi_dns, which is already handled
 *      globally by instrumentation-client.ts never initializing PostHog for
 *      them. There is no consent record to check for a visitor who isn't
 *      signed in, so there is nothing to gate here.
 *
 *   2. Signed IN, no consent record OR analytics:false → capture BLOCKED.
 *      The house rule is "no consent record yet = don't track" — a user
 *      who hasn't made an explicit choice is never opted in by default,
 *      and a user who explicitly said no is obviously never tracked.
 *
 *   3. Signed IN, analytics:true               → capture ALLOWED.
 *
 * WHY false WHILE CLERK IS LOADING: Clerk's isLoaded starts false on every
 * mount, and we cannot yet tell states 1/2/3 apart at that point — a
 * signed-in user's consent record hasn't been fetched, but a signed-out
 * visitor also reads isLoaded === false momentarily. Returning true here
 * would fire an unconsented event for a small window on every signed-in
 * page load; returning false costs at most one lost early event per
 * mount (fired again on the next user interaction, once isLoaded flips).
 * A lost event is an acceptable, silent-by-design gap; an unconsented
 * capture is not — see this repo's fail-loud-never-fake stance on
 * silently degrading vs. silently over-collecting. This is a deliberate,
 * one-directional bias: under-fire while uncertain, never over-fire.
 */

import { useUser } from "@clerk/nextjs";
import { hasAnalyticsConsent } from "@/lib/consent";

/**
 * Returns whether the three components with direct posthog.capture() calls
 * (assessment-progress.tsx, home-address-search.tsx, pricing-buttons.tsx)
 * are allowed to fire an event for the current visitor right now.
 *
 * Does NOT check the Do-Not-Sell/Share opt-out itself — that's handled
 * upstream by instrumentation-client.ts skipping posthog.init() entirely,
 * which makes every posthog.capture() call downstream a no-op for an
 * opted-out visitor. This hook only adds the analytics-consent layer for
 * signed-in users, matching posthog-identify.tsx's gating logic.
 */
export function usePostHogCaptureAllowed(): boolean {
  const { isLoaded, isSignedIn, user } = useUser();

  // Anonymous visitor: allowed. (Clerk reports isSignedIn === false once
  // loaded even for a visitor with no session at all, so this also covers
  // the "definitely signed out" case once isLoaded is true.)
  if (isLoaded && !isSignedIn) return true;

  // Still resolving, or signed in: block until we have a definite
  // signed-in + consented verdict. See the module doc comment above for
  // why the loading window defaults to false rather than true.
  if (!isLoaded || !isSignedIn || !user) return false;

  return hasAnalyticsConsent(user.unsafeMetadata as Record<string, unknown> | undefined);
}
