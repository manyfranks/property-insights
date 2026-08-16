# Research Committee Second Pass: Repo Gap Analysis & Full 20-Phase Journey

*August 16, 2026. External committee pass provided by Matt — repo-grounded gap analysis of the current insurance seam plus the full customer journey with state models. Complements [E2E-COMMITTEE-REPORT.md](../E2E-COMMITTEE-REPORT.md); supersedes its §3 journey table in granularity.*

## Conclusion

Property Insights has a strong acquisition and prefill seam, but it is not yet connected to an insurance transaction system. Today it captures a compact coverage profile, saves it, emails the operator, and opens an affiliate partner's site. No profile data is transmitted to a broker or carrier rating engine, and the repo has no quote, underwriting, bind, policy, billing, renewal, claims, payout, or broker-workbench state.

The strategic path is not "build Lemonade in Canada." Lemonade is a vertically integrated insurer. The practical Canadian model:

> Own the digital journey and customer record; let licensed insurers/MGAs own rates, underwriting authority, policy risk, and initially claims settlement.

### The licensing answer

No — a BC general-insurance licence is not Canada-wide.

- Individuals and usually the brokerage entity need appropriate provincial/territorial licences. CCIR/CISRO simplifies non-resident applications but creates no national licence. [CCIR/CISRO](https://www.ccir-ccrra.org/Agent_BrokerApplications)
- A broker licence permits broking within its scope. It does not confer underwriting or binding authority — that must be expressly delegated by an authorized insurer or MGA agreement. [BCFSA delegated-functions report](https://www.bcfsa.ca/media/3767/download), [Insurance Council of BC](https://www.insurancecouncilofbc.com/licensee-resources/notices/delegated-authority/)
- The brokerage entity needs its own authorization, nominee/supervisory structure, and at least one insurer relationship. [ICBC agency licensing](https://www.insurancecouncilofbc.com/getting-a-licence/general-insurance/agency-insurance/)
- Claims adjustment and settlement are separately regulated — a sales/broker licence is not claims authority.
- Quebec is a separate expansion program: AMF registration, French-language requirements, privacy rules, and a documented three-unaffiliated-quote capability or reasonable efforts for applicable personal-lines brokerage activity. [AMF](https://lautorite.qc.ca/en/professionals/firms-representatives-and-independent-partnerships/obligations-and-administrative-procedures/qualification-of-damage-insurance-registrants)

## What the repo has today

Stack suitable for acquisition and an early broker-assisted MVP: Next.js 16, Clerk, Vercel, Neon Postgres, Upstash, Resend, PostHog/Vercel analytics, feature-gated regional and partner routing.

The four-step wizard captures: address, province, coverage line; broad property type, year built, beds/baths/sqft; assessment-derived value; occupancy and approximate unit count; claims count over five years; approximate roof/system age; current coverage-expiry month; name, email, phone, consent.

Decisive seams:

- `src/components/insurance/coverage-prefill.ts:84`
- `src/components/insurance/coverage-profile-wizard.tsx:478`
- `src/components/insurance/coverage-handoff.tsx:80`
- `src/lib/db/coverage-profiles.ts:281`
- `src/lib/db/schema.sql:186`

The current profile is sufficient for: lead qualification, product/province routing, coarse straight-through-vs-review triage, prefilling the beginning of a broker application. **It is not sufficient to produce a bindable home-insurance quote.**

Specific repo limitations:

- The partner link carries attribution, not the coverage-profile payload.
- `vendor_id` means "outbound link clicked," not "broker received," "quoted," or "bound."
- Address lookup only searches properties already tracked in the application.
- Flood, wildfire, and wind fields exist but are always submitted as `null`.
- Claims are captured only as a count.
- Roof age is approximate and effectively conflated with broader "systems" language.
- User-corrected fields retain group-level "known/modeled" provenance rather than becoming user-attested facts.
- Operator notification is email, not a durable case queue.
- No submission idempotency, carrier transaction ID, workflow status, retry, SLA, or reconciliation exists.

## Is the profile stack quote-ready?

| Domain | Current readiness | What must be added |
|---|---|---|
| Applicant | Low | Legal named insured, DOB where required, co-applicants, ownership interest, mailing address, identity verification |
| Property identity | Partial | Normalized address, postal code, unit/parcel identity, geocode, property-record match, user attestation |
| Building | Low | Construction type, storeys, foundation/basement, living/finished area, exterior, attached structures/outbuildings |
| Major systems | Absent | Electrical service/wiring/panel, plumbing material, heating/fuel, hot-water tank, renovation/replacement years |
| Roof | Low | Material, replacement year, condition, slope, prior damage and documentation |
| Water/fire protection | Absent | Sump pump, backwater valve, leak detection/shutoff, alarms, sprinklers, hydrant/fire-hall protection |
| Use/occupancy | Partial | Primary/secondary, duration vacant, tenants, STR details, home business, renovations |
| Loss history | Low | Date, cause, peril, amount, open/closed status, corrective work, prior insurer |
| Insurance history | Low | Prior carrier, years continuously insured, lapse, cancellation/non-renewal/non-payment reasons |
| Exposure | Absent | Carrier-approved wildfire/flood/sewer/coastal/earthquake/fire-protection data |
| Replacement cost | Absent | Insurer-approved reconstruction-cost calculation; assessment or market value is not an adequate substitute |
| Coverage selection | Absent | Dwelling/contents/ALE/liability limits, deductibles, endorsements |
| Interests | Absent | Mortgagee, loss payee, additional insured/interested parties |
| Compliance | Partial | Versioned disclosures, recipient-specific consent, credit/claims consent, application attestation, e-delivery |
| Quote transaction | Absent | Carrier request/response schema, quote version, conditions, expiry, referral reason, bind token |

The next integration contract should be a canonical `Submission` object mapped into each carrier/MGA's schema — not another generic JSON blob.

## Full customer journey (20 phases)

| Phase | Customer experience | System and operating action | Exception path |
|---|---|---|---|
| 1. Discover | Enter address and intended use | Normalize address; determine province, product, operating eligibility | Unsupported jurisdiction/product → waitlist or licensed referral |
| 2. Prefill | See known facts with provenance | Enrich property and hazard data; record source, age, confidence | Low-confidence/conflicting data → require correction |
| 3. Consent | Understand who receives what data and why | Store recipient, purpose, exact disclosure version, timestamp | Credit, marketing, claims-history, quote consent handled separately |
| 4. Adaptive interview | Answer only questions not reliably known | Branch by product, carrier appetite, prior answers | Save-and-resume; explain why sensitive questions are needed |
| 5. Triage | "Checking available markets" | Deterministic rules select eligible carriers, detect referrals | Do not label an early indication as a quote |
| 6. Submit | Application sent once | Idempotent carrier/MGA requests; retries; reconciliation | Timeout → pending status, never duplicate submissions |
| 7A. Bindable quote | Review insurer, coverage, premium, tax, deductible, conditions | Persist carrier-confirmed quote, wording/form/rate versions, expiry, bind conditions | Expiry or fact change → re-rate |
| 7B. Referral | See what requires review and expected timing | Broker/underwriter case with standardized reason and SLA | Request documents, inspection, photos, clarification |
| 7C. Inspection | Upload photos or schedule inspection | Manage inspection order, vendor, findings, remediation | Quote conditional until carrier clears it |
| 7D. No offer | Honest availability outcome | Preserve carrier reason internally; offer alternate licensed route | Avoid unsupported/misleading adverse explanations |
| 8. Selection | Adjust deductibles/limits, preview revised price | Re-rate approved changes; show coverage differences | Non-standard change → underwriting referral |
| 9. Bind | Attest facts, choose effective date, sign, pay | Verify licence/appointment/authority; carrier confirms bind | Payment acceptance alone must not imply coverage is bound |
| 10. Issue | Receive binder, declarations, wording | Generate/deliver documents and proof; record delivery evidence | Correct errors via controlled endorsement/reissue |
| 11. Onboard | Dashboard: policy, billing, important actions | Customer/policy/mortgagee view and renewal schedule | Failed e-delivery → retry + human follow-up |
| 12. Service | Download proof, update payment, request changes | Straight-through low-risk endorsements; queue material changes | Show "requested" / "under review" / "effective" |
| 13. Billing | View installments and payment status | Carrier-direct billing initially; dunning/notices | If brokerage collects premiums, trust accounting becomes mandatory |
| 14. Renewal | Review upcoming premium and changes | Refresh risk data, re-rate, notices, remarketing | Inspection, non-renewal, market exit → broker queue |
| 15. Cancel/exit | Request cancellation, see refund status | Validate effective date, mortgagee notices, return premium | Warn about coverage gaps and outstanding claims |
| 16. FNOL | Report emergency/loss, upload photos/receipts | Validate policy/date/peril; create claim; route to carrier/adjuster | Emergency vendor guidance ≠ coverage approval |
| 17. Claim review | Track requests and assigned handler | Coverage, severity, fraud triage; adjuster/TPA assignment | Suspicion → human investigation, not automatic denial |
| 18. Settlement | Reasoned approval, partial approval, denial | Authority checks, reserves, payment, reconciliation, decision letter | Complaint, appeal, ombuds, reopen paths |
| 19. Recovery | Follow repair/replacement and final payment | Vendor management, depreciation recovery, subrogation, salvage | Failed payment/disputed scope → controlled reissue/review |
| 20. Post-claim/renewal | See how the claim affects the relationship | Update risk record and renewal workflow | Never silently change eligibility without required notice |

Persistent quote UI states: `Estimate` · `Application incomplete` · `Checking markets` · `Pending broker review` · `Inspection required` · `Bindable quote` · `Quote expired` · `Bound` · `Issued` · `No available market`.

## Where "instant" breaks

**There are no safe universal public thresholds** ("two claims," "roof older than 20 years," "premium over $5,000"). Those are carrier, product, geography, and delegated-authority rules. **They should be configuration with effective dates, not hardcoded product assumptions.**

| Factor | Likely handling |
|---|---|
| Missing/contradictory property information | Ask for correction or refer |
| Multiple, recent, severe, or unresolved claims | Refer; possibly restricted terms or decline |
| Water, fire, liability, theft claims | Usually require claim-specific detail |
| Old, damaged, or unknown roof | Photos, inspection, remediation condition, or referral |
| Knob-and-tube/aluminum wiring, low-amperage service | Referral or remediation requirement |
| Galvanized/poly-B plumbing, older water systems | Referral, water restrictions, or remediation |
| Oil tank, wood stove, unusual heating | Documentation/inspection; sometimes specialist market |
| Vacancy, seasonal use, STR, home business | Different product or specialist referral |
| Major renovation/construction underway | Conditional coverage or specialist referral |
| Heritage, log, mixed-use, acreage, float home, unusual outbuildings | Specialist market/manual underwriting |
| High reconstruction value or custom finishes | High-value underwriting and appraisal |
| Extensive glass | Not a universal standalone decline rule; materially increases reconstruction cost and custom-home complexity → high-value review |
| Wildfire, flood, sewer, coastal, remote fire-protection exposure | Geo-rating, restrictions, higher deductible, or no current market |
| Prior cancellation, lapse, non-payment | Manual review or decline under carrier rules |
| Identity/property/claims-history mismatch | Hold for verification/fraud review |
| Active catastrophe or binding moratorium | Quote/bind paused regardless of user quality |

Public Canadian questionnaire evidence supports roof, prior insurance/claims, oil tank, and major-system scrutiny — but not universal cut-offs. [Square One underwriting questions](https://www.squareone.ca/quote-buy/underwriting-questions), [IBC](https://www.ibc.ca/insurance-basics/home/how-home-insurance-rates-are-set), [Desjardins](https://www.desjardins.com/en/insurance/home/homeowners.html)

### Honest timing bands (product-design estimates, not promises)

- Eligibility/precheck: seconds
- Complete, clean straight-through carrier quote: seconds to a few minutes
- Data-enriched or minor correction path: minutes to same business day
- Licensed broker/underwriter review: ~1–5 business days
- Inspection/remediation: several days or longer
- High-value/non-standard/specialist market: several business days to weeks

The UI should always show the blocking item, owner, and next expected update — never an indefinite spinner.

## Target architecture (summary)

Modular backend with durable workflow processing; regulated transactions must not live only in Next.js request handlers and JSONB rows. Required bounded capabilities:

1. **Customer/property record** — field-level source, confidence, attestation, change history
2. **Consent ledger** — purpose, recipients, wording version, jurisdiction, withdrawal
3. **Authority engine** — province, employee licence, brokerage licence, carrier appointment, product, limits, moratorium
4. **Submission/quote orchestrator** — canonical schema, carrier adapters, idempotency, retries, quote comparison, expiry
5. **Case/workflow engine** — tasks, deadlines, queue ownership, escalation, broker handoff
6. **Policy-service layer** — initially a synchronized view over carrier systems, not a home-grown PAS
7. **Document/evidence vault** — application, quote, wording, binder, endorsement, correspondence, inspections, claim evidence
8. **Billing/reconciliation** — carrier-direct premium payment first; commissions and carrier statements still reconciled
9. **Claims gateway** — FNOL and status experience; carrier/TPA/adjuster authoritative
10. **Audit/event ledger** — input, source, rule/model version, output, human override, user-visible reason, effective time

## Broker/admin backend requirements

Customer/property/policy 360 · new-submission and incomplete-application queues · referral queues by reason/carrier/jurisdiction/SLA · licence/appointment-aware assignment · side-by-side carrier responses · missing-information and document request workflows · underwriting notes/decisions/conditions/overrides · quote acceptance, bind confirmation, issuance reconciliation · endorsement/cancellation/renewal queues · payment failure, refund, commission reconciliation · claim handoff/status and complaints · CAT/moratorium controls · supervisor QA, audit export, capacity analytics · product/question/rule/disclosure/authority configuration with maker/checker approval.

**Email is a notification channel, never the operational source of truth.**

## Claims and payouts

First claims product: emergency guidance → FNOL capture → secure evidence upload → carrier/TPA routing → assigned-handler and status visibility → communication and complaint escalation. It should not initially make coverage decisions or calculate settlements. Automated payout only with written delegated claims authority and enforced monetary/coverage limits; carrier-controlled Canadian rails (EFT, cheque, direct vendor payment) — never touching claim money.

Lemonade's bounded-automation lesson (2025 Form 10-K): AI Maya/APIs sell 98% of policies, AI Jim receives 96% of FNOL without human intervention, ~55% of claims end-to-end automated; complex claims remain with specialists/adjusters/TPAs; AI does not automatically reject claims. [10-K](https://www.sec.gov/Archives/edgar/data/1691421/000169142126000016/lmnd-20251231.htm), [claim automation](https://www.lemonade.com/blog/lemonades-claim-automation/)

## Infrastructure and compliance gaps beyond the current stack

MFA + fine-grained RBAC/ABAC · runtime licence/delegated-authority enforcement · segregation of duties (bind overrides, refunds, claim payments) · durable workflows/queues/retries/DLQ · webhook signature verification + end-to-end idempotency · immutable decision/audit records · field-level provenance and user attestation · encryption/key management · malware scanning, retention, legal hold, secure delivery · Canadian data-location/subprocessor assessment · carrier reconciliation + mismatch alerts · DR and restore testing · privacy access/correction/deletion workflows · complaint classification/escalation · model/rule governance, explainability, human override · CAT concentration/moratorium/surge controls.

## Recommended sequence

- **Phase 0 — secure the authority:** brokerage/nominee contract; select insurer/MGA markets and obtain full submission schemas; define quote/bind/endorsement/billing/claims authority matrices; confirm direct-bill and carrier/TPA claims model; counsel approval for scripts, disclosures, privacy, unlicensed-staff boundaries.
- **Phase 1 — close today's handoff gap:** `coverage_profile` → versioned submission; transmit through authenticated partner API; delivery receipt, partner submission ID, status, durable broker queue; saved progress + customer status page. Broker-assisted quotes acceptable. **This alone moves the experience from "affiliate click" to "actionable broker submission."**
- **Phase 2 — BC straight-through quote and bind:** questionnaire to the selected carrier's actual field contract; Canadian property/reconstruction/hazard enrichment; deterministic referral rules; quote, re-rate, bind, payment confirmation, document delivery. Launch narrowly: uncomplicated owner-occupied detached homes fitting one carrier's appetite.
- **Phase 3 — policy self-service:** documents, proof, mortgagee changes, low-risk endorsements, payment methods, cancellations, renewal/non-renewal workflows.
- **Phase 4 — claims gateway:** FNOL, evidence, emergency routing, status, complaints; carrier/TPA remains system of record and payout owner.
- **Phase 5 — scale authority and geography:** additional carriers and comparative choice; landlord/tenant/strata/high-value lines; additional provincial/entity licences; MGA/delegated underwriting only after volume, audit history, and carrier trust; Quebec as a dedicated program.
