"use client";

/**
 * Contains a Clerk load failure so it cannot take down the whole page.
 *
 * When the browser cannot fetch clerk.browser.js, `@clerk/nextjs` throws
 * `failed_to_load_clerk_js` from inside ClerkProvider. That error is
 * unhandled, so it escapes past the root layout and the visitor falls
 * through to global-error.tsx — a blank page instead of just a missing
 * sign-in button. This React error boundary wraps ClerkProvider and its
 * consumers, catches that throw, and renders a Clerk-free fallback so the
 * header, page content, and footer still render.
 *
 * The trigger is environmental (a blocked or dropped script request), not
 * our code, so we cannot stop it. We still report the caught error to
 * PostHog. Because this is a manual capture it lands as *handled*, unlike
 * the original unhandled crash, so Error Tracking keeps one signal per
 * occurrence without the page-wide blast radius.
 */

import { Component, type ReactNode } from "react";
import posthog from "posthog-js";

export default class ClerkBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    // Fail loud first — see global-error.tsx for why this must not depend
    // on PostHog having initialized.
    console.error("[clerk-boundary]", error);

    try {
      posthog.captureException(error);
    } catch (reportingError) {
      console.error("[clerk-boundary] failed to report to PostHog:", reportingError);
    }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
