"use client";

import { useState } from "react";
import { useUser } from "@clerk/nextjs";
import { CITY_METADATA } from "@/lib/data/city-metadata";

export default function CityInterestForm({
  preselectedCity,
}: {
  preselectedCity?: string;
}) {
  const { user } = useUser();
  const [selected, setSelected] = useState<Set<string>>(
    preselectedCity ? new Set([preselectedCity]) : new Set()
  );
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [subscribedCities, setSubscribedCities] = useState<string[]>([]);

  function toggle(slug: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  async function handleSubmit() {
    if (selected.size === 0) return;
    setStatus("saving");
    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cities: Array.from(selected) }),
      });
      if (!res.ok) throw new Error("Failed to save");
      const data = await res.json();
      setSubscribedCities(data.cities || Array.from(selected));
      setStatus("done");
    } catch {
      setStatus("error");
    }
  }

  if (status === "done") {
    const names = subscribedCities
      .map((s) => CITY_METADATA.find((c) => c.slug === s)?.name || s)
      .join(", ");
    return (
      <div className="text-center py-4">
        <p className="text-sm text-green-700 font-medium">
          We&apos;ll email you when motivated listings appear in {names}.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2 justify-center mb-4">
        {CITY_METADATA.map((city) => (
          <button
            key={city.slug}
            onClick={() => toggle(city.slug)}
            className={`px-3 py-1.5 text-xs rounded-full border transition-all ${
              selected.has(city.slug)
                ? "bg-foreground text-white border-foreground"
                : "border-border text-muted hover:border-foreground/30"
            }`}
          >
            {city.name}
          </button>
        ))}
      </div>
      <div className="flex justify-center">
        <button
          onClick={handleSubmit}
          disabled={selected.size === 0 || status === "saving"}
          className="px-5 py-2 text-sm font-medium rounded-full bg-foreground text-white hover:bg-foreground/90 disabled:opacity-40 transition-all"
        >
          {status === "saving" ? "Saving..." : status === "error" ? "Try again" : "Notify me"}
        </button>
      </div>
    </div>
  );
}
