# Property Intelligence Phasemap — Subjects, Journeys, and Insurance

_Created 2026-08-11. Living execution tracker for the next iteration of Property Insights. Related: `08-EXECUTION-PHASEMAP.md` (current US/monetization program), `09-US-ADVANTAGE-DESIGN.md`, `10-RENTCAST-DATA-QUALITY.md`, `12-US-CTA-JOURNEY-MAP.md`, and `docs/proposals/insurance-distribution-proposal.html`._

## Program outcome

Evolve Property Insights from one buyer-oriented listing report into a property-evidence platform that can safely produce goal-specific views without confusing a unit, building, parcel, listing, property class, or user intent.

The critical path is:

```text
P0 Safety baseline
  -> P1 Preserve source evidence
  -> P2 Resolve the assessment subject
  -> P3 Classify the subject + compute capabilities
  -> P4 Add explicit per-assessment goals + view switching
  -> P5 Ship Investor / Landlord V1
  -> P6 Move Buyer + Owner journeys onto the same platform

After P4: I1 Insurance distribution experiment may run beside P5
After I1 proves demand: I2 Coverage Profile intake
Not on the current critical path: commercial data expansion, insurance underwriting
```

## How to use this document

Status markers:

- `[ ]` Not started
- `[~]` In progress
- `[x]` Complete
- `[!]` Blocked or requires a product/external decision

Owners:

- **[A]** Agentic engineering: code, fixtures, documentation, QA, and data audits
- **[M]** Matt: product calls, partner decisions, legal approval, spend, and production rollout authorization
- **[A+M]** Joint gate

A phase is complete only when every exit-gate item is checked. Updating a task requires adding its evidence: commit, PR, production URL, query result, screenshot, or dated decision.

### Validation baseline

As of 2026-08-11, `npm exec tsc -- --noEmit` passes. P1 removed five existing findings in files it had to touch, so the repository-wide `npm run lint` baseline is now 26 errors and 20 warnings across untouched scripts/components (down from 31 errors and 20 warnings at P0). Until that debt is cleared separately, every phase must pass lint on its touched code, keep TypeScript green, and introduce no additional full-repository lint findings. Do not mark a phase blocked solely by unrelated baseline findings.

## Program invariants

These are release-blocking requirements, not preferences:

1. **Never auto-switch a journey from inferred property classification.** Classification may suggest another view or limit a module; the user controls the journey.
2. **Goal is assessment-level state.** A profile preference may preselect it later, but never permanently labels the user.
3. **Resolve the assessment subject before making property-level claims.** Unit, building, parcel, and listing are different entities even when they share an address.
4. **Unknown means clarify or degrade neutrally.** It does not mean residential, commercial, government, or unsupported.
5. **Classification is scoped.** Parcel use, building form, unit use, listing scope, and occupancy are separate fields—not one overloaded `propertyType`.
6. **Capabilities control modules.** A selected journey does not authorize a valuation or insight the evidence cannot support.
7. **Observed, modeled, inferred, and user-supplied values remain distinguishable.** Every important output must retain source and freshness.
8. **Insurance means distribution/prequalification until a later explicit gate.** County FEMA data is context, not property-level underwriting evidence.
9. **Non-residential commercial is a data-expansion program.** Current RentCast coverage cannot turn office, retail, or industrial property into another render mode.
10. **No owner names or mailing addresses in P1.** Revisit only after a documented privacy, licensing, retention, and product-necessity review.
11. **P2 subject resolution spends no new provider quota.** It resolves from the already-fetched assessment bundle and user input. Any candidate that requires another provider call remains unresolved and is recorded as a capability gap.
12. **Occupancy evidence does not personalize before counsel review.** `ownerOccupied` may be preserved and evaluated in shadow mode, but it cannot select or suggest a goal, change visible content, route CTAs, or feed a persistent intent profile until the profiling/privacy review is complete.

## Portfolio dashboard

| Track | Status | Outcome | Depends on | Exit evidence |
|---|---|---|---|---|
| **P0 — Safety baseline** | `[x] Complete 2026-08-11` | Prevent address-only residential overclaims; lock vocabulary and fixtures | None | 14/14 P0 fixtures; 16/16 guard; 20/20 integration |
| **P1 — Evidence preservation** | `[x] Complete 2026-08-11` | Stop discarding classification evidence from RentCast, Zoocasa, and assessments | P0 | Field matrix + mapper fixtures |
| **P2 — Subject resolution** | `[x] Complete 2026-08-11` | Distinguish listing, unit, building, parcel, and unknown subjects | P1 | 23/23 resolver fixtures + common subject envelope |
| **P3 — Classification/capabilities** | `[~] In progress — shadow built; P3.5 acceptance active 2026-08-11` | Confidence-tagged, scope-aware classification and honest module availability | P2 | Shadow-mode report + routing fixtures |
| **P4 — Goal UX/instrumentation** | `[~] Sprint A built; release verification pending 2026-08-11` | Optional per-assessment goal, conditional scope clarification, manual view switching | P3 | Funnel events + flagged rollout |
| **P5 — Investor/Landlord V1** | `[ ]` | Address-level US rental screen; capability-gated Canadian version | P4 | End-to-end journey QA + KPI baseline |
| **P6 — Buyer/Owner convergence** | `[ ]` | Existing buyer parity plus current-owner/landlord view on shared contracts | P5 | Regression parity + owner journey QA |
| **I1 — Insurance distribution test** | `[ ] Parallel after P4` | Measure intent-matched insurance demand without claiming underwriting | P4; preferably P5 | Pre-registered test + measured results |
| **I2 — Coverage Profile** | `[ ] Gated` | Prefill a partner-ready intake and ask users for missing insurance facts | I1 go decision | Partner/legal approval + handoff QA |
| **X1 — Data expansions** | `[ ] Deferred` | Municipal development data or non-residential commercial discovery | P3 stability + business case | Separate approved proposal |

---

## P0 — Safety baseline and shared vocabulary

**Purpose:** establish correctness before widening the product. This phase does not add persona UI.

### Build

- [x] **[A] Define fixture taxonomy** for at least:
  - Detached residential address
  - Condo/apartment unit with explicit unit number
  - Multi-unit building address without a unit
  - Mixed-use building with a residential unit
  - Vacant land
  - Government/institutional address
  - Geocodable US address with no RentCast property record
- [x] **[A] Record current outputs** for each fixture before changing behavior.
- [x] **[A] Verify and preserve the existing fallback disclosure:** the current UI already labels the number “County Median Home Value — Modeled Estimate” and says it is county-level, not property-specific, and approximate.
- [x] **[A] Add a machine-readable reason** for the degraded result, such as `property_record_not_found`, without prematurely labeling the subject commercial or unsupported.
- [x] **[A] Tighten fallback semantics only where fixtures prove a gap.** P0 is a labeling/contract hardening pass, not a fallback redesign. Do not suppress useful regional context or fail a residential unit merely because its containing building may be mixed-use.
- [x] **[A] Document the common vocabulary:** assessment subject, subject scope, containing entity, classification, goal, journey, capability, evidence, and unsupported reason.
- [x] **[M] Confirm the no-auto-switch invariant** and the V1 scope of selectable goals.

### Exit gate

- [x] A Census-geocodable address alone cannot produce a confident property-level residential claim.
- [x] Existing confirmed residential US and Canadian assessment fixtures remain usable.
- [x] Every baseline fixture has a recorded expected result and failure/degradation mode.
- [x] `npx tsx scripts/test-pipeline-guard.ts` passes without a live RentCast call.
- [x] The 20-random seed harness passes in the integration environment and proves RentCast quota is unchanged before/after.
- [x] `npm exec tsc -- --noEmit` passes; touched-file lint passes; the full-repository lint baseline has no new findings.

### Evidence

- Commit: `ca30d1b` (`Ship property intelligence P0 baseline`)
- Fixture report: `13A-P0-BASELINE-AND-VOCABULARY.md`; 14/14 offline fixtures
- Operational guard: 16/16; no live RentCast call attempted
- Integration: 20/20, seed `20260811`, RentCast quota `45 → 45`
- Product decision: `13A-P0-BASELINE-AND-VOCABULARY.md`

---

## P1 — Preserve source evidence and publish the geo capability matrix

**Purpose:** stop losing fields before classification. This is additive; do not replace `Listing` in a big bang.

### Build

- [x] **[A] Add a generic evidence contract**, including value, source/provider, source record identifier where allowed, observed date, ingestion date, evidence kind (`observed | modeled | inferred | user_supplied`), and confidence/availability.
- [x] **[A] Preserve the exact assessment input:** raw address, selected autocomplete value/place ID when available, parsed unit, direct listing URL, and normalized address.
- [x] **[A] RentCast:** preserve property type and `ownerOccupied`; preserve land/improvement assessment components where returned.
- [x] **[A] Zoocasa:** preserve raw search `property_type`, detail `type`, and `propertySubType` without collapsing away the provider value.
- [x] **[A] Canadian assessments:** retain total/land/building values exactly where supplied; represent unavailable components as unavailable—not meaningful zeroes in the new evidence contract.
- [x] **[A] County adapters:** inventory class/use/tax-class fields seen internally and identify which can be safely normalized. Do not promise coverage merely because one adapter exposes a field.
- [x] **[A] Keep owner name and mailing address out of the normalized model** in this phase.
- [x] **[A] Create `14-PROPERTY-DATA-CAPABILITY-MATRIX.md`** with rows by source/geo and columns for subject scope, property type, occupancy, unit count, land/building split, address rent, regional rent, sales, tax, hazards, and known provider exclusions.
- [x] **[A] Split every US capability row by ingestion surface:**
  - **On-demand assess bundle:** may contain `/properties`, AVM, rent AVM, active-listing, and live county evidence, subject to cache/quota/source availability.
  - **Discover seed/listing page:** originates from city `/listings/sale` sweeps and does not inherently contain the per-address property record, `ownerOccupied`, land/improvement split, or address-level rent. Later enrichment must be represented as a separate evidence tier, not assumed across the corpus.
- [x] **[A] Add mapper fixtures** proving that source fields survive into the new envelope without changing current buyer output.

### Exit gate

- [x] RentCast and Zoocasa type evidence reaches the assessment service with provider provenance intact.
- [x] `ownerOccupied` is available to classification but not presented as proof of investment use.
- [x] BC land/building split remains available; AB/ON/MB absence is explicit.
- [x] The capability matrix covers every live geo adapter and distinguishes address-level from regional evidence.
- [x] The capability matrix reports Discover-seed and on-demand-assess coverage separately; enriched fixtures cannot inflate the apparent capability of the seeded corpus.
- [x] Existing `Listing` consumers remain backward compatible.
- [x] Typecheck, touched-file lint, and mapper fixtures pass; the full lint baseline has no new findings.

### Evidence

- Commit: P1 implementation (`Preserve property evidence across ingestion surfaces`)
- Capability matrix: `14-PROPERTY-DATA-CAPABILITY-MATRIX.md`
- Mapper fixtures: 12/12 (`scripts/test-property-intelligence-p1.ts`)
- Regression: P0 14/14; pipeline guard 16/16; integration 20/20 with seed `20260811`, RentCast quota `45 → 45`
- Quality: TypeScript passes; touched-file lint passes; full lint improves from 31 errors / 20 warnings to 26 errors / 20 warnings

---

## P2 — Resolve the assessment subject

**Purpose:** determine what real-world entity the user means before interpreting the address.

### Target contract

```ts
type SubjectScope = "unit" | "building" | "parcel" | "listing" | "unknown";

interface AssessmentSubject {
  scope: SubjectScope;
  canonicalAddress: string;
  unit: string | null;
  selectedBy: "explicit_input" | "listing_match" | "provider_match" | "user_confirmation" | "unresolved";
  resolutionConfidence: "high" | "medium" | "low";
  containingBuildingId?: string;
  containingParcelId?: string;
  requiresClarification: boolean;
  clarificationReason?: string;
}
```

The final contract may differ, but it must preserve these semantics.

### Build

- [x] **[A] Add candidate entities** rather than flattening all provider records into one address object.
- [x] **[A] Resolve only from already-fetched evidence:** exact user input, parsed unit, listing URL/listing record, geocoder result, property record, and assessor data already present in the bundle.
- [x] **[A] Add no provider calls in the resolver.** When existing evidence cannot distinguish unit/building/parcel scope, return `requiresClarification` or a capability gap instead of fetching again.
- [x] **[A] Implement deterministic resolution precedence:** explicit unit/listing selection first; exact provider entity match second; address-only building/parcel match never silently becomes a unit.
- [x] **[A] Keep listing scope separate from property-record scope.** A unit listing and a building-level assessor record may both be correct.
- [x] **[A] Emit conflicts** when providers appear to describe different scopes or units.
- [x] **[A] Add `requiresClarification`** only when ambiguity would materially change the result.
- [x] **[A] Normalize CA and US assessment responses** into one subject-aware envelope while preserving current country-specific modules.
- [x] **[A] Add resolver fixtures** for every P0 case plus unit-format variations and direct listing URLs.

### Resolution rules

- A detached home with consistent records should not receive an unnecessary scope question.
- A building address without a unit must not inherit a random unit listing.
- A residential unit in a mixed-use building remains a valid residential subject.
- A whole-building acquisition must not be evaluated with unit-level AVM/rent data.
- When scope cannot be resolved, the system asks or renders neutral regional context; it does not guess.

### Exit gate

- [x] Every successful assessment returns a subject scope, resolution confidence, and provenance.
- [x] Resolver fixture runs make zero RentCast/provider calls and do not change quota counters.
- [x] Unit, building, parcel, and listing records can coexist without destructive merging.
- [x] All ambiguity fixtures resolve correctly or explicitly require clarification.
- [x] Current detached-home assessment flow remains no more complex for the user.
- [x] Typecheck, touched-file lint, resolver fixtures, and existing assessment smoke checks pass; the full lint baseline has no new findings.

### Evidence

- Commit/PR: P2 implementation (`Resolve assessment subjects without new provider calls`)
- Resolver fixture report: `15-P2-SUBJECT-RESOLUTION.md`; 23/23 offline fixtures, zero provider calls
- API response examples: `15-P2-SUBJECT-RESOLUTION.md`

---

## P3 — Scope-aware classification and capability routing

**Purpose:** describe the resolved subject conservatively and decide which modules the evidence supports.

### Classification model

- `parcelUse`: residential, commercial, mixed-use, institutional, land, unknown
- `buildingForm`: detached, attached, low-rise multi-unit, apartment, mixed-use, other, unknown
- `unitUse`: residential, commercial, other, unknown
- `listingScope`: unit, whole building, parcel, unknown
- `occupancySignal`: owner-occupied, non-owner-occupied, conflicting, unknown
- `tags`: short-hold resale pattern, suite signal, high land-to-improvement ratio, recent build, and future evidence-backed tags

Each result must include scope, source evidence, confidence, and an explanation suitable for debugging. `non-owner-occupied` is not synonymous with rental; `short-hold resale` is not proof of a flip.

### Build

- [x] **[A] Implement `PropertyClassification`** with deterministic, inferred, conflicting, and unknown states.
- [x] **[A] Implement `Capabilities`** separately from classification, including at minimum:
  - Address-level sale valuation
  - Address-level rent estimate
  - Regional rent benchmark
  - Offer analysis
  - Gross yield screen
  - Land/improvement analysis
  - County market/risk context
  - Whole-building commercial analysis
  - Insurance prefill
- [x] **[A] Add explicit capability reasons** (`available`, `missing_field`, `unsupported_scope`, `provider_exclusion`, `regional_proxy_only`, `conflicting_evidence`).
- [x] **[A] Run classification in shadow mode** and log/inspect outcomes before it affects visible modules.
- [x] **[A] Produce a coverage report** by country, province/state/county adapter, subject scope, classification confidence, and capability.
- [x] **[A] Add routing fixtures** proving that classification never mutates the user goal and never auto-switches a journey.
- [ ] **[M] Obtain counsel/privacy direction before any occupancy-driven visible personalization, view suggestion, CTA routing, or intent-profile persistence.** Coordinate this with the existing GPC/Do-Not-Sell and profiling review rather than treating it as a mapper-only question.
- [ ] **[M] Review shadow-mode false positives**, especially mixed-use, apartment-unit, land, and institutional cases.

### Exit gate

- [ ] Every visible property-level module has a satisfied capability and traceable evidence.
- [x] Unknown and conflicting classifications degrade neutrally in the shadow capability contract.
- [x] High-confidence unsupported results are tied to the verified assessment subject—not merely its containing building or geocoded address.
- [ ] Shadow-mode review reaches an agreed launch bar by fixture category; no single global “accuracy” number hides geo gaps.
- [x] Typecheck, touched-file lint, and routing fixtures pass; the full lint baseline has no new findings.

### Evidence

- Commit/PR: `745f4fb` (`Add P3 shadow classification and capabilities`)
- Coverage report: `16-P3-SHADOW-COVERAGE.md`; 14/14 fixtures, zero provider calls
- P3.5 acceptance: `17-P3.5-SHADOW-ACCEPTANCE.md`; anonymous operational telemetry plus a read-only replay of 2,325 persisted listings
- Discover finding: 2,324/2,325 records predate P1 and lack an evidence envelope; replay made zero provider calls and RentCast quota remained `50 -> 50`
- Rollout boundary: P4 may pilot on on-demand assessments behind its flag after production telemetry verification; Discover remains excluded from persona routing until evidence-envelope coverage is measured and sufficient
- Production proof: commit `8c0c1ab`; live US listed assessment emitted queryable `classification_result` and `capability_missing` rows while preserving the current buyer output
- Shadow review decision: _TBD_

---

## P4 — Per-assessment goal UX, clarification, and journey instrumentation

**Purpose:** let users state what they are trying to decide without permanently assigning them a persona.

### V1 interaction

1. User enters an address or listing URL.
2. Resolver silently resolves straightforward cases.
3. If consequentially ambiguous, ask: “What are you evaluating at this address?”
   - A specific unit
   - The entire building/property
   - A listing I found
   - I’m exploring the address generally
4. Ask an optional goal question:
   - Buying a home
   - Rental investment
   - I own or manage it
   - Explore everything
5. Render one prioritized view. Other supported views remain manually selectable.

Development/renovation should not be a top-level V1 promise until P3 shows enough supported coverage. It may appear later as a capability-gated module or goal.

### Build

- [x] **[A] Add conditional scope clarification** driven by P2; do not show it for high-confidence straightforward subjects.
- [x] **[A] Add the optional assessment-goal selector** after address entry/resolution, with today’s buyer experience or Explore as the controlled rollout default.
- [x] **[A] Carry goal and subject** through the assessment request and result envelope.
- [x] **[A] Add manual result-view switching** without refetching the entire property bundle when existing evidence is sufficient.
- [x] **[A] Ensure suggestions are non-destructive:** “Investment data is also available” rather than “Switching you to Investment.”
- [x] **[A] Add events:**
  - `assessment_subject_clarification_shown`
  - `assessment_subject_selected`
  - `journey_selected`
  - `journey_result_viewed`
  - `journey_switched`
  - `classification_result`
  - `capability_missing`
- [ ] **[A] Store goal with the assessment/saved property.** Do not add a permanent profile persona in V1.
- [ ] **[A] Add an optional signed-in default** only after the assessment-level flow is stable; it may preselect, never lock.
- [x] **[A] Put the UI behind a feature flag:** environment flag or internal per-assessment preview. Cohort/default-on rollout remains a later decision.

### Exit gate

- [ ] Users can correct scope and change views without re-entering the address.
- [ ] No classification path automatically changes the selected journey.
- [ ] Funnel events answer: which goals are selected, where clarification occurs, which views users switch to, and which capabilities are missing.
- [ ] Existing buyer flow remains available and regression-tested while the flag is off.
- [ ] Mobile and desktop flows pass browser QA.

### Evidence

- Commit/PR: _Sprint A implementation pending release commit_
- Event query/dashboard: _TBD_
- Browser QA: `18-P4-GOAL-UX-SPRINT-A.md`; local flag-off and no-refetch preview checks pass
- Rollout decision: _TBD_

---

## P5 — Investor / Landlord V1

**Purpose:** ship the strongest new journey using data and calculations already present, while calling it a rental screen rather than full deal underwriting.

### Product scope

- US address-level rent estimate where RentCast supports the resolved subject
- HUD FMR and county metrics as clearly labeled regional benchmarks
- Canadian CMA/CMHC rent as regional proxy only
- Gross rent-to-price/yield screen
- Taxes, value triangulation, vacancy/HPI, and county FEMA context with existing caveats
- User-entered financing and operating assumptions where required
- Investor/landlord CTA routing based on selected journey

### Build

- [ ] **[A] Create the investor result composition** from P3 capabilities rather than country-only branching.
- [ ] **[A] Separate address-level expected rent from regional benchmark rent** in UI, narrative, and types.
- [ ] **[A] Rename “Investor Flip” to “Short-hold resale pattern”** and remove claims that renovation or seller motivation is proven.
- [ ] **[A] Show gross yield by default;** show cash flow/cap rate only when required expenses are known or user-supplied.
- [ ] **[A] Add inputs for financing, vacancy, maintenance, management, utilities, insurance, and other operating costs** without blocking the first useful result.
- [ ] **[A] Feed real journey state** into `AudienceMode` and `result-investor` CTA surfaces.
- [ ] **[A] Capability-gate Canadian output:** no address-level rent language when only CMA/CMHC data exists; land/improvement insight only where the split exists.
- [ ] **[A] Save assumptions** per assessment/saved property, not as universal truths.
- [ ] **[A+M] Define the V1 success readout before launch:** selection rate, result completion, view switching, missing-capability rate, investor CTA engagement, and saved/shared assessments.

### Exit gate

- [ ] A supported US residential rental fixture completes end to end with address-level and regional values clearly distinguished.
- [ ] Canadian results never relabel regional rent as expected property rent.
- [ ] Unit-level calculations never use whole-building values, or vice versa.
- [ ] Investor CTA routing is intent-matched and FTC disclosure remains adjacent.
- [ ] Unsupported commercial whole-building analysis degrades honestly.
- [ ] KPI baseline is captured after the agreed observation window.

### Evidence

- Commit/PR: _TBD_
- Production examples: _TBD_
- KPI readout: _TBD_

---

## P6 — Buyer parity and Owner / Manager journey

**Purpose:** complete the platform migration after the investor journey proves the shared contracts.

### Buyer convergence

- [ ] **[A] Move buyer result composition** onto subject + classification + capability contracts.
- [ ] **[A] Preserve current scoring, offer, narrative, email, and CTA behavior** for supported residential listings.
- [ ] **[A] Make mixed-use/unit context informative** without treating the containing building as the assessment subject.
- [ ] **[A] Compare old and new buyer outputs** across the P0 fixture set before default-on.

### Owner / Manager V1

- [ ] **[A+M] Select the smallest coherent V1:** rent benchmark, tax/assessment review, value tracking, or a combination supported by observed demand.
- [ ] **[A] Reuse saved properties and assessment-level assumptions.**
- [ ] **[A] Avoid purchase-offer language and buyer CTAs in owner mode.**
- [ ] **[A] Distinguish current landlord operations from prospective rental acquisition.**

### Exit gate

- [ ] Buyer parity review passes with no unexplained offer/valuation regressions.
- [ ] Buyer and owner modes use the same evidence without sharing inappropriate narrative or CTAs.
- [ ] Legacy country-specific paths have an explicit retention or retirement decision.
- [ ] Profile defaults, if added, remain removable preselects.

### Evidence

- Commit/PR: _TBD_
- Buyer parity report: _TBD_
- Owner V1 decision/readout: _TBD_

---

## I1 — Insurance distribution experiment (parallel after P4)

**Purpose:** validate demand and partner economics before building a deeper intake. This is not underwriting.

### Build and measure

- [ ] **[A] Establish the current insurance impression/click baseline** by surface and geography.
- [ ] **[A+M] Pre-register experiment eligibility, copy, success metrics, minimum observation window/sample, and stop conditions** before launch.
- [ ] **[A] Show insurance CTAs only where journey, property scope, geography, and partner coverage fit.**
- [ ] **[A] Separate homeowners and landlord-insurance messaging.**
- [ ] **[A] Track eligible impression → click → partner handoff;** capture downstream conversion only where the partner contract permits it.
- [ ] **[A] Keep county hazard context separate from quote eligibility or pricing claims.**
- [ ] **[M] Make the go/iterate/stop decision** from the pre-registered readout.

### Exit gate

- [ ] The experiment can be evaluated without relying on anecdotal clicks.
- [ ] No UI or copy claims that Property Insights underwrites, quotes, binds, or determines eligibility.
- [ ] A dated go/iterate/stop decision is recorded.

### Evidence

- Experiment spec: _TBD_
- Results: _TBD_
- Decision: _TBD_

---

## I2 — Coverage Profile intake (only after I1 go decision)

**Purpose:** prefill known facts, ask the user for missing facts, and hand a transparent coverage profile to an approved partner.

### Required gates before build

- [ ] **[M] I1 demonstrates sufficient demand/partner value** under the agreed test.
- [ ] **[M] Partner confirms accepted fields, attribution, state/province coverage, handoff mechanism, and downstream reporting.**
- [ ] **[M] Legal/privacy review covers disclosures, consent, retention, licensing posture, and sensitive insurance/claims inputs.**
- [ ] **[A] Data provenance is visible** so users can correct modeled or stale property facts.

### Candidate intake

- Known/prefilled where supported: resolved subject, address, property type/form, year built, size, value, rent estimate, regional context
- User-confirmed: occupancy/use, number of units, construction, roof and system ages, renovations, short-term rental use, claims, current coverage, and desired coverage

### Exit gate

- [ ] Every prefilled field is labeled and editable.
- [ ] Required unknowns are asked rather than inferred.
- [ ] Consent and partner handoff are explicit.
- [ ] The product remains described as matching, prequalification, or submission prefill—not underwriting.

### Evidence

- Partner requirements: _TBD_
- Legal approval: _TBD_
- Handoff QA: _TBD_

---

## X1 — Deferred data-expansion programs

These require separate approval and must not quietly expand the current phasemap.

### Municipal development intelligence

Possible after P3: zoning, permits, rezoning history, parcel assembly, entitlement, and redevelopment signals. Pilot one municipality at a time with a freshness/coverage model; do not infer entitlement from listing language.

### Non-residential commercial

Requires a provider/data audit for office, retail, industrial, mixed-use building financials, parcel/tenant/lease scope, and licensing/cost. Treat as a new data business, not an investor-view enhancement.

### Insurance underwriting

Requires property-level hazard and replacement-cost evidence, construction/system condition, protection/fire response, claims, carrier rules, actuarial validation, and a separate legal/licensing operating model. No phase is scheduled.

---

## Release strategy

1. **Additive contracts:** keep current `Listing` and country-specific outputs working while `PropertySnapshot`/subject/evidence contracts are introduced beside them.
2. **Fixture first:** every high-risk address/scope case gets an expected result before routing changes.
3. **Shadow classification:** compute and inspect P3 results before they suppress or add visible modules.
4. **Feature flag:** P4 journey UI rolls out independently of evidence collection and classification.
5. **No expensive refetch for view switching:** reuse the evidence bundle unless a user requests a module whose required source was intentionally deferred.
6. **Geo-specific rollout:** enable only where the capability matrix and fixtures pass; do not hide uneven coverage behind a global launch flag.
7. **Rollback:** disabling journey UI must return the existing buyer flow without requiring a data migration rollback.
8. **Shared-file coordination:** before P0/P1 work begins, record ownership for `src/app/api/assess/route.ts`, `src/lib/pipeline/us-assess.ts`, RentCast/Zoocasa mappers, and any shared result component. Coordinate with concurrent monetization/cron work; do not let parallel changes silently overwrite one another.
9. **Use the application data layer:** all persisted changes go through the repository's guarded KV/database abstractions. Do not add direct ad hoc production writes.
10. **Run the operational regressions:** changes touching assess, mapper, pipeline, or persistence paths must run `scripts/test-pipeline-guard.ts` and, in an appropriately configured integration environment, `scripts/verify-seeds.ts` with its default 20-random sample. Record the reproducible seed and before/after quota count.

## Progress scorecard

Update this table at each phase gate. Never aggregate away geography or subject scope.

| Metric | Baseline | Current | Target/gate | Last updated |
|---|---:|---:|---:|---|
| Baseline fixtures passing | 14/14 | 14/14 | 100% | 2026-08-11 |
| Assessments with resolved subject scope | TBD | TBD | Set after P2 shadow baseline | — |
| Assessments requiring clarification | TBD | TBD | Observe; no arbitrary minimization | — |
| Clarification completion rate | TBD | TBD | Set after P4 baseline | — |
| High-confidence classification coverage, US residential | TBD | TBD | Set after P3 report | — |
| High-confidence classification coverage, Canada by province | TBD | TBD | Set separately per province | — |
| Property-level modules shown without satisfied capability | TBD | TBD | **0** | — |
| Automatic journey switches caused by classification | 0 | 0 | **0** | — |
| Goal selection rate | N/A | N/A | Observe after P4 | — |
| Result-view switch rate | N/A | N/A | Observe after P4 | — |
| Investor results with address-level rent | TBD | TBD | Report separately from regional proxy | — |
| Insurance eligible impressions/clicks/handoffs | TBD | TBD | Pre-register in I1 | — |

## Decision log

| Date | Decision | Why | Revisit trigger |
|---|---|---|---|
| 2026-08-11 | Goal is explicit, optional, and per assessment | Users have different goals for different properties | Evidence that a profile default materially improves completion |
| 2026-08-11 | Classification never auto-switches the journey | Building class does not identify the intended unit, asset scope, or user intent | None; this is a correctness invariant |
| 2026-08-11 | Subject resolution precedes classification routing | Unit, building, parcel, and listing can share an address but require different evidence | None; contract may evolve but separation remains |
| 2026-08-11 | P4 rollout is surface-specific | On-demand assessments can preserve property evidence; 2,324/2,325 persisted Discover records predate P1 | Re-measure after guarded Discover refreshes materially increase envelope coverage |
| 2026-08-11 | `PropertySnapshot` is additive beside `Listing` initially | Avoid a high-risk big-bang rewrite of the live buyer flow | P6 buyer parity is complete |
| 2026-08-11 | Investor/Landlord is the first new journey | Strongest existing US data/calculation/CTA foundation | P3 capability report finds insufficient coverage |
| 2026-08-11 | Insurance distribution runs as an experiment; underwriting is deferred | Current data can prefill and contextualize, not price or determine eligibility | Separate data, partner, legal, and actuarial plan approved |
| 2026-08-11 | Non-residential commercial is a separate expansion | Current provider coverage excludes core commercial classes/financials | Approved provider and unit economics |
| 2026-08-11 | Owner names/mailing addresses excluded from P1 | Not necessary for V1; privacy/licensing burden exceeds current value | Documented product need plus governance review |
| 2026-08-11 | P0 hardens fallback labeling/contracts rather than redesigning the county fallback | Existing UI already says county-level, modeled, not property-specific, and approximate | A recorded fixture demonstrates a remaining misleading behavior |
| 2026-08-11 | P2 subject resolution makes no new provider calls | RentCast quota is the binding constraint and ambiguity can degrade to clarification | A separately approved quota/cost plan |
| 2026-08-11 | Capability reporting separates Discover seeds from on-demand assessments | `/listings/sale` sweeps and assessment bundles have structurally different evidence completeness | Discover gains a documented, universal enrichment contract |
| 2026-08-11 | Occupancy-driven personalization is counsel-gated | Preserving a field is different from using it for profiling, content, or affiliate routing | Counsel/privacy approval and implemented opt-out treatment |

## Immediate next implementation slice

P2 completed on 2026-08-11. Execute **P3 scope-aware classification and capability routing** next:

1. Classify resolved subject scopes without collapsing parcel, building, unit, listing, or occupancy evidence.
2. Compute module capabilities separately from classification.
3. Run both outputs in shadow mode before they affect visible modules.
4. Publish geo/scope/confidence coverage and conflict reports.
5. Prove with routing fixtures that classification never mutates the user goal or auto-switches a journey.

Do not add goal UI, persona routing, occupancy-driven personalization, or commercial financial claims in the P3 slice.
