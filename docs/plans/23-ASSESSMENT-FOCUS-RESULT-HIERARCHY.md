# 23 — Assessment Focus Result Hierarchy Correction

_Created 2026-08-14 from the production replay of
`2820-cosgrove-cres`. This is a P4 composition correction, not a new persona or
data-provider feature._

## Production defects

1. A property-page handoff already carried `assessmentGoal=buy_home`, but
   `/assess` ignored that completed choice when initializing the flow and
   presented a second **What are you trying to decide?** screen.
2. Once the result rendered, the journey wrapper placed an expanded four-goal
   **Assessment focus** panel before the address and recommended offer. Sprint
   22 had moved the base-property handoff, not this separate result wrapper.

## Product contract

- Goal choice at handoff is sufficient. An explicit valid goal starts the
  assessment immediately; the chooser remains only for journey entries with no
  goal.
- Goal is per-assessment view state, never a permanent persona label and never
  a reason to change property facts.
- Result order is: **property identity → primary offer/value → one collapsed
  focus switch → goal-specific module → remaining report**.
- Expanding or changing focus reuses the current evidence bundle. It does not
  call RentCast, Zoocasa, a county adapter, or another provider.
- Unsupported goals are disabled with an evidence reason. A directly selected
  unavailable goal keeps a route to change focus while withholding the unsafe
  report.

## Implementation

- Centralize the start decision in `shouldStartAssessmentImmediately()` so
  non-journey, restored, and explicit-goal handoffs have testable semantics.
- Separate the journey provider/gate from the compact
  `AssessmentJourneyFocus` control.
- Let Canadian results supply their address and primary offer/value as a lead
  before the focus control.
- Embed the same control after the primary hero in US listed, off-market, and
  county-fallback results; limited rental results place it after the property
  identity because they intentionally have no supported primary yield hero.

## Acceptance matrix

| Surface | Required behavior |
|---|---|
| CA property handoff with explicit Buy goal | No repeated chooser; lookup starts immediately |
| `2820-cosgrove-cres` Buy result | Address and `$815,000` recommended offer precede one collapsed focus switch |
| `2820-cosgrove-cres` Rental switch | Same property/offer lead remains; Rental scenario follows focus; no refetch |
| US listed Buy/Rental | Address and recommended offer precede one focus switch and any rental module |
| US off-market Buy/Rental | Address and property value precede one focus switch and any rental module |
| US county fallback | Address and available county context precede one focus switch; no property-level overclaim |
| Excluded land/non-residential goal | Unsafe report remains withheld; focus switch remains available to recover |
| Journey entry without a goal | The goal chooser remains available and starts once |

## Exit gate

- [x] Explicit-goal initialization fixture passes with zero provider calls.
- [x] Render fixtures lock lead/focus/content order and exactly one embedded
  focus control.
- [x] Local browser replay passes on the exact Cosgrove assessment ID, including
  a Buy → Rental switch and URL update without an assessment refetch.
- [x] Full property-intelligence, pipeline, TypeScript, lint, and production
  build checks pass.
- [ ] Production replay passes after deployment.

## Production replay — 2026-08-14

The hierarchy deployed, but the first Canadian rental replay exposed three
remaining acceptance defects:

- the nested Canada rental module repeated the property address;
- focus-panel padding did not align with the result cards; and
- the assessment-origin page served a stale ten-minute listing snapshot that
  displayed `$969,000` offer / `$620,000` assessment / `0.00x`, while the
  current stored record was `$815,000` / `$800,000` / `1.30x`.

The correction removes the nested identity, aligns the collapsed/expanded
focus content to the same result gutter, bypasses the KV read cache only for
assessment-origin results, and refuses to relabel a cached language offer as
assessment-anchored merely because a separate assessment exists. Discover
retains normal caching. Production acceptance remains pending until this
correction deploys.
