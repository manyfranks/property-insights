"use client";

/**
 * Fires an anonymous `page_view` into the first-party event spine
 * (src/lib/signal.ts → POST /api/signal → analytics_events) on every
 * client-side route change. Renders nothing visible. Mounted once in the
 * root layout.
 *
 * Complements — not replaces — the other analytics layers: Vercel
 * Analytics counts pageviews in aggregate and PostHog autocaptures its
 * own $pageview; this event is what makes pageviews JOINable in SQL
 * against the funnel events (same anon_id/session_id), which neither of
 * those can do.
 *
 * Privacy: signal() itself refuses to enqueue when the visitor is opted
 * out (GPC / pi_dns), and the server drops requests without spine cookies
 * — an opted-out browser never got them minted (src/proxy.ts). Keyed on
 * pathname only; signal() reads location.search itself, so UTM params
 * still reach the server without this component touching useSearchParams
 * (which would force a Suspense boundary in the layout).
 */

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { signal } from "@/lib/signal";

export default function PageViewSignal() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname) return;
    signal("page_view");
  }, [pathname]);

  return null;
}
