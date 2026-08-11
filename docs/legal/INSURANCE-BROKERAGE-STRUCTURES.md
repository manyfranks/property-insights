# Insurance Distribution — Structures, Licensing Footprint, Jurisdiction Map

_Researched 2026-08-09. NOT LEGAL ADVICE. Engineering/strategy input for a regulatory lawyer.
Supersedes the first draft: the commission figures in v1 were wrong (see §1)._

Companion docs: `US-EXPANSION-LEGAL-BRIEFING.md`, `../plans/12-US-CTA-JOURNEY-MAP.md`.

---

## 1. Commission economics — CORRECTED

v1 of this doc said "10–20% norm, BC strata ~9%." **Both figures were wrong or misapplied.**
The 10–20% came from US commercial P&C sources; the 9% traced to a single brokerage.

| # | What it measures | Canadian personal property | Canadian commercial property |
|---|---|---|---|
| 1 | **Gross commission, carrier → brokerage** | Modal **15–20%**, ceiling **~25–27%** | **15–25%**, some carriers to 30–32% |
| 2 | **Producer's split of that gross** | New business commonly **40–50%+**; renewal **20–30%**; blended average **33–35%** | Similar, commercial skews higher on new |
| 3 | "BC strata ~9%" | **One brokerage's halved rate**, not a line standard — see below | — |
| 4 | US vs Canada | v1 leaned US-commercial; Canadian personal property sits at the *upper* end | — |

**Primary sources:** Intact's own broker page states commissions run "5% to the high 20's."
Definity/Economical publishes Personal Property 17.5–20%, Commercial Property 20%, surety to 25%.
NFP's regulated multi-carrier disclosure (60+ carriers): personal property clusters 15–20%
(Intact 20%, Wawanesa 20%, Aviva 15–20%, Gore 20%, CAA 20%).

**The 9% strata figure explained:** FS Insurance Brokers (FirstService Residential) discloses
commission as "18% × one half of your annual premium" = 9% net. The **18% base is normal**;
the halving is a property-manager-affiliation/volume concession specific to that brokerage.
BCFSA's own strata reports publish no commission rate at all.

**Verdict on the broker's claim:** 25% is at the documented ceiling, not fabricated — plausible
for specific carriers/specialty placements, high as a blanket average. His "35% to the producer"
is an almost exact match to Canadian Underwriter/Smythe LLP's published "33% to 35% average
producer compensation." **He was more right than v1 of this research.**

### Per-policy economics (the number that decides strategy)

| Policy | Typical premium | Gross commission | Producer take |
|---|---|---|---|
| Landlord/rental | $2,300/yr | $414–575 | $145–288 |
| Homeowner | $1,800/yr | $324–450 | $113–225 |
| Small strata building | $40,000/yr | $7,200–10,000 | $2,520–5,000 |
| Large strata (hard market) | $150,000/yr | $27,000–37,500 | $9,450–18,750 |

**A landlord policy is worth $414–575 gross licensed vs. a $25 flat referral fee unlicensed —
a 16–23× difference on the same click.** The unlicensed funnel is a market test, not a business.

**Strata reframed:** BC banned strata referral fees *because* $7k–37k per building was flowing
to unlicensed property managers. The ban is evidence of the prize. It prohibits paying unlicensed
referrers — a **licensed** broker placing strata earns that commission normally. Strata goes from
"closed" to "highest-value line available" the moment a licence exists, and it's the one niche
with a genuine SERP gap (no comparison UX exists in Canada).

## 2. Licensing footprint — how many licences, how many humans

**Answer: "one Canadian broker + one US broker" is the correct model.** Not a broker per
jurisdiction; not one universal licence (none exists — NARAB II was never implemented).

### Canada — a portfolio problem (one human can do it)
- No federal licence. Licensing is provincial, but the **CISRO/CCIR "Reliance Model" (since 2006)**
  means a host province relies on your home-province standard rather than re-testing.
- **BC**: non-residents holding an equivalent home-province licence skip exams; need the BC Council
  Rules Course + good standing. ~$200 + $25–50.
- **AB**: no "transfer" — a fresh application per province, but equivalent licences skip AB exams
  (BC General Level 2 → AB General Level 2 maps directly).
- **ON**: **Bill 2 (June 2025) "As of Right"** — an eligible out-of-province agent can start working
  the moment FSRA confirms a complete application, deemed certified 6 months. $150 / 2 years.
- Agency entity must register per province with a nominee/DR/Principal Representative — but that can
  be the **same individual** if validly licensed in each.

### US — a headcount problem exactly once, then a portfolio problem
- **Matt cannot personally hold a US resident licence.** Every state's "home state" definition
  requires actual US residence or principal place of business; Designated Home State programs are
  **adjuster-specific** and still require US citizenship/work authorization. Georgia and Alabama
  require citizenship affidavits; 13+ more require proof of work authorization.
- Therefore the US side **requires a genuine US-resident licensed producer** as the anchor. That is
  the "US broker" partner — structurally mandatory, not a convenience.
- Once that anchor exists: **1 resident licence → non-resident licences in 49 states + DC** via NIPR,
  $10–225/state, 2–7 day turnaround, biennial renewal, home-state CE usually suffices.
- **Business-entity licence per state**, each needing a **DRLP** (officer/owner, not just employee).
  If the DRLP's licence lapses, ~30 days to replace or the entity licence cancels.

### Two layers people forget
- **Carrier appointments** are per carrier *per state*, and carriers vet new agencies on production
  history a startup won't have. **Solution: 1–2 MGA/wholesale relationships** provide sub-appointment
  under their existing carrier/state footprint. Far more viable than direct appointments in year one.
- **Surplus lines / E&S** for STR, marinas, resorts, some strata: a *separate* broker licence per
  state, bonds ($25k CA→$50k+), plus premium-tax remittance and stamping-office reporting. Budget as
  a distinct workstream, likely handled through the MGA partner.

## 3. Jurisdiction friction map

### The safe operating envelope (build once, reuse everywhere)
1. **Flat fixed-dollar fee**, never a percentage
2. **Non-contingent on sale** — pay for the introduction, not the policy
3. **Cap ≤ $25** (clears TN's $25, NC's $50; legal everywhere uncapped)
4. **Zero discussion of terms, rates, coverage, or comparative merit** — no "best," "top-rated,"
   "recommended." *Highest-leverage rule:* solicitation is defined by **behavior, not payment**, so
   this single discipline clears WA, CA, NY, TX, PA, VA simultaneously
5. **Written disclosure** of the arrangement
6. **Free tools never conditioned on purchase** — keeps us inside anti-rebating rules everywhere,
   including CA which rejected the NAIC #880 modernization. Our calculators are free to all: safe.

### Launch exclusions (express as `stateExclusions` in the vendor registry)
| Jurisdiction | Status |
|---|---|
| **BC — strata only** | Total ban (Bill 14, 2020). No structure fixes it. Other BC lines fine |
| **Washington** | Exclude. Only jurisdiction with documented **double-sided** enforcement (site *and* accepting producer). TAA 2021-01: content that "urges" toward an insurer is licensable regardless of pay. $100/12-mo cap |
| **Quebec** | Exclude pending review. Civil-law AMF regime; their DWR framework doesn't map to referral fees. Bill 96 language requirements are a separate layer |
| **New Brunswick** | Elevated risk. 2023 regime: licensing applies "regardless of whether conducted in person, in writing, over the telephone or **online**" |
| **California** | Do NOT exclude, but strictest copy discipline — prohibited referral compensation is a **misdemeanor**, enforceable by any DA, $1,000/violation |

### Confirmed-permissive / default
- **Manitoba** — cleanest confirmed Canadian rule: referral fee allowed if "in no way tied to the
  placing of a policy or receipt of commission"
- **US default (NAIC PLMA §13(D))** — payment to a person who does not sell/solicit/negotiate is
  permitted, subject to non-contingency + no-discussion + anti-rebating
- Capped states: **TN $25, NC $50, WA $100/12mo**. VA requires "nominal fixed dollar" with no number
  specified (secondary sources claiming "$25" are unverified — do not rely)
- **The Zebra** operates as an unlicensed lead-gen marketplace — proof the passive-referral model is
  a live business, not theoretical

### Unconfirmed — needs a paid legal-database pass before an unrestricted funnel
**Alberta, Ontario, Nova Scotia, Quebec.** No primary statutory text reachable. One industry source
claims most provincial regulators disallow paying any P&C commission portion to unlicensed persons —
materially stricter than the US default. Ontario's RIBO requires full compensation disclosure.

## 4. Structures with a licensed partner

| # | Structure | Paid how | Ceiling | Risk |
|---|---|---|---|---|
| 1 | **Sponsorship** — partner employs Matt, he earns Level 1→2 | Commission splits once licensed | His own production | Low, but Level 1 must work **on agency premises** under supervision (COVID exemption rescinded) |
| 2 | **New entity, Matt co-owns, partner is nominee/DRLP** | Entity earns agency commission; Matt paid as **owner** | **Highest** | No BC rule found restricting equity ownership. One nominee per brokerage |
| 3 | **Dividends vs. referral fee** | Board-declared, pro-rata | — | **NY DFS OGC 02-11-27**: unlicensed owner may take dividends "in the usual course of business," distinct from commission-sharing, if unrelated to volume transacted. **No BC equivalent found** |
| 4 | **MSA / flat SaaS fee** | Flat fee, itemized services, FMV | Modest | Low if genuine. Volume-linked "SaaS fee" = referral fee in costume |
| 5 | **White-label / BOR** | Only via #2 or #4 | — | Highest if done as unlicensed per-policy bounty (the WA fact pattern) |

**Precedent:** Matic, Zensurance, and APOLLO all reached real economics by *becoming the licensed
entity*. Matic earns ordinary carrier commission as BOR; lender partners get soft value, not bounties.

## 5. Recommended sequencing

1. **Now — prove the funnel.** County landlord-insurance content modules on the 3,144 county pages.
   Content + existing affiliate CTAs. Zero new compliance surface, no partner agreement, no PII.
   Generates the conversion evidence everything else depends on.
2. **Now, parallel — Matt starts Level 1 coursework.** Zero downside, settles nothing prematurely.
3. **If the funnel converts — build the intake/handoff flow.** Pre-filled handoff to partner's
   licensed engine. Terminal step designed pluggable (see §6).
4. **Then — Canadian entity** (partner as nominee, Matt with equity, dividend discipline from day one).
5. **US — only once a US-resident licensed partner is secured.** That anchor is structurally required.

**Build the machine before the corporation.**

## 6. Architecture note: the two paths are one build

The pre-filled handoff **is** the DIY MVP's v1. Everything upstream of the quote is identical in
both worlds — capture property, build risk profile, ask what our data can't answer, route by
geography, hand off. Only the terminal step changes: today it deep-links to a partner's licensed
engine; post-licensing it submits internally. **Make the terminal step pluggable and nothing is wasted.**

- Routing rides the **existing affiliate registry** (`country` + `stateCoverage` + `stateExclusions`
  + `getVendorsForSurface`) — jurisdiction frictions from §3 become exclusion lists, the same
  mechanism already gating Kiavi out of 5 states.
- Vendor type gains a prefill capability declaration + param map.
- **Pre-fill payload is the unfair advantage:** address, value estimate, rent estimate, year built,
  beds/baths/sqft, property type, FEMA hazard scores — most of a submission before the user types.
  This is the Matic pattern (eliminate data entry).
- Must ask: occupancy type, unit count, claims history, coverage expiry, contact preference. ~6 questions.
- **Copy constraint from §3.4:** "build your coverage profile → get matched with a licensed broker,"
  never "compare quotes." Retrofitting compliant copy onto a comparison product is painful.
- Stored profiles in Postgres are the strategic asset: warm pipeline + conversion proof for the
  equity negotiation.

## 7. Questions for the regulatory lawyer

1. Is there a **BC ruling equivalent to NY OGC 02-11-27** on dividends vs. commission-sharing?
2. Does BC apply **controlled-business scrutiny** where nearly all business originates from one
   shareholder's website?
3. What does **"employed and supervised"** require in hours/premises for a Level 1 licensee who also
   runs an unrelated business?
4. Can one Level 3 be **nominee at two entities** simultaneously?
5. **US entity home-state nuance** — could a genuine US entity with US-based officers establish
   home-state status even though no owner is a US resident? *Highest-value US question: if there's a
   door here it changes the whole US sequence.*
6. **US multistate lead-gen** — does converting US traffic into referrals trigger entity licensing
   for the platform state-by-state? Does WA's TAA generalize?
7. **Strata** — does Bill 14 reach *all* platform compensation touching strata, including flat MSA fees?
8. **AB / ON / NS / QC referral rules** — primary-source pass required.
9. **Tax/corporate** — separating entity shares, MSA invoicing, and the sole proprietorship so
   "dividends not disguised commissions" stays clean. Lawyer + accountant together.

## 8. Verification gaps

- BC Council Rules and Supervision Guidelines PDFs weren't machine-parseable — open directly.
- FSRA's out-of-province page returned 403; Ontario As-of-Right mechanics reconstructed from
  secondary coverage. Verify with FSRA.
- Matic's lender compensation is inferred, not from a disclosed contract.
- The "no Canadian can hold a US resident licence" finding is corroborated across FL, CT, and NAIC
  home-state definitions but is **not** an on-the-record regulator statement. Confirm with US counsel.
- AB fee schedule not confirmed.

## 9. Niche viability

| Niche | Verdict |
|---|---|
| **Landlord** | Red ocean for tooling (Steadily/Obie own address→quote), but **county-grain content is unclaimed**. Build here first. Easiest partner plumbing |
| **BC strata** | Genuine SERP gap; referral fees banned. **Content/authority play until licensed — then the highest-value line** |
| **STR / Airbnb** | Red ocean. Obie and Proper own the mechanic; our assessed-value data doesn't map to booking-revenue pricing |
| **Marina, boutique hotel/resort** | Skip. Negligible retail search, wholesale-MGA-only channels, no data fit. E&S licensing burden on top |
