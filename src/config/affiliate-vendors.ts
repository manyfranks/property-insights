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

/**
 * Insurance product lines. Meaningful only on `vertical: "insurance"` vendors —
 * declares which lines a vendor actually writes, since e.g. Square One quotes
 * homeowner/landlord/tenant but Allstate (via this affiliate program) is
 * homeowner-only. Drives per-line CTA/eligibility once Stage 2 routing lands
 * (see docs/proposals/insurance-distribution-proposal.html).
 */
export type InsuranceLine = "homeowner" | "landlord" | "tenant" | "strata" | "commercial";

export type AffiliateNetwork =
  | "direct"
  | "CJ"
  | "Impact"
  | "FlexOffers"
  | "ShareASale"
  | "PartnerStack"
  | "unconfirmed";

/**
 * The role the named counterparty performs in an insurance journey. This is
 * deliberately distinct from `vertical` and from the commercial affiliate
 * relationship: a referral URL does not turn the named provider into a
 * brokerage, insurer, or rater. Unspecified legacy/non-insurance vendors
 * default to AFFILIATE so the registry remains backwards compatible.
 */
export type CounterpartyRole =
  | "AFFILIATE"
  | "REFERRER"
  | "BROKERAGE"
  | "AGENCY"
  | "MGA"
  | "INSURER"
  | "RATER"
  | "BMS"
  | "TPA"
  | "ADJUSTER"
  | "DATA_PROVIDER"
  | "PAYMENT_PROVIDER";

export function counterpartyRoleLabel(role: CounterpartyRole | undefined): string {
  switch (role) {
    case "BROKERAGE": return "insurance brokerage";
    case "AGENCY": return "insurance agency";
    case "MGA": return "managing general agency";
    case "INSURER": return "insurer";
    case "RATER": return "insurance rater";
    case "BMS": return "broker management system";
    case "TPA": return "third-party administrator";
    case "ADJUSTER": return "claims adjuster";
    case "DATA_PROVIDER": return "data provider";
    case "PAYMENT_PROVIDER": return "payment provider";
    case "REFERRER": return "referral partner";
    case "AFFILIATE":
    default: return "insurance partner";
  }
}

export function counterpartyRoleDescription(role: CounterpartyRole | undefined): string {
  const label = counterpartyRoleLabel(role);
  return /^(insurer|insurance)/.test(label) ? `an ${label}` : `a ${label}`;
}

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

/**
 * NOTE (2026-08-14): the Stage 2 insurance handoff screen
 * (coverage-handoff.tsx) used to hardcode `source: "assess-result"` for its
 * partner-connect click, which is wrong — "assess-result" names the /assess
 * result page (src/components/us-assessment-result.tsx), and this screen is
 * reached only via the separate /coverage-profile wizard. It now uses
 * "property-page" instead — the closest existing bucket for a buyer-facing
 * result-adjacent surface (see the SurfaceKey doc comment below, which
 * already groups "assess-result" and "property-page" together). A true
 * "coverage-profile" value would be more accurate, but adding one here
 * would break src/app/api/coverage-profile/route.ts's `VALID_SOURCES`
 * (a hardcoded, non-deriving copy of this list, not touchable in this
 * change — see that route's TODO potential: switch it to
 * `AffiliateSource[]` so the two lists can't drift). Flagged here rather
 * than silently worked around.
 */

export interface AffiliateVendor {
  /** env var key: NEXT_PUBLIC_AFFILIATE_URL_{ID} (uppercased, hyphens -> underscores) */
  id: string;
  name: string;
  vertical: Vertical;
  /** Operational role of the named counterparty; defaults to AFFILIATE for legacy entries. */
  counterpartyRole?: CounterpartyRole;
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
  /**
   * Narrower-than-`stateCoverage` allowlist for vendors whose PAID affiliate
   * program pays out in fewer regions than the vendor is actually licensed
   * in (e.g. Square One: licensed BC/AB/SK/MB/ON, but the affiliate program
   * excludes MB — a referral there is unpaid, not a usable revenue channel).
   * When set, this — not `stateCoverage` — gates CTA eligibility, since a
   * region where the click can't be attributed/paid shouldn't render a
   * commissioned CTA. Omit when the affiliate program's scope matches
   * `stateCoverage` exactly (the common case).
   */
  affiliateRegions?: string[];
  /** promo copy shown when rendered as the hero CTA */
  offerText?: string;
  network: AffiliateNetwork;
  /** rate/payment/business notes — not rendered, for maintainers only */
  notes?: string;
  /** Which insurance product lines this vendor writes. Meaningful only when
   *  `vertical: "insurance"` — ignored for every other vertical. */
  lines?: InsuranceLine[];
  /**
   * Declares whether a vendor's quote flow can accept pre-filled property
   * data — the Stage 2 handoff capability (see
   * docs/proposals/insurance-distribution-proposal.html and
   * docs/legal/INSURANCE-BROKERAGE-STRUCTURES.md §6). Declaration only: no
   * resolver/param-mapping logic exists yet, this just records what each
   * vendor's partner program supports so Stage 2 can be built without a
   * fresh capability audit.
   */
  prefill?: {
    kind: "url-params" | "smart-link" | "api";
    notes?: string;
  };

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

export interface AffiliateVendorPresentation {
  ctaLabel: string;
  description: string;
  shortCta: string;
  offerText: string;
}

/** Resolve journey-specific language without changing vendor eligibility. */
export function affiliateVendorPresentation(
  vendor: AffiliateVendor,
  mode: AudienceMode
): AffiliateVendorPresentation {
  if (mode === "investor" && vendor.vertical === "insurance" && vendor.lines?.includes("landlord")) {
    return {
      ctaLabel: "Explore landlord insurance",
      description: `${vendor.name} coverage options for a rental property`,
      shortCta: "Rental coverage",
      offerText: "Explore coverage for your rental property",
    };
  }
  return {
    ctaLabel: vendor.ctaLabel ?? vendor.name,
    description: vendor.description ?? vendor.name,
    shortCta: vendor.shortCta ?? "Learn more",
    offerText: vendor.offerText ?? vendor.description ?? vendor.name,
  };
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
    counterpartyRole: "AGENCY",
    country: "CA",
    url: "https://www.squareone.ca",
    enabled: true,
    affiliateReady: true,
    // Tier 2 per the payout banding (tier 1 = <$50): Square One's public
    // program pays $50/$100/$175 per policy sold. This also encodes the
    // 2026-08-15 owner ruling that Square One wins the BC personal-lines
    // tie over APOLLO ($25/policy, advisor-assisted personal flow) —
    // deterministic via cpaTier sort, retiring rotateTies() for this pair.
    cpaTier: 2,
    audienceMode: ["buyer", "investor"],
    // Licensed BC/AB/SK/MB/ON only — not NS/PEI/NL or the territories. See
    // `affiliateRegions` below: the paid affiliate program is narrower still.
    stateCoverage: ["BC", "AB", "SK", "MB", "ON"],
    // MB is licensed (stateCoverage above) but excluded from the paid
    // affiliate program — an MB referral is unpaid, not a usable channel.
    affiliateRegions: ["BC", "AB", "SK", "ON"],
    offerText: "$20 credit applied automatically",
    network: "direct",
    ctaLabel: "Get home insurance",
    description: "Quote in 5 minutes — $20 credit applied automatically",
    shortCta: "Get quote",
    legacyPartnerType: "insurance",
    envKey: "NEXT_PUBLIC_SQUAREONE_URL",
    lines: ["homeowner", "landlord", "tenant"],
    notes:
      "2026-08-14: corrected from stateCoverage 'all' (verified Aug 2026 partner research). Licensed BC/AB/SK/MB/ON only (absent NS/PEI/NL + territories). Paid affiliate program covers BC/AB/SK/ON only — MB is licensed but not affiliate-payable, see `affiliateRegions`. Prod tracking URL confirmed by owner 2026-08-14: https://www.squareone.ca/propertyinsights (vanity path — attribution is site-level per their program docs; appended sub_id honoring unconfirmed). " +
      "WORDMARK VERDICT (2026-08-15, Sprint C Task 3): PERMITTED. Source: squareone.ca/affiliate-program-agreement, fetched 2026-08-15. §20 affirmatively allows Square One to \"identify you or Your Site as an Affiliate of the Program\" — i.e. public naming of affiliates is contemplated by the agreement, not just tolerated. The agreement's actual restrictions are narrow and don't reach a plain-text partner-strip mention: §15 bars bidding on Square One's trademarks/brand terms in paid search and using them in Display URLs; §7 bars altering the tracking links themselves; §16 bars anything that could mislead a visitor into thinking the affiliate's site IS Square One's site. Our partner strip renders \"Square One\" as plain text (no logo, no stylized wordmark asset) and attributes it as a third-party insurance partner. No code change.",
  },
  {
    id: "apollo",
    name: "APOLLO Insurance",
    vertical: "insurance",
    counterpartyRole: "AGENCY",
    country: "CA",
    url: "https://apollocover.com",
    enabled: true,
    affiliateReady: true,
    cpaTier: 1,
    audienceMode: ["buyer", "investor"],
    stateCoverage: "all",
    // Precautionary jurisdiction gate — see docs/legal/INSURANCE-BROKERAGE-STRUCTURES.md §3.
    // QC: civil-law AMF regime whose distribution-without-representative framework
    // does not map onto referral compensation. NB: 2023 regime licenses intermediary
    // activity "regardless of whether conducted... online". Both pending legal review.
    stateExclusions: ["QC", "NB"],
    // Sprint B (2026-08-15): stateCoverage "all" above is APOLLO's *licensed-claim*
    // tier (unverified, inherited from the original registry entry) — this
    // narrower allowlist is the *verified-or-corroborated* tier and is what
    // actually gates eligibility (eligibleInsuranceVendors/filterEligibleVendors
    // read `affiliateRegions ?? stateCoverage`). Only the 9 provinces below
    // could be confirmed; the 3 territories (YT/NT/NU) — previously covered
    // only because "all" swept them in — are deliberately absent. See the
    // dated verification summary in `notes` below for per-region sourcing.
    affiliateRegions: ["BC", "AB", "SK", "MB", "ON", "NB", "NS", "PE", "NL"],
    network: "direct",
    ctaLabel: "Explore property insurance",
    description: "Explore property coverage with an insurance agency",
    shortCta: "Get quote",
    notes:
      "APPROVED (auto) Aug 2026. Prod URL confirmed by owner 2026-08-14: apollocover.com/lp/propertyinsights (set as NEXT_PUBLIC_AFFILIATE_URL_APOLLO in Vercel). NOTE: a second issued URL, covertrack.ca/propertyinsights, remains unreconciled — verify in the partner portal that the lp URL carries attribution (if covertrack is the tracker, clicks on the lp URL may not credit). " +
      "Payout confirmed 2026-08-14 via APOLLO's published 'Rewards Program — Calculation Methodology': $25 one-time 'Marketing Reward' per qualifying tenant, paid once the policy has been active 90+ days (unpaid/'Pending' before that); accrual must reach a $100 minimum before any payout, capped at $5,000/qualifying instance and $10,000/calendar year without APOLLO's written approval. cpaTier 1 (<$50) still correct at $25. " +
      "SCOPE CAVEAT: this methodology explicitly covers 'APOLLO-Insured Tenants' only — it says nothing about homeowner/landlord/commercial payout, which remain unconfirmed despite this vendor's `lines` including all four. Don't assume $25 applies outside the tenant line. " +
      "COMPLIANCE CAVEAT: APOLLO's own terms state this reward 'is not a commission, referral fee, or compensation for the sale, solicitation, or placement of insurance' and does not authorize acting as an agent/broker — framed as pay for tenant education/engagement, not the sale. That's in tension with how docs/legal/INSURANCE-BROKERAGE-STRUCTURES.md §1 already models this same $25 figure as a 'flat referral fee' for economics purposes — and it's volume-linked to qualifying purchases, which that doc's own §1 table (row 4) flags as the 'SaaS fee in costume' pattern. General site disclosure copy now uses neutral 'partner compensation' language; the owner-and-counsel-controlled coverage-wizard consent still says 'referral fee' and requires a separate approved amendment before APOLLO reliance. " +
      "SPRINT B VENDOR-TRUTH VERIFICATION (2026-08-15, per-region, primary sources first): entity is APOLLO Insurance Solutions Ltd. (Vancouver BC, founded 2017; acquired by Arthur J. Gallagher & Co., announced 2026-08-05) plus its licensed retail-brokerage subsidiary APOLLO Insurance Agency Ltd. (o/a 'Apollo'). " +
      "VERIFIED via primary regulator registry: BC — Insurance Council of BC licensee directory (login.insurancecouncilofbc.com/licensee-directory), both entities Class 'General' Status 'Active'. SK — Insurance Councils of Saskatchewan (licenseesearch.skcouncil.sk.ca), Apollo Insurance Agency Ltd. Lic#08880 P&C Active; Apollo Insurance Solutions Ltd. Lic#09820 P&C-Managing General Agent Active. MB — Insurance Council of Manitoba agency search (lms.icm.mb.ca), both entities present with active license counts (6 and 1). ON — RIBO brokerage search (ribo.com), Apollo Insurance Agency Ltd. Status 'Active', Lic#4314. NB — FCNB agency/MGA listing (portal.fcnb.ca), both entities licensed (Lic#230016919 agency, #230021822 MGA) — NB stays in stateExclusions above regardless, per the separate 2023-regime compliance rationale (§3), unrelated to this licensing fact. " +
      "UNVERIFIED (absence of evidence, not evidence of absence — registries were form-gated/non-functional at check time, distinct from a real no-match): AB — Alberta Insurance Council's public agency lookup (lookups.abcouncil.ab.ca) returned 'An error has occurred while fetching results' on every query tried, including control terms, i.e. broken generally, not Apollo-specific. NS — Nova Scotia's online agent/agency lookup (acp.novascotia.ca) WAF-blocked the request ('Request Rejected') on repeated attempts. PE — princeedwardisland.ca's licensed-agent search returned zero results even for the generic control term 'Insurance', suggesting it's an individual-name/exact-match tool that may not index corporate agencies at all, not a real negative for Apollo specifically. NL — the only public online tool (cfs-portal.gov.nl.ca) is explicitly scoped to 'Licensed Insurance Individuals' (first/last name only, no agency field); the separate gov.nl.ca nonprofit broker-agent page is a voluntary self-submitted survey list, not a registry. " +
      "For all 4 of AB/NS/PE/NL, included in affiliateRegions anyway on STRONG CORROBORATION from apollocover.com's own licensing disclosure (secondary but company-sourced, per Sprint B brief): the site footer lists exactly 9 served provinces (Alberta, British Columbia, Manitoba, New Brunswick, Newfoundland, Nova Scotia, Ontario, Prince Edward Island, Saskatchewan), each backed by a live /tenant-insurance/{province}-tenant-insurance landing page (200 OK, checked 2026-08-15); the homepage's 'recently purchased policies' feed also shows a real Nova Scotia transaction (Clementsvale). " +
      "NOT verified and NOT corroborated — EXCLUDED: YT, NT, NU (absent from the footer's province list, /yukon /northwest-territories /nunavut all 404, never appear in purchased-policy examples sampled across two pages) — consistent with our own prior partner research concluding the territories 'none viable'. QC unchanged/out of scope (stateExclusions, AMF civil-law regime, §3; also absent from APOLLO's own footer). " +
      "WORDMARK VERDICT (2026-08-15, Sprint C Task 3): RESTRICTED-AMBIGUOUS / [U] on the part that matters most. Sources: apollocover.com/terms-conditions/ (fetched 2026-08-15) — general site ToS states \"The use, the retransmission or other copying or modification of any trade-marks displayed on this website is prohibited without the written permission of Apollo or the owner of the trademark.\" Read literally this is broad enough to cover any use of the APOLLO name, but its plain target (the trademark 'displayed on this website', i.e. their logo/stylized wordmark asset) is about copying/reproducing that asset, not about a third party factually naming the company in running text — our partner-strip.tsx renders \"APOLLO Insurance\" as plain CSS text, not a copied logo. That distinction is NOT settled by anything APOLLO has published: the partner-program-specific terms that would actually govern this (apollocover.com/partnerships directs signups to partner-portal.apollocover.com/setup) are gated behind a private portal and could not be fetched — [U], per Task 3's instruction to mark gated content as unconfirmed. apollocover.com/terms (no trailing slash) 404s; no public affiliate/partner agreement equivalent to Square One's exists. Given the general clause is broad-but-arguably-inapplicable and the specific governing terms are unreachable, this is NOT a 'clearly prohibited' case — no code change per Task 3's instruction (hide the wordmark only on a clear prohibition). Flagged for owner/counsel follow-up: get the gated partner-portal brand-usage terms before relying further on this wordmark, or replace it with a generic 'APOLLO' text mention framed even more clearly as third-party attribution.",
    lines: ["homeowner", "landlord", "tenant", "commercial"],
  },
  {
    id: "zensurance",
    name: "Zensurance",
    vertical: "insurance",
    counterpartyRole: "BROKERAGE",
    country: "CA",
    url: "https://www.zensurance.com",
    enabled: false,
    affiliateReady: false,
    cpaTier: 1,
    audienceMode: ["investor"],
    stateCoverage: "all",
    // Precautionary jurisdiction gate — see docs/legal/INSURANCE-BROKERAGE-STRUCTURES.md §3.
    // Same QC exclusion rationale as APOLLO above (civil-law AMF regime, no
    // referral-fee mapping). No personal homeowner/tenant lines to gate NB on.
    // YT/NT/NU added 2026-08-14 per Zensurance's own "no territories" statement.
    stateExclusions: ["QC", "YT", "NT", "NU"],
    network: "direct",
    ctaLabel: "Insure my rental property",
    description: "Rental property coverage from a licensed Canadian brokerage",
    shortCta: "Get quote",
    notes:
      "$50 CAD CPA per completed online quote via Fintel Connect. Application in review Aug 2026. No personal homeowner/tenant lines — landlord/commercial only. Excludes QC + territories. 2026-08-14: verified Aug 2026 partner research confirmed Zensurance's own 'no territories' statement — added YT/NT/NU to stateExclusions (was QC only). lines confirmed commercial-only (landlord/commercial); no homeowner/tenant/strata routing.",
    lines: ["landlord", "commercial"],
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
    enabled: true,
    affiliateReady: true,
    cpaTier: 2,
    audienceMode: ["investor"],
    stateCoverage: "all",
    network: "direct",
    ctaLabel: "Find off-market deals",
    description: "Drive for dollars, skip trace owners, send mail — one app",
    shortCta: "Find deals",
    offerText: "Use code PROPERTYINSIGHTS at checkout",
    notes:
      "APPROVED Aug 2026. 20-50% lifetime recurring. Link: dealmachine.com/partner/propertyinsights (set NEXT_PUBLIC_AFFILIATE_URL_DEALMACHINE). Payout via Gusto — W-8BEN needed (see docs/plans/10-AFFILIATE-APPLICATION-KIT.md). Their ToS requires explicit paid-link disclosure: satisfied by the per-card Sponsored label + cluster FTC line.",
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
    counterpartyRole: "AFFILIATE",
    country: "US",
    url: "https://www.thezebra.com",
    enabled: false,
    affiliateReady: false,
    cpaTier: 1,
    audienceMode: ["buyer", "investor"],
    stateCoverage: "all",
    network: "unconfirmed",
    ctaLabel: "Get home insurance quotes",
    description: "Quotes from 100+ insurance companies in one place",
    shortCta: "Get quotes",
    notes:
      "Carrier-agnostic insurance comparison — nationwide default insurance CTA when a specific carrier isn't licensed in the property's state. Network unconfirmed (possibly Awin); apply direct.",
    lines: ["homeowner", "tenant"],
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
    counterpartyRole: "AFFILIATE",
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
    lines: ["homeowner"],
  },
  {
    id: "smartfinancial",
    name: "SmartFinancial",
    vertical: "insurance",
    counterpartyRole: "AFFILIATE",
    country: "US",
    url: "https://smartfinancial.com",
    enabled: false,
    affiliateReady: false,
    cpaTier: 1,
    audienceMode: ["buyer", "investor"],
    stateCoverage: "all",
    network: "direct",
    ctaLabel: "Get home insurance quotes",
    description: "Quotes from local and national insurers",
    shortCta: "Get quotes",
    notes:
      "In-house publisher platform (agents.smartfinancial.com/publishers), self-serve low-barrier approval; up to ~$40/lead claimed (unverified).",
    lines: ["homeowner"],
  },
  {
    id: "insurify",
    name: "Insurify",
    vertical: "insurance",
    counterpartyRole: "AFFILIATE",
    country: "US",
    url: "https://insurify.com",
    enabled: false,
    affiliateReady: false,
    cpaTier: 1,
    audienceMode: ["buyer", "investor"],
    stateCoverage: "all",
    network: "Impact",
    ctaLabel: "Get insurance quotes",
    description: "Real quotes from 100+ companies in minutes",
    shortCta: "Get quotes",
    notes:
      "~$15/lead home (secondary), 30d cookie; licensed all 50 states; apply via Impact or partnerships@insurify.com.",
    lines: ["homeowner", "tenant"],
  },

  // ---------------------------------------------------------------------
  // US — Insurance BD pipeline (Aug 2026). Landlord-focused specialists with
  // a Stage 2 pre-filled-handoff capability (see
  // docs/proposals/insurance-distribution-proposal.html and
  // docs/legal/INSURANCE-BROKERAGE-STRUCTURES.md §6) — the `prefill` field
  // records what each partner program supports. Inert until BD lands.
  // ---------------------------------------------------------------------
  {
    id: "steadily",
    name: "Steadily",
    vertical: "insurance",
    counterpartyRole: "AFFILIATE",
    country: "US",
    url: "https://www.steadily.com",
    enabled: false,
    affiliateReady: false,
    cpaTier: 1,
    audienceMode: ["investor"],
    stateCoverage: "all",
    network: "direct",
    ctaLabel: "Insure my rental property",
    description: "Landlord policies quoted online in minutes",
    shortCta: "Get quote",
    prefill: {
      kind: "smart-link",
      notes:
        "Steadily smart links accept pre-filled property data; request via partners@steadily.com",
    },
    notes:
      "Ambassador tier already held; partner program at steadily.com/partners has an explicit unlicensed-referrer track. 'Smart links' tier = pre-filled quote experience with referral tracking (the Stage 2 terminal). Full API is licensed-partners-only. Payouts direct-BD, not public.",
    lines: ["landlord"],
  },
  {
    id: "obie",
    name: "Obie",
    vertical: "insurance",
    counterpartyRole: "AFFILIATE",
    country: "US",
    url: "https://www.obieinsurance.com",
    enabled: false,
    affiliateReady: false,
    cpaTier: 1,
    audienceMode: ["investor"],
    stateCoverage: "all",
    network: "direct",
    ctaLabel: "Insure this rental property",
    description: "Coverage for rental and investment properties, online in minutes",
    shortCta: "Get quote",
    prefill: {
      kind: "api",
      notes: "Embedded API accepts property data; docs via BD, not public",
    },
    notes:
      "BD thread live Aug 2026 (partnerships team: Sumaya + Brian Harris). Baldwin Group completed acquisition Jan 2026 — confirm current terms. Embedded stack (Instant Estimate Widget / Embedded Experience / Policy Sync); 'simple referral options' for unlicensed platforms. Licensed all 50 states + DC. 2026-08-14: corrected lines from [landlord, strata, commercial] — verified Aug 2026 partner research could not substantiate strata or commercial lines. Obie's real product is landlord/multifamily (single-family rentals, 2-4 units, 5+ unit apartment buildings, condo units) — 5+ unit multifamily is its differentiator vs Steadily. Post-Baldwin-Group terms still unconfirmed, re-verify before BD closes.",
    lines: ["landlord"],
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
    counterpartyRole: "AFFILIATE",
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
    lines: ["landlord", "strata", "commercial"],
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
// Insurance jurisdiction exclusions
//
// See docs/legal/INSURANCE-BROKERAGE-STRUCTURES.md §3 for the underlying
// research. These are line/state-level overlays on top of each vendor's own
// `stateExclusions` — they exist because some jurisdictions ban referral
// compensation for a specific *line* (BC strata) or the *entire insurance
// vertical* (WA/QC/NB) rather than for a specific vendor.
// ---------------------------------------------------------------------------

/**
 * BC bans referral compensation on strata insurance entirely (ICN 20-003 /
 * Bill 14, 2020) — the strata line renders as an uncompensated
 * licensed-broker handoff in BC, never a paid CTA.
 */
export const INSURANCE_LINE_EXCLUSIONS: Record<Country, Record<string, InsuranceLine[]>> = {
  CA: { BC: ["strata"] },
  US: {},
};

/**
 * Whole-vertical insurance exclusions by state/province. WA: TAA 2021-01
 * double-sided enforcement (site *and* accepting producer exposed). QC: AMF
 * regime whose distribution-without-representative framework doesn't map to
 * referral compensation. NB: 2023 regime licenses intermediary activity
 * "regardless of whether conducted... online" — both QC and NB pending legal
 * review. See docs/legal/INSURANCE-BROKERAGE-STRUCTURES.md §3.
 */
export const INSURANCE_STATE_EXCLUSIONS: Record<Country, string[]> = {
  US: ["WA"],
  CA: ["QC", "NB"],
};

/** Landlord/commercial/strata lines are rental & building-ownership
 *  concerns, closer to the app's "investor" audience mode; homeowner/tenant
 *  map to "buyer". Lives here (rather than resolve-vendor.ts, its original
 *  home) so both resolve-vendor.ts (client-side vendor resolution) and
 *  insurance-rollout.ts's boot-time live-implies-vendor assertion can share
 *  one definition without insurance-rollout.ts (a config module) reaching
 *  into src/components — see eligibleInsuranceVendors below for the same
 *  reasoning. */
export function audienceModeForLine(line: InsuranceLine): AudienceMode {
  return line === "landlord" || line === "commercial" || line === "strata" ? "investor" : "buyer";
}

/**
 * The eligibility half of resolve-vendor.ts's resolveVendor() — every filter
 * resolveVendor applies BEFORE it sorts/rotates ties, extracted so callers
 * that only need "is there at least one usable vendor here" (the
 * live-implies-vendor build guarantee in scripts/journey-matrix.ts --check
 * and the boot-time assertion in insurance-rollout.ts) get a date-independent
 * answer without invoking rotateTies()'s day-of-year tie-break. resolveVendor
 * itself now calls this rather than re-implementing the filter, so the two
 * can never drift.
 *
 * Deliberately does NOT check INSURANCE_STATE_EXCLUSIONS / INSURANCE_LINE_-
 * EXCLUSIONS (the app-wide overlay exclusions) — those gate whether the
 * wizard/CTA is reachable at all (coverage-profile/page.tsx,
 * insurance-module.tsx), not vendor eligibility itself; a vendor can be
 * "eligible" here while still unreachable because the app-wide gate excludes
 * the region/line first. Callers that care about the app-wide gate (as the
 * live-implies-vendor check does) apply it themselves before calling this.
 */
export function eligibleInsuranceVendors(country: Country, region: string, line: InsuranceLine): AffiliateVendor[] {
  const mode = audienceModeForLine(line);
  return AFFILIATE_VENDORS.filter((v) => {
    // Paid-program scope beats licensed scope when declared — mirrors
    // filterEligibleVendors below (kept as a separate small filter here,
    // rather than merged with it, since insurance eligibility also gates on
    // vertical/line/lines in ways filterEligibleVendors doesn't need to).
    const coverage = v.affiliateRegions ?? v.stateCoverage;
    return (
      v.enabled &&
      v.vertical === "insurance" &&
      v.country === country &&
      v.audienceMode.includes(mode) &&
      (!v.lines || v.lines.includes(line)) &&
      !v.stateExclusions?.includes(region) &&
      (coverage === "all" || coverage.includes(region))
    );
  });
}

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
      // affiliateRegions (when set) narrows stateCoverage to the paid
      // affiliate program's actual scope — a region outside it can't be
      // attributed/paid, so it isn't a usable CTA even though the vendor is
      // licensed there (e.g. Square One in MB). See its doc comment above.
      const coverage = v.affiliateRegions ?? v.stateCoverage;
      if (coverage === "all") return true;
      return upperState ? coverage.includes(upperState) : false;
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
  surface: SurfaceKey,
  /**
   * Hoist one vertical to the front of the surface's usual priority. Used where
   * the *content* declares its own topic and should outrank the surface default
   * — e.g. an insurance blog post must not lead with a mortgage CTA just because
   * "result-buyer" is mortgage-first.
   */
  preferVertical?: Vertical
): AffiliateVendor[] {
  const base = SURFACE_VERTICAL_PRIORITY[surface];
  const priority = preferVertical
    ? [preferVertical, ...base.filter((v) => v !== preferVertical)]
    : base;

  return rotateTies(
    filterEligibleVendors(country, state, mode).sort((a, b) => {
      const aRank = priority.indexOf(a.vertical);
      const bRank = priority.indexOf(b.vertical);
      const aIndex = aRank === -1 ? priority.length : aRank;
      const bIndex = bRank === -1 ? priority.length : bRank;
      if (aIndex !== bIndex) return aIndex - bIndex;
      if (b.cpaTier !== a.cpaTier) return b.cpaTier - a.cpaTier;
      return Number(b.affiliateReady) - Number(a.affiliateReady);
    })
  );
}

/** Day of year (UTC) — deterministic, stable within a calendar day, no RNG. */
function dayOfYearUTC(d: Date = new Date()): number {
  const startOfYear = Date.UTC(d.getUTCFullYear(), 0, 0);
  const today = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.floor((today - startOfYear) / 86_400_000);
}

/**
 * Rotate vendors that sort identically (same vertical + cpaTier) by day of year.
 *
 * Once approvals outnumber the 3 rendered slots — as they did the day DealMachine
 * joined Kiavi/RentCast/DealCheck in US investor-tools — a strict sort makes the
 * newest partner permanently invisible, and a vendor that never renders can never
 * earn the click data needed to rank it properly. Rotating only the ties keeps
 * vertical priority and tier ordering intact while giving every approved partner
 * exposure. Replace with EPC-driven ordering once partner_clicks has volume.
 *
 * DECISION MARKER (Sprint B, 2026-08-15, superseding the same-day
 * rotation ruling): the former BC personal-lines SQ1/APOLLO tie is now
 * broken deterministically by cpaTier — owner confirmed APOLLO pays
 * ~$25/signed policy (their published tenant "Marketing Reward"; owner
 * also reports a ~$1,000 minimum policy value [UNCONFIRMED in writing]
 * and a 10% user discount via our partner URL [UNCONFIRMED wording — do
 * not surface in CTA copy until APOLLO confirms]), vs Square One's
 * public $50/$100/$175 per policy — so Square One is cpaTier 2 and wins
 * personal lines outright; APOLLO keeps commercial (sole eligible) and
 * all regions outside Square One's paid program. rotateTies() remains
 * for future genuine ties and currently rotates nothing on the
 * insurance vertical.
 */
export function rotateTies(sorted: AffiliateVendor[]): AffiliateVendor[] {
  const out: AffiliateVendor[] = [];
  const day = dayOfYearUTC();

  for (let i = 0; i < sorted.length; ) {
    let j = i + 1;
    while (
      j < sorted.length &&
      sorted[j].vertical === sorted[i].vertical &&
      sorted[j].cpaTier === sorted[i].cpaTier
    ) {
      j++;
    }
    const run = sorted.slice(i, j);
    const offset = run.length > 1 ? day % run.length : 0;
    out.push(...run.slice(offset), ...run.slice(0, offset));
    i = j;
  }

  return out;
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
  apollo: process.env.NEXT_PUBLIC_AFFILIATE_URL_APOLLO,
  zensurance: process.env.NEXT_PUBLIC_AFFILIATE_URL_ZENSURANCE,

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
  steadily: process.env.NEXT_PUBLIC_AFFILIATE_URL_STEADILY,
  obie: process.env.NEXT_PUBLIC_AFFILIATE_URL_OBIE,
  easystreet: process.env.NEXT_PUBLIC_AFFILIATE_URL_EASYSTREET,
  limaone: process.env.NEXT_PUBLIC_AFFILIATE_URL_LIMAONE,
  newamericanfunding: process.env.NEXT_PUBLIC_AFFILIATE_URL_NEWAMERICANFUNDING,
  baselane: process.env.NEXT_PUBLIC_AFFILIATE_URL_BASELANE,
  mrc: process.env.NEXT_PUBLIC_AFFILIATE_URL_MRC,
  simplybusiness: process.env.NEXT_PUBLIC_AFFILIATE_URL_SIMPLYBUSINESS,
  avail: process.env.NEXT_PUBLIC_AFFILIATE_URL_AVAIL,
  choicehomewarranty: process.env.NEXT_PUBLIC_AFFILIATE_URL_CHOICEHOMEWARRANTY,
};

function appendSubId(url: string, subId: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set("sub_id", subId);
    return u.toString();
  } catch {
    // Relative or otherwise unparseable URL — fall back to naive append.
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}sub_id=${encodeURIComponent(subId)}`;
  }
}

export interface ResolvedAffiliateUrl {
  url: string;
  /** true when `url` is the tracked affiliate URL (env-configured), false when it's the plain fallback */
  isAffiliate: boolean;
}

/** Values that look like unreplaced setup placeholders rather than real links. */
const PLACEHOLDER_URL_PATTERN = /YOUR_ID|YOUR_AFF|REPLACE_ME|CHANGEME|XXXX|example\.com/i;

/**
 * Resolves the outbound URL for a vendor: the env-configured affiliate URL
 * when present, otherwise the vendor's plain fallback `url`. Appends
 * `sub_id={subId ?? source}` only when the resolved URL is the affiliate one
 * — sub_id has no meaning on a plain homepage link.
 *
 * `subId` is an optional per-referral override (e.g. a coverage-profile id)
 * so a single click can be reconciled 1:1 against a specific record, rather
 * than only bucketed by `source`'s surface-level grouping. Whether a given
 * partner's tracking actually *honors* an arbitrary per-click sub_id is
 * unconfirmed per-partner: Square One's affiliate link today attributes at
 * the site level with no documented click-level sub_id passthrough; APOLLO's
 * support for it is an open BD question. Set it anyway — worst case it's an
 * inert query param, not lost attribution. Either way, this URL param is not
 * the authoritative reconciliation record: that's `coverage_profiles.vendor_id`
 * (src/lib/db/coverage-profiles.ts), first-write-wins-stamped by
 * markProfileHandoff() from /api/partner-connect. Note partner_clicks
 * (src/lib/db/partner-clicks.ts) does not currently carry profileId at all —
 * it has no such column — so it cannot serve as a reconciliation key today;
 * that would need a schema change owned by src/app/api/db/migrate/route.ts.
 */
export function getAffiliateUrl(
  id: string,
  source?: AffiliateSource,
  subId?: string
): ResolvedAffiliateUrl {
  const vendor = AFFILIATE_VENDORS.find((v) => v.id === id);
  const envUrl = ENV_URL_MAP[id];
  const trackingId = subId ?? source;

  // Placeholders are operational defects, not compensated links. Fall back
  // without Sponsored/compensation presentation; the health guard below
  // continues to report the bad production configuration.
  if (envUrl && !PLACEHOLDER_URL_PATTERN.test(envUrl)) {
    return {
      url: trackingId ? appendSubId(envUrl, trackingId) : envUrl,
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
  "apollo",
  "dealmachine",
];

/**
 * Prod-only check: for every revenue-critical vendor that is currently
 * enabled + affiliateReady, verify its env URL actually resolved. Call once
 * server-side (property/result page render) — cheap, synchronous, no I/O.
 */
/**
 * Vendor ids already reported this process. `assertAffiliateHealth()` runs on
 * every server render, so a single misconfigured vendor previously emitted one
 * identical line per page — a production build logged hundreds of them and
 * buried the real error. The defect still needs to be loud once; it does not
 * need to be loud repeatedly.
 */
const reportedHealthDefects = new Set<string>();

function reportHealthDefect(key: string, message: string): void {
  if (reportedHealthDefects.has(key)) return;
  reportedHealthDefects.add(key);
  console.error(message);
}

export function assertAffiliateHealth(): void {
  if (process.env.NODE_ENV !== "production") return;

  for (const id of REVENUE_CRITICAL_IDS) {
    const vendor = AFFILIATE_VENDORS.find((v) => v.id === id);
    if (!vendor || !vendor.enabled || !vendor.affiliateReady) continue;

    const envName = vendor.envKey ?? `NEXT_PUBLIC_AFFILIATE_URL_${id.toUpperCase()}`;
    const configured = ENV_URL_MAP[id];

    if (!configured) {
      reportHealthDefect(
        `${id}:missing`,
        `[affiliate-health] Revenue-critical vendor "${id}" is enabled+affiliateReady but its env URL ` +
          `(${envName}) is missing — falling back to ${vendor.url}.`
      );
      continue;
    }

    // Placeholder configuration is still an operational defect even though
    // resolution now fails safe to the vendor's plain, undisclosed fallback.
    // Ratehub shipped with `?ref=YOUR_ID` for months undetected.
    if (PLACEHOLDER_URL_PATTERN.test(configured)) {
      reportHealthDefect(
        `${id}:placeholder`,
        `[affiliate-health] Revenue-critical vendor "${id}" has a PLACEHOLDER affiliate URL in ${envName} ` +
          `(${configured}) — using the plain non-affiliate fallback until the real tracking link is configured.`
      );
    }
  }
}
