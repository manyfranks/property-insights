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

import type { AffiliateSource, AudienceMode, Country } from "@/config/affiliate-vendors";
import { getAffiliateUrl, getVendorsForRegion } from "@/config/affiliate-vendors";

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
    }),
  }).catch(() => {}); // fire and forget
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
  const vendors = getVendorsForRegion(country, state, mode);
  if (vendors.length === 0) return null;

  const [heroVendor, ...rest] = vendors;
  const pillVendors = rest.slice(0, 2);

  const hero = { vendor: heroVendor, resolved: getAffiliateUrl(heroVendor.id, source) };
  const pills = pillVendors.map((vendor) => ({
    vendor,
    resolved: getAffiliateUrl(vendor.id, source),
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
            })
          }
          className="flex-1 min-w-[220px] basis-full sm:basis-auto border border-border rounded-xl p-5 bg-white hover:border-foreground/20 hover:shadow-sm transition-all group"
        >
          <div className="text-base font-medium text-foreground mb-1 group-hover:underline">
            {hero.vendor.ctaLabel ?? hero.vendor.name}
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
              })
            }
            className="flex-1 min-w-[140px] border border-border rounded-xl p-4 bg-white hover:border-foreground/20 hover:shadow-sm transition-all group"
          >
            <div className="text-sm font-medium text-foreground mb-1 group-hover:underline">
              {vendor.ctaLabel ?? vendor.name}
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
