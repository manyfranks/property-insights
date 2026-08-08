# US Advantage Layer — Design Spec

_Built 2026-08-07. Implements src/lib/pipeline/us-advantage.ts + integration into src/app/api/assess/route.ts (`handleUSAssessment`) + rendering in src/components/us-assessment-result.tsx. Zero RentCast API calls — all computation runs off data already fetched by the existing pipeline (RentCast bundle + regional_econ county panel) plus pure math. Unit-tested in scripts/test-us-advantage.ts (79 assertions, all passing)._

## Why this exists

The CA product (BC/AB/ON) anchors on Zoocasa's MLS remarks text: keyword-driven motivation signals (`src/lib/signals.ts`, `src/lib/scoring.ts`), a 2-point valuation anchor (assessment + asking), and no per-property rent, county risk, or ownership-history data. RentCast's free tier returns **no MLS remarks** at all (confirmed during the POC), so every text-keyword signal in the shared pipeline structurally can't fire for US listings — `src/lib/pipeline/us-assess.ts`'s module doc already documents this gap.

The directive: don't just patch that gap back to CA parity — the US data RentCast *does* return (sale history, tax-assessment history, an AVM with comps, a rent estimate) plus the county panel already ingested (`src/lib/db/regional-econ.ts`: HPI, vacancy, FMR, FEMA) supports five signals **with no CA equivalent**. This doc specifies those five, the thresholds chosen, and how they're rendered.

If/when a paid RentCast tier adds MLS remarks, the existing keyword signals in signals.ts/scoring.ts start firing again on their own — nothing in this layer needs to change; it's additive, not a replacement architecture.

## Architecture

- **`src/lib/pipeline/us-advantage.ts`** — pure functions only. Each signal is computed by a standalone exported function (record/panel shapes in, plain data out, zero I/O). `buildUsAdvantageBundle()` is the single integration entry point that composes all five from the inputs `handleUSAssessment` already has in hand.
- **Not wired through `signals.ts`/`scoring.ts`/`offer-model.ts`** — those are shared with the CA pipeline. Touching them risks shifting CA's weights. Instead:
  - The equity/tenure signal's score contribution is applied *after* `scoreV2()` runs, via `applyEquitySignalToScore()` — entirely in the US-only code path. CA never calls it, so CA scoring is provably unaffected (verified: `src/lib/scoring.ts` has zero diff).
  - The equity/tenure chip label is spliced into the `signals` string array in `route.ts`, not inside `getSignals()`.
  - Triangulation, investor yield, risk/momentum, and the over-assessment flag are new sibling fields on the API response (`equitySignal`, `triangulation`, `investorYield`, `riskMomentum`, `overAssessment`), alongside the existing US-only `comparables` field — following the pattern already established for `UsCompSupport`, not extending the shared `OfferResult`/`Assessment` types from `src/lib/types.ts`.
- **route.ts integration**: one `buildUsAdvantageBundle()` call per branch (listed + off-market). The fallback branch (no RentCast record at all) has no basis for any of this and is unchanged.
- **Off-market properties get the layer too**: no active listing means no true asking price, so `askingPrice: null` is passed and the AVM value stands in as `currentValueEstimate`, tagged `currentValueKind: "avm_estimate"` so every narrative stays honest about what it's comparing against rather than silently pretending an AVM number is an asking price.

## Signal 1 — Seller Equity & Tenure (`computeEquityTenureSignal`)

The "crown jewel": RentCast's sale history (`lastSaleDate` + `lastSalePrice`) turns into a structural distress/flip/flexibility read — the direct replacement for the keyword signals that can't fire for US listings.

**Inputs**: property record (last sale date/price), current value estimate (asking price or AVM), county HPI 5-year trend.

**Computed**:
- `holdYears` — years since `lastSaleDate`.
- `impliedAppreciationPct` — `(currentValueEstimate - lastSalePrice) / lastSalePrice`. Explicitly documented as a **proxy**, not real equity — it doesn't net out any mortgage balance or paydown, which RentCast's free tier doesn't expose.
- `hpiImpliedValue` — `lastSalePrice` grown forward at the county's annualized HPI rate (`(1 + hpiTrend5y)^(1/5) - 1`) over `holdYears`. An independent corroboration check: does the current value estimate track county-wide appreciation, or diverge from it?
- `hpiCorroboration` — `consistent` (within ±8% of the HPI-implied value) / `below_hpi_trend` / `above_hpi_trend` / `no_hpi_data`.

**Tiers and thresholds** (evaluated in this priority order — loss-sale and flip are checked before long-tenure so a short, underwater hold is never miscategorized just because the percentages also happen to cross the long-tenure bar):

| Tier | Condition | Motivation | Score points |
|---|---|---|---|
| `loss_sale_distress` | hold ≤ 5yr **and** current value ≤ 98% of purchase price | high | **20** |
| `short_hold_flip` | hold ≤ 2yr **and** current value ≥ 115% of purchase price | moderate | **10** |
| `long_tenure_high_equity` | hold ≥ 10yr **and** implied appreciation ≥ 50% | moderate | **6** |
| `moderate_hold` | none of the above | none | 0 |

Threshold rationale:
- **Loss-sale, 5yr / 98%**: a 5-year window is generous enough to still plausibly mean "owes more than they'll net" (mortgages are barely dented that early), while the 98% (not 100%) cutoff avoids false-triggering on rounding/negotiation noise right at breakeven.
- **Flip, 2yr / 115%**: RentCast's data alone can't distinguish "investor flip" from "owner sold quickly for personal reasons" beyond hold length and markup size, so this stays conservative — short enough to read as a flip, with enough markup (15%+) that it looks like a value-add resale rather than a wash sale.
- **Long-tenure, 10yr / 50%**: a decade is roughly the point most conventional mortgages are substantially paid down regardless of price movement, and the 50%+ appreciation corroborates there's real cushion, not just time elapsed.
- **HPI consistency band, ±8%**: matches the medium-confidence spread band used in valuation triangulation (below), for one consistent "how much disagreement is meaningful" standard across the whole layer.

**Missing sale history** (no `lastSaleDate`/`lastSalePrice`, or no `record` at all) → `computeEquityTenureSignal` returns `null`. Callers treat `null` as "no signal," not an error — this is the documented graceful-degradation path (RentCast doesn't have a transaction on file for every address).

**Score integration** (`applyEquitySignalToScore`): adds `scorePoints` on top of `scoreV2()`'s total (capped at 100, same 33/45 WATCH/WARM/HOT boundaries `scoring.ts` uses), and records the tier's label in the breakdown. Weighted against `scoring.ts`'s existing CA scale (Estate/Distress=18, Price Reduced=15, Must Sell=12): a **verified**, structurally-confirmed below-purchase-price ask is a stronger signal than a keyword match, so it sits above Estate/Distress at 20. The flip and long-tenure tiers read as *negotiation leverage*, not desperation, so they're weighted well below — 10 and 6.

**Rendering**: the tier label is spliced into the "Motivation Signals" chip list (as done for every other signal), **plus** its own bento card ("Seller Equity & Tenure") showing hold period, last sale price, implied change, HPI corroboration, and the full narrative sentence — proportionate to its "crown jewel" billing, not just a chip.

## Signal 2 — Valuation Triangulation (`triangulateValuation`)

CA's `offer-model.ts` anchors on exactly 2 points: assessment and asking. RentCast supports up to 4 independent anchors:

1. **Tax-assessed value** — from `record.taxAssessments[0]`.
2. **RentCast AVM** — the model's own value estimate.
3. **Asking price** — only when there's an active listing (never populated from an AVM stand-in — that would double-count the AVM anchor).
4. **Comp $/sqft implied value** — `buildUsCompSupport().impliedValue` from `src/lib/pipeline/us-assess.ts`, already computed from the AVM's own comparables with zero extra RentCast calls.

**Basis-correction**: the tax-assessed anchor is **excluded** when `assessmentBasis === "acquisition_value"` (California's Prop 13 and similar acquisition-value schemes — see `assessmentBasisForState()` in `rentcast.ts`). Those states assess on purchase price + a small annual cap **by design**, not market value — including that number as a market-value anchor would corrupt the triangulation with a value that's *expected* to diverge from market, not a soft proxy for it.

**Confidence bands**, keyed on spread = `(max - min) / median` across the anchor set:

| Spread | Confidence |
|---|---|
| ≤ 10% | high |
| ≤ 25% | medium |
| > 25% | low |
| < 2 anchors | insufficient |

10%/25% chosen so "high confidence" means genuinely tight agreement between independently-sourced numbers (a government tax roll, a statistical model, the market's own asking price, and a comp-based estimate rarely land within 10% of each other by coincidence), while the 25% ceiling still allows "medium" for the common case of a stale tax assessment dragging the median around.

**Rendering**: an expandable "Valuation triangulation" section (methodology detail, not a headline number — the actual offer still comes from `offer-model.ts`'s own 2-point anchor, unchanged) listing each anchor, the triangulated median, the confidence badge, and the agreement note. Present on both the listed and off-market views.

## Signal 3 — Investor Yield (`computeInvestorYield`)

CA has no per-property rent estimate at all. RentCast's `/avm/rent/long-term` gives one for free.

**Computed**:
- `grossYieldPct` = `(monthlyRent × 12) / price`.
- `rentToPriceRatio` = `monthlyRent / price`.
- `onePercentRuleMet` = `rentToPriceRatio ≥ 1%` — the standard investor screening heuristic (monthly rent at least 1% of purchase price), kept as a fixed, widely-recognized rule of thumb rather than a tuned parameter.
- `fmr2brDeltaPct` = `(monthlyRent - countyFmr2br) / countyFmr2br`, using HUD's county 2BR Fair Market Rent from `regional_econ`. Null when the county has no FMR-2BR figure — the yield numbers still compute and render, just without the FMR comparison clause in the verdict text (a graceful degradation the test suite exercises explicitly).

Returns `null` only when there's no price or no rent estimate to work from at all.

**Rendering**: a new bento card ("Investor Yield") — gross yield as the headline stat, a 1%-rule badge, and the verdict sentence (FMR comparison included when available).

## Signal 4 — Risk & Momentum (`computeRiskMomentum`)

Condenses the county panel's HPI trend, vacancy rate, and FEMA per-hazard scores into one offer-adjacent note. No CA equivalent — no county-level risk/momentum panel exists there.

**Momentum**, from `hpiTrend5y` (the ~5-year cumulative HPI ratio already computed in `regional-econ.ts`):

| Threshold | Momentum |
|---|---|
| ≥ 15% cumulative | accelerating |
| 0–15% | steady |
| < 0% | cooling |
| no data | unknown |

15% cumulative over ~5 years is roughly >2.8%/yr compounded — a reasonable line between "ordinary appreciation" and "a market running hot enough to matter for offer strategy."

**Vacancy**: flagged elevated at **≥ 8%** ACS rental vacancy — roughly double the tight-market norm most metro counties run at, a simple/legible bar for "this market reads soft for a landlord."

**Top perils**: FEMA NRI per-hazard scores are 0–100 national percentiles. **≥ 50** ("more exposed than at least half of US counties for this specific peril") is the bar for surfacing a hazard by name; the top 2 by score are shown.

**Rendering**: a new bento card ("Risk & Momentum") with a momentum badge, up to 2 peril chips, and the condensed note (e.g. _"county home values are cooling (-2.1% over ~5yr) — supports a more aggressive offer; elevated wildfire risk (score 97/100) — factor insurance costs into the offer."_).

## Signal 5 — Over-Assessment Flag (`computeOverAssessmentFlag`)

Flags a potential property-tax-appeal opportunity when the market reference (the triangulated value from Signal 2, or the current value estimate as a fallback) sits **≥ 8% below** the tax-assessed value.

**8% threshold**: large enough that it's not just ordinary noise between a government tax roll (often a year or more stale) and a live market read, but plausible enough to be worth a homeowner's time pursuing a formal appeal.

**Excluded for acquisition-value states** (same basis-correction as Signal 2): Prop-13-style assessed values are *expected* to lag market by design, so a gap there isn't evidence of a mis-assessment — it never triggers regardless of gap size.

**Rendering**: a highlighted blue callout (not a bento card) positioned directly above the "Next Steps" CTA block, on both the listed and off-market views. This is the deliberate pairing with the **Ownwell tax-appeal CTA** (`src/config/affiliate-vendors.ts`, `vertical: "tax-appeal"`) — the flag makes that CTA contextually relevant ("here's specifically why this applies to you") instead of a generic pitch shown regardless of the property's numbers. Only renders when the flag actually triggers.

## Modeled-estimate disclaimers

Every number in this layer is derived from RentCast's AVM/rent model, a possibly-stale government tax roll, or county-level Census/FHFA/HUD/FEMA aggregates — never a signed lease, a confirmed sale, or a fresh appraisal. Every rendering component carries an explicit disclaimer line (e.g. "Modeled from RentCast sale history — the appreciation figure doesn't account for any mortgage balance or paydown," "Modeled estimate — based on RentCast's rent AVM, not a signed lease"), consistent with the disclaimer treatment already used for the AVM-anchored assessment and offer.

## Testing

`scripts/test-us-advantage.ts` — pure fixture-driven tests, zero network/KV/DB calls, run via `npx tsx scripts/test-us-advantage.ts`. Covers: long-tenure equity, loss-sale distress, short-hold flip, missing/null sale history (graceful degradation), moderate-hold (no chip/no score bump), score-cap-at-100, tight vs. wide triangulation spread, acquisition-value-state exclusion, insufficient/zero anchors, yield with/without FMR data, missing price/rent, accelerating/cooling/unknown momentum, vacancy flag, top-peril filtering, over-assessment trigger/non-trigger/acquisition-value-exclusion/missing-data, and two full `buildUsAdvantageBundle()` integration cases (a listed short-hold-flip property and an off-market long-tenure property). **79/79 assertions pass.** `npx tsc --noEmit` is clean across the new module, the route, the component, and the test script.
