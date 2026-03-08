"use client";

import { useState } from "react";
import { useUser, SignInButton } from "@clerk/nextjs";

export default function RequestCityPrompt() {
  const { isSignedIn, isLoaded } = useUser();
  const [expanded, setExpanded] = useState(false);
  const [city, setCity] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");

  if (!isLoaded) return null;

  if (status === "done") {
    return (
      <p className="text-xs text-green-700 text-center mt-6">
        Thanks! We&apos;ll notify you when {city} is available.
      </p>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="text-center mt-6">
        <SignInButton mode="modal">
          <button className="text-xs text-muted hover:text-foreground transition-colors">
            Don&apos;t see your city?{" "}
            <span className="underline">Sign in to request one</span>
          </button>
        </SignInButton>
      </div>
    );
  }

  if (!expanded) {
    return (
      <div className="text-center mt-6">
        <button
          onClick={() => setExpanded(true)}
          className="text-xs text-muted hover:text-foreground transition-colors"
        >
          Don&apos;t see your city?{" "}
          <span className="underline">Request one</span>
        </button>
      </div>
    );
  }

  async function handleSubmit() {
    const trimmed = city.trim();
    if (!trimmed) return;
    setStatus("saving");
    try {
      const res = await fetch("/api/request-city", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ city: trimmed }),
      });
      if (!res.ok) throw new Error("Failed");
      setStatus("done");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="flex flex-col sm:flex-row items-center justify-center gap-2 mt-6">
      <input
        type="text"
        value={city}
        onChange={(e) => setCity(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
        placeholder="City name, e.g. Kelowna"
        className="px-3 py-1.5 text-xs rounded-lg border border-border bg-white focus:outline-none focus:border-foreground/40 w-full sm:w-48"
        autoFocus
      />
      <button
        onClick={handleSubmit}
        disabled={!city.trim() || status === "saving"}
        className="px-4 py-1.5 text-xs font-medium rounded-lg bg-foreground text-white hover:bg-foreground/90 disabled:opacity-40 transition-all w-full sm:w-auto"
      >
        {status === "saving" ? "Sending..." : status === "error" ? "Retry" : "Submit"}
      </button>
    </div>
  );
}
