"use client";

/**
 * Shared click-tracking + URL-resolution helpers for the affiliate CTA
 * components (src/components/partner-cta.tsx and partner-cta-row.tsx).
 * Split out so the V2 "row" layout doesn't duplicate the opt-out /
 * sub_id / /api/partner-connect logic that partner-cta.tsx already had —
 * both components import from here instead.
 */

import { useEffect, useState } from "react";
import type { AffiliateSource, ResolvedAffiliateUrl } from "@/config/affiliate-vendors";
import { AFFILIATE_VENDORS, getAffiliateUrl } from "@/config/affiliate-vendors";
import { isOptedOutClient } from "@/lib/privacy";

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
  }).catch(() => {}); // fire and forget
}
