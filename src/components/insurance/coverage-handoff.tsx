"use client";

/**
 * components/insurance/coverage-handoff.tsx
 *
 * Screen 4 of the Insurance Path design: the confirmation/handoff page
 * shown after a coverage profile is saved. Unlicensed-referrer framing
 * throughout — "Outcome" CTA only ("Build your coverage profile → get
 * matched" / "Continue to {partner}"), never a quote or ranking framing.
 * See scripts/check-insurance-copy.ts, which scans this whole directory for
 * prohibited solicitation terms.
 *
 * Vendor resolution: the `vendor` query param (carried through as
 * `vendorParam`) wins when it names an eligible vendor for this
 * country/line/region; otherwise the top eligible insurance vendor from the
 * registry (src/config/affiliate-vendors.ts) by cpaTier/affiliateReady;
 * otherwise a plain, visibly-unsponsored "match me" mailto fallback. Every
 * currently-enabled insurance vendor is CA-only (Square One, APOLLO), so on
 * US traffic (and for lines no enabled vendor writes) the fallback is what
 * actually renders today — that's expected, not a bug. The resolver itself
 * lives in resolve-vendor.ts (shared with coverage-profile-wizard.tsx, which
 * needs the same eligibility logic reactively for its consent copy).
 */

import { useState } from "react";
import { getAffiliateUrl, type AffiliateSource, type Country, type InsuranceLine } from "@/config/affiliate-vendors";
import { resolveVendor } from "@/components/insurance/resolve-vendor";
import { ProvenanceChip, type ProvenanceSource } from "@/components/insurance/coverage-provenance-chip";

export interface HandoffRow {
  label: string;
  value: string;
  source: ProvenanceSource;
}

const CONTACT_EMAIL = "insights@mail.propertyinsights.xyz";

const COMPLIANCE_NOTE =
  "Availability varies by state/province. You'll only ever be matched with a licensed broker — Property Insights does not sell, quote, or bind insurance.";

// This screen is only ever reached via the /coverage-profile wizard (Stage 2
// intake), not directly from an assessment result page — "assess-result"
// (the value this used to be hardcoded to) misrepresented the surface for
// both click-through analytics and the sub_id on the affiliate URL.
// "property-page" is the closest existing AffiliateSource bucket (see its
// doc comment in src/config/affiliate-vendors.ts for why a dedicated
// "coverage-profile" value isn't used instead — it would break a hardcoded
// list in a file out of scope for this change).
const HANDOFF_SOURCE: AffiliateSource = "property-page";

function trackHandoffClick(payload: Record<string, unknown>) {
  void fetch("/api/partner-connect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch((err) => {
    if (process.env.NODE_ENV === "development") {
      console.warn("[track] beacon failed:", err);
    }
  });
}

export default function CoverageHandoff({
  profileId,
  country,
  region,
  line,
  vendorParam,
  rows,
}: {
  profileId: string;
  country: Country;
  region: string;
  line: InsuranceLine;
  vendorParam: string | null;
  rows: HandoffRow[];
}) {
  const [clicked, setClicked] = useState(false);
  const vendor = resolveVendor(country, region, line, vendorParam);
  // subId = profileId: per-referral attribution, so this click's outbound
  // URL carries the same id that markProfileHandoff stamps onto
  // coverage_profiles.vendor_id (the authoritative reconciliation record).
  // See getAffiliateUrl's doc comment for the per-partner sub_id caveat.
  const resolved = vendor ? getAffiliateUrl(vendor.id, HANDOFF_SOURCE, profileId) : null;
  const partnerName = vendor?.name ?? "a licensed broker";

  function handleClick() {
    setClicked(true);
    trackHandoffClick({
      vendor: vendor?.id ?? "broker-referral-fallback",
      vertical: "insurance",
      state: region,
      source: HANDOFF_SOURCE,
      affiliate: resolved?.isAffiliate ?? false,
      profileId,
    });
  }

  const mailHref = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
    `Match me with a licensed broker — coverage profile ${profileId}`
  )}`;

  return (
    <div>
      <div className="text-center mb-7">
        <div className="inline-flex items-center justify-center w-11 h-11 rounded-full bg-teal-50 mb-3.5">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M5 12.5l4.5 4.5L19 7.5"
              stroke="#0f766e"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted mb-1.5">
          Coverage profile ready
        </div>
        <h1 className="text-2xl sm:text-[26px] font-semibold tracking-tight text-foreground mb-1.5 text-wrap-balance">
          You&apos;re matched with a licensed broker
        </h1>
        <p className="text-sm text-muted max-w-md mx-auto leading-relaxed">
          Your details travel with you — {partnerName} opens with your property already filled in.
          They&apos;re the broker of record; Property Insights never sells or binds coverage.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-white overflow-hidden mb-4">
        <div className="px-4 sm:px-5 py-3.5 border-b border-border flex items-center justify-between">
          <span className="text-[13px] font-semibold text-foreground">Profile we&apos;re handing off</span>
          <span className="font-mono text-[9px] uppercase tracking-wide text-muted">{rows.length} fields</span>
        </div>
        <div className="px-4 sm:px-5 divide-y divide-border">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-3 py-2.5">
              <span className="text-[12.5px] text-muted">{row.label}</span>
              <span className="flex items-center gap-2">
                <span className="font-mono text-[13px] font-medium text-foreground text-right">{row.value}</span>
                <ProvenanceChip source={row.source} />
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-white p-4 sm:p-5">
        {vendor && resolved ? (
          <a
            href={resolved.url}
            target="_blank"
            rel="noopener noreferrer sponsored"
            onClick={handleClick}
            className="relative block overflow-hidden rounded-xl border border-cta-accent bg-teal-50/40 px-5 py-4 hover:shadow-sm transition-shadow"
          >
            <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-cta-accent" aria-hidden="true" />
            <div className="text-base font-semibold text-foreground mb-1">
              Build your coverage profile → get matched
            </div>
            <p className="text-[13px] text-muted mb-3 leading-relaxed">
              A licensed broker for {region} picks it up with everything above already filled in.
            </p>
            <span className="inline-flex items-center gap-2 rounded-lg bg-cta-accent text-white px-4 py-2 text-[13.5px] font-semibold">
              Continue to {partnerName} →
            </span>
            {resolved.isAffiliate && (
              <span className="block mt-2 text-[10px] uppercase tracking-wide text-muted/70">Sponsored</span>
            )}
          </a>
        ) : (
          <a
            href={mailHref}
            onClick={handleClick}
            className="relative block overflow-hidden rounded-xl border border-border bg-white px-5 py-4 hover:border-foreground/30 transition-colors"
          >
            <div className="text-base font-semibold text-foreground mb-1">
              Build your coverage profile → get matched
            </div>
            <p className="text-[13px] text-muted mb-3 leading-relaxed">
              No partner is licensed to refer this line in {region} yet — reach our team directly and
              we&apos;ll route you to a licensed broker.
            </p>
            <span className="inline-flex items-center gap-2 rounded-lg border border-foreground text-foreground px-4 py-2 text-[13.5px] font-semibold">
              Match me with a licensed broker →
            </span>
            <span className="block mt-2 text-[10px] uppercase tracking-wide text-muted/70">Unsponsored</span>
          </a>
        )}

        <p className="text-xs text-muted leading-relaxed mt-3.5">
          We may earn a commission if you get a quote through this match. This doesn&apos;t affect our
          analysis. {COMPLIANCE_NOTE}
        </p>
      </div>

      {clicked && <p className="text-xs text-muted text-center mt-3">Opening {partnerName} in a new tab…</p>}
    </div>
  );
}
