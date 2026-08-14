# P4 Sprint A — Assessment Goal and Subject UX

_Created 2026-08-11. First on-demand vertical slice of P4; rollout policy reconciled 2026-08-14._

## Outcome

Sprint A adds explicit assessment-level intent without assigning a permanent persona or allowing property classification to choose for the user.

The assessment sequence is:

```text
Sign in
  -> optionally choose this assessment's goal
  -> fetch the assessment bundle once
  -> clarify subject only when P2 says the ambiguity is consequential
  -> capability-check the confirmed subject
  -> render the unchanged report or an honest failpath
  -> allow manual focus switching without a refetch
```

`journeys=1` is now an intentional product route used by Discover goal handoffs, not a preview override or environment flag. Plain `/assess` retains the established buyer flow while the shared buyer migration remains in P6. There is no permanent journeys environment switch; see `21-JOURNEYS-ROLLOUT-POLICY.md`.

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

A specific-unit choice requires a unit identifier. The identifier is not sent in journey analytics or placed in the result URL. For Canadian redirects it is first written to the authenticated user's private assessment record; the property page accepts only durable `user_confirmation` provenance and never trusts a `subjectScope` query value.

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

The read-only aggregate report is:

```bash
npx tsx scripts/report-property-journeys.ts 7
```

It selects no user ID, address, unit, slug, or raw event payload.

## Verification

- P4 contract fixtures: 9/9, zero provider calls
- TypeScript: pass
- Touched-file lint: pass; one pre-existing warning remains in `property/[slug]/page.tsx`
- Local plain-flow QA: existing buyer result remains visible when the journey route is not selected
- Local journey QA: Rental → Explore changes the view state and URL with no second property-page request
- Production build: 337/337 pages generated
- Full P0-P4 regression and pipeline guard: pass
- Integration: 20/20, seed `20260811`, RentCast quota `50 -> 50`
- Full-repository lint: unchanged baseline of 26 errors and 20 warnings in untouched files
- Signed-in production journey: Rental selected explicitly; Queens returned supported/high-confidence evidence with the existing `$999,000` list and `$969,000` offer; Explore switch required no refetch
- Production funnel aggregate: `journey_selected`, `journey_result_viewed`, and `journey_switched` rows are queryable without selecting user or property identifiers
- Responsive QA: no horizontal overflow at 390px or 1280px; result focus controls have a 44px minimum touch target

## Remaining P4 work

- Private goal/subject persistence and explicit opt-out fixtures shipped in Sprint B; see `19-P4-SPRINT-B-PERSISTENCE-PRIVACY.md`.
- Complete post-deploy acceptance for the supported product route before expanding the asset matrix.
- Keep occupancy-driven suggestions blocked pending counsel/privacy review.
