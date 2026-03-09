"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useUser, SignInButton } from "@clerk/nextjs";

interface Step {
  label: string;
  detail: string;
  delay: number; // ms from mount to start this step
}

const STEPS: Step[] = [
  { label: "Looking up property listing", detail: "Searching active listings on Zoocasa", delay: 0 },
  { label: "Fetching assessment data", detail: "Checking government property assessment records", delay: 2500 },
  { label: "Running AI analysis", detail: "Scoring motivation signals and modeling offer price", delay: 7000 },
  { label: "Saving results", detail: "Storing analysis and preparing your report", delay: 16000 },
];

type StepStatus = "pending" | "active" | "complete";
type ErrorKind = "parse" | "not-found" | "rate-limit" | "transient" | "network";

function HouseIconCircle() {
  return (
    <div className="w-10 h-10 rounded-full border border-border flex items-center justify-center mx-auto mb-4">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 10.5L12 3l9 7.5V21a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V10.5z" />
        <path d="M9 21V12h6v9" />
      </svg>
    </div>
  );
}

function displayAddress(raw: string): string {
  // For Zoocasa URLs, extract a readable slug label
  const match = raw.match(/zoocasa\.com\/[a-z][a-z0-9-]*-[a-z]{2}-real-estate\/([a-z0-9-]+)/i);
  if (match) {
    return match[1].replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return raw;
}

export default function AssessmentProgress({ address }: { address: string }) {
  const router = useRouter();
  const { isSignedIn, isLoaded } = useUser();
  const [stepStatuses, setStepStatuses] = useState<StepStatus[]>(
    STEPS.map((_, i) => (i === 0 ? "active" : "pending"))
  );
  const [errorState, setErrorState] = useState<{ kind: ErrorKind; message: string } | null>(null);
  const [apiDone, setApiDone] = useState(false);
  const [slug, setSlug] = useState("");
  const [retryCount, setRetryCount] = useState(0);

  // Complete all steps and redirect
  const finishAll = useCallback((resultSlug: string) => {
    setStepStatuses(STEPS.map(() => "complete"));
    setTimeout(() => {
      router.push(`/property/${resultSlug}`);
    }, 800);
  }, [router]);

  // Fire API call when authenticated.
  // No fetchedRef — React 18 Strict Mode runs effects twice in dev.
  // The first run's AbortController cleanup cancels it; the second run proceeds.
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;

    const controller = new AbortController();

    fetch("/api/assess", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
      signal: controller.signal,
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          let kind: ErrorKind = "transient";
          if (res.status === 400) kind = "parse";
          else if (res.status === 404) kind = "not-found";
          else if (res.status === 429) kind = "rate-limit";
          else if (res.status === 502) kind = "transient";
          setErrorState({ kind, message: data.error || "Something went wrong." });
          return;
        }
        if (data.slug) {
          setSlug(data.slug);
          setApiDone(true);
        } else {
          setErrorState({ kind: "transient", message: "Unexpected response from server." });
        }
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          setErrorState({ kind: "network", message: "Network error. Please check your connection and try again." });
        }
      });

    return () => controller.abort();
  }, [address, isLoaded, isSignedIn, retryCount]);

  // Step timers (simulated progress)
  useEffect(() => {
    if (errorState) return;

    const timers = STEPS.map((step, i) => {
      if (i === 0) return undefined; // step 0 starts active immediately
      return setTimeout(() => {
        setStepStatuses((prev) => {
          const next = [...prev];
          // Complete previous step
          if (i > 0) next[i - 1] = "complete";
          // Activate this step
          next[i] = "active";
          return next;
        });
      }, step.delay);
    });

    return () => timers.forEach((t) => t && clearTimeout(t));
  }, [errorState, retryCount]);

  // When API completes, fast-forward all steps
  useEffect(() => {
    if (apiDone && slug) {
      finishAll(slug);
    }
  }, [apiDone, slug, finishAll]);

  function handleRetry() {
    setErrorState(null);
    setStepStatuses(STEPS.map((_, i) => (i === 0 ? "active" : "pending")));
    setApiDone(false);
    setSlug("");
    setRetryCount((c) => c + 1);
  }

  // Loading state — avoid flash before Clerk loads
  if (!isLoaded) return null;

  // Auth gate — show conversion screen for unauthenticated users
  if (!isSignedIn) {
    return (
      <main className="max-w-xl mx-auto px-6 py-16 sm:py-24">
        <div className="text-center">
          <HouseIconCircle />
          <h1 className="text-2xl font-semibold tracking-tight text-foreground mb-2">
            Sign in to assess this property
          </h1>
          <p className="text-sm text-muted break-words mb-6">{address}</p>
          <p className="text-sm text-muted mb-8 max-w-sm mx-auto">
            We&apos;ll look up the listing, pull government assessment records,
            run AI analysis, and email you the full report.
          </p>
          <SignInButton mode="modal">
            <button className="px-6 py-2.5 text-sm font-medium rounded-lg bg-foreground text-white hover:bg-foreground/90 transition-all">
              Sign in to continue
            </button>
          </SignInButton>
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-xl mx-auto px-6 py-16 sm:py-24">
      {!errorState && (
        <div className="text-center mb-10">
          <HouseIconCircle />
          <h1 className="text-2xl font-semibold tracking-tight text-foreground mb-2">
            Assessing property
          </h1>
          <p className="text-sm text-muted break-words">{displayAddress(address)}</p>
        </div>
      )}

      {/* Steps — hidden when error is shown */}
      {!errorState && <div className="flex justify-center mb-10">
        <div className="space-y-5 inline-block text-left">
          {STEPS.map((step, i) => (
            <div key={i} className="flex items-start gap-4">
              {/* Indicator */}
              <div className="flex-shrink-0 mt-0.5">
                {stepStatuses[i] === "complete" ? (
                  <div className="w-7 h-7 rounded-full bg-green-100 flex items-center justify-center">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-green-600">
                      <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                ) : stepStatuses[i] === "active" ? (
                  <div className="w-7 h-7 rounded-full border-2 border-foreground/30 flex items-center justify-center">
                    <div className="w-2.5 h-2.5 rounded-full bg-foreground/60 animate-pulse" />
                  </div>
                ) : (
                  <div className="w-7 h-7 rounded-full border border-border" />
                )}
              </div>

              {/* Text */}
              <div>
                <p
                  className={`text-sm font-medium ${
                    stepStatuses[i] === "pending"
                      ? "text-muted"
                      : "text-foreground"
                  }`}
                >
                  {step.label}
                </p>
                <p
                  className={`text-xs ${
                    stepStatuses[i] === "pending"
                      ? "text-muted/60"
                      : "text-muted"
                  }`}
                >
                  {step.detail}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>}

      {/* Error states */}
      {errorState?.kind === "parse" && (
        <div className="border border-amber-200 bg-amber-50 rounded-xl p-5 text-center">
          <HouseIconCircle />
          <p className="text-sm font-medium text-amber-800 mb-1">
            We couldn&apos;t understand this address
          </p>
          <p className="text-xs text-amber-700 break-words mb-3">{address}</p>
          <p className="text-xs text-amber-600 mb-4">
            Use a full Canadian address like: 123 Main St, Vancouver, BC
            <br />
            or paste a Zoocasa listing URL directly.
          </p>
          <button
            onClick={() => router.push("/")}
            className="px-4 py-1.5 text-xs font-medium rounded-lg bg-foreground text-white hover:bg-foreground/90 transition-all"
          >
            Search again
          </button>
        </div>
      )}

      {errorState?.kind === "not-found" && (
        <div className="border border-border rounded-xl p-5 text-center">
          <HouseIconCircle />
          <p className="text-sm font-medium text-foreground mb-3">
            This property doesn&apos;t appear to be listed for sale
          </p>
          <ul className="text-xs text-muted text-left max-w-xs mx-auto space-y-1.5 mb-4">
            <li>• Check the spelling of the address</li>
            <li>• Verify it&apos;s currently listed on Zoocasa or Realtor.ca</li>
            <li>• Try without the unit number</li>
            <li>• Or paste the Zoocasa listing URL directly into the search bar</li>
          </ul>
          <button
            onClick={() => router.push("/")}
            className="px-4 py-1.5 text-xs font-medium rounded-lg bg-foreground text-white hover:bg-foreground/90 transition-all"
          >
            Search again
          </button>
        </div>
      )}

      {errorState?.kind === "rate-limit" && (
        <div className="border border-amber-200 bg-amber-50 rounded-xl p-5 text-center">
          <HouseIconCircle />
          <p className="text-sm font-medium text-amber-800 mb-1">
            Daily assessment limit reached
          </p>
          <p className="text-xs text-amber-600 mb-4">
            You can assess up to 15 properties per day. Your limit resets in 24 hours.
          </p>
          <button
            onClick={() => router.push("/")}
            className="px-4 py-1.5 text-xs font-medium rounded-lg bg-foreground text-white hover:bg-foreground/90 transition-all"
          >
            Back to home
          </button>
        </div>
      )}

      {(errorState?.kind === "transient" || errorState?.kind === "network") && (
        <div className="border border-red-200 bg-red-50 rounded-xl p-5 text-center">
          <HouseIconCircle />
          <p className="text-sm font-medium text-red-800 mb-1">
            Something went wrong
          </p>
          <p className="text-xs text-red-600 mb-4">{errorState.message}</p>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={handleRetry}
              className="px-4 py-1.5 text-xs font-medium rounded-lg bg-foreground text-white hover:bg-foreground/90 transition-all"
            >
              Try again
            </button>
            <button
              onClick={() => router.push("/")}
              className="px-4 py-1.5 text-xs font-medium rounded-lg border border-border text-foreground hover:bg-gray-50 transition-all"
            >
              Back to home
            </button>
          </div>
        </div>
      )}

      {/* Footer copy */}
      {!errorState && (
        <div className="text-center">
          <p className="text-xs text-muted">
            This usually takes 10-20 seconds. We&apos;re looking up the listing,
            pulling government assessment records, and running AI analysis.
          </p>
        </div>
      )}
    </main>
  );
}
