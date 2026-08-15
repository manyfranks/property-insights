"use client";

/**
 * Interactive half of the pricing page — the rest is a plain server
 * component. Handles the three states the upgrade button can be in:
 *   1. Billing not configured (no Stripe env vars) → disabled "Coming soon"
 *   2. Signed out → prompts sign-in (Clerk modal), same as elsewhere in the app
 *   3. Signed in, already Pro → "Manage billing" (opens the billing portal)
 *   4. Signed in, free tier → "Upgrade to Pro" (starts checkout)
 */

import { useState } from "react";
import { useUser, SignInButton } from "@clerk/nextjs";
import posthog from "posthog-js";
import { usePostHogCaptureAllowed } from "@/lib/use-posthog-consent";

interface PricingButtonsProps {
  configured: boolean;
  initialPro: boolean;
}

const BUTTON_CLASS =
  "w-full px-5 py-2.5 text-sm font-medium rounded-full bg-foreground text-white hover:bg-foreground/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all";

export default function PricingButtons({ configured, initialPro }: PricingButtonsProps) {
  const { isLoaded, isSignedIn } = useUser();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Consent gate for the posthog.capture() calls in goTo() below — see
  // src/lib/use-posthog-consent.ts for the three-state policy. goTo() is
  // only reachable once isSignedIn is true (the buttons that call it only
  // render in that branch below), so the consent verdict is always settled
  // by the time these captures would fire.
  const captureAllowed = usePostHogCaptureAllowed();

  async function goTo(endpoint: "/api/stripe/checkout" | "/api/stripe/portal") {
    setPending(true);
    setError(null);

    // Capture the intent before the redirect so the event isn't lost
    if (captureAllowed) {
      if (endpoint === "/api/stripe/checkout") {
        posthog.capture("checkout_started", { plan: "pro" });
      } else {
        posthog.capture("billing_portal_opened");
      }
    }

    try {
      const res = await fetch(endpoint, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.url) {
        throw new Error(data.error || "Something went wrong");
      }
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setPending(false);
    }
  }

  if (!configured) {
    return (
      <button disabled className={BUTTON_CLASS}>
        Coming soon
      </button>
    );
  }

  if (!isLoaded) {
    return (
      <button disabled className={BUTTON_CLASS}>
        &nbsp;
      </button>
    );
  }

  if (!isSignedIn) {
    return (
      <SignInButton mode="modal">
        <button className={BUTTON_CLASS}>Sign in to upgrade</button>
      </SignInButton>
    );
  }

  return (
    <div>
      {initialPro ? (
        <button
          onClick={() => goTo("/api/stripe/portal")}
          disabled={pending}
          className={BUTTON_CLASS}
        >
          {pending ? "Opening…" : "Manage billing"}
        </button>
      ) : (
        <button
          onClick={() => goTo("/api/stripe/checkout")}
          disabled={pending}
          className={BUTTON_CLASS}
        >
          {pending ? "Redirecting…" : "Upgrade to Pro"}
        </button>
      )}
      {error && <p className="text-xs text-red-600 mt-2 text-center">{error}</p>}
    </div>
  );
}
