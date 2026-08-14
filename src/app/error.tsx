"use client";

/**
 * error.tsx
 *
 * Route-level error boundary (App Router convention). Catches errors thrown
 * while rendering any segment under the root layout; renders inside that
 * layout (navbar/footer/providers stay mounted), unlike global-error.tsx
 * which only fires when the layout itself is broken and has to rebuild
 * <html>/<body> from scratch. Same PostHog reporting pattern as
 * global-error.tsx — see that file's comment for why the try/catch guard
 * matters.
 */

import { useEffect } from "react";
import posthog from "posthog-js";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Unconditional and first — see global-error.tsx's comment on why this
    // must not depend on PostHog having initialized.
    console.error("[error]", error);

    try {
      posthog.captureException(error);
    } catch (reportingError) {
      console.error("[error] failed to report to PostHog:", reportingError);
    }
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-6">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold text-foreground mb-2">Something broke</h1>
        <p className="text-sm text-muted leading-relaxed mb-5">
          This page hit an error it couldn&apos;t recover from. It has been reported.
        </p>
        {error.digest && (
          <p className="text-xs text-muted font-mono mb-5">Error ID: {error.digest}</p>
        )}
        <button
          onClick={() => reset()}
          className="px-5 py-2 text-sm font-medium rounded-full bg-foreground text-white hover:bg-foreground/90 transition-all"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
