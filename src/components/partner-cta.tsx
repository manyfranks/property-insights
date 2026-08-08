"use client";

/**
 * Adaptive affiliate CTA block for property/result pages.
 *
 * Renders "act on this offer" — a hero CTA (highest cpaTier vendor,
 * offerText if present) plus up to 2 pill CTAs, sourced from the vendor
 * registry (src/config/affiliate-vendors.ts) instead of a hardcoded list.
 * Users click through and provide their own info on the partner site — we
 * don't share any user data. Click events are tracked for analytics.
 *
 * Regression note: with only the 3 Canadian vendors (ratehub, nesto,
 * squareone) currently `enabled: true`, this renders exactly those 3 —
 * same partners, same URLs, same fallback behavior as the old hardcoded
 * PARTNER_CONFIG — just laid out as hero + pills instead of 3 equal cards.
 */

import type {
  AffiliateSource,
  AudienceMode,
  Country,
  ResolvedAffiliateUrl,
} from "@/config/affiliate-vendors";
import { AFFILIATE_VENDORS, getAffiliateUrl, getVendorsForRegion } from "@/config/affiliate-vendors";
import { isOptedOutClient } from "@/lib/privacy";
import { useEffect, useState } from "react";

interface PartnerCtaBlockProps {
  /** property country — "CA" for all current listings (BC/ON/AB) */
  country: Country;
  /** province/state code, e.g. "BC" — used for US state gates; CA vendors are stateCoverage: "all" */
  state?: string;
  /** which CTAs to show; defaults to "buyer" since the app has no investor mode yet */
  mode?: AudienceMode;
  /** where this cluster is rendered, for sub_id attribution + click tracking */
  source: AffiliateSource;
  propertySlug?: string;
  city?: string;
}

function trackClick(opts: {
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

/**
 * Resolves a vendor's outbound URL, honoring the visitor's Do Not Sell/Share
 * opt-out: when opted out, always use the vendor's plain (non-affiliate,
 * non-sub_id-tagged) URL so no click attribution occurs. isAffiliate is
 * forced false, which also suppresses the "Sponsored" tag and FTC
 * disclosure naturally, since they're derived from isAffiliate.
 */
function resolveUrl(vendorId: string, source: AffiliateSource, optedOut: boolean): ResolvedAffiliateUrl {
  if (optedOut) {
    const vendor = AFFILIATE_VENDORS.find((v) => v.id === vendorId);
    return { url: vendor?.url ?? "", isAffiliate: false };
  }
  return getAffiliateUrl(vendorId, source);
}

const FTC_DISCLOSURE =
  "We may earn a commission if you sign up or get a quote through these links. This doesn't affect our analysis.";

export default function PartnerCta({
  country,
  state,
  mode = "buyer",
  source,
  propertySlug,
  city,
}: PartnerCtaBlockProps) {
  const [optedOut, setOptedOut] = useState(false);
  useEffect(() => {
    // Deferred via setTimeout (not called synchronously in the effect body)
    // per this repo's react-hooks/set-state-in-effect lint rule — same
    // pattern consent-banner.tsx uses for its mount-time state sync.
    const timer = setTimeout(() => setOptedOut(isOptedOutClient()), 0);
    return () => clearTimeout(timer);
  }, []);

  const vendors = getVendorsForRegion(country, state, mode);
  if (vendors.length === 0) return null;

  const [heroVendor, ...rest] = vendors;
  const pillVendors = rest.slice(0, 2);

  const hero = { vendor: heroVendor, resolved: resolveUrl(heroVendor.id, source, optedOut) };
  const pills = pillVendors.map((vendor) => ({
    vendor,
    resolved: resolveUrl(vendor.id, source, optedOut),
  }));

  const hasAnyAffiliate = [hero, ...pills].some((c) => c.resolved.isAffiliate);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        {/* Hero CTA — larger card, offer copy front and center */}
        <a
          href={hero.resolved.url}
          target="_blank"
          rel="noopener noreferrer sponsored"
          onClick={() =>
            trackClick({
              vendorId: hero.vendor.id,
              vertical: hero.vendor.vertical,
              legacyPartnerType: hero.vendor.legacyPartnerType,
              state,
              source,
              affiliate: hero.resolved.isAffiliate,
              propertySlug,
              city,
              optOut: optedOut,
            })
          }
          className="flex-1 min-w-[220px] basis-full sm:basis-auto border border-border rounded-xl p-5 bg-white hover:border-foreground/20 hover:shadow-sm transition-all group"
        >
          <div className="flex items-start justify-between gap-2 mb-1">
            <div className="text-base font-medium text-foreground group-hover:underline">
              {hero.vendor.ctaLabel ?? hero.vendor.name}
            </div>
            {hero.resolved.isAffiliate && (
              <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted/70">
                Sponsored
              </span>
            )}
          </div>
          <p className="text-xs text-muted leading-relaxed mb-2">
            {hero.vendor.offerText ?? hero.vendor.description ?? hero.vendor.name}
          </p>
          <span className="text-xs text-muted">{hero.vendor.name} &rarr;</span>
        </a>

        {/* Pill CTAs — up to 2, same visual language as before */}
        {pills.map(({ vendor, resolved }) => (
          <a
            key={vendor.id}
            href={resolved.url}
            target="_blank"
            rel="noopener noreferrer sponsored"
            onClick={() =>
              trackClick({
                vendorId: vendor.id,
                vertical: vendor.vertical,
                legacyPartnerType: vendor.legacyPartnerType,
                state,
                source,
                affiliate: resolved.isAffiliate,
                propertySlug,
                city,
                optOut: optedOut,
              })
            }
            className="flex-1 min-w-[140px] border border-border rounded-xl p-4 bg-white hover:border-foreground/20 hover:shadow-sm transition-all group"
          >
            <div className="flex items-start justify-between gap-2 mb-1">
              <div className="text-sm font-medium text-foreground group-hover:underline">
                {vendor.ctaLabel ?? vendor.name}
              </div>
              {resolved.isAffiliate && (
                <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted/70">
                  Sponsored
                </span>
              )}
            </div>
            <p className="text-xs text-muted leading-relaxed mb-2">
              {vendor.description ?? vendor.name}
            </p>
            <span className="text-xs text-muted">{vendor.name} &rarr;</span>
          </a>
        ))}
      </div>

      {hasAnyAffiliate && (
        <p className="text-xs text-muted leading-relaxed">{FTC_DISCLOSURE}</p>
      )}
    </div>
  );
}
