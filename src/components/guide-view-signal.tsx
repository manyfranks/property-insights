"use client";

/**
 * Blog-post ("guide") funnel instrumentation for the first-party event
 * spine (src/lib/signal.ts → POST /api/signal → analytics_events). Two
 * concerns live in one component because both need the same wrapping DOM
 * node around a post's body:
 *
 * 1. `guide_viewed` — fired once per mount, unconditionally. Referrer-based
 *    entry classification (organic search vs. direct vs. internal, etc.)
 *    already happens server-side from the request's Referer header (see
 *    /api/signal's `referrerHost` column) — this component does not attempt
 *    to reclassify that client-side, it just marks "this guide was viewed."
 *
 * 2. `guide_to_tool_click` — a single delegated click listener on the
 *    wrapping container, rather than instrumenting every internal link in
 *    every post .tsx file under src/app/blog/[slug]/posts/. Trade-off:
 *    this only sees clicks on descendants of wherever this component is
 *    mounted (the article body — see src/app/blog/[slug]/page.tsx), so a
 *    product link placed outside that container (e.g. the page template's
 *    own "Browse analyzed listings" row) is intentionally NOT captured by
 *    this mechanism. In exchange, every post — past and future — gets
 *    click tracking for free with zero per-post edits, and a post author
 *    can never forget to wire it in. A post's internal links use
 *    next/link's <Link>, which still renders a plain <a href> in the DOM,
 *    so a plain click-delegation listener sees it the same as a hand-written
 *    anchor.
 *
 * Reliability note on click-before-navigate: next/link intercepts the click
 * and does a same-document (client-side) route change rather than a full
 * page unload, so signal.ts's module-level batching queue survives the
 * navigation intact — the queued event still flushes via signal.ts's normal
 * MAX_BATCH_SIZE/debounce-timer/visibilitychange triggers, it just does so
 * after the SPA transition instead of before it. This event is NOT at risk
 * of the "lost on unload" failure mode sendBeacon exists to solve, precisely
 * because there is no document unload here. That failure mode would only
 * resurface if a post ever linked to a product route with a plain
 * full-reload anchor (e.g. `target="_blank"` cross-origin, or a future
 * non-Link anchor) — signal.ts's own visibilitychange-to-hidden flush
 * already covers that case today, so no change was needed here.
 */

import { useEffect, useRef } from "react";
import type { MouseEvent, ReactNode } from "react";
import { signal } from "@/lib/signal";

interface GuideViewSignalProps {
  slug: string;
  tags: string[];
  children: ReactNode;
}

/**
 * Mirrors the per-value 256-char cap that src/lib/tracking-validation.ts's
 * validateGenericEventData enforces server-side. That validator rejects the
 * *entire* event (not just the offending field) when a string value runs
 * over, so the joined tag list is truncated defensively here rather than
 * risking a silently-dropped guide_viewed event for a heavily-tagged post.
 */
const MAX_TAG_STRING_LENGTH = 256;

/** Path prefixes that count as "into the product" for guide_to_tool_click. */
function isProductLinkPathname(pathname: string): boolean {
  return (
    pathname.startsWith("/tools/") ||
    pathname === "/assess" ||
    pathname.startsWith("/assess/") ||
    pathname === "/discover" ||
    pathname.startsWith("/discover/") ||
    pathname === "/insurance" ||
    pathname.startsWith("/insurance/")
  );
}

/**
 * Resolves an anchor's destination to a trackable product pathname, or null
 * if it isn't an internal link into one of the product surfaces above.
 * `anchor.href` (the DOM property, not a raw attribute read) is always
 * browser-normalized to an absolute URL regardless of how the href was
 * authored, so this works the same for next/link's relative hrefs and any
 * hand-written absolute one.
 */
function resolveProductLinkTarget(anchor: HTMLAnchorElement): string | null {
  let url: URL;
  try {
    url = new URL(anchor.href);
  } catch {
    return null;
  }
  if (url.origin !== window.location.origin) return null;
  return isProductLinkPathname(url.pathname) ? url.pathname : null;
}

export default function GuideViewSignal({ slug, tags, children }: GuideViewSignalProps) {
  const firedViewRef = useRef(false);
  const tagsParam = tags.join(",").slice(0, MAX_TAG_STRING_LENGTH);

  useEffect(() => {
    // Guards against a double-fire on re-render (e.g. React StrictMode's
    // dev-mode double-invoke of effects) independently of the dependency
    // array below — this ref persists for the lifetime of the mount and is
    // never reset except by a genuine unmount/remount.
    if (firedViewRef.current) return;
    firedViewRef.current = true;
    signal("guide_viewed", { slug, tags: tagsParam });
  }, [slug, tagsParam]);

  function handleClick(event: MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement | null;
    const anchor = target?.closest("a[href]") as HTMLAnchorElement | null;
    if (!anchor) return;
    const toTool = resolveProductLinkTarget(anchor);
    if (!toTool) return;
    signal("guide_to_tool_click", { fromSlug: slug, toTool });
  }

  return <div onClick={handleClick}>{children}</div>;
}
