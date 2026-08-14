"use client";

/**
 * Shared click-tracking + URL-resolution helpers for the affiliate CTA
 * components (src/components/partner-cta.tsx and partner-cta-row.tsx).
 * Split out so the V2 "row" layout doesn't duplicate the opt-out /
 * sub_id / /api/partner-connect logic that partner-cta.tsx already had —
 * both components import from here instead.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { AffiliateSource, ResolvedAffiliateUrl } from "@/config/affiliate-vendors";
import { AFFILIATE_VENDORS, getAffiliateUrl } from "@/config/affiliate-vendors";
import { isOptedOutClient } from "@/lib/privacy";
import { signal } from "@/lib/signal";

export const FTC_DISCLOSURE =
  "We may earn a commission if you sign up or get a quote through these links. This doesn't affect our analysis.";

/**
 * Mount-time opt-out check. Deferred via setTimeout (not called synchronously
 * in the effect body) per this repo's react-hooks/set-state-in-effect lint
 * rule — same pattern consent-banner.tsx uses for its mount-time state sync.
 */
export function useOptedOut(): boolean {
  const [optedOut, setOptedOut] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setOptedOut(isOptedOutClient()), 0);
    return () => clearTimeout(timer);
  }, []);
  return optedOut;
}

/**
 * Resolves a vendor's outbound URL, honoring the visitor's Do Not Sell/Share
 * opt-out: when opted out, always use the vendor's plain (non-affiliate,
 * non-sub_id-tagged) URL so no click attribution occurs. isAffiliate is
 * forced false, which also suppresses the "Sponsored" tag and FTC
 * disclosure naturally, since they're derived from isAffiliate.
 */
export function resolveUrl(vendorId: string, source: AffiliateSource, optedOut: boolean): ResolvedAffiliateUrl {
  if (optedOut) {
    const vendor = AFFILIATE_VENDORS.find((v) => v.id === vendorId);
    return { url: vendor?.url ?? "", isAffiliate: false };
  }
  return getAffiliateUrl(vendorId, source);
}

export function trackClick(opts: {
  vendorId: string;
  vertical: string;
  legacyPartnerType?: string;
  state?: string;
  source: AffiliateSource;
  affiliate: boolean;
  propertySlug?: string;
  city?: string;
  optOut: boolean;
}) {
  fetch("/api/partner-connect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      vendor: opts.vendorId,
      vertical: opts.vertical,
      ...(opts.legacyPartnerType && { partnerType: opts.legacyPartnerType }),
      ...(opts.state && { state: opts.state }),
      source: opts.source,
      affiliate: opts.affiliate,
      ...(opts.propertySlug && { propertySlug: opts.propertySlug }),
      ...(opts.city && { city: opts.city }),
      optOut: opts.optOut,
    }),
  }).catch((err) => {
    if (process.env.NODE_ENV === "development") {
      console.warn("[track] beacon failed:", err);
    }
  });
}

/**
 * `partner_cta_impression` payload — deliberately mirrors the field names
 * trackClick() above sends to /api/partner-connect (`vendor`, `vertical`,
 * `source`, `state`) rather than reusing trackClick's `vendorId` naming, so
 * an impression row and its eventual click row join cleanly in SQL on
 * (vendor, vertical, source, state) without a rename in between.
 */
export interface PartnerCtaImpressionPayload {
  vendor: string;
  vertical: string;
  source: AffiliateSource;
  state?: string;
}

/** Stable string identity for a payload, used to dedupe impressions per CTA
 *  rather than per DOM node — see usePartnerCtaImpression's doc comment. */
function payloadKey(payload: PartnerCtaImpressionPayload): string {
  return `${payload.vendor}|${payload.vertical}|${payload.source}|${payload.state ?? ""}`;
}

/**
 * Fires one `partner_cta_impression` signal the first time the element this
 * hook's returned ref callback is attached to crosses 50% visibility, then
 * disconnects that IntersectionObserver — a CTA that scrolls in and out of
 * view repeatedly is still counted once per mount, not once per crossing.
 *
 * Returns a ref *callback* rather than a ref object specifically so one hook
 * call can back one fixed "slot" in a card row/grid (hero, pill 1, pill 2,
 * ...) whose occupant vendor can change across renders without re-
 * subscribing — e.g. insurance-module.tsx swapping the selected coverage
 * line, which swaps which vendor (if any) occupies the hero slot. The
 * callback is memoized with an empty dependency array so React only invokes
 * it when the DOM node itself mounts/unmounts, while `payload` is read from a
 * ref on every fire so the closure always sees the latest
 * vendor/vertical/source/state for whatever currently occupies the slot.
 *
 * Dedup is keyed on the *payload's own identity*
 * (vendor|vertical|source|state), not on the DOM node or a plain fired
 * boolean: a fresh Set lives for the hook's whole lifetime (one per
 * component mount) and remembers every distinct CTA this slot has already
 * signaled. That means switching the insurance module's line from
 * "homeowner" to "landlord" and back doesn't re-fire for the same homeowner
 * vendor, but a genuinely different vendor sliding into the same slot (e.g.
 * landlord's hero differs from homeowner's) still gets its own impression —
 * a plain per-slot boolean would have silently undercounted every vendor
 * after the first one shown in that slot.
 *
 * Pass `null` for a slot with nothing to render this render (e.g. an absent
 * 2nd pill) — the returned callback still attaches fine, it just never has a
 * payload to fire with, so it silently no-ops.
 *
 * Call this hook unconditionally, before any early `return null` in the
 * calling component (Rules of Hooks) — a hook call whose ref callback never
 * ends up attached to a rendered element is inert, since the callback (and
 * therefore the IntersectionObserver it would create) only ever runs when
 * React calls it with a real node.
 *
 * SSR/no-op guarded: bails out before referencing `window` or
 * `IntersectionObserver` when either is unavailable.
 */
export function usePartnerCtaImpression(
  payload: PartnerCtaImpressionPayload | null
): (node: Element | null) => void {
  const firedKeysRef = useRef<Set<string>>(new Set());
  const payloadRef = useRef(payload);
  // Refs must not be written during render (react-hooks/refs) — sync it in
  // an effect instead. Timing is safe: the IntersectionObserver callback
  // that reads payloadRef only ever runs asynchronously in response to a
  // real scroll/layout event, never synchronously during this render.
  useEffect(() => {
    payloadRef.current = payload;
  }, [payload]);
  const observerRef = useRef<IntersectionObserver | null>(null);

  return useCallback((node: Element | null) => {
    // Re-attaching (node changed, including unmount) always tears down any
    // observer from a previous node first.
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (!node) return;
    if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const current = payloadRef.current;
          if (current) {
            const key = payloadKey(current);
            if (!firedKeysRef.current.has(key)) {
              firedKeysRef.current.add(key);
              signal("partner_cta_impression", {
                vendor: current.vendor,
                vertical: current.vertical,
                source: current.source,
                ...(current.state ? { state: current.state } : {}),
              });
            }
          }
          // Whether newly counted or already seen, this node's visibility
          // question is answered — stop observing it either way.
          observer.disconnect();
          observerRef.current = null;
          break;
        }
      },
      { threshold: 0.5 }
    );
    observer.observe(node);
    observerRef.current = observer;
  }, []);
}
