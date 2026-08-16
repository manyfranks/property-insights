"use client";

/**
 * Result-page insurance module — Screen 1 of the Insurance Path
 * (docs/proposals/insurance-distribution-proposal.html, Stage 2).
 *
 * "Pick a coverage type → build a coverage profile → get matched with a
 * licensed insurance partner." The platform is an UNLICENSED referrer here: every card
 * links to the (separately-built) /coverage-profile intake route instead of
 * an outbound affiliate URL — no quote or price is ever shown.
 * scripts/check-insurance-copy.ts build-fails on solicitation-flavored
 * language anywhere under src/components/insurance/**, so keep copy edits
 * to "build a coverage profile / continue to a licensed insurance partner"
 * framing.
 *
 * Visual language borrows partner-cta.tsx's hero-plus-pills card layout
 * (left cta-accent bar, Sponsored tag, FTC disclosure, click tracking via
 * /api/partner-connect) but the vertical/line chooser and restricted-line
 * notice are new to this module.
 */

import Link from "next/link";
import { useState } from "react";
import type {
  AffiliateSource,
  AudienceMode,
  Country,
  InsuranceLine,
  SurfaceKey,
} from "@/config/affiliate-vendors";
import {
  getVendorsForSurface,
  INSURANCE_LINE_EXCLUSIONS,
  INSURANCE_STATE_EXCLUSIONS,
} from "@/config/affiliate-vendors";
import { stageAtLeast } from "@/config/insurance-stage";
import { isLive } from "@/config/insurance-rollout";
import {
  FTC_DISCLOSURE,
  trackClick,
  useOptedOut,
  usePartnerCtaImpression,
  type PartnerCtaImpressionPayload,
} from "@/lib/partner-cta-shared";

export interface InsuranceModuleProps {
  /** property country */
  country: Country;
  /** state/province code (e.g. "TX", "BC") */
  region: string;
  address: string;
  /** where this cluster is rendered, for sub_id attribution + click tracking */
  source: AffiliateSource;
  mode?: AudienceMode;
  /** orders vendors by this surface's vertical journey priority, same as PartnerCta/PartnerCtaRow */
  surface?: SurfaceKey;
  /** reference id (MLS #, listing slug) forwarded to the intake route */
  listingId?: string;
  /**
   * Property context beyond region/address. Not part of today's URL
   * contract to /coverage-profile (that route is being built in parallel —
   * see the task handoff); accepted here so callers don't need a second
   * wiring pass once the intake page is ready to read richer context.
   */
  propertyType?: string;
  yearBuilt?: string | number;
  estimatedValue?: number;
  estimatedRent?: number;
  /** default line selection — typically derived via goal-line-map.ts from the active P4 goal */
  initialLine?: InsuranceLine;
}

const LINES: { id: InsuranceLine; label: string; beta?: boolean }[] = [
  { id: "homeowner", label: "Homeowner" },
  { id: "landlord", label: "Landlord" },
  { id: "tenant", label: "Tenant" },
  { id: "strata", label: "Strata / condo" },
  { id: "commercial", label: "Commercial", beta: true },
];

const LINE_DETAIL: Record<InsuranceLine, { headline: string; blurb: string }> = {
  homeowner: {
    headline: "Homeowner coverage",
    blurb: "Coverage for an owner-occupied home — dwelling, contents, and liability.",
  },
  landlord: {
    headline: "Landlord coverage",
    blurb: "A rental-property policy: building, loss of rent, and landlord liability.",
  },
  tenant: {
    headline: "Tenant coverage",
    blurb: "Renters coverage for contents and liability inside a unit you don't own.",
  },
  strata: {
    headline: "Strata / condo coverage",
    blurb: "The building-level master policy for a strata corporation or condo board.",
  },
  commercial: {
    headline: "Commercial coverage",
    blurb: "Mixed-use and commercial buildings — property, liability, and business interruption.",
  },
};

const REGION_NAMES: Record<string, string> = {
  BC: "British Columbia",
};

export default function InsuranceModule({
  country,
  region,
  address,
  source,
  mode = "buyer",
  surface = "result-buyer",
  listingId,
  initialLine,
}: InsuranceModuleProps) {
  const [line, setLine] = useState<InsuranceLine>(initialLine ?? "homeowner");
  const optedOut = useOptedOut();

  // Vendor-slate derivation, hoisted above every early `return null` below
  // (Rules of Hooks: the usePartnerCtaImpression calls that follow must run
  // in the same order on every render). None of this depends on the
  // stageAtLeast/exclusions/isLive gates below, so hoisting changes nothing
  // about what gets computed — it only moves *when*. A hook whose ref never
  // attaches to a rendered element (because the component bails out below)
  // is inert: see usePartnerCtaImpression's doc comment.
  const upperRegion = region ? region.toUpperCase() : "";
  const lineExclusions = INSURANCE_LINE_EXCLUSIONS[country]?.[upperRegion] ?? [];
  const restricted = lineExclusions.includes(line);
  const vendors = restricted
    ? []
    : getVendorsForSurface(country, region, mode, surface, "insurance").filter((v) => v.lines?.includes(line));
  const hero = vendors[0];
  const pills = vendors.slice(1, 3);
  const noMatch = !restricted && vendors.length === 0;
  const hasSponsoredCard = Boolean(hero);

  // Impression payloads mirror trackClick()'s field names (see handleClick
  // below and usePartnerCtaImpression's doc comment). The hero slot is
  // shared by the hero card and the "match me with an insurance partner"
  // no-match card — they're mutually exclusive (noMatch is only true when
  // there's no hero), so one hook call safely covers both.
  const heroSlotPayload: PartnerCtaImpressionPayload | null = hero
    ? { vendor: hero.id, vertical: "insurance", source, ...(region ? { state: region } : {}) }
    : noMatch
      ? { vendor: "licensed-broker", vertical: "insurance", source, ...(region ? { state: region } : {}) }
      : null;
  const pill0Payload: PartnerCtaImpressionPayload | null = pills[0]
    ? { vendor: pills[0].id, vertical: "insurance", source, ...(region ? { state: region } : {}) }
    : null;
  const pill1Payload: PartnerCtaImpressionPayload | null = pills[1]
    ? { vendor: pills[1].id, vertical: "insurance", source, ...(region ? { state: region } : {}) }
    : null;
  const heroImpressionRef = usePartnerCtaImpression(heroSlotPayload);
  const pill0ImpressionRef = usePartnerCtaImpression(pill0Payload);
  const pill1ImpressionRef = usePartnerCtaImpression(pill1Payload);

  if (!stageAtLeast("intake")) return null;

  if (INSURANCE_STATE_EXCLUSIONS[country]?.includes(upperRegion)) return null;
  // Rollout gate, distinct from the exclusions check above: AB/ON/NS etc.
  // aren't excluded (no permanent regulatory ban) but also aren't isLive()
  // yet — referral-fee legality there is still unresolved, so partner cards
  // must not render there even though the region itself isn't off-limits.
  // Same null-return pattern as the exclusions check (this module simply
  // doesn't render rather than showing a broken/dead-end card).
  if (!isLive(country, upperRegion)) return null;

  const regionName = REGION_NAMES[upperRegion] ?? region;
  const detail = LINE_DETAIL[line];

  const restrictedCopy =
    country === "CA" && upperRegion === "BC" && line === "strata"
      ? {
          label: "Licensed broker required in British Columbia",
          body: "BC doesn't allow referral fees on strata insurance, so this isn't a sponsored placement — seek help directly from a licensed BC strata broker.",
        }
      : {
          label: `Licensed broker required in ${regionName}`,
          body: `This coverage line isn't available as a sponsored placement in ${regionName} — seek help directly from a licensed broker who can place it.`,
        };

  function buildProfileUrl(vendorId?: string): string {
    const params = new URLSearchParams({ country, region: upperRegion, line, address });
    if (listingId) params.set("listingId", listingId);
    if (vendorId) params.set("vendor", vendorId);
    return `/coverage-profile?${params.toString()}`;
  }

  function handleClick(vendorId: string, isSponsored: boolean) {
    trackClick({
      vendorId,
      vertical: "insurance",
      state: region,
      source,
      affiliate: isSponsored,
      propertySlug: listingId,
      optOut: optedOut,
    });
  }

  const complianceNote =
    country === "US"
      ? "Availability varies by state. You'll only ever continue to a licensed insurance partner — Property Insights does not sell, quote, or bind insurance."
      : "Availability varies by province. You'll only ever continue to a licensed insurance partner — Property Insights does not sell, quote, or bind insurance.";

  return (
    <div className="border border-border rounded-xl overflow-hidden bg-white" data-insurance-module="protect-this-property">
      <div className="px-5 sm:px-6 pt-5">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">Protect this property</h2>
          <span className="text-[10px] font-mono uppercase tracking-wide text-muted/60">Insurance</span>
        </div>
        <p className="text-sm text-muted mt-1.5 max-w-[60ch]">
          Pick a coverage type. We already hold many of the property details an insurance partner may need — build a coverage
          profile and continue to a licensed insurance partner for your region.
        </p>
      </div>

      {/* Line chooser */}
      <div className="px-5 sm:px-6 pt-4 pb-1">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {LINES.map((l) => {
            const active = l.id === line;
            const gateChip = l.beta ? "Beta" : lineExclusions.includes(l.id) ? "Broker only" : null;
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => setLine(l.id)}
                aria-pressed={active}
                className={`relative text-center rounded-xl border px-2 py-3 transition-colors ${
                  active ? "border-cta-accent bg-cta-accent/5" : "border-border bg-white hover:border-foreground/20"
                }`}
              >
                <span className="text-[13px] font-semibold block text-foreground">{l.label}</span>
                {gateChip && (
                  <span className="inline-block mt-1.5 text-[9px] font-mono uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">
                    {gateChip}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected line detail + partner slate */}
      <div className="px-5 sm:px-6 pb-5 pt-4">
        <div className="text-sm text-muted mb-3.5 px-3.5 py-3 bg-gray-50/50 border border-border/60 rounded-lg">
          <span className="text-foreground font-semibold">{detail.headline}</span> — {detail.blurb}
        </div>

        {restricted ? (
          <div className="border border-amber-200 bg-amber-50 rounded-xl px-4 py-4">
            <div className="text-[10px] font-mono uppercase tracking-wide text-amber-700 mb-1.5">
              {restrictedCopy.label}
            </div>
            <p className="text-sm text-amber-900">{restrictedCopy.body}</p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-3">
            {hero && (
              <Link
                ref={heroImpressionRef}
                href={buildProfileUrl(hero.id)}
                onClick={() => handleClick(hero.id, true)}
                className="relative flex-1 min-w-[220px] basis-full sm:basis-auto overflow-hidden border border-border rounded-xl p-5 pl-6 bg-white hover:border-foreground/20 hover:shadow-sm transition-all group"
              >
                <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-cta-accent" aria-hidden="true" />
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="text-base font-semibold text-foreground group-hover:underline">
                    {hero.ctaLabel ?? hero.name}
                  </div>
                  <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted/70">Sponsored</span>
                </div>
                <p className="text-sm text-muted leading-relaxed mb-2">
                  {hero.offerText ?? hero.description ?? hero.name}
                </p>
                <span className="text-xs text-cta-accent font-semibold">Start your profile &rarr;</span>
              </Link>
            )}

            {pills.map((vendor, i) => (
              <Link
                key={vendor.id}
                ref={i === 0 ? pill0ImpressionRef : pill1ImpressionRef}
                href={buildProfileUrl(vendor.id)}
                onClick={() => handleClick(vendor.id, true)}
                className="relative flex-1 min-w-[150px] basis-full sm:basis-auto overflow-hidden border border-border rounded-xl p-4 pl-5 bg-white hover:border-foreground/20 hover:shadow-sm transition-all group"
              >
                <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-cta-accent" aria-hidden="true" />
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="text-[13.5px] font-semibold text-foreground group-hover:underline">
                    {vendor.name}
                  </div>
                  <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted/70">Sponsored</span>
                </div>
                <p className="text-xs text-muted leading-relaxed">{vendor.description ?? vendor.name}</p>
              </Link>
            ))}

            {noMatch && (
              <Link
                ref={heroImpressionRef}
                href={buildProfileUrl()}
                onClick={() => handleClick("licensed-broker", false)}
                className="relative flex-1 min-w-[220px] overflow-hidden border border-border rounded-xl p-5 pl-6 bg-white hover:border-foreground/20 hover:shadow-sm transition-all group"
              >
                <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-cta-accent" aria-hidden="true" />
                <div className="text-base font-semibold text-foreground group-hover:underline mb-1">
                  Match me with an insurance partner
                </div>
                <p className="text-sm text-muted leading-relaxed">
                  We&apos;ll route your request to a licensed insurance professional who can place this line in {regionName}.
                </p>
              </Link>
            )}
          </div>
        )}

        {hasSponsoredCard && <p className="text-xs text-muted leading-relaxed mt-3.5">{FTC_DISCLOSURE}</p>}
        <p className="text-[11.5px] text-muted/70 leading-relaxed mt-2">{complianceNote}</p>
        <Link href="/insurance" className="inline-block text-[11.5px] text-cta-accent font-medium mt-2 hover:underline">
          How insurance matching works &rarr;
        </Link>
      </div>
    </div>
  );
}
