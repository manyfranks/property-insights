"use client";

import { useEffect, useState } from "react";
import { useUser } from "@clerk/nextjs";
import posthog from "posthog-js";
import { hasGpcSignal, isOptedOutClient, setOptOutCookie } from "@/lib/privacy";

type Status = "loading" | "ready";

/**
 * Interactive status panel + toggle for /privacy-choices. Reads/writes the
 * pi_dns opt-out cookie and detects a live GPC signal client-side (both are
 * browser-only, so this whole panel is client-rendered — the surrounding
 * page.tsx stays a server component for metadata/SEO).
 */
export default function PrivacyChoicesPanel() {
  const { isSignedIn, user } = useUser();
  const [status, setStatus] = useState<Status>("loading");
  const [gpcDetected, setGpcDetected] = useState(false);
  const [optedOut, setOptedOut] = useState(false);
  const [saving, setSaving] = useState(false);
  // True once we've told the user "tracking resumes next page load" because
  // they opted back in while PostHog had never been initialized in this tab
  // (they loaded the page already opted out, so instrumentation-client.ts
  // skipped posthog.init() entirely).
  const [resumesOnReload, setResumesOnReload] = useState(false);

  useEffect(() => {
    // Deferred via setTimeout (not called synchronously in the effect body)
    // per this repo's react-hooks/set-state-in-effect lint rule — same
    // pattern consent-banner.tsx uses for its mount-time state sync.
    const timer = setTimeout(() => {
      setGpcDetected(hasGpcSignal());
      setOptedOut(isOptedOutClient());
      setStatus("ready");
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  async function handleToggle() {
    const next = !optedOut;
    setSaving(true);
    setOptOutCookie(next);
    setOptedOut(next);

    // Mirror the choice into PostHog for the rest of this tab session.
    // Guarded on __loaded: a visitor who landed on the page already opted
    // out never had posthog.init() called (see instrumentation-client.ts),
    // so there's no live client to opt back in here. We deliberately do
    // NOT attempt a late init() — instrumentation-client.ts is the single
    // place PostHog gets initialized — so opting back in in that situation
    // only takes effect starting from the next page load.
    if (posthog.__loaded) {
      if (next) {
        posthog.opt_out_capturing();
      } else {
        posthog.opt_in_capturing();
      }
      setResumesOnReload(false);
    } else if (!next) {
      console.warn("[posthog] opted back in, but tracking resumes on next page load (PostHog was never initialized in this tab)");
      setResumesOnReload(true);
    }

    // Signed-in users: also turn off partner-sharing consent through the
    // existing consent endpoint so the account-level record agrees with the
    // browser-level opt-out. Opting back in does not re-enable partner
    // sharing automatically — that stays an explicit, separate choice via
    // the consent banner / account settings.
    if (isSignedIn && next) {
      try {
        await fetch("/api/consent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ analytics: false, partnerSharing: false }),
        });
        await user?.reload();
      } catch {
        // Fail soft — the browser-level cookie is already set, which is
        // what actually gates tracking/affiliate attribution.
      }
    }

    setSaving(false);
  }

  if (status === "loading") {
    return (
      <div className="rounded-xl border border-border p-5 bg-white">
        <p className="text-sm text-muted">Checking your current preference&hellip;</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border p-5 bg-white space-y-3">
        {gpcDetected && (
          <p className="text-sm text-foreground leading-relaxed">
            <span className="font-medium">Global Privacy Control signal detected.</span> We
            detected the Global Privacy Control signal from your browser and have applied it —
            this browser is opted out of sale/share.
          </p>
        )}
        {!gpcDetected && (
          <p className="text-sm text-muted leading-relaxed">
            No Global Privacy Control signal was detected from your browser.
          </p>
        )}
        <p className="text-sm leading-relaxed">
          <span className="text-foreground font-medium">Current status: </span>
          {optedOut ? (
            <span className="text-foreground">
              Opted out — this browser is not tracked and affiliate links are not attributed to
              you.
            </span>
          ) : (
            <span className="text-muted">Not opted out.</span>
          )}
        </p>
        {resumesOnReload && (
          <p className="text-sm text-foreground leading-relaxed">
            Saved. Tracking on this browser resumes the next time you load a page — this tab
            already had it turned off.
          </p>
        )}
      </div>

      <button
        onClick={handleToggle}
        disabled={saving}
        className="px-4 py-2 text-sm font-medium rounded-full bg-foreground text-white hover:bg-foreground/90 transition-all disabled:opacity-50"
      >
        {optedOut ? "Opt back in" : "Do Not Sell or Share My Personal Information"}
      </button>
    </div>
  );
}
