# Full-Service Insurance Brokerage: E2E Architecture & Infrastructure Committee Report

*August 16, 2026. Synthesis of five research streams (full reports in `docs/insurance/research/`): [pan-Canadian licensing](research/licensing-pan-canada.md), [Lemonade end-to-end](research/lemonade-e2e.md), [Canadian quote mechanics](research/quote-mechanics-canada.md), plus a second committee pass: [repo gap analysis + 20-phase journey](research/repo-gap-and-journey.md) and the delivered [build/buy/broker responsibility matrix + reference architecture](research/build-buy-broker-architecture.md). **Rev 3** applies the [audit pushbacks](research/audit-pushbacks.md) — 12 corrections separating market access / authority / connectivity, splitting "buildable" from "publicly deployable pre-licence," and fixing economics and partner-matrix claims. Prior context: `docs/legal/INSURANCE-BROKERAGE-STRUCTURES.md`, `insurance-path-status` memory.*

---

## 1. The licensing answer (the question that frames everything)

**A BC-licensed broker cannot sell home insurance across Canada.** Two separate facts:

1. **A broker licence alone does not confer underwriting or binding authority.** The insurer owns the risk and ultimate underwriting responsibility; an insurer *may* contractually delegate defined underwriting and binding functions to a brokerage/MGA while retaining risk and oversight ([ICBC delegated-authority notice](https://www.insurancecouncilofbc.com/licensee-resources/notices/delegated-authority/)). Our brokerage-to-MGA strategy does not require becoming an insurer because we will not carry policy risk.
2. **Distribution licensing is strictly provincial.** Use the insured-property/customer province as a conservative runtime gate — but note the full legal locus for an online business (property, residence, solicitation, licensed entity, where activity is conducted) is counsel work, not a settled single-factor test. Selling to an Ontario homeowner from Vancouver is, conservatively, transacting in Ontario.

Keep four categories permanently separate — the audit's most important correction: **distribution authority** (provincial licences) · **market access/paper** (carrier appointment or MGA/wholesale arrangement) · **binding authority** (contractual carrier delegation) · **connectivity** (BMS/rater/APIs). Buying a BMS supplies connectivity to markets available under an arrangement, never the arrangement itself.

The expansion path is non-resident licensing province by province (CCIR/CISRO harmonized forms make the Prairies + Atlantic cheap; Ontario requires a RIBO "Active Firm" with an Ontario presence and an always-designated Level 3 Principal Broker; Quebec requires AMF firm registration + ChAD certification + a French-language regime that effectively demands a francophone licensed team). Every digital-brokerage comparator confirms the gradient: Surex covers 12 jurisdictions *except* Quebec; YouSet (QC-native) stopped at 2 provinces; Zensurance took ~7–8 years to reach 9 provinces.

**Hard constraint discovered:** BC requires the brokerage's nominee to hold a **Level 3 license, which requires 5-of-last-7 years licensed with 3+ as a Level 2**. We cannot mint our own — "sign a licensed broker" means **hiring an already-qualified Level 3 (or buying a small brokerage that has one)**. The same pattern repeats in Ontario (Principal Broker) and Quebec (francophone team). The dominant licensing cost is staffing gates, not fees (~low-to-mid five figures CAD in total fees; **18–30 months to genuine 10-province coverage**).

**Dead end confirmed:** BC's Restricted Insurance Agent regime (Jan 1, 2027) excludes home insurance and is limited to incidental sellers — not a path for us.

**Recommended sequence:** BC (hire Level 3 nominee, open brokerage, MGA wholesale paper) → AB/SK/MB/Atlantic non-resident (months 6–12) → Ontario RIBO (months 9–18, start Principal Broker recruiting early) → Quebec last (year 2+).

---

## 2. What Lemonade actually is (corrections to our mental model)

Lemonade is a **full-stack carrier** — that single fact powers everything a brokerage cannot copy. But the research materially deflates the "instant everything" story, in ways that *help* us:

| Marketing story | Operating reality |
|---|---|
| 90-second quote | Weakly corroborated; homeowners flow depends on an unnamed property-data prefill vendor with a documented outage mode |
| Instant bind | **Homeowners cannot bind same-day** — future-dated only, plus a **60-day post-bind inspection window** where Lemonade can still cancel. Renters bind same-day |
| AI claims in 3 seconds | ~55% of claims fully automated E2E; ~30% paid instantly; **AI never auto-rejects — every denial gets human sign-off** (legally driven) |
| No agents, no humans | Active independent-agent program; 34% of staff hold producer/claims licenses; regulators caught unappointed producers and an unlicensed MGA-like affiliate |
| Precision AI underwriting | Rules-based appetite grid with blunt exclusions; Illinois found "any prior decline by any carrier = auto-decline" **unlawful** — a warning for automated declines under BCFSA/FSRA too |

**The strategic gift:** Lemonade's *actual* homeowners experience — future-dated provisional bind, human-reviewed edge cases, manual mortgagee handling — is a bar a **brokerage with a good carrier partner can realistically match**. And Lemonade's own life-insurance line is run exactly as a brokerage (sub-agent for Bestow) — an existence-proof inside Lemonade that the model works.

**What only a carrier can do:** instant claims payout, setting underwriting appetite, the reinsurance capital-efficiency lever (their 75%→18% quota-share glide-down), full pricing↔loss data loop. **What a brokerage can fully replicate:** chat quoting UX, rules-based triage engine, self-serve policy portal, video FNOL intake (handed to carrier claims), cross-sell/retention lifecycle.

**Stack notes for our build:** Lemonade built Maya/AI Jim/CX.AI/Forensic Graph/Blender (policy backend)/Cooper (ops bot) in-house; bought AWS, Pulumi, Stripe, Guy Carpenter, ZestyAI, groundcover/Orca. Headcount flat ~1,100–1,320 since 2022 while premium 4×'d. Not yet EBITDA-positive (guided Q4 2026). No Canada presence or plans — the "Lemonade Insurance" in Calgary is an unrelated brokerage with a coincident name.

---

## 3. The target-state user journey (Property Insights, BC seam)

What the full self-serve journey looks like once licensed, stage by stage. "Ship gate" = what must be true before that stage can go live.

| # | Stage | User experience | Machinery | Ship gate |
|---|---|---|---|---|
| 1 | **Discovery** | Property analysis → insurance module on listing pages, /insurance landing | Existing affiliate surfaces (repo default stage=landing; prod verified at stage=intake 2026-08-15 — reconfirm via prod config + smoke tests) | Deployed |
| 2 | **Coverage profile** | Wizard: address/line/occupancy + underwriting questions, prefilled from our listing + assessment data | Existing wizard + `coverage_profiles` (needs systems-block expansion, §5) | Deployed (same confirmation caveat) |
| 3 | **Instant indicative range** | "Homes like this in Kelowna typically run $1,400–$2,100/yr" — labeled estimate, never a quote | Our data + rate heuristics | **Buildable now; NOT cleared for public pre-licence deployment** — a personalized address-based range may itself be "insurance activity" under BC referral rules; counsel/partner approval required (see gate table in [audit-pushbacks.md](research/audit-pushbacks.md) §3) |
| 4 | **Real quote** | Priced, bindable premium in-flow | Licensed-only: Opta iClarify prefill, HITS claims pull, FUS protection class, carrier/MGA rating API or ARS | **Brokerage license + market access** |
| 5 | **Triage** | Clean risk → proceed to bind; flagged → "a broker will call you today"; hard → set expectations (days, inspection) | Rules engine over the §4 flag taxonomy; wildfire-moratorium postal-code hold | License + rules engine (engine buildable now) |
| 6 | **Bind + payment** | Effective-date pick (expect future-dated, like Lemonade homeowners), card payment, instant policy docs, mortgagee clause capture | Carrier binding authority (via MGA delegated or carrier appointment), Stripe-style payments, e-signature | License + binding authority |
| 7 | **Policy management** | Portal: view docs, adjust deductible/limits within carrier parameters, cancel pro-rata, renewal notices, payment methods | Self-serve portal over carrier/BMS APIs; BMS (Applied Epic / PowerBroker) likely required for carrier connectivity (CSIO eDocs) | License + BMS |
| 8 | **Claims intake** | FNOL in our UX (form/video), status tracking; adjudication and payout are the carrier's | FNOL intake + handoff; carrier claims system does the rest | License (payout speed is carrier-bound) |
| 9 | **Lifecycle** | Renewal repricing review, remarketing at renewal (the broker's actual value-add), cross-sell (tenant→homeowner→landlord), win-back | Renewal automation (cf. Quandri), email/analytics stack we already run | License |

The human-in-the-loop is not a failure mode — it's stage 5 working as designed. Lemonade itself keeps humans at exactly these points.

---

## 4. Instant-offer vs. manual-review: the triage model

A bindable quote needs 5 data blocks (applicant, construction, systems, protection class, loss history + coverage selections). The **licensed wall**: Opta iClarify (construction prefill), HITS (claims history), FUS grades, and every rating engine are sold to licensed brokerages/insurers only. Our data substitutes for parts of the construction block only.

**Full flag taxonomy** (detail + citations in [quote-mechanics-canada.md](research/quote-mechanics-canada.md)). Summary of what knocks a risk out of instant:

- **Refer (same-day broker callback):** roof 20–25yr; 2+ claims in 5yr (water especially); above-ground oil tank; WETT-certified wood stove (carrier-dependent); prior cancellation for non-payment; vacancy; STR (specialty markets exist); replacement cost >$1M–1.5M; log/heritage construction; 3+ unrelated tenants or 5+ units; home-based business; aged "4-line" systems (roof/wiring/plumbing/heating ~30–40yr no updates); premium above carrier's internal authority threshold.
- **Decline from standard markets (specialty or remediation only):** buried oil tank (until removed + soil test); knob-and-tube wiring (until replaced, some carriers); un-WETT'd wood stove (the single most common decline); prior cancellation for misrepresentation; roof 25yr+ at some carriers.
- **Regional mechanics, BC-specific:** earthquake endorsement is near-universal with a **10–15%-of-insured-value deductible** (pricing mechanic, not a decline); **wildfire binding moratoriums** freeze new business near active fires each summer (insurer-specific, postal-code/FSA level, renewals unaffected) — our flow needs a "temporarily unavailable in your area" state, which is a fail-loud UX obligation, not an edge case (126 active BC fires as of today).

**Expected BC book split** (low confidence, no public dataset): ~50–65% clean/instant-eligible, ~25–35% same-day referral, ~10–15% multi-day (inspections/remediation). Grounding: ~6–10% of Canadian homes are already water-damage-uninsurable. **Planning restriction (audit):** these percentages — and the "~12–18 remaining questions" estimate in §5 — are demo scenario coverage and UX hypotheses only. Do not use them for conversion forecasts, broker staffing, SLA capacity, revenue models, or investor claims.

**Speed ladder:** (i) indicative range <5s from our data (buildable now, unlicensed); (ii) bindable in minutes via rating API for clean risks (licensed); (iii) same-day-to-5-business-day licensed review for flagged; (iv) days-to-weeks for hard risks (inspection/remediation/specialist market). Lemonade's own numbers say even the best-in-class carrier runs a version of this ladder.

**Thresholds are configuration, not constants (second-pass ruling).** The specific numbers in the taxonomy above (roof >20–25yr, 2+ claims, $1–1.5M) are *typical patterns*, not universal rules — actual cut-offs are carrier, product, geography, and delegated-authority rules. Encode them as versioned configuration with effective dates per carrier/product, never hardcoded product assumptions. One addition from the second pass: **extensive glass** is not a standalone decline rule — it raises reconstruction cost and custom-home complexity, landing risks in high-value review. And the quote UI must always show the blocking item, its owner, and the next expected update via explicit states (`Estimate` → `Checking markets` → `Pending broker review` → `Inspection required` → `Bindable quote` → `Bound` → `Issued` / `No available market`) — never an indefinite spinner.

---

## 5. Is our profile stack sufficient? (gap ledger)

**Hold today:** address, province, line, occupancy (incl. STR/vacant), unit count, claims-count bucket, roof-age bucket, year built/beds/baths/sqft/type (listing prefill), assessment + estimated value, contact, expiry month, consent.

**Verdict: lead-qualification and pre-triage grade; NOT sufficient for a bindable quote — and not yet true triage-grade either** (it lacks major systems, claims details, replacement cost, hazard/protection data, prior-insurance history, mortgagee, and any carrier-specific appetite; triage-grade arrives only after the common-facts expansion below *plus* carrier-configured decision rules). Three gap classes:

1. **Add to wizard (unlicensed, just disclosures):** construction type; heating type/fuel; wood stove + WETT status; wiring type; panel amperage; plumbing material (Poly-B!); oil tank presence/age; vacancy day-count; home-based business; mortgage/lienholder; prior insurer + claims detail (type/date, not just count); DOB (+ credit consent where permitted); coverage selections (dwelling limit, deductible, liability, sewer backup / overland water / earthquake endorsements).
   *Design note: don't front-load all of these — ask the systems block conditionally (old homes only) and let triage decide when detail is needed.*
2. **Derivable hints, never facts:** listing description NLP can pre-flag "wood stove"/"heritage"/"poly-B replaced" to trigger targeted questions. Assessment value ≠ replacement cost — a real RCT (Opta, CoreLogic/Cotality, e2Value) is required for the quote path; our value data feeds the indicative range only.
3. **Licensed integrations (the wall):** Opta iClarify prefill, HITS claims pull, FUS protection class, carrier/MGA rating API or Applied Rating Services, CSIO/BMS connectivity.

**Even with everything prefilled, expect ~12–18 user-answered questions to reach bindable** — comparable to Square One's ~5-minute flow. Our edge is not fewer questions; it's arriving pre-qualified with property context, honest triage, and the analytics relationship.

---

## 6. Staged operating model (how the seam opens)

| Stage | What we are | Revenue | Status |
|---|---|---|---|
| 0 | Referral/affiliate (Square One pinned BC/AB/SK/ON paid scope; APOLLO per the registry's verified matrix: 9 provinces BC/AB/SK/MB/ON/NB/NS/PE/NL, no territories/QC, **$25 payout confirmed for the tenant line only** — homeowner/landlord/commercial payouts unconfirmed, and APOLLO's terms say the reward "is not a commission, referral fee, or compensation for the sale"; registry copy "no phone call needed" needs reverification post-Gallagher) | $25–175/policy on confirmed lines | **Deployed** (prod stage=intake verified 2026-08-15; reconfirm) |
| 1 | + Expanded wizard + the **insurance transaction kernel** (see §7): canonical case + versioned submission through a **provider-neutral adapter** — synthetic acknowledgement in demo, authenticated external acknowledgement once a contracted endpoint exists (there is no partner API today; the first real connection could be carrier/MGA REST, BMS API, portal submission, CSIO transaction, or a human broker queue with structured export). Public deployment of personalized pricing/recommendations stays gated on counsel (§3 above) | Same referral fees, better conversion once a contracted submission path exists | Kernel buildable now; public surfaces counsel-gated |
| 2 | **Licensed BC brokerage** (hired Level 3 nominee or acquired shell) + **market access via insurer appointment or MGA/wholesale arrangement** (the BMS provides connectivity to those markets, never the paper itself), Opta/HITS/rating access, bind in our UX | ~20% of premium, segment economics (repo legal doc): homeowner ~$1,800 premium → **$324–450 gross**; landlord ~$2,300 → $414–575; strata/commercial $7.2k–37.5k/building — the licensed-vs-referral delta on the same click is 16–23× on landlord; $2.5k+/policy exists only in strata/commercial/high-value segments | 6–12 months once nominee secured |
| 3 | Non-resident expansion (AB/SK/MB/Atlantic → ON → QC) | Same, wider TAM | +6–24 months |
| 4 | MGA/delegated authority (bind + maybe claims-handle under carrier delegation) — the APOLLO playbook (2017 founding → 2021 own brokerage → 2026 Gallagher exit) | Program economics | Year 3+, optional |

Full-stack carrier (Lemonade's actual model) is explicitly out of scope: capital requirements, loss-ratio risk, and a decade-to-breakeven curve for a team of our size. The brokerage → MGA path captures most of the UX and a meaningful revenue step-up without balance-sheet risk.

---

## 7. Build vs. buy vs. broker — resolved (second-pass verdicts)

The follow-up analysis this report originally framed has been delivered — full responsibility matrix, reference architecture, state machines, vendor shortlist, and procurement position in [build-buy-broker-architecture.md](research/build-buy-broker-architecture.md). The portfolio verdict:

- **Build (ours):** customer experience, canonical insurance record (case/submission/quote/policy/claim projections — first-class entities, not an ever-growing `coverage_profiles` JSONB), consent + disclosure ledger, property intelligence/enrichment orchestration, adaptive questionnaire mapped to carrier schemas, runtime licence/appointment/authority engine, case workflow definitions, provider adapter gateway, customer portal, broker workbench, FNOL shell, immutable audit ledger.
- **Buy (conditionally):** ONE Canadian BMS/rater as the brokerage core — **Acturis Canada vs. Applied Epic + Applied Rating Services** is the shortlist, but **commit only after the licensed operating entity and market-access relationship are known**: a sub-broker arrangement may mandate the host's BMS, an MGA white-label may dictate the platform (possibly BrokerLift), a carrier-embedded start may run on the carrier portal/API before any BMS. Scripted demos can start now; the BMS is an adapter and operational system, never our canonical customer/consent record. Also buy: durable workflow infra (Step Functions-class), Canadian document plane (S3 ca-central-1 + KMS + Object Lock), e-sign, property/rebuild/hazard data (**Verisk/Opta iClarify** — strongest Canadian lead), identity, communications, observability. **A BMS purchase supplies connectivity, never market access** — paper comes only from an insurer appointment or MGA/wholesale arrangement.
- **Broker-owned:** licensing, advice, supervision, market access, manual underwriting, broker-conduct complaints.
- **Carrier/MGA-owned:** product, appetite, rating, bind confirmation, policy record + wording, billing (carrier-direct first — avoids trust accounting), claims decisions, claim payouts.
- **Defer:** any PAS (Socotra-class is a future-MGA question), independent rating engine, premium trust accounting, claims core (Sedgwick/ClaimsPro/Crawford are operating-partner RFP candidates when needed), automated adverse decisions, delegated settlement.

Two hard rules from the second pass: **only a provider-authenticated carrier response may create `QUOTED`/`BOUND`/`ISSUED` states**, and **missing or stale authority data hard-stops the operation** (province, licence, appointment, delegated limits, moratorium state evaluated on every consequential action).

**Partner correction:** **Square One is not a viable brokerage market or quote/bind API under its current public distribution model** — it publicly states it does not authorize third-party brokers to sell its policies ([source](https://www.squareone.ca/resource-centres/fraud-protection/unauthorized-brokers)). Treat it as affiliate/direct fallback unless Square One expressly contracts otherwise (its model could change; "currently unavailable," not "can never"). Note it calls itself a licensed *agent*, not a broker — model every counterparty by actual role (`AFFILIATE / REFERRER / BROKERAGE / AGENCY / MGA / INSURER / RATER / BMS / TPA / ADJUSTER`); the generic "licensed broker" framing in current UI copy is too coarse. Stage-2 market access = insurer appointment or MGA/wholesale arrangement, with the BMS providing connectivity to whatever markets that arrangement opens.

**The corrected immediate build target — the insurance transaction kernel** (useful before and after licensing, survives whichever broker/MGA/carrier/BMS/TPA agreements Phase 0 produces): canonical `insurance_case` · versioned `submission` · field-level evidence + user attestation · consent/disclosure artifacts · submission/quote/policy/claim state machines · authority model · durable outbox + webhook inbox · broker task queue + customer status timeline · provider-neutral interfaces · synthetic providers running the 23 failure/lifecycle scenarios (moratorium, webhook dedup, bind failure, claim-status conflict, …) · demo hard-stops ("no insurance is offered, bound, adjusted, or paid" banner, no real premiums/payments/wording, destination allowlist, environment isolation) · contract tests every future provider adapter must pass.

**Delayed until authority/partner review (build as demo, do not publicly deploy):** personalized indicative pricing, coverage recommendations, real triage/decline statements, expanded coverage-selection UI, named BMS integration, real broker/carrier submission, bind/payment controls, operative policy and claims communications.

**Remaining unknowns (procurement-only — no further desk research will resolve them):**
- **The #1 regulator question:** does a fully self-serve quote-and-bind flow satisfy BC "supervision"/suitability obligations, or is a licensed-human touchpoint required per transaction? Ask Insurance Council of BC / counsel directly.
- Acturis vs. Applied scripted demos against the §13 contractual/API package (named BC-home carrier panels, quote round-trip, export rights, sandbox).
- Verisk/Opta enterprise outreach: API, pricing, sandbox, whether they sell to a newly-licensed digital brokerage at startup volumes.
- APOLLO post-Gallagher: does any instant-bind personal-lines API survive for partners? (Feeds the Aug 19 Obie-week APOLLO thread.)
- Carrier/MGA volume commitments for a new brokerage; BC E&O minimums (mortgage-brokerage proxy = $500k/$1M); provincial credit-scoring rules for property lines.

---

*Full citations and [UNVERIFIED] flags live in the three research reports. Nothing in this synthesis should be treated as legal advice; the licensing and compliance sections are research inputs for counsel, not conclusions.*
