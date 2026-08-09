"use client";

/**
 * Client half of /resources — the vendor cards need URL resolution + click
 * tracking, both of which depend on the visitor's live Do Not Sell/Share
 * opt-out state (see src/lib/partner-cta-shared.ts), so they can't be
 * resolved server-side. page.tsx does the registry filtering/grouping
 * (no per-visitor state needed for that) and hands the grouped, unresolved
 * vendor list down as props.
 */

import type { AffiliateVendor, Vertical } from "@/config/affiliate-vendors";
import { FTC_DISCLOSURE, resolveUrl, trackClick, useOptedOut } from "@/lib/partner-cta-shared";

export interface ResourceSection {
  vertical: Vertical;
  label: string;
  vendors: AffiliateVendor[];
}

export default function ResourcesList({ sections }: { sections: ResourceSection[] }) {
  const optedOut = useOptedOut();

  const resolvedSections = sections.map((section) => ({
    ...section,
    vendors: section.vendors.map((vendor) => ({
      vendor,
      resolved: resolveUrl(vendor.id, "resources", optedOut),
    })),
  }));

  const hasAnyAffiliate = resolvedSections.some((section) =>
    section.vendors.some(({ resolved }) => resolved.isAffiliate)
  );

  return (
    <div className="space-y-12">
      {hasAnyAffiliate && (
        <p className="text-xs text-muted leading-relaxed border border-border rounded-lg p-4 bg-gray-50">
          {FTC_DISCLOSURE}
        </p>
      )}

      {resolvedSections.map((section) => (
        <section key={section.vertical}>
          <h2 className="text-lg font-semibold text-foreground mb-4">{section.label}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {section.vendors.map(({ vendor, resolved }) => (
              <div
                key={vendor.id}
                className="relative overflow-hidden border border-border rounded-xl p-5 pl-6 bg-white"
              >
                <span
                  className="absolute left-0 top-0 bottom-0 w-[3px] bg-cta-accent"
                  aria-hidden="true"
                />
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="text-base font-semibold text-foreground">
                    {vendor.ctaLabel ?? vendor.name}
                  </div>
                  {resolved.isAffiliate && (
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted/70">
                      Sponsored
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted leading-relaxed mb-2">
                  {vendor.description ?? vendor.name}
                </p>
                {vendor.offerText && (
                  <p className="text-xs font-medium text-cta-accent mb-3">{vendor.offerText}</p>
                )}
                <a
                  href={resolved.url}
                  target="_blank"
                  rel="noopener noreferrer sponsored"
                  onClick={() =>
                    trackClick({
                      vendorId: vendor.id,
                      vertical: vendor.vertical,
                      legacyPartnerType: vendor.legacyPartnerType,
                      source: "resources",
                      affiliate: resolved.isAffiliate,
                      optOut: optedOut,
                    })
                  }
                  className="inline-flex items-center gap-1 text-sm font-semibold text-white bg-cta-accent hover:bg-cta-accent-hover rounded-lg px-4 py-2 transition-colors"
                >
                  Visit {vendor.name} &rarr;
                </a>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
