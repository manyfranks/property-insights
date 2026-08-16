# Lemonade's End-to-End Journey & Machinery: A Build-vs-Buy Reference Map

*Compiled August 16, 2026 (Sonnet research agent), for Property Insights' Canadian (BC-first) self-serve home insurance build. Sources: Lemonade's S-1/424B4, FY2024/FY2025 10-K, Q4 2025–Q2 2026 shareholder letters and earnings calls, three state market-conduct exams (Pennsylvania, Illinois, Virginia), a public Lemonade "Tip Sheet for Agents" PDF, Stripe's blog, ZestyAI's press release, and press coverage. Lemonade's own domain and SEC.gov largely blocked direct fetches (403) during research — content from those sources was relayed via proxy fetch or secondary citation. Claims without a citable source are marked **[UNVERIFIED]**.*

## TL;DR

- Lemonade is a genuine **full-stack carrier** (not a broker/MGA), which is the load-bearing fact behind almost everything else: instant bind, instant claims payment, and full data/product control are only possible because Lemonade holds the paper. A brokerage distributing other carriers' products **cannot replicate the instant-bind/instant-pay mechanics** — it can replicate the UX shell (chat quoting, self-serve portal, slick FNOL) but the money movement and risk decision require carrier authority.
- The "chatbot magic" story is real but thinner than the marketing: Maya's ~90-second quote claim is only weakly independently corroborated; homeowners quoting depends on an **unnamed third-party property-data vendor** with an acknowledged outage mode; and **homeowners policies cannot bind same-day** — future-dated only. Renters can bind same-day; homeowners cannot. Critical correction to the "instant everything" assumption.
- Claims automation is real and improving (LAE ratio 5% vs ~9% industry; cost-per-claim $44→$14 since 2021) but **Lemonade has publicly committed that AI never auto-rejects a claim** — every denial gets human sign-off, largely enforced by state Unfair Claims Settlement Practices Acts.
- Lemonade is **not agent-free**: active independent-agent program; PA and IL market-conduct exams caught unappointed producers writing business, an unlicensed MGA-like affiliate (Lemonade Insurance Agency, LLC), and multi-year undetected renewal-pricing bugs affecting tens of thousands of policies.
- Reinsurance dependence fell from **75% (2020) to ~18% (July 2026)** as loss ratios improved (~160%+ at founding → ~59-60% gross Q2 2026) — the clearest "earn your way to capital efficiency" template.
- Underwriting is **rules-based and coarse at the edges**: the agent guide shows blunt exclusions (any prior decline/cancellation by *any* carrier = auto-decline), and Illinois's regulator found that rule **unlawful** (215 ILCS 5/143.10). Canadian regulators can be expected to scrutinize categorical automated declines the same way.
- Built **in-house**: Maya, AI Jim, CX.AI, Forensic Graph, backend policy system **Blender**, internal ops bot **Cooper**. ("Forge" is not a real Lemonade term — do not carry it forward.) **Bought**: AWS, Pulumi, Guy Carpenter (reinsurance broker), ZestyAI (cat underwriting data), groundcover/Orca/Beacon (observability/security), Fibery/Guru (internal ops), Stripe (payments, per Stripe's own blog).
- **No Canada presence or stated plans found.** Trap: an unrelated Calgary brokerage also uses the "Lemonade Insurance" name (lemonade-insurance.ca, est. 2023) and gets conflated with NYSE:LMND on low-quality aggregator sites.
- Economics at Q2 2026: 3.31M customers, $1.43B IFP, $433 premium/customer, gross loss ratio ~59-60%, **not yet EBITDA-positive** (first positive quarter guided Q4 2026, full-year 2027); adjusted FCF positive 5 straight quarters; headcount roughly flat (~1,100–1,320) since 2022 while premium ~4×'d (IFP/employee $400K→$1.07M).

---

## 1. Stage-by-Stage Journey Map

| Stage | User Experience | Machinery Behind It | Human-in-the-Loop? | Replicable by a Brokerage? |
|---|---|---|---|---|
| **Acquisition / quote (Maya)** | Conversational chatbot ("13 questions" figure is repeated widely but traces to no primary source); homeowners quote pulls property scoring (Building Age, Building Durability, Distance From Coast, Fire Station Proximity) via an **unnamed third-party "partner database"** mid-flow, with an acknowledged outage screen. ~90 seconds is marketing, thinly corroborated. Soft credit check disclosed for HO3. Quotes expire after 90 days. Ineligible addresses get a **live decline message in the quote UI** (hard rules: farms, mobile homes, waterfront, knob-and-tube, vicious dog breeds, prior decline/cancellation by any carrier) — binary instant-issue/instant-decline more than a review queue. ([Tip Sheet PDF](https://appund.com/content/documents/divisions/personalLines/lemonade/LemonadeAgentTipSheet.pdf); [Stripe blog](https://stripe.com/blog/the-future-is-arriving-fast-in-the-insurance-industry)) | Proprietary NLP layer **CX.AI**; unnamed property-data vendor API; soft credit pull; rules-based decline engine | No at quote time (humans only via the parallel agent channel) | **Partially.** Chat quoting UX, question flow, and a decline-rules engine are buildable by a brokerage on a carrier's rating API. What a brokerage cannot do is originate the underwriting appetite itself. |
| **Bind + payment** | **Homeowners cannot bind same-day — future effective date only.** Renters can activate same-day. Policy doc issued instantly by email + in-app ID card. Payment **card/debit only** (no ACH found); lender/escrow billing is manual user data-entry, not a mortgage-servicer integration. A **DocuSign ToS confirmation must be signed by 11PM the day before the effective date or the policy auto-cancels**. Homeowners carry a **60-day post-bind inspection/appraisal window** during which Lemonade can still decline/cancel/non-renew (e.g., roof condition) — "instant bind" is provisional, not final. ([date-of-issue](https://www.lemonade.com/homeowners/explained/date-of-issue/)) | **Stripe** confirmed at platform level (Connect + Optimized Checkout Suite); mortgagee notification is manual back-office email (help@lemonade.com) | Yes for homeowners — 60-day inspection is de facto manual underwriting; mortgagee changes human-processed | **Mostly yes**, with the caveat that actually putting a policy on-risk instantly requires binding authority the carrier grants (MGA-style delegated authority). |
| **Policy management ("Live Policy")** | In-app instant edits to deductible, personal-property/liability/loss-of-use limits (updated docs auto-emailed); cancel anytime pro-rata; change payment method; auto-renewal with ~30-day notice. **"Extra Coverage" (scheduled valuables) is NOT instant** — photo + receipt/appraisal (≤5 yrs) reviewed by a team before activation (engagement rings get 14-day temp coverage pending). Address-change re-underwriting behavior **undocumented**. ([Carrier Management](https://www.carriermanagement.com/news/2017/08/25/170610.htm); [Extra Coverage docs](https://www.lemonade.com/homeowners/explained/scheduled-property-receipts-appraisals/)) | **Blender** backend drives instant coverage edits; scheduled-item review is a manual queue | Yes for Extra Coverage approval; core edits/cancellation self-serve | **Fully replicable UX shell**; instant edit→new-premium recalc needs delegated authority or a live carrier rating API. |
| **Claims (AI Jim / FNOL)** | Video FNOL: honesty pledge → video statement → AI Jim runs anti-fraud checks and pays, declines, or routes to human. Three conflated stats: **~55% fully automated end-to-end** (Claims Journal, Mar 2025); **~30% paid instantly overall** (50%+ pet); **95-96% of FNOL intake** via AI/digital channel. "3-second" (2016) / "2-second" (UK 2023) records are real but self-declared. Escalation triggers (~$10K, structural/liability/water complexity) **[UNVERIFIED — secondary only]**. Cost per claim **$44 (2021) → $14 (2025)**. **AI never auto-rejects — human sign-off on every denial.** Weiss Ratings: Lemonade closed **64% of homeowners claims without payment in 2025** (2nd-highest studied) — Lemonade attributes to renters-heavy, sub-deductible claims. | Fraud: **Forensic Graph** ("18 anti-fraud algorithms" per early marketing); payout to bank account, rail unnamed (funds-clearing 1-2 business days despite instant *decision*) | **Yes, structurally required** — every denial reviewed (company commitment + state UCSPA); complex/high-value → human claims experts, 7-14 day response | **Not replicable at the instant-payout level without carrier authority.** A broker can build equally slick video-FNOL intake handed off to the carrier's claims system; "3-second payment" requires being the risk-bearer. |
| **Retention / lifecycle** | Auto-renewal, ~30-day notice; **ADR 85%** (Q2 2026, depressed by homeowners-book pruning). No retention/win-back flow found on cancellation. Cross-sell: pet (in-house 2020), car (Metromile), life (**brokered, not carried** — Lemonade is sub-agent for **Bestow**; issuing carrier North American Company for Life and Health). Multi-product penetration "more than 5%"; car-to-existing-customer = **40-50% of new car business** Q2 2026. PA/IL exams found multi-year undetected **renewal-pricing bugs** (100% error rate on a 100-file PA sample; roof-age/telematics mis-crediting in IL). | Renewal/rating engine (Blender) | Yes — exams surfaced unappointed producers, unlicensed MGA-affiliate | **Fully replicable** — and Lemonade's life line *is* run exactly as a brokerage would run its whole book. Cleanest existence-proof the cross-sell/retention layer doesn't require carrier status. |
| **Human touchpoints overall** | Despite "no agents" marketing: active independent-agent program (portal, tip sheet, referral incentives); **422 employees (34% of headcount) held claims/producer licenses** (FY2024). AI/APIs sell "98% of policies" per 10-K (vs ~95% industry agent-sold baseline — Lemonade's own comparison invites skepticism). CX: one company post says CX.AI resolves "over half" of inquiries; a 2022 post says roughly two-thirds still reach a human — both are Lemonade's own claims, in tension. | N/A | **Yes, more than marketing suggests** | Lemonade's actual human footprint is structurally closer to a brokerage model than its marketing implies — encouraging for a brokerage-first strategy. |

---

## 2. Underwriting: instant vs. manual split, risk filters, inspections

**No published numeric split** of instant-approve vs. decline vs. refer exists in any Lemonade disclosure.

Three-tier appetite grid from Lemonade's own **Agent Tip Sheet**:

- **"Customers we love"** (best rates): owner-occupied single-family, roof ≤15 yrs, heating/wiring/plumbing ≤30 yrs, zero paid losses in 5 yrs, primary residence, ≥5 miles from coast, protection class 1-8.
- **"Customers to quote"**: roof to 20 yrs, heating to 80 yrs, up to 2 paid losses in 5 yrs, seasonal homes, 1-5 miles from coast (hurricane deductible), rowhouses ≤3 attached, non-vicious dog breeds.
- **"Customers we don't cover"** (auto-decline): farms, modular/mobile homes, waterfront, buried oil/fuel tanks, knob-and-tube/aluminum wiring, non-controlled heat sources (wood/pellet stoves), vacant/under-renovation, LLC-owned, named "vicious" dog breeds, exotic pets, Airbnb/STR use, home daycare, **and any applicant previously declined/cancelled/non-renewed by any carrier for any reason.**

That last rule: **Illinois found it unlawful** under 215 ILCS 5/143.10. Directly relevant to a Canadian build — BCFSA/FSRA can be expected to scrutinize categorical automated-decline rules similarly.

**California wildfire exposure:** January 2025 LA wildfires (Palisades/Eaton): KBW estimated gross loss ~$102.7M (net ~$67.2M after reinsurance), plus $6.9M CA FAIR Plan assessment (Q4 2025 letter). "California wildfire appetite restricted to lower-hazard properties"; coastal wind state-by-state; offshore islands uninsurable.

**Inspections:** No pre-bind inspection. **60-day post-bind window**, requesting inspection report or current appraisal from nearly all homeowners customers. Recurring complaint theme (ConsumerAffairs, secondary): post-bind cancellations over roof type with no claims filed.

**Named underwriting data vendor:** **ZestyAI** (announced Mar 12, 2025) for catastrophe perils. ([ZestyAI announcement](https://zesty.ai/resource/lemonade-insurance-enhances-underwriting)) No confirmed Betterview/Cape Analytics/EagleView/LexisNexis C.L.U.E. use, though "claims will follow the customer not the property" implies some claims-history bureau.

**"Precision underwriting"** claims trace to a **2018 blog post** (100+ data points vs 20-40 traditional; 3x loss-ratio variance within cohorts) — old, unrefreshed; recent materials qualitative only.

---

## 3. Admin backend + internal platform

**Lemonade built its own policy administration system** rather than licensing Guidewire/Duck Creek/Sapiens (S-1, FY2025 10-K, Nov 19, 2024 Investor Day):

| System | Function |
|---|---|
| **Maya** | Customer-facing onboarding/quoting/binding bot |
| **AI Jim** | Customer-facing claims bot |
| **CX.AI** | Customer-service NLP ("Natural Action Synthesis") |
| **Forensic Graph** | Graph-based fraud detection across claims/CX/behavior |
| **Blender** | The policy-admin-equivalent backend spanning CX, underwriting, claims, growth, marketing, finance, risk; claims specialists work queues/coverage determinations/vendor dispatch inside it |
| **Cooper** | Internal DevOps/workflow bot ("their Jarvis") — task assignment, test environments, automated suites, cross-departmental automation |

**"Forge" is not a real Lemonade term** — do not carry it forward.

**Infrastructure (two independent vendor case studies with Lemonade-personnel quotes):** all-**AWS** (Lambda, EKS, RDS/Aurora); **Pulumi** IaC (migrated off Terraform; "a handful of infrastructure engineers" supporting "dozens" of backend engineers — Igor Shapiro); **groundcover** observability; **Orca Security** (12,000+ cloud assets, CISO Jonathan Jaffe); **Beacon Security** data pipeline; **Fibery** planning; **Guru** knowledge base. Rasa possibly underlying some bot tooling (customer-showcase signal, unconfirmed).

**No active technical engineering blog exists** — public content is business/product/investor-facing. No rich engineering trove to mine.

**"Data moat" claims:** partially substantiated. Loss ratio genuinely improved (88%→59% gross over two years); LAE 5% vs ~9% industry is a filed number. But analysts note the 2024 Investor Day gave "one slide on claims" vs "21 charts about telematics" — data advantage used more for pricing precision than demonstrated loss reduction; no source isolates data-volume as causal vs rate increases/tightening/mix. Directionally plausible, not proven.

**Headcount:** 170 by 2019 (Forbes); **1,282 at Dec 31, 2025** (10-K; ~1,321 Mar 2026 per Revelio). Flat since 2022 while IFP ~4×'d; IFP/employee ~$400K→$1.07M.

**Confirmed vendors (the "buy" side):**

| Category | Vendor | Confidence |
|---|---|---|
| Reinsurance broker | Guy Carpenter | Confirmed — SEC 10-Q exhibit |
| Reinsurers | Hannover Rück, MAPFRE Re, Swiss Re America, Aviva, Lloyd's 2791/1084/2001, Tokio Marine Nichido, Travelers Indemnity, Odyssey Re | Confirmed — 10-K + exhibits |
| Cloud / IaC | AWS / Pulumi | Confirmed |
| Observability / security | groundcover / Orca / Beacon | Confirmed |
| Internal tooling | Fibery, Guru | Confirmed |
| Cat underwriting data | ZestyAI | Confirmed — vendor PR |
| Payments | Stripe (Connect + Optimized Checkout Suite) | Platform-level confirmed via Stripe blog |
| Quote-time property prefill | Unnamed "partner database(s)" | Existence confirmed; identity never disclosed |
| E-signature | Possibly DocuSign (ToS countersignature) | [UNVERIFIED] |
| KYC/identity | Unnamed ("authentication providers"; facial recognition/biometric may be used; third-party vendor retrieves driver's license numbers) | [UNVERIFIED] vendor; 2023-24 breach (driver's licenses) confirmed, settled $10.5M |
| Life underwriting | Bestow (Lemonade sub-agent); issuer North American Company for Life and Health | Confirmed — IL exam |
| Core policy admin | None — Blender is in-house | Consistent absence |

---

## 4. Corporate / insurance structure

**Lemonade Insurance Company is a full-stack carrier**, NY-domiciled (incorporated Oct 27, 2015; licensed Sept 15, 2016), now licensed in 40+ states + DC. Not an MGA/fronting arrangement for core US lines.

**Reinsurance quota-share glide path:**

| Effective | % ceded | Note |
|---|---|---|
| July 2020 | 75% | Capital-substitute; Munich Re, Swiss Re, Hannover Re, Nephila |
| July 2021 | 70% | + separate US cat program |
| 2022 | 55% | |
| Through mid-2025 | 55%→45% | |
| July 2025 | 20% | TTM loss ratio ~67%; "capital-generating" |
| July 2026 | ~18% | "Improving costs, coverage, and capital efficiency" |

Plus a Cayman captive ("Lemonade Re") and (FY2024 10-K, single-source) a Bermuda captive-cell retaining most windstorm exposure ($80M per-occurrence/aggregate limit).

**Full-stack buys:** risk selection/pricing/product control with no fronting veto; end-to-end claims (the substrate that makes AI Jim possible); full data loop-closure; easier reinsurance access.
**Full-stack costs:** RBC/statutory capital + reserving; state-by-state licensing + market-conduct exams (PA/IL exams are the concrete cost); retained loss-ratio risk — why the 75%→18% glide was gated on loss ratio proving out first.

**Metromile:** announced Nov 2021 at $500M all-stock; closed July 28, 2022 at **~$145M** after stock decline. Telematics + Metromile Insurance Company's 49-state auto licensing. ~20% staff laid off post-close. Jan 2026: **Tesla partnership** for AV insurance (~50% per-mile cut for FSD).

**Europe:** **Lemonade Insurance N.V.** (Netherlands, DNB-licensed, Solvency II passporting), active in Germany + France. 2022 European GWP €4.3M; current figure **[UNVERIFIED]**.

**UK:** launched Oct 2022 via Aviva partnership, but **June 2023 secured its own PRA carrier license** — Aviva now more reinsurance/capacity partner than fronting carrier. Well-supported synthesis, not primary-verified.

**Canada: no presence, no stated plans, confirmed.** Naming trap: Calgary's unrelated "Lemonade Insurance" (lemonade-insurance.ca).

---

## 5. Economics + scale reference points (Q2 2026 unless noted)

| Metric | Value | Trend |
|---|---|---|
| Customers | ~3.31M | +23% YoY |
| In-force premium | $1.434B | +32% YoY |
| Premium/customer | $433 | $388 (YE24) → $414 (YE25) → $424 (Q1 26) |
| Gross earned premium (qtr) | $332.4M | +32% YoY |
| Revenue (qtr) | $294.4M | +79% YoY |
| Gross loss ratio | 59-60% (net 61%) | From 88% two yrs prior; ~160%+ at founding |
| LAE ratio | 5% (record) | vs ~9% industry |
| Adj. EBITDA (qtr) | $(18.7)-$(19)M | From $(40.9)M Q2 2025 |
| Net loss (qtr) | $(43.4)M | |
| Adj. FCF (qtr) | +$18.8M | 5th consecutive positive |
| FY2026 guidance | IFP +~33%, revenue +~65%, EBITDA $(47)-$(51)M, **Q4 2026 ~+$8M positive** | Full-year positive targeted 2027 |
| IFP/employee | ~$1.07M | From ~$400K two yrs prior |
| Headcount | ~1,282 (Dec 2025) | Flat since 2022 |
| Claims fully automated E2E | ~55% (YE2025) | From ~33% at S-1 |
| FNOL via AI/digital | 95-96% | Intake channel, not resolution |
| Cost per claim | $44 (2021) → $14 (2025) | Pet: $65→$14 |
| CAC financing | General Catalyst: up to 80% of CAC for 16% of premium stream, ~$150M, through Dec 2025 (renewal **[UNVERIFIED]**) | LTV/CAC >3, ~50% IRR, ~24-mo payback |
| Market cap | ~$4.08B (Aug 2026) | ~$48-54/share |

**Read for build-vs-buy:** ~a decade to approach EBITDA breakeven while retaining risk; the reinsurance glide-down is the mechanism that converted proven loss ratios into retained margin. A brokerage sidesteps capital intensity and loss-ratio risk entirely but can't capture that margin-expansion lever.

---

## 6. Replicable by a brokerage vs. carrier-only

**Fully replicable by a brokerage (no carrier license needed):**
- Chat-based quoting UX (Maya-equivalent), including a rules-based appetite/decline engine layered on a partner carrier's actual rules
- Self-serve policy portal: documents, coverage edits within carrier-approved parameters, cancellation, payment methods, renewal notices
- Video/chat FNOL intake handed off to the carrier's claims system
- Cross-sell/bundling UX and lifecycle marketing — **Lemonade's own life line already works this way** (sub-agent for Bestow)
- Retention/renewal comms, pro-rata refund calc (if carrier exposes it), scheduled-valuables documentation workflow

**Requires carrier (or MGA-delegated) authority:**
- **Instant bind** — on-risk in real time is the carrier's decision; even Lemonade doesn't truly instant-bind homeowners (future-dated + 60-day inspection), so the achievable bar for a broker may be close to Lemonade's *actual* homeowners experience
- **Instant claims payment** — requires being the risk-bearer with claims authority
- **Underwriting appetite and pricing** — a broker distributes appetite, doesn't set it (absent full MGA delegated authority, which invites the scrutiny Lemonade's own MGA-like affiliate hit in Illinois)
- **Reinsurance structuring / capital-efficiency gains** — carrier-only lever
- **Full data loop-closure** between pricing and loss experience

**Net strategic read:** Lemonade's operating reality — real agent channel, licensed staff, a brokered life line, provisional homeowners binding, regulator findings against coarse automated declines — is meaningfully closer to a well-built brokerage-plus-AI-UX than its marketing suggests. Most customer-visible magic is buildable without carrier status; the carrier-only pieces map to a "start as broker, earn toward MGA/delegated authority" path that mirrors Lemonade's own reinsurance glide-down logic.

---

## Open questions / confirmed gaps

1. Maya's actual question script (homeowners vs renters) — no source reproduces it; needs a live walkthrough.
2. Identity of the property-data vendor powering homeowners quote-time scoring.
3. Named payment rail for claims payouts; named KYC vendor.
4. Exact instant-approve/decline/refer split at quote stage — not published anywhere.
5. Address-change re-underwriting behavior mid-policy.
6. Precise UK legal structure; current absolute European GWP.
7. Claims adjuster employment structure; actual escalation dollar thresholds (secondary-sourced only).
8. 2024-2025 AI-claim-denial litigation and claimed NYDFS AI-in-claims guidance — single unreachable aggregator source; confirm at docket/primary before relying on it.
9. General Catalyst facility renewal beyond Dec 2025.
10. Early-era loss-ratio figures vary a few points across sources (2017: 161% vs 166%; 2019: 79% vs 86%).

**Direct human pulls worth doing** (403'd to automation): S-1 on EDGAR, Q4 2025–Q2 2026 shareholder letter PDFs, FY2025 10-K.
