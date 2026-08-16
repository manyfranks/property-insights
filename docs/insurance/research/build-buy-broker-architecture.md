# Build / Buy / Broker: Responsibility Matrix, Reference Architecture & Procurement Position

*August 16, 2026. External committee pass provided by Matt — the build-vs-buy-vs-broker analysis anticipated by [E2E-COMMITTEE-REPORT.md](../E2E-COMMITTEE-REPORT.md) §7, delivered. ("Orio" = Property Insights platform.)*

## Conclusion

We can build the complete demo now without waiting for Phase 0, and most of that code can become production code unchanged. The central architectural decision:

> Orio owns the customer experience, canonical insurance record, property intelligence, consent, workflow, audit history, provider adapters, and broker workbench.
> The brokerage owns licensed advice and supervision.
> The insurer/MGA owns rates, appetite, underwriting authority, bind authority, policy issuance, premium handling, and initially claims decisions and payouts.

**Do not buy or build a carrier-grade policy administration system for first live.** It would duplicate the insurer's system, delay launch, and create reconciliation risk.

## 1. Responsibility and system-of-record matrix

| Capability | Decision | Authoritative system at first live |
|---|---|---|
| Customer UX and account | Build | Orio |
| Customer/property/risk profile | Build | Orio for collected facts; carrier for accepted underwriting facts |
| Consent and disclosure ledger | Build | Orio |
| Property enrichment orchestration | Hybrid | Orio normalized record + provider evidence |
| Questionnaire / progressive interview | Build | Orio, mapped to carrier schemas |
| Eligibility/readiness indication | Build | Orio rules, clearly non-binding |
| Carrier appetite, rates, underwriting rules | Carrier-owned | Carrier/MGA |
| Quote orchestration and presentation | Build/hybrid | Carrier response preserved in Orio |
| Comparative rating connectivity | Buy | Selected rater/BMS |
| Licensed advice / manual review | Broker-owned | Brokerage/BMS |
| Runtime licence/authority enforcement | Build | Orio policy engine using contractual authority data |
| Quote/bind/issue transaction | Hybrid | Carrier confirmation is authoritative |
| Policy record and wording | Carrier-owned | Carrier PAS |
| Brokerage servicing record | Buy | BMS |
| Customer policy portal | Build | Orio synchronized from carrier/BMS |
| Premium collection | Carrier-owned initially | Carrier/payment provider |
| Trust and commission accounting | Buy/defer | BMS/accounting platform |
| Documents and evidence | Hybrid | Carrier authoritative policy docs; Orio secure vault + delivery evidence |
| Endorsements and cancellations | Hybrid | Carrier decision; Orio request/status UX |
| Renewals | Hybrid | Carrier offer; Orio workflow and customer experience |
| FNOL | Hybrid | Orio intake, carrier/TPA claim record |
| Claims adjustment and settlement | Carrier/TPA-owned | Carrier claims system |
| Claim payments | Carrier-owned | Carrier/TPA payment and accounting |
| Complaints | Hybrid | Orio for brokerage complaints; carrier for underwriting/claims complaints |
| Workflow runtime | Buy | Durable workflow platform |
| Business workflow definitions | Build | Orio |
| Audit/event ledger | Build | Orio |
| Product analytics | Hybrid | PostHog/warehouse, restricted data excluded |
| Security infrastructure | Buy/build | Canadian-region infrastructure + Orio controls |

## 2. Reference architecture and deployment topology

Keep the existing Next.js app as the experience layer. Add a separate **sensitive insurance plane** designed for Canadian hosting from day one. Layers: Experience (customer web/mobile, broker workbench, policy/claims portal) → Orio insurance platform (API/BFF; party/identity/consent; property + risk evidence; case/task management; submission + quote orchestration; licence/appointment/authority engine; policy-service projection; FNOL/claim-status projection; documents/evidence; communications; versioned rules; immutable audit ledger; provider adapter gateway) → durable infrastructure (Canadian-region PostgreSQL, workflow engine, queues/event bus, encrypted object storage, KMS, observability/SIEM, warehouse) → licensed insurance systems (BMS/comparative rater, carrier/MGA quote-bind APIs, carrier PAS, TPA/adjusters, carrier payment rails) → approved external providers (address validation, property/rebuild/hazard data, claims history with consent, identity/fraud, e-sign/e-delivery).

| Component | Demo | Production-ready target |
|---|---|---|
| Web/customer portal | Current Vercel Next.js | Vercel, subject to insurer/privacy approval |
| Insurance API | Next route handlers behind internal modules | TypeScript service on AWS Canada; API Gateway + Lambda or ECS/Fargate |
| Transaction DB | Neon | PostgreSQL in approved Canadian region; Aurora/RDS conservative default |
| Workflow | Inngest | AWS Step Functions + SQS/EventBridge; Temporal alternative after residency diligence |
| Event delivery | Postgres outbox | Outbox → EventBridge/SQS |
| Documents | Test fixtures/local adapter | S3 `ca-central-1`, KMS, versioning, Object Lock |
| Malware scanning | Simulated | GuardDuty Malware Protection for S3 + quarantine workflow |
| Secrets | Vercel env vars | AWS Secrets Manager + KMS, rotation |
| Analytics | Existing PostHog | PostHog with opaque IDs and non-sensitive funnel events only |
| Observability | Logs/PostHog | OpenTelemetry → approved monitoring/SIEM |
| DR | Fixture reset + Neon backups | PITR, document replication, quarterly restore exercises |

Notes: AWS Step Functions available in Canadian regions ([AWS regions](https://docs.aws.amazon.com/general/latest/gr/step-functions.html)); S3 Object Lock ([docs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock-managing.html)); GuardDuty S3 scanning ([docs](https://docs.aws.amazon.com/guardduty/latest/ug/supported-s3-features-malware-protection-s3.html)). **Cloudflare R2 should not be presented as guaranteed Canadian storage** ([R2 jurisdictions](https://developers.cloudflare.com/r2/reference/partners/snowflake-regions/)). **Inngest's public docs do not establish Canadian data residency** ([Inngest](https://www.inngest.com/docs/platform/deployment)). Canadian residency is not automatically mandatory for every record, but a Canadian sensitive-data plane now eliminates a common carrier procurement objection.

## 3. Modular domain architecture

Begin as a **modular monolith with separately deployable workers** — not dozens of microservices. Twelve Orio-owned modules: (1) party & identity, (2) consent & disclosure (exact text/version/language, purpose, recipients; credit/claims-history/marketing/e-delivery consent kept separate; grant/withdrawal/expiration events), (3) property & evidence (canonical address, parcel/unit IDs, user facts vs provider evidence, field-level source/confidence/retrieval time/licence restrictions, corrections that don't destroy original evidence), (4) insurance case (goal, product, jurisdiction, lifecycle status, assigned licensed rep, tasks/SLA/blockers, links to submissions/quotes/policies/claims), (5) submission/questionnaire (versioned question set, answers, attestations, carrier mapping, completeness validation, referral reasons), (6) quote orchestration (provider requests, immutable quote snapshots, coverage/limits/deductibles/premium/tax/fees, conditions, expiry, re-rate, bind requests), (7) authority (province, licences, appointments, product, transaction, binding/settlement limits, delegated-authority version, effective dates, CAT moratorium state), (8) policy projection (synchronized carrier policy info, documents, billing status, endorsement/cancellation requests, renewals, mortgagees), (9) claims experience (FNOL, evidence, carrier/TPA acknowledgement, normalized status, adjuster contact, complaints), (10) documents & communications (originals + hashes, virus-scan state, access grants, retention/legal hold, e-sign envelopes, correspondence), (11) integration gateway (credentials, outbound requests + idempotency, webhook verification/inbox, normalization, health/reconciliation), (12) audit & analytics (append-only events, rules/models used, human overrides, user-visible explanations, provider/authority versions).

## 4. Canonical records

Add first-class entities rather than extending `coverage_profiles` indefinitely:

`party` · `party_identifier` · `brokerage` · `staff_licence` · `carrier_appointment` · `delegated_authority` · `canonical_address` · `property` · `property_fact` · `property_evidence` · `consent_artifact` · `insurance_case` · `case_party` · `case_task` · `submission` · `submission_answer` · `carrier_submission` · `quote_snapshot` · `quote_coverage` · `referral` · `inspection` · `policy_snapshot` · `policy_transaction` · `billing_snapshot` · `claim_snapshot` · `claim_event` · `document` · `document_access_grant` · `communication` · `provider_request` · `provider_response_metadata` · `webhook_inbox` · `outbox_event` · `audit_event` · `complaint`

Sensitive provider payloads encrypted or stored in the document/evidence plane; normalized facts and pointers in PostgreSQL.

## 5. State models

### Submission and quote

```text
DRAFT → ENRICHING → NEEDS_CUSTOMER_INPUT → READY → SUBMITTING → SUBMITTED
SUBMITTED → QUOTED | REFERRED | INSPECTION_REQUIRED | DECLINED | PROVIDER_ERROR
QUOTED → SELECTED → BINDING → BOUND | BIND_FAILED
QUOTED → EXPIRED | WITHDRAWN
BOUND → ISSUED
```

**Only a provider-authenticated carrier response may create `QUOTED`, `BOUND`, or `ISSUED`.**

### Policy

```text
PENDING_EFFECTIVE → ACTIVE
ACTIVE → ENDORSEMENT_REQUESTED → ENDORSED | REJECTED
ACTIVE → RENEWAL_PENDING → RENEWED | NON_RENEWED | EXPIRED
ACTIVE → CANCELLATION_REQUESTED → CANCELLED | REQUEST_REJECTED
ACTIVE → LAPSE_PENDING → LAPSED | REINSTATED
```

Carrier authoritative; Orio records requests and synchronized snapshots.

### Claim

```text
DRAFT → SUBMITTING → CARRIER_CONFIRMATION_PENDING → RECEIVED → NEEDS_INFORMATION
  → ASSIGNED → UNDER_REVIEW → APPROVED | PARTIALLY_APPROVED | DENIED
  → PAYMENT_PENDING → PAID → CLOSED → REOPENED
```

Orio may transition only `DRAFT`, `SUBMITTING`, `CARRIER_CONFIRMATION_PENDING`; later states must be authenticated carrier/TPA events.

## 6. Provider interfaces

All external capabilities behind Orio-owned interfaces: `AddressProvider`, `PropertyEvidenceProvider`, `ReplacementCostProvider`, `HazardProvider`, `ClaimsHistoryProvider`, `IdentityProvider`, `QuoteProvider`, `BmsProvider`, `PolicyProvider`, `ClaimProvider`, `DocumentProvider`, `SignatureProvider`, `PaymentProvider`, `CommunicationProvider`.

Each operation requires: Orio correlation + idempotency ID, provider request ID, case/submission/policy/claim ID, schema version, authority + consent references, request/response timestamps, status + reason code, raw-response location, normalized output, retryability, provider rules/product version.

**Webhook architecture:** receive → verify signature + timestamp → persist raw in `webhook_inbox` → dedupe by provider event ID → ack fast → process async → append normalized domain event → update projection in one DB transaction → scheduled provider reconciliation → replay capability.

**Event taxonomy examples:** `insurance.case.created.v1`, `insurance.consent.granted.v1`, `insurance.property.enrichment.completed.v1`, `insurance.submission.sent.v1`, `insurance.quote.received.v1`, `insurance.quote.referred.v1`, `insurance.bind.requested.v1`, `insurance.policy.bound.v1`, `insurance.policy.issued.v1`, `insurance.policy.renewal.offered.v1`, `insurance.claim.fnol.submitted.v1`, `insurance.claim.status.changed.v1`, `insurance.complaint.opened.v1`.

## 7. Insurance-core vendor decision

### Shortlist for a BC brokerage

| Candidate | Role | Strength | Required proof |
|---|---|---|---|
| **Acturis Canada** | BMS, rater, CRM, servicing | Strongest public evidence of a consolidated Canadian personal-lines stack; CSIO + Canadian carrier positioning | Named BC-home carriers, full transaction coverage, API/export, sandbox, security package |
| **Applied Epic + Applied Rating Services** | BMS + comparative rating | Lower-risk Canadian incumbent; Canadian property rating + broker workflows | Exact BC market panel, API/Data Lake rights, quote round-trip, export, implementation |
| **BrokerLift Engage** | Embedded quote/pay/bind/issue + MGA distribution | Strong white-label/API positioning, Canadian programme evidence | Actual BC-home carrier availability, BMS reconciliation, authority, raw webhook/export rights |
| **Quandri** | Renewal/policy-check automation | Useful later with Applied Epic | Least-privilege bot model, auditability, sufficient policy volume |
| **Socotra** | API-first PAS for future MGA | Excellent public API + sandbox | Canadian product localization, carrier acceptance, delegated-authority need |
| Guidewire/Duck Creek/Majesco/OneShield | Carrier/MGA core | Mature insurer tech | Defer unless a carrier mandates it or Orio controls a programme |

Sources: [Acturis Canada](https://acturis.ca/product/), [Applied Epic](https://www1.appliedsystems.com/en-ca/solutions/for-brokers/brokerage-management-system/applied-epic/), [ARS brochure](https://prod.appliedsystems.com/globalassets/all-documents/resources/brochures-data-sheets/applied-rating-services_en-ca.pdf), [BrokerLift](https://brokerlift.com/engage-distribution-platform), [Socotra](https://docs.socotra.com/).

Procurement choice: **exactly one of Acturis or Applied Epic/ARS as the brokerage core**; add BrokerLift only when a carrier/MGA programme requires an embedded transaction layer the core can't provide cleanly; carrier-issued policy documents and numbers stay authoritative; **no separate PAS for the initial brokerage**.

**Square One is not a broker API route: it publicly states it does not authorize third-party brokers to sell its policies. Keep it as an affiliate fallback only.** [Square One unauthorized-brokers notice](https://www.squareone.ca/resource-centres/fraud-protection/unauthorized-brokers)

## 8. Horizontal infrastructure decisions

| Area | Demo choice | Live choice |
|---|---|---|
| Workflow | Inngest | AWS Step Functions/SQS/EventBridge |
| Database | Neon | Canadian-region PostgreSQL if contracts require |
| Documents | Mock/S3 adapter | S3 Canada + KMS + Object Lock |
| Malware scanning | Fixture result | GuardDuty scanning/quarantine |
| E-sign | Test-mode provider | Carrier-approved DocuSign, OneSpan, Adobe, or Dropbox Sign |
| Payments | Simulator | Carrier-hosted direct billing |
| Address | Google Address Validation adapter | Same or Canada Post/Loqate after procurement |
| Property/rebuild | Synthetic fixtures | **Verisk Canada / Opta iClarify** |
| Claims history | Explicitly unavailable | CGI/HITS or approved source with dedicated consent |
| Identity | Mock adapter | Canadian-capable enterprise provider |
| Communications | Resend + mock SMS | Approved email/SMS behind abstraction |
| Observability | Sentry/OTel | OTel → approved destination |
| Feature flags | Versioned config | OpenFeature-compatible provider with approval/audit |
| Analytics | PostHog funnel events | PostHog/warehouse with restricted-data segregation |

Verisk Canada/Opta iClarify is the strongest Canadian property-data lead: nationwide construction features, reconstruction valuation, imagery, FUS information, 18M+ residential properties; API/pricing/sandbox require enterprise outreach. [Verisk Canada](https://optaintel.ca/solutions.html) Google Address Validation supports Canada but storage restrictions mean the customer-confirmed canonical address must be retained separately from the Google response. [Coverage](https://developers.google.com/maps/documentation/address-validation/coverage), [policies](https://developers.google.com/maps/documentation/address-validation/policies)

## 9. Claims and FNOL decision

**Build the claims experience shell; do not buy a claims core yet.** Orio owns: guided FNOL, consent, evidence uploads, intake receipt, carrier/TPA forwarding, status normalization, notifications, broker support queue, complaint routing, audit/reconciliation. Carrier/TPA owns: claim number, coverage determination, reserves, adjuster assignment, investigation, SIU/fraud conclusions, vendor commitments, settlement offers, decision letters, payments, subrogation/salvage.

Canadian operating partners worth an RFP: [Sedgwick Canada](https://www.sedgwick.com/canada/), [ClaimsPro](https://claimspro.ca/), [Crawford Canada](https://www.crawco.ca/) — public sites establish operating capability, not API quality; the chosen carrier's existing claim system and TPA relationship should drive the integration decision. If Orio later controls claims under delegation: evaluate Guidewire ClaimCenter, Duck Creek Claims, Socotra, possibly Five Sigma — not before the authority relationship is known.

## 10. Runtime authority controls

Every consequential operation evaluates: actor, brokerage, staff licence, province, insured-property province, carrier appointment, product, transaction type, delegated-authority version, effective date/time, quote/policy limits, monetary authority, required approvals, CAT/moratorium state → result `ALLOW` / `DENY` / `REQUIRE_LICENSED_REVIEW` / `REQUIRE_CARRIER_REVIEW` / `REQUIRE_SECOND_APPROVAL`. **Missing or stale authority data must hard-stop the operation.**

Examples: unlicensed support staff may gather facts but cannot recommend coverage; a BC-licensed broker cannot act on an Alberta property without an AB licence; a valid broker cannot bind outside the carrier's delegated limits; nobody binds during a carrier moratorium; claims-intake staff cannot alter reserves/settlements; refunds, claim payments, and authority overrides require segregation of duties.

## 11. Demo that becomes production

Use the exact production domain model and provider interfaces with synthetic adapters. Required synthetic scenarios: clean straight-through quote · missing facts · multiple-claims referral · old-roof inspection · oil tank referral · high-value/custom-glass review · unsupported occupancy · carrier decline · catastrophe moratorium · provider timeout · duplicate and out-of-order webhook · quote expiry + re-rate · bind payment failure · successful bind + issue · endorsement request · renewal offer/non-renewal · cancellation/refund · FNOL acknowledgement · claim needs-information · claim assigned/under review · claim-status conflict · TPA outage · broker licence/appointment revocation.

Demo hard stops: synthetic data only · no live insurer logos without permission · no real premium represented as an offer · no real payment movement · no operative policy wording · no real claims decision · persistent banner "Demonstration only — no insurance is offered, bound, adjusted, or paid" · separate demo tenancy/secrets/storage · production flags default off · destination allowlist preventing synthetic submissions from reaching live providers. Real adapters later replace the simulator behind the same interfaces.

## 12. Security and operating controls

Staff SSO + phishing-resistant MFA · RBAC/ABAC · authority policy checks on API and worker actions · field-level data classification · encryption in transit/at rest · Canadian-region document keys · immutable audit events · document hashing + malware quarantine · least-privilege provider credentials · signed URLs, short lifetimes · **no insurance/claims payloads in PostHog** · PIA/DPIA + vendor DPA workflow · access/correction/deletion orchestration · legal hold/retention · webhook signing/dedup/replay · dependency/container scanning · IaC · restore and degraded-mode exercises · carrier/TPA reconciliation · kill switches by carrier, province, product, transaction.

Initial operational targets: no acknowledged data loss on accepted submissions; webhooks persisted before acknowledgement; end-to-end idempotency on quote/bind; RPO ≤5 min transactional; RTO 1h insurance API, 4h documents; documented manual carrier/TPA path for every critical dependency.

## 13. Contractual/API package to demand from every partner

OpenAPI/field spec · question dictionaries · carrier/rules/rate/form version identifiers · quote states + reason codes · referral/document requirements · idempotency/timeout/retry rules · signed webhooks with replay · bind-authority + moratorium feed · policy/document sync · endorsement/cancellation/renewal operations · direct-bill/accounting responsibility · FNOL + claims-status contract · sandbox with synthetic policies and claims · data roles/permitted uses/subprocessors · Canadian data-location commitments where required · security reports/incident history/breach SLA · BCP/RPO/RTO · full structured export · post-termination read access + migration assistance · **no restriction on Orio retaining its customer-entered profile, consent, and audit history**.

Proof-of-value script — one complete BC-home lifecycle:

> quote → referral → bind → issue → document delivery → endorsement → payment failure → renewal → cancellation → FNOL → claim-status synchronization → export and replay

## Final procurement position

- **Build:** Orio experience, canonical records, property intelligence, consent, workflow definitions, authority controls, case management, provider gateway, customer portal, broker workbench, FNOL shell, audit, analytics.
- **Buy:** one Canadian BMS/rater, durable workflow infrastructure, Canadian document plane, e-sign, property/rebuild/hazard data, identity, communications, observability.
- **Broker-owned:** licensing, advice, supervision, market access, manual underwriting, broker-conduct complaints.
- **Carrier/MGA-owned:** product, appetite, rating, bind confirmation, policy, billing, claims decisions, payouts.
- **Defer:** PAS, independent rating engine, premium trust accounting, claims core, automated adverse decisions, delegated settlement.

Remaining unknowns — pricing, named BC carrier connectivity, private APIs, sandbox access, data residency guarantees, implementation commitments — can only be resolved through scripted vendor demonstrations, security diligence, and contract negotiation.
