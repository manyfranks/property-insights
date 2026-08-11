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
  | "discover"
  | "county-page"
  | "rent-page"
  | "state-page"
  | "resources"
  | "blog";

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
  /** 1-2 word action verb for the compact PartnerCtaRow button, e.g. "Track it" */
  shortCta?: string;
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
    description: "See today's best Canadian mortgage rates in one place",
    shortCta: "Compare",
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
    ctaLabel: "Get pre-approved for a mortgage",
    description: "Find out how much you can borrow — free, online, in minutes",
    shortCta: "Start",
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
    ctaLabel: "Get home insurance",
    description: "Quote in 5 minutes — $20 credit applied automatically",
    shortCta: "Get quote",
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
    audienceMode: ["buyer", "investor"],
    stateCoverage: "all",
    network: "direct",
    ctaLabel: "Track this home's value and rent",
    description: "Free alerts when a property's value or rent changes",
    shortCta: "Track it",
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
    enabled: true,
    affiliateReady: true,
    cpaTier: 2,
    audienceMode: ["buyer", "investor"],
    stateCoverage: "all",
    network: "direct",
    ctaLabel: "Will this deal make money?",
    description: "Free calculators for cash flow, profit, and what to offer",
    shortCta: "Analyze it",
    offerText: "Use code BESTDEAL at checkout",
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
    ctaLabel: "Find off-market deals",
    description: "Drive for dollars, skip trace owners, send mail — one app",
    shortCta: "Find deals",
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
    ctaLabel: "Research any property",
    description: "Owner info, liens, comps, and motivated-seller lists",
    shortCta: "Research",
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
    enabled: true,
    affiliateReady: true,
    cpaTier: 3,
    audienceMode: ["investor"],
    stateCoverage: "all",
    stateExclusions: ["MS", "NM", "RI", "UT", "VT"],
    network: "PartnerStack",
    ctaLabel: "Get a loan for a flip or rental",
    description: "Fast financing built for real estate investors",
    shortCta: "Get funded",
    notes:
      "APPROVED Aug 2026. $1,000/closed loan (verified). Tracking link: try.kiavi.com/property-insights (set NEXT_PUBLIC_AFFILIATE_URL_KIAVI). Excluded states gated above. Confirm cross-border PartnerStack payout before first threshold.",
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
    ctaLabel: "Lower my property taxes",
    description: "They appeal your assessment for you — you only pay if you save",
    shortCta: "Appeal now",
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
    ctaLabel: "Compare home insurance quotes",
    description: "Prices from 100+ insurance companies side by side",
    shortCta: "Compare",
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
    ctaLabel: "Compare mortgage offers",
    description: "Up to 5 lender offers from one short form",
    shortCta: "Compare",
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
    ctaLabel: "Find a top local agent",
    description: "Free matches with the best-reviewed agents near this home",
    shortCta: "Find agent",
    notes:
      "Self-serve affiliate arm (affiliate.homelight.com), distinct from the licensed agent-referral network. RESPA-clean as a platform affiliate fee.",
  },

  // ---------------------------------------------------------------------
  // US — Research addendum v2 (verified web pass, Aug 7 2026)
  // Data-complete, inert until affiliate approvals land.
  // ---------------------------------------------------------------------
  {
    id: "allstate",
    name: "Allstate",
    vertical: "insurance",
    country: "US",
    url: "https://www.allstate.com",
    enabled: false,
    affiliateReady: false,
    cpaTier: 1,
    audienceMode: ["buyer"],
    stateCoverage: "all",
    network: "Impact",
    ctaLabel: "Get a home insurance quote",
    description: "See what it costs to insure this home",
    shortCta: "Get quote",
    notes:
      "~$5-8/lead PPL (secondary-sourced; verify in Impact dashboard). Impact media-partner application explicitly accepts US/Canada publishers; 2-5 day manual review.",
  },
  {
    id: "smartfinancial",
    name: "SmartFinancial",
    vertical: "insurance",
    country: "US",
    url: "https://smartfinancial.com",
    enabled: false,
    affiliateReady: false,
    cpaTier: 1,
    audienceMode: ["buyer", "investor"],
    stateCoverage: "all",
    network: "direct",
    ctaLabel: "Find cheaper home insurance",
    description: "Compare quotes from local and national insurers",
    shortCta: "Compare",
    notes:
      "In-house publisher platform (agents.smartfinancial.com/publishers), self-serve low-barrier approval; up to ~$40/lead claimed (unverified).",
  },
  {
    id: "insurify",
    name: "Insurify",
    vertical: "insurance",
    country: "US",
    url: "https://insurify.com",
    enabled: false,
    affiliateReady: false,
    cpaTier: 1,
    audienceMode: ["buyer", "investor"],
    stateCoverage: "all",
    network: "Impact",
    ctaLabel: "Compare insurance quotes",
    description: "Real quotes from 100+ companies in minutes",
    shortCta: "Compare",
    notes:
      "~$15/lead home (secondary), 30d cookie; licensed all 50 states; apply via Impact or partnerships@insurify.com.",
  },
  {
    id: "easystreet",
    name: "Easy Street Capital",
    vertical: "investor-tools",
    country: "US",
    url: "https://www.easystreetcap.com",
    enabled: false,
    affiliateReady: false,
    cpaTier: 3,
    audienceMode: ["investor"],
    stateCoverage: "all",
    network: "direct",
    ctaLabel: "Get investor financing fast",
    description: "Hard-money and rental loans with quotes in minutes",
    shortCta: "Get funded",
    notes:
      "$1,000/closed loan (verified on easystreetcap.com/refer/) — Kiavi payout parity; DSCR/hard money is RESPA-exempt business-purpose credit.",
  },
  {
    id: "limaone",
    name: "Lima One Capital",
    vertical: "investor-tools",
    country: "US",
    url: "https://limaone.com",
    enabled: false,
    affiliateReady: false,
    cpaTier: 3,
    audienceMode: ["investor"],
    stateCoverage: "all",
    network: "direct",
    ctaLabel: "Finance my next investment",
    description: "Loans for flips, rentals, and new construction",
    shortCta: "Get funded",
    notes:
      "0.25-0.50% of funded loan (verified, limaone.com/referral-application/); DSCR/fix-flip/construction.",
  },
  {
    id: "newamericanfunding",
    name: "New American Funding",
    vertical: "mortgage",
    country: "US",
    url: "https://www.newamericanfunding.com",
    enabled: false,
    affiliateReady: false,
    cpaTier: 2,
    audienceMode: ["buyer"],
    stateCoverage: "all",
    network: "FlexOffers",
    ctaLabel: "Get pre-approved for a mortgage",
    description: "See what you can afford with a fast online pre-approval",
    shortCta: "Get pre-approved",
    notes:
      "Up to $60/prospect, verified Active on FlexOffers — second reason FlexOffers signup gates revenue.",
  },
  {
    id: "baselane",
    name: "Baselane",
    vertical: "investor-tools",
    country: "US",
    url: "https://www.baselane.com",
    enabled: false,
    affiliateReady: false,
    cpaTier: 2,
    audienceMode: ["investor"],
    stateCoverage: "all",
    network: "direct",
    ctaLabel: "Banking built for landlords",
    description: "Free rent collection, bookkeeping, and banking for rentals",
    shortCta: "Sign up",
    notes:
      "$150-200/referral via Affonso.io, no minimum (verified); landlord banking/finance.",
  },

  // ---------------------------------------------------------------------
  // US — CJ live-dashboard inventory (Aug 2026 pass). Inert until applied
  // for / approved; added now so the vertical-priority fallback engine has
  // real candidates to slot in as approvals land.
  // ---------------------------------------------------------------------
  {
    id: "mrc",
    name: "Mortgage Research Center",
    vertical: "mortgage",
    country: "US",
    url: "https://www.mortgageresearch.com",
    enabled: false,
    affiliateReady: false,
    cpaTier: 2,
    audienceMode: ["buyer"],
    stateCoverage: "all",
    network: "CJ",
    ctaLabel: "Compare mortgage lenders",
    description: "Match with lenders that fit this home and your budget",
    shortCta: "Compare",
    notes:
      "CJ #7647072, Lead 60% revshare, 3mo EPC $207 — lower approval odds, apply with content samples.",
  },
  {
    id: "simplybusiness",
    name: "Simply Business",
    vertical: "insurance",
    country: "US",
    url: "https://www.simplybusiness.com",
    enabled: false,
    affiliateReady: false,
    cpaTier: 2,
    audienceMode: ["investor"],
    stateCoverage: "all",
    network: "CJ",
    ctaLabel: "Insure my rental property",
    description: "Landlord insurance quotes from top insurers in minutes",
    shortCta: "Get quote",
    notes: "CJ #5808859, $30/lead, 3mo EPC $1,570 — landlord/business insurance.",
  },
  {
    id: "avail",
    name: "Avail",
    vertical: "investor-tools",
    country: "US",
    url: "https://www.avail.co",
    enabled: false,
    affiliateReady: false,
    cpaTier: 1,
    audienceMode: ["investor"],
    stateCoverage: "all",
    network: "CJ",
    ctaLabel: "Manage my rental for free",
    description: "Free landlord software: leases, tenant screening, rent collection",
    shortCta: "Sign up",
    notes: "CJ #7785516, $25/lead, 3mo EPC $143. Realtor.com-owned.",
  },
  {
    id: "choicehomewarranty",
    name: "Choice Home Warranty",
    vertical: "home-services",
    country: "US",
    url: "https://www.choicehomewarranty.com",
    enabled: false,
    affiliateReady: false,
    cpaTier: 1,
    audienceMode: ["buyer"],
    stateCoverage: "all",
    network: "CJ",
    ctaLabel: "Protect this home's systems",
    description: "One plan covers repairs to appliances, AC, and plumbing",
    shortCta: "Get covered",
    notes: "CJ #4593144, $20/lead, 3mo EPC $64.",
  },
];

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/**
 * Where a CTA cluster is rendered, for vertical-priority ordering — distinct
 * from `AffiliateSource` (which drives sub_id attribution/tracking). A given
 * page can map to the same surface across multiple `source` values (e.g.
 * "assess-result" and "property-page" both feed a buyer-facing result page).
 */
export type SurfaceKey =
  | "result-buyer"
  | "result-investor"
  | "county-page"
  | "calculator"
  | "email"
  | "discover"
  | "state-page"
  | "rent-page";

/**
 * Per-surface vertical journey order. This is the fallback engine: with
 * only investor-tools vendors enabled today (rentcast/dealcheck US), every
 * surface still fills with those two — but as each future vertical gets an
 * affiliate approval (mortgage, insurance, tax-appeal, ...) it auto-slots
 * into its correct journey position on every surface with zero further
 * code changes, since the ordering already exists here.
 */
export const SURFACE_VERTICAL_PRIORITY: Record<SurfaceKey, Vertical[]> = {
  "result-buyer": ["mortgage", "insurance", "investor-tools", "home-services", "agent-referral", "tax-appeal"],
  "result-investor": ["investor-tools", "insurance", "mortgage", "tax-appeal", "home-services", "agent-referral"],
  "county-page": ["investor-tools", "insurance", "mortgage", "tax-appeal", "home-services", "agent-referral"],
  calculator: ["tax-appeal", "mortgage", "insurance", "investor-tools", "home-services", "agent-referral"],
  email: ["mortgage", "insurance", "investor-tools", "home-services", "agent-referral", "tax-appeal"],
  discover: ["investor-tools", "insurance", "mortgage", "tax-appeal", "home-services", "agent-referral"],
  "state-page": ["investor-tools", "insurance", "mortgage", "tax-appeal", "home-services", "agent-referral"],
  "rent-page": ["investor-tools", "insurance", "mortgage", "tax-appeal", "home-services", "agent-referral"],
};

/**
 * Shared eligibility filter (enabled + country + audienceMode + state gate)
 * used by both `getVendorsForRegion` and `getVendorsForSurface` — only the
 * sort differs between them.
 *
 * `state` is optional: pages with no single-property/county context (the
 * /us hub) call with `state: undefined`. In that case a state-gated vendor
 * (stateCoverage is an allowlist, e.g. Ownwell's 8 states) can't be verified
 * eligible, so it's excluded — only `stateCoverage: "all"` vendors pass.
 * Every currently-`enabled` US vendor happens to be "all"-coverage today, so
 * this has no effect yet, but it's the correct behavior once a state-gated
 * vendor goes live and a nationwide surface renders it.
 */
function filterEligibleVendors(
  country: Country,
  state: string | undefined,
  mode: AudienceMode
): AffiliateVendor[] {
  const upperState = state ? state.toUpperCase() : undefined;

  return AFFILIATE_VENDORS.filter((v) => v.enabled)
    .filter((v) => v.country === country)
    .filter((v) => v.audienceMode.includes(mode))
    .filter((v) => {
      if (upperState && v.stateExclusions?.includes(upperState)) return false;
      if (v.stateCoverage === "all") return true;
      return upperState ? v.stateCoverage.includes(upperState) : false;
    });
}

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
  return filterEligibleVendors(country, state, mode).sort((a, b) => {
    if (b.cpaTier !== a.cpaTier) return b.cpaTier - a.cpaTier;
    return Number(b.affiliateReady) - Number(a.affiliateReady);
  });
}

/**
 * Same eligibility rules as `getVendorsForRegion`, but ordered by the
 * surface's vertical journey priority first (see `SURFACE_VERTICAL_PRIORITY`),
 * then cpaTier desc, then affiliateReady desc. A vendor whose vertical isn't
 * listed for the surface sorts last (defensive — every current Vertical is
 * listed for every SurfaceKey above).
 */
export function getVendorsForSurface(
  country: Country,
  state: string | undefined,
  mode: AudienceMode = "buyer",
  surface: SurfaceKey
): AffiliateVendor[] {
  const priority = SURFACE_VERTICAL_PRIORITY[surface];

  return filterEligibleVendors(country, state, mode).sort((a, b) => {
    const aRank = priority.indexOf(a.vertical);
    const bRank = priority.indexOf(b.vertical);
    const aIndex = aRank === -1 ? priority.length : aRank;
    const bIndex = bRank === -1 ? priority.length : bRank;
    if (aIndex !== bIndex) return aIndex - bIndex;
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
  allstate: process.env.NEXT_PUBLIC_AFFILIATE_URL_ALLSTATE,
  smartfinancial: process.env.NEXT_PUBLIC_AFFILIATE_URL_SMARTFINANCIAL,
  insurify: process.env.NEXT_PUBLIC_AFFILIATE_URL_INSURIFY,
  easystreet: process.env.NEXT_PUBLIC_AFFILIATE_URL_EASYSTREET,
  limaone: process.env.NEXT_PUBLIC_AFFILIATE_URL_LIMAONE,
  newamericanfunding: process.env.NEXT_PUBLIC_AFFILIATE_URL_NEWAMERICANFUNDING,
  baselane: process.env.NEXT_PUBLIC_AFFILIATE_URL_BASELANE,
  mrc: process.env.NEXT_PUBLIC_AFFILIATE_URL_MRC,
  simplybusiness: process.env.NEXT_PUBLIC_AFFILIATE_URL_SIMPLYBUSINESS,
  avail: process.env.NEXT_PUBLIC_AFFILIATE_URL_AVAIL,
  choicehomewarranty: process.env.NEXT_PUBLIC_AFFILIATE_URL_CHOICEHOMEWARRANTY,
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
 * degraded experience. Phase 1: the 3 live CA vendors, plus rentcast and
 * dealcheck once they flipped to enabled+affiliateReady (US Tier 1).
 */
export const REVENUE_CRITICAL_IDS: string[] = [
  "ratehub",
  "nesto",
  "squareone",
  "rentcast",
  "dealcheck",
  "kiavi",
];

/** Values that look like unreplaced setup placeholders rather than real links. */
const PLACEHOLDER_URL_PATTERN = /YOUR_ID|YOUR_AFF|REPLACE_ME|CHANGEME|XXXX|example\.com/i;

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

    const envName = vendor.envKey ?? `NEXT_PUBLIC_AFFILIATE_URL_${id.toUpperCase()}`;
    const configured = ENV_URL_MAP[id];

    if (!configured) {
      console.error(
        `[affiliate-health] Revenue-critical vendor "${id}" is enabled+affiliateReady but its env URL ` +
          `(${envName}) is missing — falling back to ${vendor.url}.`
      );
      continue;
    }

    // A placeholder URL is worse than a missing one: the CTA still renders a
    // "Sponsored" tag and the commission disclosure, but the link can never
    // attribute. Ratehub shipped with `?ref=YOUR_ID` for months undetected.
    if (PLACEHOLDER_URL_PATTERN.test(configured)) {
      console.error(
        `[affiliate-health] Revenue-critical vendor "${id}" has a PLACEHOLDER affiliate URL in ${envName} ` +
          `(${configured}) — clicks are disclosed as commissioned but cannot be attributed. Replace with the real tracking link.`
      );
    }
  }
}
