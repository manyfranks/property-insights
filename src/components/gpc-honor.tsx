"use client";

import { useEffect } from "react";
import { hasGpcSignal, hasOptOutCookie, setOptOutCookie } from "@/lib/privacy";

/**
 * Silently honors an incoming Global Privacy Control signal on first paint:
 * if the browser sends GPC and we haven't already recorded an opt-out
 * cookie, set one. Renders nothing. Mounted once in the root layout so GPC
 * is honored site-wide, not just on /privacy-choices.
 */
export default function GpcHonor() {
  useEffect(() => {
    if (hasGpcSignal() && !hasOptOutCookie()) {
      setOptOutCookie(true);
    }
  }, []);

  return null;
}
