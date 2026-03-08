"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";

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

export default function AssessmentProgress({ address }: { address: string }) {
  const router = useRouter();
  const fetchedRef = useRef(false);
  const [stepStatuses, setStepStatuses] = useState<StepStatus[]>(
    STEPS.map((_, i) => (i === 0 ? "active" : "pending"))
  );
  const [error, setError] = useState("");
  const [apiDone, setApiDone] = useState(false);
  const [slug, setSlug] = useState("");

  // Complete all steps and redirect
  const finishAll = useCallback((resultSlug: string) => {
    setStepStatuses(STEPS.map(() => "complete"));
    setTimeout(() => {
      router.push(`/property/${resultSlug}`);
    }, 800);
  }, [router]);

  // Fire API call on mount
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    const controller = new AbortController();

    fetch("/api/assess", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
      signal: controller.signal,
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
        } else if (data.slug) {
          setSlug(data.slug);
          setApiDone(true);
        } else {
          setError("Unexpected response from server.");
        }
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          setError("Network error. Please try again.");
        }
      });

    return () => controller.abort();
  }, [address]);

  // Step timers (simulated progress)
  useEffect(() => {
    if (error) return;

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
  }, [error]);

  // When API completes, fast-forward all steps
  useEffect(() => {
    if (apiDone && slug) {
      finishAll(slug);
    }
  }, [apiDone, slug, finishAll]);

  function handleRetry() {
    setError("");
    fetchedRef.current = false;
    setStepStatuses(STEPS.map((_, i) => (i === 0 ? "active" : "pending")));
    setApiDone(false);
    setSlug("");
    // Re-trigger by toggling fetchedRef — need a re-render
    setTimeout(() => {
      fetchedRef.current = false;
      // Force re-mount effect
      window.location.reload();
    }, 0);
  }

  return (
    <main className="max-w-xl mx-auto px-6 py-16 sm:py-24">
      <div className="text-center mb-10">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground mb-2">
          Assessing property
        </h1>
        <p className="text-sm text-muted break-words">{address}</p>
      </div>

      {/* Steps */}
      <div className="space-y-5 mb-10">
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

      {/* Error state */}
      {error && (
        <div className="border border-red-200 bg-red-50 rounded-xl p-5 text-center">
          <p className="text-sm font-medium text-red-800 mb-1">
            Assessment failed
          </p>
          <p className="text-xs text-red-600 mb-4">{error}</p>
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
      {!error && (
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
