# 24 — P5 Operating Scenario Sprint

_Sequenced 2026-08-14 after the Canadian rental hierarchy passed locally. US
live composition waits for the RentCast credit reset; the math and Canadian
surface do not require a provider call._

## Outcome

Extend the existing gross rental screen into an optional operating scenario
without presenting modeled rent, missing expenses, or financing assumptions as
facts. Keep the first useful gross screen visible; detailed underwriting is a
supplemental expansion.

## Slice A — shared math and Canadian composition

**Implemented locally 2026-08-14; desktop browser acceptance passed.** The
surface stores inputs only in component state and makes no provider or
persistence call.

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

- Persist assumptions only to the authenticated, owner-scoped assessment—not
  the shared listing, Clerk profile, URL, or analytics.
- Define bounded numeric fields, deletion behavior, restore semantics, and
  data-usage copy before the additive schema migration.
- Do not deploy UI that claims **saved** until the production migration and
  owner-isolation tests pass.

## Slice C — US composition and acceptance

- Reuse the same scenario contract beneath supported US rental results after
  credits reset.
- A RentCast rent AVM may prefill a clearly modeled starting value but remains
  editable; HUD FMR never becomes the property rent input.
- Test one listed, one off-market, one regional fallback, and one unit/building
  scope mismatch. View changes and scenario edits must not refetch.

## Exit gate

- [x] Pure math fixtures cover blank vs zero, invalid rates, NOI/cap rate,
  mortgage payment, and cash flow with zero provider calls.
- [ ] Canadian desktop/mobile layout passes with and without CMHC context.
- [ ] Owner-scoped persistence migration and privacy tests pass.
- [ ] US listed/off-market/fallback composition passes after credits reset.
- [x] No output labels a user assumption or regional benchmark as a property
  fact, cash-flow guarantee, or cap-rate projection with missing costs.

### Verification evidence

- P5: 14/14, zero provider calls.
- Render-shaped suite: 4/4; operating scenario is nested and collapsed.
- Local Cosgrove replay: one property identity, current `$815,000` offer /
  `$800,000` assessment / `1.30x` ratio; operating outputs remain withheld
  until rent plus all seven expense inputs are explicit.
- Completed local example: `$4,500` rent, 5% vacancy, and explicit monthly
  costs produced `$37,500` scenario NOI and 3.61% cap rate. Adding complete
  financing inputs produced separately labeled debt service and cash flow.
- Remaining Slice A acceptance: narrow/mobile viewport and a city with mapped
  CMHC context.
