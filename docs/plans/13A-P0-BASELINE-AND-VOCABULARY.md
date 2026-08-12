# Property Intelligence P0 — Baseline and Vocabulary

_Created 2026-08-11. Evidence artifact for P0 in `13-PROPERTY-INTELLIGENCE-PHASEMAP.md`._

## P0 scope

P0 hardens the existing US fallback contract. It does not add a classifier, subject resolver, goal selector, persona journey, provider call, property-use failpath, or new persisted property model.

The existing fallback presentation is already appropriately qualified:

- Label: **County Median Home Value — Modeled Estimate**
- Disclosure: **Based on US Census ACS county-level median ([year]), not property-specific. Treat as approximate.**

P0 preserves that presentation and adds a machine-readable reason describing why address-level property evidence was unavailable.

## Shared vocabulary

| Term | Meaning | Not interchangeable with |
|---|---|---|
| **Assessment subject** | The real-world entity the user means to evaluate | The text address or containing building |
| **Subject scope** | Listing, unit, building, parcel, or unresolved | Property class |
| **Containing entity** | A building or parcel that contains the selected subject | The selected subject itself |
| **Evidence** | A sourced observation, model output, inference, or user-supplied fact | A final product claim |
| **Classification** | A confidence-tagged description of a resolved subject at a stated scope | User intent/persona |
| **Capability** | Whether available evidence supports a specific module for this subject | Whether the user wants the module |
| **Goal** | The user’s explicit purpose for this assessment | A permanent profile label |
| **Journey** | The result composition used to help with the selected goal | Property classification |
| **Degraded result** | A result limited to honest regional/source context because property-level evidence is unavailable | A verified unsupported property class |
| **Unsupported reason** | A verified explanation that a module cannot apply at the resolved scope | Unknown or missing data |

## Confirmed product decisions

1. Classification never auto-switches a journey.
2. Goal is optional and belongs to an assessment, not permanently to a user.
3. Subject resolution precedes classification-driven routing.
4. Unknown or conflicting evidence clarifies or degrades neutrally.
5. P2 subject resolution uses only already-fetched evidence.
6. Occupancy-driven personalization is blocked pending counsel/privacy review.
7. V1 goal vocabulary for later P4 design:
   - `buy_home` — Buying a home
   - `rental_investment` — Rental investment
   - `own_manage` — I own or manage it
   - `explore` — Explore everything
8. Development/renovation is deferred as a top-level goal until capability coverage supports the promise.

## Baseline fixture contract

The offline harness is `scripts/test-property-intelligence-p0.ts`. These are evidence-shape fixtures, not claims that P0 can already resolve the described real-world subject.

| Fixture | Existing/P0 data path | Required P0 behavior | Deferred work |
|---|---|---|---|
| Confirmed detached residential listing | Listed | Existing result unchanged | Classification in P3 |
| Explicit residential unit listing | Listed | Do not reinterpret the containing building as the subject | Entity resolution in P2 |
| Multi-unit address without unit | Off-market when record/AVM exists | Do not auto-switch or invent unit scope | Clarification in P2/P4 |
| Residential unit in potentially mixed-use building | Listed when listing exists | Do not fail based on containing-building use | Scoped classification in P3 |
| Vacant-land record/AVM | Off-market | Do not claim land/development capability yet | Classification/capabilities in P3 |
| Government/institutional clean miss | Regional fallback | `property_record_not_found`; no verified class claim | Verified failpath after P2/P3 |
| Generic geocodable clean miss | Regional fallback | `property_record_not_found`; unknown remains unknown | P2/P3 |
| Provider quota exhausted | Regional fallback | `provider_quota_exhausted`; no retry/new call | Provider economics remain external |
| Provider error/bundle failure | Regional fallback | `provider_error`; no retry/new call | Operational monitoring |
| Rent-only bundle | Regional fallback | Rent alone does not become a valuation/offer | Capability routing in P3 |
| AVM without property identity | Regional fallback | Withhold modeled value; scope may be unit, building, or parcel | Clarification/evidence expansion |
| Property record with listing lookup blocked | Regional fallback | Do not claim the property is off market | Provider availability |

## Machine-readable fallback reasons

| Reason | Meaning | User-visible behavior in P0 |
|---|---|---|
| `property_record_not_found` | Provider calls completed without usable record, AVM, or listing evidence | Existing regional fallback |
| `property_identity_not_found` | Modeled values were returned without a matching property identity record | Withhold ambiguous values and explain unresolved unit/building/parcel scope |
| `provider_quota_exhausted` | One or more required lookups were blocked by the quota guard and no usable property evidence remained | Explicitly says RentCast was not checked; regional fallback remains clearly labeled |
| `provider_error` | Provider call/bundle failed and no usable property evidence remained | Explicitly says listing status could not be confirmed; regional fallback remains clearly labeled |

These reasons explain evidence availability. They do not classify the property.

## Sprint-close verification record

| Check | Result | Evidence |
|---|---|---|
| P0 offline fixtures | **PASS — 20/20** | `npx tsx scripts/test-property-intelligence-p0.ts`; includes quota-vs-miss, endpoint outcome, and identity/scope copy contracts added 2026-08-12 |
| King County unit-scope fixtures | **PASS — 3/3** | `npx tsx scripts/test-king-unit-scope.ts`; unit-tagged exact match is not treated as the whole property |
| Pipeline guard | **PASS — 16/16** | `npx tsx scripts/test-pipeline-guard.ts`; fake KV; live RentCast calls blocked |
| TypeScript | **PASS** | `npm exec tsc -- --noEmit` |
| Touched-file lint | **PASS** | `npm exec eslint -- src/app/api/assess/route.ts src/components/us-assessment-result.tsx src/lib/property-intelligence/p0-fallback.ts scripts/test-property-intelligence-p0.ts` |
| 20-random integration harness | **PASS — 20/20** | `npx tsx scripts/verify-seeds.ts 20 3905 20260811`; quota `45 → 45` |
