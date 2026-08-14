"use client";

/**
 * V2 "result-adjacent partner row" (Aug 2026 CTA redesign,
 * docs/mockups/cta-variations.html) — a compact horizontal strip of up to 2
 * vendor units, meant to sit directly beneath the headline offer/value
 * figure on a result page, borrowing the calculator -> lender-table pattern
 * at the moment intent peaks. Each unit is name + one-line desc + a small
 * solid CTA button using a short action verb (vendor.shortCta).
 *
 * Shares click-tracking / URL-resolution / opt-out handling with
 * partner-cta.tsx via src/lib/partner-cta-shared.ts rather than duplicating
 * it — same trackClick payload shape, same /api/partner-connect endpoint,
 * same Do Not Sell/Share opt-out behavior.
 */

import type {
  AffiliateSource,
  AudienceMode,
  Country,
  SurfaceKey,
} from "@/config/affiliate-vendors";
import { getVendorsForRegion, getVendorsForSurface } from "@/config/affiliate-vendors";
import {
  FTC_DISCLOSURE,
  resolveUrl,
  trackClick,
  useOptedOut,
  usePartnerCtaImpression,
  type PartnerCtaImpressionPayload,
} from "@/lib/partner-cta-shared";

interface PartnerCtaRowProps {
  country: Country;
  state?: string;
  mode?: AudienceMode;
  source: AffiliateSource;
  /** orders vendors by this surface's vertical journey priority — see
   *  SURFACE_VERTICAL_PRIORITY in src/config/affiliate-vendors.ts */
  surface?: SurfaceKey;
  propertySlug?: string;
  city?: string;
}

export default function PartnerCtaRow({
  country,
  state,
  mode = "buyer",
  source,
  surface,
  propertySlug,
  city,
}: PartnerCtaRowProps) {
  const optedOut = useOptedOut();

  const vendors = (
    surface ? getVendorsForSurface(country, state, mode, surface) : getVendorsForRegion(country, state, mode)
  ).slice(0, 2);

  // See usePartnerCtaImpression's doc comment (src/lib/partner-cta-shared.ts)
  // for why these are computed and the hooks called unconditionally, before
  // the `vendors.length === 0` early return below.
  const unit0Payload: PartnerCtaImpressionPayload | null = vendors[0]
    ? { vendor: vendors[0].id, vertical: vendors[0].vertical, source, ...(state ? { state } : {}) }
    : null;
  const unit1Payload: PartnerCtaImpressionPayload | null = vendors[1]
    ? { vendor: vendors[1].id, vertical: vendors[1].vertical, source, ...(state ? { state } : {}) }
    : null;
  const unit0ImpressionRef = usePartnerCtaImpression(unit0Payload);
  const unit1ImpressionRef = usePartnerCtaImpression(unit1Payload);

  if (vendors.length === 0) return null;

  const units = vendors.map((vendor) => ({
    vendor,
    resolved: resolveUrl(vendor.id, source, optedOut),
  }));

  const hasAnyAffiliate = units.some((u) => u.resolved.isAffiliate);

  return (
    <div className="space-y-2">
      <div className="flex flex-col sm:flex-row gap-3">
        {units.map(({ vendor, resolved }, i) => (
          <div
            key={vendor.id}
            ref={i === 0 ? unit0ImpressionRef : unit1ImpressionRef}
            className="flex-1 min-w-0 border border-border rounded-xl p-4 bg-white"
          >
            <div className="flex items-start justify-between gap-2 mb-1">
              <span className="text-[13px] font-semibold text-foreground truncate">{vendor.name}</span>
              {resolved.isAffiliate && (
                <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted/70">Sponsored</span>
              )}
            </div>
            <p className="text-xs text-muted leading-relaxed mb-3">{vendor.description ?? vendor.name}</p>
            <a
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
              className="inline-flex items-center gap-1 text-xs font-semibold text-white bg-cta-accent hover:bg-cta-accent-hover rounded-lg px-3 py-1.5 transition-colors"
            >
              {vendor.shortCta ?? "Learn more"} &rarr;
            </a>
          </div>
        ))}
      </div>
      {hasAnyAffiliate && <p className="text-xs text-muted leading-relaxed">{FTC_DISCLOSURE}</p>}
    </div>
  );
}
