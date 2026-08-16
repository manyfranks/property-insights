# Audit of the E2E Committee Synthesis: 12 Pushbacks

*August 16, 2026. External audit pass provided by Matt on the rev-2 synthesis. Verdict: directionally excellent (~80–85% ready to sequence); architecture verdict sound; operating-model language occasionally turned qualified research into unsafe absolutes. All 12 corrections were applied to [E2E-COMMITTEE-REPORT.md](../E2E-COMMITTEE-REPORT.md) rev 3 same day. Repo-fact claims (#7, #8, #12) were independently re-verified against `affiliate-vendors.ts`, `INSURANCE-BROKERAGE-STRUCTURES.md`, and `insurance-stage.ts` before applying.*

## Confirmed solid (unchanged)

Provincial licensing with no national shortcut · broker licence ≠ binding authority · profile not quote-grade · thresholds as versioned carrier config · only authenticated carrier responses create QUOTED/BOUND/ISSUED · build the experience/record/consent/authority/workflow/adapter layers · carrier owns product/rates/binding/policy/billing/claims initially · defer PAS/claims core/trust accounting/automated adverse decisions · build the production-shaped synthetic demo now · Square One not available as brokerage paper under current model · durable case workflow replaces email + `vendor_id` click attribution.

## The 12 corrections

1. **Acturis/Applied do not provide market access.** Keep four categories separate: distribution authority (provincial licences) · market access/paper (carrier appointment or MGA/wholesale arrangement) · binding authority (contractual carrier delegation) · connectivity (BMS/rater/APIs). A purchased BMS supplies connectivity to markets available under an arrangement — never the arrangement itself. Make the boundary explicit in the architecture and procurement RACI.
2. **"Brokers never underwrite" is too absolute.** Correct form: a broker licence alone does not confer underwriting or binding authority; an insurer may contractually delegate defined underwriting and binding functions while retaining the risk and oversight responsibility ([ICBC delegated-authority notice](https://www.insurancecouncilofbc.com/licensee-resources/notices/delegated-authority/)). Likewise "we never need an insurer licence" → "the brokerage-to-MGA strategy does not require becoming an insurer because we will not carry policy risk."
3. **Buildable ≠ publicly deployable pre-licence.** BC bars unlicensed referrers from conducting insurance activities, including discussing product merits or the customer's insurance needs ([ICBC referral rules](https://www.insurancecouncilofbc.com/licensee-resources/licensee-responsibilities/)). A personalized address-based premium range, coverage-limit selection, or "this home needs X" could cross that line even labelled "estimate." Split the gate per capability:

   | Capability | Build now | Public pre-licence |
   |---|---:|---:|
   | Synthetic indicative range | Yes | Counsel/partner approval required |
   | Generic regional premium content | Yes | Possibly, if genuinely non-personalized |
   | Property facts intake | Yes | Likely, with approved scripts and consent |
   | Coverage recommendations | Yes as demo | No |
   | Coverage-limit/deductible selection | Yes as demo | Licensed-flow functionality |
   | Deterministic referral simulator | Yes | Never present as a real underwriting outcome |
   | Broker lead submission | Yes | Only under an executed referral/data-sharing arrangement |

   Related to but distinct from the Level 1 self-serve supervision question; both need counsel.
4. **There is no authenticated partner API yet.** It's the target, not a fact. Build the provider-neutral pieces first: canonical `Submission`, `SubmissionProvider` interface, synthetic adapter, durable outbox, webhook inbox, delivery-acknowledgement model, broker case queue, customer status timeline. The first real connection could be a carrier/MGA REST API, BMS API, BrokerLift workflow, secure portal submission, CSIO transaction, or a human-assisted broker queue with structured export — the architecture must accommodate all. Correct outcome statement: "versioned submission through a provider-neutral adapter; synthetic acknowledgement in demo, authenticated external acknowledgement once a contracted endpoint exists."
5. **"Buy exactly one BMS" is conditional, not immediate.** Sub-broker/branch → the host brokerage's BMS may be mandatory; new brokerage → we procure; MGA white-label → the MGA may dictate the platform; carrier-embedded → the carrier portal/API may precede any BMS. Buy the brokerage core only after the licensed operating entity and market-access relationship are known. Scripted Acturis/Applied demos can start now, but the BMS is an adapter and operational system, never the canonical customer/consent record.
6. **Square One: "not currently available," not "can never."** Its current public model bars third-party brokers; it could change or negotiate. Also model counterparties by actual role (`AFFILIATE / REFERRER / BROKERAGE / AGENCY / MGA / INSURER / RATER / BMS / TPA / ADJUSTER`) — Square One calls itself a licensed *agent*, not a broker; generic "licensed broker" UI framing is too coarse.
7. **"APOLLO commercial + rest-of-CA" was inaccurate.** Registry truth (`affiliate-vendors.ts`, re-verified): affiliateRegions = 9 provinces (BC/AB/SK/MB/ON/NB/NS/PE/NL), no territories, no QC; the confirmed $25 reward methodology is **tenant-only** — homeowner/landlord/commercial payouts unconfirmed; APOLLO's own terms say the reward "is not a commission, referral fee, or compensation for the sale" (label under legal review). Live copy inconsistency: registry description still says "online quote and policy in minutes, no phone call needed" vs. post-Gallagher advisor-assisted research — reverify before relying on it in the active experience.
8. **The $10k-premium / $2.5k-commission example is misleading.** Repo economics (`INSURANCE-BROKERAGE-STRUCTURES.md`): homeowner ~$1,800 premium → $324–450 gross commission; landlord ~$2,300 → $414–575; small strata ~$40k → $7.2k–10k; large strata ~$150k → $27k–37.5k. $2.5k/policy maps to strata/commercial/high-value only. Model standard homeowner, landlord/high-value, and strata/commercial as separate segments.
9. **The profile is lead-qualification/pre-triage grade**, not triage-grade — it lacks major systems, claims details, replacement cost, hazard/protection data, prior-insurance history, mortgagee, and carrier-specific appetite. Triage-grade arrives only after the common-facts expansion plus carrier-configured decision rules.
10. **Synthesized percentages are demo scenario coverage only.** 50–65 / 25–35 / 10–15 and "12–18 remaining questions" must not drive conversion forecasts, staffing, SLA capacity, revenue models, or investor claims.
11. **"Where the risk lives" is a conservative runtime gate, not the complete legal test.** Online-business jurisdiction can involve insured property, customer residence, solicitation, licensed entity, and where activity is conducted — counsel work. RIBO firm/PB requirements directionally confirmed ([RIBO](https://www.ribo.com/getting-a-license/brokerage-licenses/)).
12. **"Live now" isn't demonstrated by the repo alone.** Checked-in dev config is `NEXT_PUBLIC_INSURANCE_STAGE=landing` (`insurance-stage.ts`); prod was verified at `intake` on 2026-08-15 per project memory — phrase as "affiliate surfaces exist; deployment stage confirmed against production configuration and smoke tests," and keep re-confirming.

## Corrected immediate build target

Not "send today's profile to a partner" — an **insurance transaction kernel** useful before and after licensing:

1. Canonical `insurance_case`
2. Versioned `submission`
3. Field-level evidence + user attestation
4. Consent/disclosure artifacts
5. Submission/quote/policy/claim state machines
6. Authority model
7. Durable outbox + webhook inbox
8. Broker task queue + customer status timeline
9. Provider-neutral interfaces
10. Synthetic providers + the 23 failure/lifecycle scenarios
11. Demo hard stops + environment isolation
12. Contract tests every future provider adapter must pass

**Delay until authority/partner review:** personalized indicative pricing in public, coverage recommendations, real triage/decline statements, expanded coverage-selection UI in public, named BMS integration, real broker/carrier submission, bind/payment controls, operative policy and claims communications.

## Bottom line

Revise vocabulary and gates; don't reject the blueprint. The two most consequential changes: (1) separate market access, authority, and connectivity; (2) define Phase 1 as a provider-neutral synthetic transaction platform — not a real partner API integration or a publicly deployable unlicensed quote experience. With those, the work built now survives whichever broker, MGA, carrier, BMS, or TPA agreements Phase 0 produces.
