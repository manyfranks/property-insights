# Insurance Distribution Structures — Counsel Prep

_Researched 2026-08-09. NOT LEGAL ADVICE. Prepared as engineering/strategy input for a
regulatory lawyer conversation. Triggered by a broker's pitch (small-commercial niche book)
and the follow-up question: "what if I partner with an already-licensed broker?"_

Companion docs: `US-EXPANSION-LEGAL-BRIEFING.md`, `../plans/12-US-CTA-JOURNEY-MAP.md`.

---

## 1. The broker's original pitch, validated claim by claim

| Claim | Verdict |
|---|---|
| Large brokerages neglect sub-$10k-premium commercial | **Partly true.** Real segment ("small commercial" / "micro commercial" ≤$2,500). Consolidation is real (top-10 groups <40% → >60% of Canadian market) and pushes small accounts into service centres. But insurtechs/MGAs are actively *pursuing* this segment, not abandoning it. No source uses a $10k threshold — that's the broker's own framing. |
| ~25% commission per policy | **Mostly refuted.** Mainstream commercial P&C is **10–20%**. BC strata specifically documented at **~9%** (FS Insurance Brokers' disclosed formula). 25%+ occurs on surplus-lines or when a separate broker fee is stacked (a distinct revenue line, not commission). Pitch overstates yield ~1.5–2×. |
| One person services 500–1,000 policies | **Plausible, conditionally.** CSR benchmarks: $165k–$250k commission handled per person ≈ ~650 policies at 15% / $2k avg premium. But that assumes an established agency's tech stack, and hospitality/marina/STR risks are higher-touch than the auto/home policies behind those benchmarks. |
| Licensing is "easy to obtain" | **Refuted as pitched.** Exams are cheap/fast (~$3,000–3,600, months part-time, Level 1→3). The gate is **sponsorship**: BC requires an employing, supervising licensed brokerage to issue even Level 1. |
| Small policies are easy to maintain | **Half true.** Low dollar exposure ≠ low servicing labour (renewals, endorsements, COIs, remarketing). Specialty risks often need MGA placement. |

## 2. Hard regulatory boundaries (unlicensed platform)

- **Permitted:** passive information content; flat, non-contingent referral fees, disclosed in writing, where the unlicensed party never discusses product merits or client needs.
- **Licensed-only:** quoting, comparing/ranking products, advising on needs, soliciting, binding — and **any compensation that varies with premium or is contingent on the sale**.
- **BC strata: referral fees banned outright** (Bill 14, Sept 2020) to any unlicensed party including property managers. Stress-test with counsel whether an MSA-style fee correlated to strata volume circumvents it.
- **Enforcement is real:** Washington TAA 2021-01 treated review/comparison sites as transacting insurance unlicensed, and enforced against **both** the site and the producer who accepted its referrals.

## 3. Partnership structures with a licensed broker

| # | Structure | How platform is paid | Ceiling | Risk |
|---|---|---|---|---|
| 1 | **Sponsorship** — partner brokerage employs Matt; he earns Level 1→2 | Normal commission splits once licensed | Capped at his own production | Low. But Level 1 must work **on agency premises** under direct supervision (COVID remote exemption rescinded) — collides with a day job |
| 2 | **New entity, Matt co-owns, partner is Level 3 nominee** | Entity earns normal agency commission; Matt paid as **owner** | **Highest** — full brokerage economics | Medium. No BC rule found restricting who may hold equity (unlike NY's 10% controlled-business rule). One nominee per brokerage in BC is a hard constraint |
| 3 | **Dividends vs. referral fee** (the crux) | Board-declared dividends, pro-rata to shares | — | **The line:** distributions must track company profit, never the volume Matt's site referred. Volume-tracking = disguised commission |
| 4 | **MSA / flat SaaS licence fee** | Flat monthly fee for real, itemized services at fair market value | Modest — a SaaS price, not brokerage economics | Low **if genuine**. A volume-linked "SaaS fee" is a referral fee in costume; regulators apply a form-vs-substance test (CFPB sham-MSA logic is the analogue) |
| 5 | **White-label / BOR** | Only via #2 (platform is licensed) or #4 (flat fee) | Depends on underlying | Highest if done as an unlicensed per-policy bounty — exactly the WA fact pattern |

### The key legal finding
**NY DFS OGC Opinion 02-11-27** (clearest authority found): an unlicensed owner *may* receive
compensation "as an owner… in the form of dividends declared in the usual course of business,"
legally distinct from commission-sharing, provided (i) no benefit tied to insurance purchases,
(ii) benefit unrelated to volume transacted, (iii) not an inducement.
**No BC equivalent ruling was found.** That gap is counsel question #1.

### The precedent nobody escapes
Every real-world platform that reached meaningful insurance economics — **Matic, Zensurance,
APOLLO** — did it by *becoming the licensed entity*, not by taking bounties as an unlicensed
distributor. Matic earns ordinary carrier commission as broker of record; its lender partners
get soft value (retention, UX), not per-policy payments. There is no durable unlicensed
bounty model in the precedent set.

## 4. Recommended sequencing

1. **Now — prove the funnel, no restructuring.** Flat-fee referral or plain MSA with the partner's *existing* brokerage. Legal today, no new entity. Run it on county landlord-insurance content. If it doesn't produce referral volume in a quarter, none of the rest matters.
2. **Now, parallel — Matt starts Level 1 coursework.** Zero downside, doesn't require settling the ownership question.
3. **Month 3–9, only if step 1 produced volume —** form the entity (partner as Level 3 nominee, Matt with equity), with dividend mechanics disciplined from day one in the shareholders' agreement and the bookkeeping.
4. **Month 6–12 —** entity becomes Matt's sponsor (resolving the premises/supervision problem by making it his employer); MSA winds down into normal producer/owner economics.

**Build the machine before building the corporation.** The funnel is unproven — we have zero
data that property-analysis traffic converts to insurance intent.

## 5. Questions for the regulatory lawyer

1. Is there a **BC ruling equivalent to NY OGC 02-11-27** distinguishing dividends from commission-sharing, or is the position inferred from corporate law + the Code of Conduct's "no remunerating unlicensed persons" language by analogy only?
2. Does BC apply **controlled-business / self-dealing scrutiny** (like NY's 10% rule) where nearly all business originates from one shareholder's website?
3. What does **"employed and supervised"** require in hours/premises for a Level 1 licensee who also runs an unrelated business? (COVID remote exemption rescinded.)
4. Can one Level 3 individual be **nominee at two entities** simultaneously, or must they migrate fully?
5. How should an **MSA fee be benchmarked to fair market value** to survive scrutiny (comparables? time-and-materials? independent appraisal?).
6. **US multistate:** does converting US traffic into referrals/MSA-covered leads trigger business-entity licensing for the *platform* state-by-state? Does WA's TAA 2021-01 "pure lead generator" line generalize?
7. **Strata:** does Bill 14's ban reach *all* platform compensation touching strata business, including flat MSA fees?
8. **Tax/corporate:** how to separate the entity's shares, the MSA invoicing entity, and the existing sole proprietorship so "dividends, not disguised commissions" stays clean. Needs lawyer + accountant together.

## 6. Verification gaps (do before relying on this)

- BC Insurance Council Rules and Salesperson Supervision Guidelines PDFs could not be machine-parsed; findings came from search-indexed excerpts. **Open both directly.**
- Matic's lender-compensation mechanics are inferred from RESPA-compliance statements, not a disclosed contract. Present to counsel as "understood to be structured this way, unconfirmed."
- No BC case law located on dividend-vs-commission. Genuine gap, not an oversight.

## 7. Niche viability (separate research, same day)

| Niche | Verdict |
|---|---|
| **Landlord insurance** | Red ocean for tooling (Steadily/Obie already do address→quote), but **county-grain content is unclaimed** — incumbents stop at state level. Build on the 3,144 county pages. Easiest partner plumbing. |
| **BC strata** | Only niche with a genuine SERP gap (no comparison UX exists in Canada) — and referral fees are **banned** in BC. Content/authority play only, unless licensed. |
| **STR / Airbnb** | Red ocean. Obie and Proper own the exact mechanic; our assessed-value data doesn't map to booking-revenue pricing. |
| **Marina, boutique hotel/resort** | Skip. Negligible retail search, wholesale-MGA-only channels (no self-serve programs), and we hold no vessel/room-count/F&B data to underwrite with. |
