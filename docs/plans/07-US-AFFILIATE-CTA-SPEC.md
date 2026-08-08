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
| Hippo | insurance | ShareASale | ~$25/lead UNVERIFIED ($5–50 range) | 90d | verify underwriting states. ⚠️ Aug 2026: program appears dormant (last tracked conversion reportedly 2021) — do not feature; never added to code registry |
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

## Research addendum v2 (verified web pass, Aug 7 2026)

### New additions
| Vendor | Vertical | Network | Rate | Verification | Apply |
|---|---|---|---|---|---|
| Allstate | insurance | Impact | ~$5-8/lead PPL | secondary | Impact marketplace |
| Insurify | insurance | Impact | ~$15/lead home, 30d cookie | secondary | Impact marketplace or partnerships@insurify.com |
| SmartFinancial | insurance | direct | up to ~$40/lead claimed | unverified | agents.smartfinancial.com/publishers |
| Easy Street Capital | investor-tools (lending) | direct | $1,000/closed loan — Kiavi parity | **verified** | easystreetcap.com/refer/ |
| Lima One Capital | investor-tools (lending) | direct | 0.25-0.50% of funded loan | **verified** | limaone.com/referral-application/ |
| New American Funding | mortgage | FlexOffers | up to $60/prospect | **verified Active** | FlexOffers (second reason to gate revenue on FlexOffers signup) |
| Baselane | investor-tools (landlord banking) | direct (Affonso.io) | $150-200/referral, no minimum | **verified** | baselane.com |

A single Impact publisher account covers Allstate + Insurify (plus the existing Lemonade + Policygenius slate).

### Backup
- **Liberty Mutual** — CJ, $10/lead (home+auto), $3/lead renters. PRIMARY-verified on libertymutual.com/affiliate-program. Use if Allstate declines.

### Documented no-program verdicts (do not re-research)
- **State Farm** — own corporate site confirms no affiliate program; listicle claims contradicted.
- **Travelers** — none.
- **Farmers / Nationwide** — licensed-agent portals only, disqualified.
- **GEICO** — deactivated on FlexOffers.
- **American Family** — none on any major network.
- **Amica** — none.
- **Chubb** — Sovrn-only, poor fit.
- **Jerry** — licensed producers only.
- **MediaAlpha** — RTB infra, volume-gated.
- **Coverage.com / Red Ventures** — no public program.
- **QuoteWizard** — affiliate domain dead / DNS failure.

### Mortgage downgrades / disqualifications
- **Figure** — inactive on FlexOffers; only a licensed-lender B2B API remains.
- **Rate / Aven / Veterans United** — no self-serve program.
- **RCN Capital** — broker-track only (yield-spread comp), not a CPL affiliate fit.
- **Bankrate** — downgraded; the 40% revshare figure traces only to weak secondary sources, and "Partner with us" is a bespoke BD form, not self-serve.
- **AmeriSave** — caution: weak terms sourcing plus a 2023 CFPB $19.3M settlement.

### Opportunistic tier (worth revisiting, not actioned)
- **EverQuote** — ~$12/lead home, but no self-serve path found.
- **Matic** — DCMnetwork; best thematic fit (embedded insurance in mortgage/real-estate journeys); terms unverified.
- **Gabi / Experian** — redundant with Zebra/Insurify.
- **SoFi** — ~$100-150/lead secondary, unverified.
- **Groundfloor** — $500/funded loan via VigLink, unconfirmed.

### Structural legal note
DSCR / fix-and-flip lending is business-purpose credit, exempt from RESPA/TILA consumer rules (checked against CFPB Reg 1024.5). This is why investor lenders (Kiavi, Easy Street, Lima One) can pay referral fees to unlicensed publishers — investor lending is the structurally safest high-$ category for us.

### Action insight
One Impact publisher account unlocks Allstate + Insurify + Lemonade + Policygenius. One CJ account unlocks Liberty Mutual + LendingTree. Exact terms and Canada eligibility are only visible inside each network's dashboard post-approval.

### Source-quality note
Figures marked **verified** above came from primary vendor pages. Everything else is consistent-secondary sourcing from SEO listicles and must be re-verified inside the network dashboard before being encoded as a `cpaTier` change in `src/config/affiliate-vendors.ts`.
