import posthog from "posthog-js";
import { isOptedOutClient } from "@/lib/privacy";
import {
  isSensitiveInsuranceCapabilityPath,
  postHogEventContainsInsuranceCapability,
} from "@/lib/insurance/privacy/sensitive-routes";

const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
// Do Not Sell/Share: never initialize PostHog for a visitor who is opted out
// (explicit pi_dns cookie choice, or a live Global Privacy Control signal —
// see src/lib/privacy.ts). Checked before the token check below so an
// opted-out visitor is skipped even when the token *is* configured.
const optedOut = isOptedOutClient();
const sensitiveCapabilityRoute =
  typeof window !== "undefined" &&
  isSensitiveInsuranceCapabilityPath(window.location.pathname);

if (optedOut || sensitiveCapabilityRoute) {
  if (process.env.NODE_ENV === "development") {
    console.warn("[posthog] disabled: privacy boundary active");
  }
} else if (!token) {
  if (process.env.NODE_ENV !== "production") {
    throw new Error(
      "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN variable required by PostHog is missing or un-configured, " +
        "this causes events to be silently missed. This error stops appearing once NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN is configured"
    );
  }
  // Production with a missing token still needs to fail loud (never silent)
  // even though init is skipped — events will be dropped, and that must be
  // visible in server/browser logs, not silently swallowed.
  console.error(
    "[posthog] disabled: NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN missing — client events dropped"
  );
} else {
  posthog.init(token, {
    api_host: "/ingest",
    ui_host: "https://us.posthog.com",
    // Required baseline config
    defaults: "2026-01-30",
    // Capture unhandled exceptions via Error Tracking
    capture_exceptions: true,
    before_send(event) {
      return postHogEventContainsInsuranceCapability(event) ? null : event;
    },
    // Debug output in development
    debug: process.env.NODE_ENV === "development",
  });
}

// IMPORTANT: Never combine this approach with other client-side PostHog initialization
// approaches, especially components like a PostHogProvider.
// instrumentation-client.ts is the correct solution for initializing client-side
// PostHog in Next.js 15.3+ apps.
