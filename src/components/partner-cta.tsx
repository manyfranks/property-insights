"use client";

/**
 * Affiliate partner CTAs for property pages.
 *
 * Outbound links to partner sites (Ratehub, nesto, Homewise, Square One).
 * Users click through and provide their own info on the partner site —
 * we don't share any user data. Click events are tracked for analytics.
 *
 * Affiliate URLs are configured via env vars (NEXT_PUBLIC_ prefix for client).
 * Falls back to partner homepages when no affiliate URL is set.
 */

export type PartnerType = "compare-rates" | "pre-approval" | "insurance";

interface PartnerConfig {
  label: string;
  partner: string;
  description: string;
  href: string;
  fallback: string;
}

const PARTNER_CONFIG: Record<PartnerType, PartnerConfig> = {
  "compare-rates": {
    label: "Compare mortgage rates",
    partner: "Ratehub",
    description: "See today's best mortgage rates from 50+ lenders",
    href: process.env.NEXT_PUBLIC_RATEHUB_URL || "",
    fallback: "https://www.ratehub.ca/best-mortgage-rates",
  },
  "pre-approval": {
    label: "Get pre-approved",
    partner: "nesto",
    description: "Online mortgage pre-approval in minutes",
    href: process.env.NEXT_PUBLIC_NESTO_URL || "",
    fallback: "https://www.nesto.ca",
  },
  insurance: {
    label: "Get a home insurance quote",
    partner: "Square One",
    description: "Customizable home insurance coverage",
    href: process.env.NEXT_PUBLIC_SQUAREONE_URL || "",
    fallback: "https://www.squareone.ca",
  },
};

interface PartnerCtaProps {
  type: PartnerType;
  propertySlug?: string;
  city?: string;
}

function trackClick(type: PartnerType, propertySlug?: string, city?: string) {
  fetch("/api/partner-connect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ partnerType: type, propertySlug, city }),
  }).catch(() => {}); // fire and forget
}

export default function PartnerCta({
  type,
  propertySlug,
  city,
}: PartnerCtaProps) {
  const config = PARTNER_CONFIG[type];
  const url = config.href || config.fallback;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer sponsored"
      onClick={() => trackClick(type, propertySlug, city)}
      className="flex-1 min-w-[140px] border border-border rounded-xl p-4 bg-white hover:border-foreground/20 hover:shadow-sm transition-all group"
    >
      <div className="text-sm font-medium text-foreground mb-1 group-hover:underline">
        {config.label}
      </div>
      <p className="text-xs text-muted leading-relaxed mb-2">
        {config.description}
      </p>
      <span className="text-xs text-muted">
        {config.partner} &rarr;
      </span>
    </a>
  );
}
