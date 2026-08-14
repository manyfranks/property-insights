# Insurance Partner Landscape — Canada & US (2026-08)

_Researched 2026-08-13 via web research agents. NOT LEGAL ADVICE. Business/BD input for partner
selection and for the regulatory lawyer — not a substitute for primary-source verification.
Items marked **[U]** are unverified (single-source, secondary-reported, or a rate the partner
hasn't confirmed in writing) — do not build compensation logic against a [U] number without
confirming it in the partner portal or agreement first._

Companion docs: `INSURANCE-BROKERAGE-STRUCTURES.md` (structures, licensing footprint, jurisdiction
map — read that one first for the legal envelope this landscape operates inside), `US-EXPANSION-LEGAL-BRIEFING.md`,
`../plans/18-INSURANCE-PATH-BUILD.md`, `../proposals/insurance-distribution-proposal.html`.

---

## 1. Canada (BC-first)

BC is the priority jurisdiction — see `INSURANCE-BROKERAGE-STRUCTURES.md` §3 for why (strata
aside, the province has no blanket referral-fee ban and the flat non-contingent envelope clears
comfortably). Partners below are evaluated first for BC fit, then national reach.

### Live / near-term partners

| Partner | Status | Lines | Payout | Prefill / API | Notes |
|---|---|---|---|---|---|
| **Square One** | Existing partner | Homeowner, condo, tenant, landlord — all BC property lines | $50 tenant / $100 condo / $175 homeowner **per policy sold** | True online bind | Only public priced CA program found. In-house program (`affiliates@squareone.ca`), no network intermediary. |
| **APOLLO** | Existing partner | Homeowner, tenant, landlord, commercial | Not disclosed publicly | Only real CA prefill/embedded API found — 1,000+ integrations incl. Yardi, partner portal | **Acquired by Arthur J. Gallagher, announced Aug 5, 2026.** Terms need re-confirmation post-acquisition before relying on the existing agreement. |
| **Surex** | Prospect (private, `btatum@surex.com`) | Multi-carrier comparison, BC | Paid B2B referral fee (amount not public) | Finmo/Filogix integrations pass name/email/address into its quoter | Best BC multi-carrier comparison found. iA-majority-owned. Closest existing template to our proposed handoff shape — worth studying their Finmo/Filogix integration contract even if we don't partner directly. |
| **Zensurance** | Application in review (Aug 2026) | Landlord via commercial line only — no personal homeowner/tenant | $50 CAD CPA per completed quote, via Fintel Connect | Not confirmed | No QC, no territories. Registry entry already added as an inert vendor (see `18-INSURANCE-PATH-BUILD.md`). |

### Watchlist

| Partner | Why watch | Blocker |
|---|---|---|
| **YouSet** | Ideal shape on paper — QuickQuote/QuickFill prefill APIs plus a per-quote affiliate tier | No BC licence yet. Licensed AMF (QC) + RIBO (ON) only. Revisit if/when BC licensing lands. |

### No partner channel

| Partner | Reason |
|---|---|
| **BCAA** | BC-only, has online bind with a 5% discount, but no partner/affiliate channel found. |

### Explicit skips

| Partner | Reason |
|---|---|
| **Duuo** | Partner programs closed; product line in retreat. |
| **Onlia** | ON-only; sold to Southampton in 2024. |
| **Sonnet** | No affiliate channel found; no standalone rental policies; home lines are BC/AB only. |
| **MyChoice** | Unlicensed lead-gen — closest Canadian analogue to The Zebra, but no publisher program exists. Undocumented URL-param prefill was observed on their site; not a supported integration, don't build against it. |
| **Westland Express** | Tenant line only — too narrow for our lines coverage. |
| **Lemonade (Canada)** | Not applicable — Lemonade has no Canadian operation. |

### RATESDOTCA family

InsuranceHotline and LowestRates are both part of the RATESDOTCA Group, licensed through Scoop
Insurance Brokers. **Ownership correction:** InsuranceHotline belongs to RATESDOTCA Group
(formerly Kanetix) — **not** Ratehub, which is a commonly repeated misattribution. InsuranceHotline
runs an affiliate program reported at **$0.50–2.50 per quote** by directory sources **[U]** —
not confirmed with RATESDOTCA directly.

---

## 2. Canada — key regulatory findings

- **No Canadian Zebra exists.** Every transactional comparison site found (Surex, RATESDOTCA
  family, MyChoice) owns its own brokerage rather than operating as a pure unlicensed
  aggregator. The analytics-to-insurance handoff niche — property data feeding a matched, licensed
  partner — is open. HonestDoor, the closest comparable property-analytics product, has no
  insurance referral mechanism at all.
- **BC referral fees to unlicensed persons are permitted**, per the Insurance Council of BC
  (primary source), subject to two conditions: (1) the referrer performs **no insurance
  activity** — this is read broadly, and explicitly includes not discussing product merits or a
  client's needs, not just refraining from binding a policy; and (2) the client receives **written
  disclosure before the transaction**. Contingency is not expressly banned in BC — Square One's
  own program pays per policy sold, which is a contingent structure and evidently compliant.
  **The ≤$25 flat non-contingent envelope used elsewhere in our compliance posture is a
  US-driven constraint; the Canadian ceiling is higher.** Strata is excepted entirely from this
  permissive reading — see the total ban below.
- **Caution on the coverage-profile flow itself:** pre-filling a "coverage profile" for the user
  edges toward "discussing insurance needs" if we're not careful. Keep the flow to property data
  plus a user-chosen policy type — never a system-generated recommendation of coverage amount,
  carrier, or product. This is a counsel item, not a resolved question.
- **Licensing — CISRO harmonized non-resident applications (the "reliance model").** One
  individual can hold licences across multiple provinces via this reliance mechanism — it lets one
  person be licensed in several places, it does not create a single universal licence.
- **Ontario Bill 2 "as-of-right"** is effective **January 1, 2026**. It applies to individuals
  only — not entities or Principal Brokers — and grants a 6-month deemed licence once FSRA
  confirms a complete application.
- **Quebec** runs a separate AMF regime, structurally different from the rest of Canada (civil-law
  framework). Excluded from this landscape pending its own review.
- **NEW — BC Restricted Insurance Agent (RIA) regime for incidental sellers**, in force
  **January 1, 2027**. This is a possible embedded-sales path short of a full brokerage licence —
  flagged as a **Stage 2.5 candidate** worth scoping once it's live (see
  `../plans/18-INSURANCE-PATH-BUILD.md` for staging).
- **RIBO referral guidance (RIBO-007)** is listed as "coming soon" as of this research pass — **[U]**,
  re-check for publication before relying on Ontario referral mechanics.
- **Alberta referral bulletin** — no equivalent primary-source bulletin was found. **[U]**, treat
  Alberta referral rules as unconfirmed per §3 of `INSURANCE-BROKERAGE-STRUCTURES.md`.

---

## 3. United States

| Partner | Status | Lines / coverage | Payout | Prefill / API | Notes |
|---|---|---|---|---|---|
| **Steadily** | We hold Ambassador tier | Landlord + STR, all 50 states + DC | Not public **[U]** | Three tiers: widget → "smart links" (pre-filled quote experience with referral tracking) → full API (licensed partners only) | Direct BD relationship. Explicit unlicensed-referrer/content-creator track — rare and valuable; most US partners don't offer this. |
| **Obie** | BD thread live (partnerships contacts: Sumaya, Brian Harris — Aug 2026) | All 50 states + DC | Not public | Deepest embedded stack found: Instant Estimate Widget, quote-to-bind Embedded Experience, Policy Sync | **Acquired by Baldwin Group, Jan 2026** — re-confirm current partner terms post-acquisition. Explicitly offers "simple referral options" for unlicensed platforms. |
| **Insurify** | Prospect | Homeowner, multi-carrier | ~$15/lead **[U on rate]** | — | Via Impact or direct. |
| **Hippo** | Prospect (ShareASale) | Homeowner | $5–25/lead **[U, conflicting sources]** | — | Its Builder Insurance Agency precedent pays per lead regardless of bind — a non-contingent model, useful as a comp for our own compensation structure. |
| **Simply Business (US)** | Prospect (FlexOffers) | Small business / landlord-adjacent | Rate not public | — | — |
| **The Zebra** | Prospect | Multi-carrier comparison | Direct partnerships pay per qualified referral (Mortgage Collaborative is the cited precedent); a separate consumer affiliate program possibly runs via Awin **[U]** | — | — |

### Excluded from the slate

| Partner | Reason |
|---|---|
| **Lemonade** | Payout via Awin/FlexOffers (~$25/sale) is **bind-contingent**, which conflicts with the flat non-contingent envelope this program is built around. Landlord line is condo/co-op-only in roughly 8 jurisdictions **[U, conflicting reports]**. Excluded on both compensation-structure and coverage grounds. |

### Poor fits (not pursued)

| Partner | Reason |
|---|---|
| **Openly** | Appointed licensed agents only — no unlicensed-referrer path. |
| **Kin** | No partner program found; only ~13–14 states. |
| **Matic** | Excellent prefill API, but lender-oriented BD — not shaped for our traffic. |

---

## 4. United States — regulatory findings

- **Washington TAA 2021-01 confirmed still current.** Content that "urges" a visitor toward a
  particular insurer is unlicensed solicitation regardless of whether money changes hands.
  Enforcement is **double-sided**: RCW 48.17.490(1) reaches the payer, RCW 48.17.530(1)(l) reaches
  the accepting producer. Two consent orders on record: Trupanion (2019), Reviews.com (2021). The
  $100/12-month cap appears to still hold, but the OIC page that states it has moved — **[U],
  verify the live OIC page** before relying on the number.
- **NEW — North Carolina HB 737.** Caps referral fees to unlicensed persons at **$50 per referral**
  for referrals made on or after **October 1, 2025**, with fines up to $2,000 per occurrence. Our
  existing ≤$25 flat envelope clears this cap with room to spare.
- No other state has adopted Washington-style behavior-based enforcement since 2024, per this
  research pass.

---

## 5. Verification gaps

- Every rate marked **[U]** above should be confirmed against the partner's own portal, agreement,
  or a direct written quote before it's used in any compensation or projection model — several are
  directory-reported or secondary-sourced only.
- APOLLO and Obie terms both need re-confirmation given their respective acquisitions (Arthur J.
  Gallagher, Aug 5 2026; Baldwin Group, Jan 2026) — acquiring companies frequently restructure
  partner programs post-close.
- RIBO-007 (Ontario referral guidance) and the Alberta referral bulletin were both unreachable at
  research time — re-check before treating either province as confirmed-permissive.
- The Washington OIC page stating the $100/12-month cap was not reachable at its previously known
  URL — confirm the cap is still current on the live site, not from this doc's citation of it.
