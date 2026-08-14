"use client";

/**
 * Adaptive affiliate CTA block for property/result pages.
 *
 * Renders "act on this offer" — a hero CTA (highest-priority vendor,
 * offerText if present) plus up to 2 pill CTAs, sourced from the vendor
 * registry (src/config/affiliate-vendors.ts) instead of a hardcoded list.
 * Users click through and provide their own info on the partner site — we
 * don't share any user data. Click events are tracked for analytics.
 *
 * Regression note: with only the 3 Canadian vendors (ratehub, nesto,
 * squareone) currently `enabled: true`, this renders exactly those 3 —
 * same partners, same URLs, same fallback behavior as the old hardcoded
 * PARTNER_CONFIG — just laid out as hero + pills instead of 3 equal cards.
 *
 * V1 "Current+" polish (Aug 2026 CTA redesign, docs/mockups/cta-variations.html):
 * a teal (--cta-accent) left-edge accent bar on every card, a tighter type
 * scale, and a section heading rendered by the component itself instead of
 * being duplicated at each call site.
 */

import type {
  AffiliateSource,
  AudienceMode,
  Country,
  SurfaceKey,
} from "@/config/affiliate-vendors";
import { getVendorsForRegion, getVendorsForSurface, type Vertical } from "@/config/affiliate-vendors";
import {
  FTC_DISCLOSURE,
  resolveUrl,
  trackClick,
  useOptedOut,
  usePartnerCtaImpression,
  type PartnerCtaImpressionPayload,
} from "@/lib/partner-cta-shared";

interface PartnerCtaBlockProps {
  /** property country — "CA" for all current listings (BC/ON/AB) */
  country: Country;
  /** province/state code, e.g. "BC" — used for US state gates; CA vendors are stateCoverage: "all" */
  state?: string;
  /** which CTAs to show; defaults to the legacy buyer composition */
  mode?: AudienceMode;
  /** where this cluster is rendered, for sub_id attribution + click tracking */
  source: AffiliateSource;
  propertySlug?: string;
  city?: string;
  /** section heading rendered above the CTA row */
  heading?: string;
  /** when set, orders vendors by this surface's vertical journey priority
   *  (see SURFACE_VERTICAL_PRIORITY) instead of plain cpaTier ordering */
  surface?: SurfaceKey;
  /** hoist one vertical above the surface default (e.g. a blog post's own topic) */
  preferVertical?: Vertical;
}

export default function PartnerCta({
  country,
  state,
  mode = "buyer",
  source,
  propertySlug,
  city,
  heading = "Act on this analysis",
  surface,
  preferVertical,
}: PartnerCtaBlockProps) {
  const optedOut = useOptedOut();

  const vendors = surface
    ? getVendorsForSurface(country, state, mode, surface, preferVertical)
    : getVendorsForRegion(country, state, mode);

  const heroVendor = vendors[0];
  const pillVendors = vendors.slice(1, 3);

  // Impression payloads mirror trackClick()'s exact field names — see
  // usePartnerCtaImpression's doc comment. Computed (and the hooks below
  // called) unconditionally, before the `vendors.length === 0` early return
  // a few lines down, so hook call order never depends on data (Rules of
  // Hooks) — a hook whose ref never attaches to a rendered element is inert.
  const heroPayload: PartnerCtaImpressionPayload | null = heroVendor
    ? { vendor: heroVendor.id, vertical: heroVendor.vertical, source, ...(state ? { state } : {}) }
    : null;
  const pill0Payload: PartnerCtaImpressionPayload | null = pillVendors[0]
    ? { vendor: pillVendors[0].id, vertical: pillVendors[0].vertical, source, ...(state ? { state } : {}) }
    : null;
  const pill1Payload: PartnerCtaImpressionPayload | null = pillVendors[1]
    ? { vendor: pillVendors[1].id, vertical: pillVendors[1].vertical, source, ...(state ? { state } : {}) }
    : null;
  const heroImpressionRef = usePartnerCtaImpression(heroPayload);
  const pill0ImpressionRef = usePartnerCtaImpression(pill0Payload);
  const pill1ImpressionRef = usePartnerCtaImpression(pill1Payload);

  if (vendors.length === 0) return null;

  const hero = { vendor: heroVendor, resolved: resolveUrl(heroVendor.id, source, optedOut) };
  const pills = pillVendors.map((vendor) => ({
    vendor,
    resolved: resolveUrl(vendor.id, source, optedOut),
  }));

  const hasAnyAffiliate = [hero, ...pills].some((c) => c.resolved.isAffiliate);

  return (
    <div>
      <h3 className="text-sm font-semibold text-foreground mb-3">{heading}</h3>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-3">
          {/* Hero CTA — larger card, offer copy front and center */}
          <a
            ref={heroImpressionRef}
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
            className="relative flex-1 min-w-[220px] basis-full sm:basis-auto overflow-hidden border border-border rounded-xl p-5 pl-6 bg-white hover:border-foreground/20 hover:shadow-sm transition-all group"
          >
            <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-cta-accent" aria-hidden="true" />
            <div className="flex items-start justify-between gap-2 mb-1">
              <div className="text-base font-semibold text-foreground group-hover:underline">
                {hero.vendor.ctaLabel ?? hero.vendor.name}
              </div>
              {hero.resolved.isAffiliate && (
                <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted/70">
                  Sponsored
                </span>
              )}
            </div>
            <p className="text-sm text-muted leading-relaxed mb-2">
              {hero.vendor.offerText ?? hero.vendor.description ?? hero.vendor.name}
            </p>
            <span className="text-xs text-muted">{hero.vendor.name} &rarr;</span>
          </a>

          {/* Pill CTAs — up to 2, same visual language as before */}
          {pills.map(({ vendor, resolved }, i) => (
            <a
              key={vendor.id}
              ref={i === 0 ? pill0ImpressionRef : pill1ImpressionRef}
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
              className="relative flex-1 min-w-[140px] basis-full sm:basis-auto overflow-hidden border border-border rounded-xl p-4 pl-5 bg-white hover:border-foreground/20 hover:shadow-sm transition-all group"
            >
              <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-cta-accent" aria-hidden="true" />
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="text-sm font-semibold text-foreground group-hover:underline">
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
    </div>
  );
}
