"use client";

import { useEffect } from "react";
import { useUser } from "@clerk/nextjs";

/**
 * Client component that fires a property_view tracking event.
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

    // Fire and forget
    fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "property_view",
        data: { slug, city, price },
      }),
    }).catch(() => {
      // Silently fail — tracking should never break the user experience
    });
  }, [isLoaded, isSignedIn, slug, city, price]);

  return null;
}
