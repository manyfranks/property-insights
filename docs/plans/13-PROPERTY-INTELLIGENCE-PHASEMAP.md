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
| **P0 — Safety baseline** | `[x] Complete; quota/scope regressions hardened 2026-08-12` | Prevent address-only residential overclaims; lock vocabulary and fixtures | None | 20/20 P0 fixtures; 3/3 King unit-scope; 16/16 guard; 20/20 integration |
| **P1 — Evidence preservation** | `[x] Complete 2026-08-11` | Stop discarding classification evidence from RentCast, Zoocasa, and assessments | P0 | Field matrix + mapper fixtures |
| **P2 — Subject resolution** | `[x] Complete 2026-08-11` | Distinguish listing, unit, building, parcel, and unknown subjects | P1 | 23/23 resolver fixtures + common subject envelope |
| **P3 — Classification/capabilities** | `[~] In progress — shadow built; P3.5 acceptance active 2026-08-11` | Confidence-tagged, scope-aware classification and honest module availability | P2 | Shadow-mode report + routing fixtures |
| **P4 — Goal UX/instrumentation** | `[~] Result hierarchy correction built; post-deploy acceptance pending 2026-08-14` | Optional per-assessment goal, conditional scope clarification, private restore, manual view switching | P3 | Funnel events + route-specific rollout |
| **P5 — Investor/Landlord V1** | `[~] CA land containment built 2026-08-14; post-deploy acceptance pending` | Address-level US rental screen; capability-gated Canadian version | P4 | End-to-end journey QA + KPI baseline |
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
- Fixture report: `13A-P0-BASELINE-AND-VOCABULARY.md`; 20/20 offline fixtures
- Quota/address/scope regression: `20-SEATTLE-QUOTA-REGRESSION.md`; provider endpoint outcomes and unresolved identity are visibly distinct
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
- Rollout boundary: P4 uses the on-demand journey route after production telemetry verification; Discover listing records remain excluded from direct capability-driven persona rendering until evidence-envelope coverage is measured and sufficient
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
- [x] **[A] Store goal with the assessment/saved property.** Initial goal, active view, and user-confirmed scope live in an owner-scoped private assessment record—not the shared listing or a permanent profile persona.
- [ ] **[A] Add an optional signed-in default** only after the assessment-level flow is stable; it may preselect, never lock.
- [x] **[A] Keep rollout surface-specific:** Discover goal handoffs use the journey route while plain `/assess` retains buyer behavior until P6. No permanent environment switch.

### Exit gate

- [ ] Users can correct scope and change views without re-entering the address.
- [ ] No classification path automatically changes the selected journey.
- [ ] Funnel events answer: which goals are selected, where clarification occurs, which views users switch to, and which capabilities are missing.
- [ ] Existing buyer flow remains available and regression-tested on plain `/assess`.
- [ ] Mobile and desktop flows pass browser QA.

### Evidence

- Commits: `d850e44` (`Add flagged P4 assessment journey preview`), `87c18c8` (`Record P4 preview acceptance`), `ca903bb` (`Persist private P4 assessment journeys`)
- Event query/dashboard: `scripts/report-property-journeys.ts`; production aggregate verified 2026-08-11
- Browser QA: `18-P4-GOAL-UX-SPRINT-A.md`; plain-flow parity, signed-in journey routing, no-refetch switching, and 390px/1280px responsive checks pass
- Private persistence/privacy: `19-P4-SPRINT-B-PERSISTENCE-PRIVACY.md`; production migration, owner-isolation round trip, signed-in restore, and `1 -> 1` duplicate guard pass 2026-08-12
- Containment decision (2026-08-14): URL subject scope is never authoritative; CA confirmation persists before redirect; no non-durable version marker or permanent journeys env flag. See `21-JOURNEYS-ROLLOUT-POLICY.md`.
- Post-deploy acceptance: _pending_

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
- [x] **[A] Separate address-level expected rent from regional benchmark rent** in UI, narrative, and types.
- [x] **[A] Rename “Investor Flip” to “Short-hold resale pattern”** and remove claims that renovation or seller motivation is proven.
- [ ] **[A] Show gross yield by default;** show cash flow/cap rate only when required expenses are known or user-supplied.
- [ ] **[A] Add inputs for financing, vacancy, maintenance, management, utilities, insurance, and other operating costs** without blocking the first useful result.
- [x] **[A] Feed real journey state** into `AudienceMode` and `result-investor` CTA surfaces.
- [x] **[A] Capability-gate Canadian output:** no address-level rent language when only CMA/CMHC data exists; land/improvement insight only where the split exists.
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

- Sprint A (2026-08-13): US on-demand rental composition responds to the explicit assessment goal without refetching; it separates RentCast address-rent evidence from HUD county FMR, shows gross screening before buyer analysis, and routes eligible CTAs through the investor audience/surface. Classification and occupancy are not inputs.
- Surface correction (2026-08-13): Discover property details now hand explicit goals into the enriched assessment flow instead of silently bypassing journeys. Unresolved multi-unit assessments withhold AVM/rent and avoid claiming that no unit in the building is listed.
- Cross-country correction (2026-08-13): Canadian rental focus now renders a limited, interactive user-rent scenario against the listing price, with CMHC shown only where available and always labeled regional. RentCast `Multi-Family`/`Apartment` rent AVMs are explicitly scoped to one unit while value/listing evidence remains whole-building, preventing false building yields such as the Salt Lake City acceptance case.
- Acceptance failure (2026-08-14): production records `2496-rosstown-rd` and `1827-main-st` both contain high-confidence Zoocasa `Land` evidence and deterministic `listingScope: parcel`, but `parcelUse` remains `unknown`. `residentialExclusion()` reads `parcelUse`, not the resolved listing-scope land decision, so rental/offer/insurance capabilities report `missing_field` or `available` instead of `provider_exclusion`. Both pages consequently present the four-goal handoff and residential partner CTAs; `1827-main-st` also renders unsupported seller-motivation narrative. P5 acceptance is paused pending `22-CA-LAND-LISTING-CONTAINMENT-SPRINT.md`.
- Containment implementation (2026-08-14): deterministic/high-confidence `listingScope: parcel` now excludes residential valuation, rent, offer, gross-yield, and insurance capabilities without promoting listing evidence into `parcelUse`. A read-time reconciliation contains pre-fix persisted envelopes. Property pages use a collapsed focus control below the primary result, withhold incompatible partner actions, and replace land offer/motivation output with evidence-scoped land price context. Local browser replay against both stored records passed; production replay remains the release gate.
- Result-hierarchy correction (2026-08-14): production replay of `2820-cosgrove-cres` showed that Sprint 22 moved the base-property handoff but not the journey result wrapper. Explicit handoff goals now bypass the redundant chooser, and CA plus all US result variants render one collapsed focus switch after the address and primary offer/value surface. See `23-ASSESSMENT-FOCUS-RESULT-HIERARCHY.md`.
- Production cache/layout correction (2026-08-14): the first deployed Cosgrove rental replay proved the hierarchy but exposed a duplicate nested address and a stale, internally inconsistent cached offer/assessment snapshot. Assessment-origin property reads now bypass the five-minute KV fetch cache, cached language offers cannot render an assessment ratio, and the result identity renders once. US provider-backed live acceptance is deferred until the monthly credit reset; no US call is required for this correction.
- Contract fixtures: `scripts/test-property-intelligence-p5.ts` covers explicit-goal routing, supported address-level output, regional-only degradation, capability withholding, legacy composition parity, and zero provider calls.
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
4. **Surface-specific route:** journey UI rolls out through explicit product entry points independently of evidence collection and classification; do not accumulate permanent per-feature environment modes.
5. **No expensive refetch for view switching:** reuse the evidence bundle unless a user requests a module whose required source was intentionally deferred.
6. **Geo-specific rollout:** enable only where the capability matrix and fixtures pass; do not hide uneven coverage behind a global launch flag.
7. **Rollback:** a release revert must return the existing buyer flow without requiring a data migration rollback. Any emergency runtime switch must ship with an owner, expiry date, and deletion issue.
8. **Shared-file coordination:** before P0/P1 work begins, record ownership for `src/app/api/assess/route.ts`, `src/lib/pipeline/us-assess.ts`, RentCast/Zoocasa mappers, and any shared result component. Coordinate with concurrent monetization/cron work; do not let parallel changes silently overwrite one another.
9. **Use the application data layer:** all persisted changes go through the repository's guarded KV/database abstractions. Do not add direct ad hoc production writes.
10. **Run the operational regressions:** changes touching assess, mapper, pipeline, or persistence paths must run `scripts/test-pipeline-guard.ts` and, in an appropriately configured integration environment, `scripts/verify-seeds.ts` with its default 20-random sample. Record the reproducible seed and before/after quota count.

## Progress scorecard

Update this table at each phase gate. Never aggregate away geography or subject scope.

| Metric | Baseline | Current | Target/gate | Last updated |
|---|---:|---:|---:|---|
| Baseline fixtures passing | 16/16 | 20/20 | 100% | 2026-08-12 |
| Assessments with resolved subject scope | TBD | TBD | Set after P2 shadow baseline | — |
| Assessments requiring clarification | TBD | TBD | Observe; no arbitrary minimization | — |
| Clarification completion rate | TBD | TBD | Set after P4 baseline | — |
| High-confidence classification coverage, US residential | TBD | TBD | Set after P3 report | — |
| High-confidence classification coverage, Canada by province | TBD | TBD | Set separately per province | — |
| Property-level modules shown without satisfied capability | TBD | **>0: CA listing-only land** | **0** | 2026-08-14 |
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
| 2026-08-14 | Journeys use an explicit product route, not a permanent environment mode | Stacked feature switches obscure production behavior and become technical debt; plain `/assess` still preserves buyer parity | P6 deliberately migrates the plain assessment flow |
| 2026-08-14 | Only durable `user_confirmation` provenance restores subject scope | URL scope is forgeable and an application-only version disappears on DB reads | Persistence schema or trust contract changes |
| 2026-08-14 | Pause broad P5 acceptance for listing-only land containment | Real CA land listings resolve to parcel scope but bypass residential exclusions, partner gating, and narrative safeguards | Sprint 22 fixtures and curated acceptance matrix pass |
| 2026-08-14 | Assessment focus is a supplemental result control | A user already selected a goal at handoff; repeating the chooser and placing focus above the property result makes routing state look like the product's primary output | Sprint 23 post-deploy replay fails the fixed order or needs a refetch |

## Immediate next implementation slice

Deploy and accept the **Sprint 23 assessment-focus cache/layout correction**, then begin **Sprint 24 operating scenarios**:

1. Deploy the focus-hierarchy correction.
2. Replay the exact `2820-cosgrove-cres` buy-home result and its rental switch.
3. Confirm the property handoff starts lookup without a second goal chooser.
4. Begin the Canada/offline Sprint 24 math and composition fixtures without
   provider calls.
5. After US credits reset, spot-check one US listed result and one US
   off-market/fallback result, then integrate the shared operating scenario.
6. Add owner-scoped assumption persistence only through an explicit additive
   schema/privacy slice; do not hide it inside the calculator UI patch.
7. Resume the remaining curated asset matrix after the cross-geo checks pass;
   keep occupancy personalization and commercial financial claims out of scope.
