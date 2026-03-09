"use client";

import { useEffect } from "react";
import { useUser } from "@clerk/nextjs";

/**
 * Client component that fires a property_view tracking event.
 * Detects return visits via sessionStorage and flags them in the event data.
 * Renders nothing visible. Placed on property pages.
 */
export default function TrackView({
  slug,
  city,
  price,
}: {
  slug: string;
  city: string;
  price: number;
}) {
  const { isSignedIn, isLoaded } = useUser();

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;

    // Detect return visits via localStorage
    const viewedKey = `pi:viewed:${slug}`;
    const previousVisit = localStorage.getItem(viewedKey);
    const isReturn = !!previousVisit;
    localStorage.setItem(viewedKey, new Date().toISOString());

    // Fire and forget
    fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "property_view",
        data: { slug, city, price, returnVisit: isReturn },
      }),
    }).catch(() => {});
  }, [isLoaded, isSignedIn, slug, city, price]);

  return null;
}
