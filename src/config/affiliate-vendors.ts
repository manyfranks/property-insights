/**
 * config/affiliate-vendors.ts
 *
 * Affiliate vendor registry — config-as-code, no DB.
 *
 * Pattern: two joined concerns (vendor data + URL/tracking resolution) live
 * in one file so presentational components (src/components/partner-cta.tsx)
 * stay dumb — they just render whatever getVendorsForRegion() hands back.
 *
 * State resolution here is trivial vs. IP-geolocation setups: on property /
 * result pages the CTA region comes from the property's own address, not
 * visitor geolocation.
 *
 * See docs/plans/07-US-AFFILIATE-CTA-SPEC.md for the full design rationale
 * and the researched US vendor slate (Aug 2026) — this file is the code
 * implementation of that spec's Phase 1.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Vertical =
  | "insurance"
  | "mortgage"
  | "investor-tools"
  | "tax-appeal"
  | "agent-referral"
  | "home-services";

export type Country = "US" | "CA";

export type AudienceMode = "buyer" | "investor";

export type AffiliateNetwork =
  | "direct"
  | "CJ"
  | "Impact"
  | "FlexOffers"
  | "ShareASale"
  | "PartnerStack"
  | "unconfirmed";

/**
 * Where a CTA is being rendered — passed through to /api/partner-connect
 * for per-vertical EPC measurement and appended as `sub_id` on affiliate
 * URLs (when the resolved URL is the tracked affiliate URL, not a plain
 * fallback).
 */
export type AffiliateSource =
  | "assess-result"
  | "property-page"
  | "calculator"
  | "email"
  | "discover";

export interface AffiliateVendor {
  /** env var key: NEXT_PUBLIC_AFFILIATE_URL_{ID} (uppercased, hyphens -> underscores) */
  id: string;
  name: string;
  vertical: Vertical;
  country: Country;
  /** plain fallback URL when no affiliate URL is configured in env */
  url: string;
  enabled: boolean;
  /** true once a tracked affiliate URL exists (or is expected) in env */
  affiliateReady: boolean;
  /** 3 = $150+/action, 2 = $50-150, 1 = <$50, 0 = none — drives hero-vs-pill layout */
  cpaTier: 0 | 1 | 2 | 3;
  /** which app mode shows this CTA */
  audienceMode: AudienceMode[];
  /** USPS/province codes; "all" = no gate */
  stateCoverage: string[] | "all";
  /** alternative to a coverage allowlist (e.g. Kiavi's excluded states) */
  stateExclusions?: string[];
  /** promo copy shown when rendered as the hero CTA */
  offerText?: string;
  network: AffiliateNetwork;
  /** rate/payment/business notes — not rendered, for maintainers only */
  notes?: string;

  // --- Presentation extensions (beyond the spec interface) ---
  // The spec's registry interface intentionally omits UI copy since it's a
  // data/eligibility registry. We keep short display copy alongside the
  // vendor data so the adaptive CTA block has something to render without a
  // second lookup table. Both are optional; the block falls back to
  // generic vertical-based copy when absent (true for every inert US
  // placeholder below).
  /** short CTA button copy, e.g. "Compare mortgage rates" */
  ctaLabel?: string;
  /** one-line helper text under the CTA label */
  description?: string;
  /**
   * Maps to the pre-Phase-1 PartnerType so /api/partner-connect keeps
   * populating `data->>'partnerType'` for the existing intent-score SQL
   * (src/lib/db/user-events.ts) without a migration. Only set on the 3
   * migrated CA vendors; new vendors are tracked purely by `vendor`/`vertical`.
   */
  legacyPartnerType?: "compare-rates" | "pre-approval" | "insurance";
  /** explicit override when the configured env var doesn't match the default
   *  NEXT_PUBLIC_AFFILIATE_URL_{ID} pattern (used to preserve the 3 existing
   *  Vercel env vars for the CA vendors migrated from partner-cta.tsx) */
  envKey?: string;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const AFFILIATE_VENDORS: AffiliateVendor[] = [
  // ---------------------------------------------------------------------
  // CA — live today, migrated from the old PARTNER_CONFIG in partner-cta.tsx
  // ---------------------------------------------------------------------
  {
    id: "ratehub",
    name: "Ratehub",
    vertical: "mortgage",
    country: "CA",
    url: "https://www.ratehub.ca/best-mortgage-rates",
    enabled: true,
    affiliateReady: true,
    cpaTier: 2,
    audienceMode: ["buyer", "investor"],
    stateCoverage: "all",
    network: "direct",
    ctaLabel: "Compare mortgage rates",
    description: "See today's best mortgage rates from 50+ lenders",
    legacyPartnerType: "compare-rates",
    envKey: "NEXT_PUBLIC_RATEHUB_URL",
  },
  {
    id: "nesto",
    name: "nesto",
    vertical: "mortgage",
    country: "CA",
    url: "https://www.nesto.ca",
    enabled: true,
    affiliateReady: true,
    cpaTier: 2,
    audienceMode: ["buyer", "investor"],
    stateCoverage: "all",
    network: "direct",
    ctaLabel: "Get pre-approved",
    description: "Online mortgage pre-approval in minutes",
    legacyPartnerType: "pre-approval",
    envKey: "NEXT_PUBLIC_NESTO_URL",
  },
  {
    id: "squareone",
    name: "Square One",
    vertical: "insurance",
    country: "CA",
    url: "https://www.squareone.ca",
    enabled: true,
    affiliateReady: true,
    cpaTier: 1,
    audienceMode: ["buyer", "investor"],
    stateCoverage: "all",
    offerText: "$20 credit applied automatically",
    network: "direct",
    ctaLabel: "Get a home insurance quote",
    description: "Customizable coverage — $20 credit applied automatically",
    legacyPartnerType: "insurance",
    envKey: "NEXT_PUBLIC_SQUAREONE_URL",
  },

  // ---------------------------------------------------------------------
  // US — Tier 1: self-serve, nationwide, fastest to revenue (apply first)
  // Data-complete, inert until affiliate approvals land.
  // ---------------------------------------------------------------------
  {
    id: "rentcast",
    name: "RentCast",
    vertical: "investor-tools",
    country: "US",
    url: "https://www.rentcast.io",
    enabled: true,
    affiliateReady: true,
    cpaTier: 2,
    audienceMode: ["investor"],
    stateCoverage: "all",
    network: "direct",
    offerText: "Use code PROPERTYINSIGHTS at checkout",
    notes:
      "30% recurring + $100/10 customers, PayPal monthly, 90d cookie. Bans paid-traffic promotion — app link-out is fine. Apply: affiliates.rentcast.io",
  },
  {
    id: "dealcheck",
    name: "DealCheck",
    vertical: "investor-tools",
    country: "US",
    url: "https://dealcheck.io",
    enabled: false,
    affiliateReady: false,
    cpaTier: 2,
    audienceMode: ["investor"],
    stateCoverage: "all",
    network: "direct",
    notes: "30% recurring + $100/10 users, 90d cookie.",
  },
  {
    id: "dealmachine",
    name: "DealMachine",
    vertical: "investor-tools",
    country: "US",
    url: "https://www.dealmachine.com",
    enabled: false,
    affiliateReady: false,
    cpaTier: 2,
    audienceMode: ["investor"],
    stateCoverage: "all",
    network: "direct",
    notes:
      "20-50% lifetime recurring, apply direct. Requires explicit 'Paid link' disclosure wording per their affiliate ToS.",
  },
  {
    id: "propstream",
    name: "PropStream",
    vertical: "investor-tools",
    country: "US",
    url: "https://www.propstream.com",
    enabled: false,
    affiliateReady: false,
    cpaTier: 2,
    audienceMode: ["investor"],
    stateCoverage: "all",
    network: "direct",
    notes: "~30% recurring UNVERIFIED — re-verify after approval.",
  },

  // ---------------------------------------------------------------------
  // US — Tier 2: high $/action, moderate friction
  // ---------------------------------------------------------------------
  {
    id: "kiavi",
    name: "Kiavi",
    vertical: "investor-tools",
    country: "US",
    url: "https://www.kiavi.com",
    enabled: false,
    affiliateReady: false,
    cpaTier: 3,
    audienceMode: ["investor"],
    stateCoverage: "all",
    stateExclusions: ["MS", "NM", "RI", "UT", "VT"],
    network: "PartnerStack",
    notes:
      "$1,000/closed loan (verified). Lending — needs >=30 investor referrals/yr capability; agents/brokers ineligible (note in application that this is a software tool). Confirm cross-border PartnerStack payout.",
  },
  {
    id: "ownwell",
    name: "Ownwell",
    vertical: "tax-appeal",
    country: "US",
    url: "https://www.ownwell.com",
    enabled: false,
    affiliateReady: false,
    cpaTier: 2,
    audienceMode: ["buyer", "investor"],
    // Full-service tier only; outside these states Ownwell routes to a
    // DIY "National Appeals Packet" (launched Feb 2026) — that fallback CTA
    // isn't wired up in Phase 1, tracked here as a note for the next pass.
    stateCoverage: ["CA", "CO", "FL", "GA", "IL", "NY", "TX", "WA"],
    network: "FlexOffers",
    notes:
      "CPA on completed+paid appeal, months lag, 45d cookie. Two-tier state coverage: full-service in CA/CO/FL/GA/IL/NY/TX/WA; elsewhere Ownwell offers a DIY 'National Appeals Packet' — needs a separate nationwide-DIY CTA variant to route non-covered states, not yet implemented.",
  },

  // ---------------------------------------------------------------------
  // US — Tier 3: thinner data, apply to confirm
  // ---------------------------------------------------------------------
  {
    id: "zebra",
    name: "The Zebra",
    vertical: "insurance",
    country: "US",
    url: "https://www.thezebra.com",
    enabled: false,
    affiliateReady: false,
    cpaTier: 1,
    audienceMode: ["buyer", "investor"],
    stateCoverage: "all",
    network: "unconfirmed",
    notes:
      "Carrier-agnostic insurance comparison — nationwide default insurance CTA when a specific carrier isn't licensed in the property's state. Network unconfirmed (possibly Awin); apply direct.",
  },
  {
    id: "lendingtree",
    name: "LendingTree",
    vertical: "mortgage",
    country: "US",
    url: "https://www.lendingtree.com",
    enabled: false,
    affiliateReady: false,
    cpaTier: 1,
    audienceMode: ["buyer", "investor"],
    stateCoverage: "all",
    network: "CJ",
    notes: "$1-70/lead, sub-offers vary. Mortgage CPL via CJ.",
  },
  {
    id: "homelight",
    name: "HomeLight",
    vertical: "agent-referral",
    country: "US",
    url: "https://www.homelight.com",
    enabled: false,
    affiliateReady: false,
    cpaTier: 1,
    audienceMode: ["buyer", "investor"],
    stateCoverage: "all",
    network: "direct",
    notes:
      "Self-serve affiliate arm (affiliate.homelight.com), distinct from the licensed agent-referral network. RESPA-clean as a platform affiliate fee.",
  },
];

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/**
 * Vendors eligible for a given property region + app mode, filtered by
 * enabled + state gate + audienceMode, sorted by cpaTier desc then
 * affiliateReady. Array.prototype.sort is stable (ES2019+), so ties fall
 * back to registry order.
 */
export function getVendorsForRegion(
  country: Country,
  state: string | undefined,
  mode: AudienceMode = "buyer"
): AffiliateVendor[] {
  const upperState = state ? state.toUpperCase() : undefined;

  return AFFILIATE_VENDORS.filter((v) => v.enabled)
    .filter((v) => v.country === country)
    .filter((v) => v.audienceMode.includes(mode))
    .filter((v) => {
      if (upperState && v.stateExclusions?.includes(upperState)) return false;
      if (v.stateCoverage === "all") return true;
      return upperState ? v.stateCoverage.includes(upperState) : true;
    })
    .sort((a, b) => {
      if (b.cpaTier !== a.cpaTier) return b.cpaTier - a.cpaTier;
      return Number(b.affiliateReady) - Number(a.affiliateReady);
    });
}

// ---------------------------------------------------------------------------
// URL resolver
// ---------------------------------------------------------------------------

/**
 * Next.js inlines `process.env.NEXT_PUBLIC_X` at build time only when the
 * expression is a static, literal member access — `process.env[dynamicKey]`
 * is NOT replaced and will be `undefined` in the client bundle. So instead
 * of resolving `NEXT_PUBLIC_AFFILIATE_URL_{ID}` dynamically, every vendor's
 * env var is referenced literally once here and looked up by vendor id at
 * call time. This is the same trick partner-cta.tsx already relied on
 * (three inline `process.env.NEXT_PUBLIC_X` reads) — just centralized so
 * getAffiliateUrl() can serve every vendor, not just three.
 *
 * The 3 CA vendors keep their existing Vercel env var names via `envKey`
 * (see registry above); everything else uses the default
 * NEXT_PUBLIC_AFFILIATE_URL_{ID} pattern this map's keys document.
 */
const ENV_URL_MAP: Record<string, string | undefined> = {
  // CA — preserve existing Vercel env var names (envKey overrides above)
  ratehub: process.env.NEXT_PUBLIC_RATEHUB_URL,
  nesto: process.env.NEXT_PUBLIC_NESTO_URL,
  squareone: process.env.NEXT_PUBLIC_SQUAREONE_URL,

  // US — default NEXT_PUBLIC_AFFILIATE_URL_{ID} pattern, wired per vendor
  // as approvals land. Reading these now (even though every US vendor is
  // `enabled: false`) costs nothing and means turning a vendor on is a
  // config-only change — no code edit required.
  rentcast: process.env.NEXT_PUBLIC_AFFILIATE_URL_RENTCAST,
  dealcheck: process.env.NEXT_PUBLIC_AFFILIATE_URL_DEALCHECK,
  dealmachine: process.env.NEXT_PUBLIC_AFFILIATE_URL_DEALMACHINE,
  propstream: process.env.NEXT_PUBLIC_AFFILIATE_URL_PROPSTREAM,
  kiavi: process.env.NEXT_PUBLIC_AFFILIATE_URL_KIAVI,
  ownwell: process.env.NEXT_PUBLIC_AFFILIATE_URL_OWNWELL,
  zebra: process.env.NEXT_PUBLIC_AFFILIATE_URL_ZEBRA,
  lendingtree: process.env.NEXT_PUBLIC_AFFILIATE_URL_LENDINGTREE,
  homelight: process.env.NEXT_PUBLIC_AFFILIATE_URL_HOMELIGHT,
};

function appendSubId(url: string, source: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set("sub_id", source);
    return u.toString();
  } catch {
    // Relative or otherwise unparseable URL — fall back to naive append.
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}sub_id=${encodeURIComponent(source)}`;
  }
}

export interface ResolvedAffiliateUrl {
  url: string;
  /** true when `url` is the tracked affiliate URL (env-configured), false when it's the plain fallback */
  isAffiliate: boolean;
}

/**
 * Resolves the outbound URL for a vendor: the env-configured affiliate URL
 * when present, otherwise the vendor's plain fallback `url`. Appends
 * `sub_id={source}` only when the resolved URL is the affiliate one —
 * sub_id has no meaning on a plain homepage link.
 */
export function getAffiliateUrl(
  id: string,
  source?: AffiliateSource
): ResolvedAffiliateUrl {
  const vendor = AFFILIATE_VENDORS.find((v) => v.id === id);
  const envUrl = ENV_URL_MAP[id];

  if (envUrl) {
    return {
      url: source ? appendSubId(envUrl, source) : envUrl,
      isAffiliate: true,
    };
  }

  return { url: vendor?.url ?? "", isAffiliate: false };
}

// ---------------------------------------------------------------------------
// Health guard
// ---------------------------------------------------------------------------

/**
 * Vendors where a missing env URL is silent revenue loss, not just a
 * degraded experience. Phase 1: the 3 live CA vendors. Add a US vendor's id
 * here the day it flips to enabled+affiliateReady.
 */
export const REVENUE_CRITICAL_IDS: string[] = ["ratehub", "nesto", "squareone"];

/**
 * Prod-only check: for every revenue-critical vendor that is currently
 * enabled + affiliateReady, verify its env URL actually resolved. Call once
 * server-side (property/result page render) — cheap, synchronous, no I/O.
 */
export function assertAffiliateHealth(): void {
  if (process.env.NODE_ENV !== "production") return;

  for (const id of REVENUE_CRITICAL_IDS) {
    const vendor = AFFILIATE_VENDORS.find((v) => v.id === id);
    if (!vendor || !vendor.enabled || !vendor.affiliateReady) continue;

    if (!ENV_URL_MAP[id]) {
      console.error(
        `[affiliate-health] Revenue-critical vendor "${id}" is enabled+affiliateReady but its env URL ` +
          `(${vendor.envKey ?? `NEXT_PUBLIC_AFFILIATE_URL_${id.toUpperCase()}`}) is missing — falling back to ${vendor.url}.`
      );
    }
  }
}
