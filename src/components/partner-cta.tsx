"use client";

import { useState } from "react";
import { useUser, SignInButton } from "@clerk/nextjs";

type PartnerType = "mortgage" | "agent" | "insurance" | "inspection";

const PARTNER_CONFIG: Record<
  PartnerType,
  { label: string; cta: string; description: string }
> = {
  mortgage: {
    label: "Get pre-approved",
    cta: "Connect with a mortgage broker",
    description:
      "We'll share your email and the property details with a licensed Canadian mortgage broker who can help with pre-approval and rate comparison.",
  },
  agent: {
    label: "Talk to an agent",
    cta: "Connect with a buyer's agent",
    description:
      "We'll share your email and property interest with a licensed real estate agent in this market.",
  },
  insurance: {
    label: "Get insurance quotes",
    cta: "Connect with an insurer",
    description:
      "We'll share your email with Canadian home insurance providers for quotes.",
  },
  inspection: {
    label: "Book an inspection",
    cta: "Connect with an inspector",
    description:
      "We'll share your email and property address with a certified home inspector in this area.",
  },
};

interface PartnerCtaProps {
  type: PartnerType;
  propertySlug?: string;
  city?: string;
  className?: string;
}

export default function PartnerCta({
  type,
  propertySlug,
  city,
  className = "",
}: PartnerCtaProps) {
  const { isSignedIn, isLoaded } = useUser();
  const [state, setState] = useState<"idle" | "confirm" | "sending" | "done">("idle");
  const [error, setError] = useState("");

  const config = PARTNER_CONFIG[type];

  async function handleConfirm() {
    setState("sending");
    setError("");
    try {
      const res = await fetch("/api/partner-connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partnerType: type, propertySlug, city }),
      });
      if (!res.ok) throw new Error("Failed");
      setState("done");
    } catch {
      setError("Something went wrong. Please try again.");
      setState("confirm");
    }
  }

  if (!isLoaded) return null;

  // Done state
  if (state === "done") {
    return (
      <div className={`border border-green-200 bg-green-50 rounded-xl p-4 text-center ${className}`}>
        <p className="text-sm font-medium text-green-800 mb-1">Request submitted</p>
        <p className="text-xs text-green-600">
          A professional will reach out to you shortly.
        </p>
      </div>
    );
  }

  // Confirmation step (express consent at point of action)
  if (state === "confirm" || state === "sending") {
    return (
      <div className={`border border-border rounded-xl p-4 ${className}`}>
        <p className="text-sm font-medium text-foreground mb-2">{config.cta}</p>
        <p className="text-xs text-muted leading-relaxed mb-3">
          {config.description}
        </p>
        {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
        <div className="flex items-center gap-2">
          <button
            onClick={handleConfirm}
            disabled={state === "sending"}
            className="px-4 py-1.5 text-xs font-medium rounded-full bg-foreground text-white hover:bg-foreground/90 transition-all disabled:opacity-50"
          >
            {state === "sending" ? "Connecting..." : "Yes, connect me"}
          </button>
          <button
            onClick={() => setState("idle")}
            disabled={state === "sending"}
            className="px-4 py-1.5 text-xs font-medium rounded-full border border-border text-foreground hover:bg-gray-50 transition-all"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // Idle state: show the CTA button
  if (!isSignedIn) {
    return (
      <SignInButton mode="modal">
        <button className={`text-xs text-muted hover:text-foreground transition-colors ${className}`}>
          {config.label}
        </button>
      </SignInButton>
    );
  }

  return (
    <button
      onClick={() => setState("confirm")}
      className={`text-xs text-muted hover:text-foreground transition-colors underline underline-offset-2 ${className}`}
    >
      {config.label}
    </button>
  );
}
