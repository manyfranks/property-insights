# US State-Aware Affiliate CTA System — Implementation Spec

_Researched 2026-08-07. Pattern ported from hit-analytics (`src/config/sportsbooks.ts` + `src/config/states.ts` + `SportsbookGrid.tsx`); vendor data from public sources — re-verify every rate flagged UNVERIFIED inside the network dashboard after approval._

## Core design (adapted from hit-analytics)

Config-as-code, no DB. Two registries joined by string IDs, a pure URL resolver reading env vars, and presentational components that fire tracking on click.

**Key improvement over hit-analytics**: state resolution is trivial here — on property/result pages the CTA state comes from the **property's address**, not visitor IP geolocation. (Optional later: ipinfo.io visitor geo for generic pages like the calculator, cached in localStorage per the hit-analytics `useGeoLocation` pattern.)

### Vendor registry — `src/config/affiliate-vendors.ts`

```ts
export type Vertical = "insurance" | "mortgage" | "investor-tools" | "tax-appeal" | "agent-referral" | "home-services";

export interface AffiliateVendor {
  id: string;                    // env var key: NEXT_PUBLIC_AFFILIATE_URL_{ID}
  name: string;
  vertical: Vertical;
  country: "US" | "CA";
  url: string;                   // plain fallback URL when affiliate URL not configured
  enabled: boolean;
  affiliateReady: boolean;       // true once tracked affiliate URL exists in env
  cpaTier: 0 | 1 | 2 | 3;        // 3 = $150+/action, 2 = $50-150, 1 = <$50, 0 = none — drives hero-vs-pill layout
  audienceMode: ("buyer" | "investor")[];  // which app mode shows this CTA
  stateCoverage: string[] | "all";          // USPS codes; "all" = no gate
  stateExclusions?: string[];              // alternative to coverage list (Kiavi case)
  offerText?: string;            // promo copy when rendered as hero CTA
  network: "direct" | "CJ" | "Impact" | "FlexOffers" | "ShareASale" | "PartnerStack" | "unconfirmed";
  notes?: string;                // rate/payment/business notes (not rendered)
}
```

Resolution: `getVendorsForProperty(state: string, mode: "buyer" | "investor")` filters by `enabled` + state gate + `audienceMode`, sorts by `cpaTier` desc then `affiliateReady`.

### URL resolver + tracking (port from hit-analytics `getSportsbookUrl`)

- `getAffiliateUrl(id, source?)`: reads `process.env.NEXT_PUBLIC_AFFILIATE_URL_{ID}` (uppercase, hyphens→underscores); falls back to plain `url`. Appends `sub_id={source}` (`source` ∈ `"assess-result" | "property-page" | "calculator" | "email" | "discover"`).
- Every CTA click → existing `POST /api/partner-connect` extended with `{ vendor, vertical, state, source, affiliate: boolean }` — this becomes per-vertical EPC measurement.
- **Health guard** (port `assertAffiliateHealth`): `REVENUE_CRITICAL_IDS` list; prod-only `console.error` if a critical vendor is `enabled` but its env URL is missing. Silent revenue loss is the failure mode this kills.
- All links `rel="noopener noreferrer sponsored"` (already the convention in `partner-cta.tsx`).

### Rendering (port `SportsbookGrid` adaptive layout)

- Result/property pages: "Act on this offer" block — **hero CTA** (highest cpaTier affiliate-ready vendor for this state+mode, with `offerText`) + up to 2 **pill CTAs**. Zero affiliate-ready vendors → render the plain grid with fallback URLs.
- **FTC disclosure** (2026 enforcement is real: ~$51.7k/violation): one plain-language line per CTA cluster, adjacent to (not below the fold from) the buttons: _"We may earn a commission if you sign up or get a quote through these links. This doesn't affect our analysis."_ Render conditionally when ≥1 displayed vendor is affiliate-active (hit-analytics `hasAnyAffiliate` pattern).
- Existing Canadian vendors (Ratehub, nesto, Square One) migrate into the same registry with `country: "CA"`, `stateCoverage: "all"`.

## US vendor slate (priority order, researched Aug 2026)

### Tier 1 — self-serve, nationwide, fastest to revenue (apply first)
| Vendor | Vertical | Network | Rate | Cookie | State gate |
|---|---|---|---|---|---|
| RentCast | investor-tools | direct (affiliates.rentcast.io) | 30% recurring + $100/10 customers, PayPal monthly | 90d | none |
| DealCheck | investor-tools | direct | 30% recurring + $100/10 users | 90d | none |
| DealMachine | investor-tools | direct (apply) | 20–50% lifetime recurring | n/d | none |
| PropStream | investor-tools | direct (apply) | ~30% recurring UNVERIFIED | n/d | none |

Notes: RentCast bans paid-traffic promotion (link-out from app is fine). DealMachine requires explicit "Paid link" disclosure wording per their affiliate ToS.

### Tier 2 — high $/action, moderate friction
| Vendor | Vertical | Network | Rate | Cookie | State gate |
|---|---|---|---|---|---|
| Kiavi | investor-tools (lending) | PartnerStack | **$1,000/closed loan** (verified) | n/d | **exclude MS, NM, RI, UT, VT** |
| Ownwell | tax-appeal | FlexOffers | CPA on completed+paid appeal (months lag) | 45d | **full-service: CA CO FL GA IL NY TX WA; elsewhere → route to "National Appeals Packet" DIY CTA** (launched Feb 2026) |
| Hippo | insurance | ShareASale | ~$25/lead UNVERIFIED ($5–50 range) | 90d | verify underwriting states |
| Lemonade | insurance | Impact | ~$15–25/lead UNVERIFIED | 30d | verify per product line |

Kiavi caveats: needs ≥30 investor referrals/yr capability; **agents/brokers ineligible** (software tool should qualify — note it in application); confirm cross-border payout on PartnerStack.

### Tier 3 — thinner data, apply to confirm
- **The Zebra** (insurance comparison) — carrier-agnostic, so it's the **nationwide default insurance CTA** when a specific carrier isn't licensed in the property's state. Network unconfirmed (possibly Awin); apply direct.
- **Steadily** (landlord insurance) — use the **Ambassador track** (no license), NOT the agent-appointment track. Rate post-application.
- **HomeLight affiliate** (agent-referral) — affiliate.homelight.com self-serve arm (distinct from the licensed agent-referral network). RESPA-clean as a platform affiliate fee.
- **Mortgage CPL**: LendingTree via CJ ($1–70/lead, sub-offers vary), Bankrate (40% revshare/CPC, 45d cookie, network unconfirmed). **Rocket Mortgage is NOT self-serve** — skip.
- **Deprioritized**: Kin (gift-card referral only, 14-state footprint), Obie (agent-appointment only), moveBuddha (no program exists), Choice/AFC home warranty (conflicting data, optional last).

## Network strategy & paperwork
- No single network covers >3–4 of the slate. Plan: **FlexOffers as primary network application** (Ownwell + mortgage/warranty options) + **5-6 direct signups** for Tier 1 (which is also fastest-to-revenue).
- Canadian sole proprietor: file **W-8BEN** (individual, not W-8BEN-E) per program, claim Canada-US treaty benefits. No program found that bars Canadian applicants; confirm PayPal/wire payout support per program (PartnerStack/ACH is the one to check).

## Per-vertical legal gates (from research; not legal advice)
- **Insurance**: pure link-out needs no producer license; gate by the *underwriter's* state licensing. Zebra = safe nationwide default.
- **Mortgage**: CPL to licensed lender/marketplace is fine nationally; the platform carries licensing. No bespoke referral deals (RESPA §8).
- **Agent-referral**: platform affiliate fee (HomeLight affiliate arm) is clean; never take a cut of commission directly without a license.
- **Tax-appeal**: hard state gate per Ownwell service tier (above).
- **Investor SaaS**: no gates except Kiavi's 5 excluded states.

## Implementation order
1. Registry + resolver + health guard + migrate CA vendors (no visual change).
2. Adaptive CTA block on property/result pages with FTC disclosure; extend partner-connect payload.
3. Wire vendors as approvals land (env vars per vendor).
4. Email CTAs (assessment email) reuse `getAffiliateUrl(id, "email")`.
