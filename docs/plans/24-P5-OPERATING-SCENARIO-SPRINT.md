# 24 — P5 Operating Scenario Sprint

_Sequenced 2026-08-14 after the Canadian rental hierarchy passed locally.
Reconciled 2026-08-20: Canadian and US composition are implemented; curated
live cross-geo acceptance, owner-scoped persistence, and KPI gates remain open._

## Current status

- The operating-scenario math, Canadian composition, US composition, and
  capability/scope containment are implemented.
- The combined Property Intelligence fixture suite passed 143/143 across 11
  suites at the 2026-08-21 Sprint 25 close. That is contract evidence, not proof of
  the remaining live asset matrix.
- The 30-day re-baseline contained 2 recorded rental selections and 9 rental
  result views (3 supported, 2 limited, 4 unavailable). The sample is too
  small to close the KPI gate or justify expanding private persistence.
- Sprint 25 dependency/auth security closure passed on 2026-08-21. Insurance A2
  begins only after this sprint's curated live acceptance also closes.

## Outcome

Extend the existing gross rental screen into an optional operating scenario
without presenting modeled rent, missing expenses, or financing assumptions as
facts. Keep the first useful gross screen visible; detailed underwriting is a
supplemental expansion.

## Slice A — shared math and Canadian composition

**Implemented 2026-08-14.** Desktop browser acceptance passed for the recorded
Cosgrove and mapped-CMHC examples. Narrow/mobile and unmapped-CMHC curated live
acceptance remain open. The surface stores inputs only in component state and
makes no provider or persistence call.

- Add a country-neutral operating-scenario contract for user-supplied vacancy,
  maintenance, management, taxes, insurance, utilities, and other costs.
- Calculate NOI and cap rate only after every required operating input is
  explicitly supplied; zero is allowed, blank is unknown.
- Add optional financing inputs for down payment, interest rate, and
  amortization. Calculate debt service and cash flow only when that set is
  complete.
- Keep address rent/model estimates, regional benchmarks, and user assumptions
  visibly distinct.
- Render the detailed scenario collapsed beneath the existing Canadian gross
  screen. Do not add provider calls.

## Slice B — private persistence

**Not implemented. Deferred until the live matrix passes and usage evidence
supports collecting additional private assumptions.**

- Persist assumptions only to the authenticated, owner-scoped assessment—not
  the shared listing, Clerk profile, URL, or analytics.
- Define bounded numeric fields, deletion behavior, restore semantics, and
  data-usage copy before the additive schema migration.
- Do not deploy UI that claims **saved** until the production migration and
  owner-isolation tests pass.

## Slice C — US composition and acceptance

**Implemented 2026-08-14 behind the existing rental-journey route; live
provider acceptance remains open.** Provider capacity is an operational
prerequisite for the test run, not an acceptance substitute or scheduling
milestone.

- Reuse the same scenario contract beneath supported US rental results.
- A RentCast rent AVM may prefill a clearly modeled starting value but remains
  editable; HUD FMR never becomes the property rent input.
- Test one listed, one off-market, one regional fallback, and one unit/building
  scope mismatch. View changes and scenario edits must not refetch.

Implementation boundaries:

- Listed asking price and off-market AVM value are editable scenario starting
  points; editing never rewrites the evidence cards.
- RentCast address rent may prefill the editable rent input and remains labeled
  modeled. A missing address rent starts blank.
- HUD FMR stays a regional evidence card and can never seed the scenario input.
- County fallback, provider exclusions, conflicting evidence, and unit/building
  scope mismatches cannot render the operating calculator.

## Exit gate

- [x] Pure math fixtures cover blank vs zero, invalid rates, NOI/cap rate,
  mortgage payment, and cash flow with zero provider calls.
- [ ] Canadian desktop/mobile layout passes with and without CMHC context.
- [ ] Owner-scoped persistence migration and privacy tests pass. This remains a
  P5 phase gate but is explicitly outside the live-acceptance sprint; it does
  not block closing the matrix or beginning synthetic-only Insurance A2.
- [ ] US listed/off-market/fallback composition passes curated live acceptance.
- [x] No output labels a user assumption or regional benchmark as a property
  fact, cash-flow guarantee, or cap-rate projection with missing costs.

### Verification evidence

- P5: 17/17, zero provider calls.
- Render-shaped suite: 7/7; operating scenario is nested and collapsed.
- Local Cosgrove replay: one property identity, current `$815,000` offer /
  `$800,000` assessment / `1.30x` ratio; operating outputs remain withheld
  until rent plus all seven expense inputs are explicit.
- Completed local example: `$4,500` rent, 5% vacancy, and explicit monthly
  costs produced `$37,500` scenario NOI and 3.61% cap rate. Adding complete
  financing inputs produced separately labeled debt service and cash flow.
- Remaining Slice A acceptance: narrow/mobile viewport.
- Mapped-CMHC browser replay passed on `699-w-29th-ave`: the `$3,455/mo`
  Vancouver CMA benchmark remained regional context while user rent and the
  operating disclosure changed locally without an assessment refetch.
- US composition fixtures: supported evidence renders an editable modeled-rent
  basis; missing rent starts blank; HUD-only fallback and unit/building scope
  mismatch render no operating calculator. Live provider acceptance remains
  intentionally pending.

## Remaining curated acceptance matrix

Execution and closure evidence now follow
`25-P5-LIVE-ACCEPTANCE-SPRINT.md`; the table below remains the scope summary.

Run after the Sprint 25 deployment/validation and record the exact URL, timestamp,
subject scope, capability reasons, provider-call count, desktop/mobile result,
and any console/server error:

| Case | Required proof | Status |
|---|---|---|
| CA residential, mapped CMHC | Regional benchmark remains separate; scenario stays local; desktop and narrow/mobile render cleanly | Desktop recorded; narrow/mobile open |
| CA residential, no mapped CMHC | User-rent scenario remains usable without inventing a benchmark | Open |
| CA land/commercial/institutional exclusion | Residential calculator, offer narrative, and incompatible partner actions stay withheld | Automated fixtures pass; curated live replay open |
| US active listing | Asking-price basis and address rent remain correctly sourced and editable only in the scenario | Open |
| US off-market property | AVM/value and address-rent provenance remain distinct | Open |
| US county/regional fallback | No operating calculator appears without supported property-level evidence | Automated fixture passes; live replay open |
| US unit/building mismatch | No unit rent is divided by a whole-building value, or vice versa | Automated fixture passes; live replay open |

For every applicable case, switching focus and editing assumptions must produce
zero assessment/provider refetches. A pass requires no scope substitution, no
property-level overclaim, no unsupported CTA, and no misleading saved-state
language.

## Sequencing decision

1. Deploy the closed Sprint 25 changes, then run and record the curated matrix above.
2. Hold Slice B persistence and P6 until the matrix passes and the telemetry
   sample can support a product decision.
3. Begin Insurance A2 only after the live matrix closes; A2 remains synthetic and
   does not expand the public quote/bind boundary.
