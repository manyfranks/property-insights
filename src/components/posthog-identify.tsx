"use client";

/**
 * Identifies the signed-in Clerk user to PostHog so that all client-side
 * events are linked to their canonical user ID. Renders nothing visible.
 * Placed inside ClerkProvider in the root layout.
 *
 * Gated on two independent signals before ever calling identify():
 *  - Do Not Sell/Share opt-out (src/lib/privacy.ts) — a GPC signal or the
 *    pi_dns cookie means this browser is never identified, full stop.
 *  - Analytics consent (src/lib/consent.ts) — the house rule is "no consent
 *    record yet = don't track", so a user who hasn't made a choice stays
 *    anonymous, not opted-in-by-default.
 *
 * identifiedThisSession is a module-level flag (not React state) so it
 * survives remounts within the same page load and lets the sign-out branch
 * tell "was ever identified, now signing out" apart from "never identified,
 * just an anonymous visitor" — resetting PostHog's identity on every load
 * for anonymous visitors would needlessly churn their distinct_id.
 */

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import posthog from "posthog-js";
import { isOptedOutClient } from "@/lib/privacy";
import { hasAnalyticsConsent } from "@/lib/consent";
import { isSensitiveInsuranceCapabilityPath } from "@/lib/insurance/privacy/sensitive-routes";

let identifiedThisSession = false;

export default function PostHogIdentify() {
  const { isLoaded, isSignedIn, user } = useUser();
  const pathname = usePathname() || "";

  useEffect(() => {
    if (!isLoaded) return;
    if (isSensitiveInsuranceCapabilityPath(pathname)) return;

    if (isSignedIn && user) {
      if (isOptedOutClient()) return;
      if (!hasAnalyticsConsent(user.unsafeMetadata as Record<string, unknown> | undefined)) return;

      // Identify the user — PII (email) goes to the person profile, never
      // into event properties, following PostHog's identify pattern.
      posthog.identify(user.id, {
        email: user.primaryEmailAddress?.emailAddress,
        name: user.fullName ?? user.firstName ?? undefined,
      });
      identifiedThisSession = true;
      return;
    }

    if (!isSignedIn && identifiedThisSession) {
      // Only reset an identity we actually created — resetting on every
      // signed-out render would also reset anonymous visitors' distinct_id
      // on every page load, which breaks anonymous funnel attribution.
      posthog.reset();
      identifiedThisSession = false;
    }
  }, [isLoaded, isSignedIn, user, pathname]);

  return null;
}
