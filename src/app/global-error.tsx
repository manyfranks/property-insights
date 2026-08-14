"use client";

/**
 * global-error.tsx
 *
 * Next.js's last-resort error boundary: catches errors thrown by the root
 * layout itself (src/app/layout.tsx) or anything above it, a case the
 * ordinary route-level src/app/error.tsx cannot handle because the layout
 * that would render *that* boundary is what broke. Per Next.js's contract
 * for this file, it must render its own <html>/<body> — the root layout is
 * presumed unmounted, so nothing above this component can be relied on.
 *
 * Styling is deliberately inline rather than Tailwind classes: this
 * boundary must not assume globals.css or the app's font/CSS pipeline
 * loaded successfully. Colors are hardcoded to match src/app/globals.css's
 * palette (#171717 foreground, #6b7280 muted, #e5e7eb border, #fafafa
 * background) so this still reads as Property Insights rather than a
 * generic unstyled crash screen.
 */

import { useEffect } from "react";
import posthog from "posthog-js";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Unconditional and first: this must reach the console regardless of
    // whether PostHog ever initialized (opted-out visitor, missing token,
    // ad blocker, etc.) — fail loud takes priority over reporting.
    console.error("[global-error]", error);

    // Best-effort report to PostHog Error Tracking. Guarded because
    // instrumentation-client.ts may have skipped posthog.init() entirely
    // (visitor opted out via GPC/pi_dns, or the token is missing) — calling
    // into an uninitialized posthog-js instance must never throw *inside*
    // the error boundary itself, which would mask the original error.
    try {
      posthog.captureException(error);
    } catch (reportingError) {
      console.error("[global-error] failed to report to PostHog:", reportingError);
    }
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
          background: "#fafafa",
          color: "#171717",
        }}
      >
        <div style={{ maxWidth: 420, padding: "0 24px", textAlign: "center" }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 8px" }}>Something broke</h1>
          <p style={{ fontSize: 14, color: "#6b7280", lineHeight: 1.6, margin: "0 0 20px" }}>
            The app hit an error it couldn&apos;t recover from and this page failed to render.
            It has been reported.
          </p>
          {error.digest && (
            <p
              style={{
                fontSize: 12,
                color: "#6b7280",
                fontFamily: "ui-monospace, monospace",
                margin: "0 0 20px",
              }}
            >
              Error ID: {error.digest}
            </p>
          )}
          <button
            onClick={() => reset()}
            style={{
              fontSize: 14,
              fontWeight: 500,
              padding: "8px 22px",
              borderRadius: 999,
              border: "1px solid #171717",
              background: "#171717",
              color: "#ffffff",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
