# P4 Sprint A — Assessment Goal and Subject UX

_Created 2026-08-11. First flagged vertical slice of P4; on-demand assessment only._

## Outcome

Sprint A adds explicit assessment-level intent without assigning a permanent persona or allowing property classification to choose for the user.

The preview sequence is:

```text
Sign in
  -> optionally choose this assessment's goal
  -> fetch the assessment bundle once
  -> clarify subject only when P2 says the ambiguity is consequential
  -> capability-check the confirmed subject
  -> render the unchanged report or an honest failpath
  -> allow manual focus switching without a refetch
```

The feature is enabled by `PROPERTY_JOURNEYS_ENABLED=true` or, for an internal signed-in production test, `journeys=1` on the assessment URL. The query preview is deliberately scoped to on-demand assessment handoffs; Discover does not render the journey controls.

## Goal contract

The four V1 assessment goals are:

- `buy_home`
- `rental_investment`
- `own_manage`
- `explore`

The selection is optional. Skipping preserves the current buyer result as the default. The selected value travels through `POST /api/assess`, returns in the assessment response, and is carried to the Canadian saved result in the handoff URL. It is not written to a profile and does not affect classification, offer logic, visible modules, or CTA routing in Sprint A.

Persisting the selection with a private saved assessment remains open. It must not be written onto the globally shared listing record, where one user's goal could become another user's default.

## Subject clarification

P2 remains the only trigger. Straightforward subjects do not see another question. Consequentially ambiguous results offer:

- a specific unit;
- the entire building/property;
- the listing found;
- general address exploration.

A specific-unit choice requires a unit identifier. The unit identifier remains local to the assessment interaction: it is not sent in journey analytics or placed in the result URL.

User confirmation does not manufacture evidence. If capabilities were computed for a different or conflicting subject scope, Sprint A withholds the report and tells the user to start a new assessment with the exact unit/listing identifier. It never reuses building, parcel, or listing values as unit values, and it never automatically performs another provider call.

## Capability behavior

The result focus reports one of:

- `supported`: the existing bundle has the property-level evidence needed for that focus;
- `limited`: only partial or regional context is available;
- `unavailable`: critical evidence is missing, excluded, conflicting, or belongs to another subject.

Manual switching changes assessment state, explanatory copy, and the URL only. It does not refetch the property. Persona-specific module ordering, investor/landlord composition, and journey-driven CTA routing belong to P5 and remain unchanged here.

## Funnel events and privacy

Sprint A adds these consent-gated `/api/track` events:

- `assessment_subject_clarification_shown`
- `assessment_subject_selected`
- `journey_selected`
- `journey_result_viewed`
- `journey_switched`

The existing analytics-consent and Do-Not-Sell/Share gates apply. Journey payloads contain only the explicit goal, country, on-demand surface, coarse subject scope, selection type, and capability status. They contain no address, unit identifier, place ID, owner/occupancy value, property classification payload, or provider evidence.

P3's `classification_result` and `capability_missing` remain in the separate anonymous operational stream introduced in P3.5.

## Verification

- P4 contract fixtures: 8/8, zero provider calls
- TypeScript: pass
- Touched-file lint: pass; one pre-existing warning remains in `property/[slug]/page.tsx`
- Local flag-off QA: no P4 panel; existing Vancouver result and `$3,674,000` offer remain visible
- Local preview QA: Rental → Explore changes the view state and URL with no second property-page request
- Production build: 337/337 pages generated
- Full P0-P4 regression and pipeline guard: pass
- Integration: 20/20, seed `20260811`, RentCast quota `50 -> 50`
- Full-repository lint: unchanged baseline of 26 errors and 20 warnings in untouched files
- Mobile/desktop and signed-in production preview: pending

## Remaining P4 work

- Persist goal and confirmed subject with a private assessment/saved-property record—not the shared listing.
- Validate funnel rows in production under analytics consent and opt-out behavior.
- Complete mobile and desktop browser QA.
- Decide the internal/cohort/default-on launch bar after review of the preview.
- Keep occupancy-driven suggestions blocked pending counsel/privacy review.
