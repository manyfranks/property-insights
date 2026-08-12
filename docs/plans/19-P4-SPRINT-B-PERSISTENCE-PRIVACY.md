# P4 Sprint B — Private Assessment State and Privacy Boundaries

_Created 2026-08-12. Second flagged vertical slice of P4; signed-in on-demand assessments only._

## Outcome

Sprint B makes the user's assessment goal, current result view, and explicitly confirmed subject durable without turning them into a permanent persona and without writing user intent onto the shared listing corpus.

```text
shared property/listing evidence
  + explicit per-assessment goal
  + user-confirmed subject scope
  -> private owner-scoped assessment state
  -> reopen or switch the same assessment
```

The initial `assessment_goal` and later `active_view` are separate fields. A view switch never rewrites what the user originally selected. Classification and occupancy remain outside the record and cannot select either value.

## Private data boundary

`user_assessments` is keyed by a random UUID and every read, update, and delete is constrained by the authenticated Clerk user ID. It contains only:

- country and result variant;
- the initial assessment goal and current active view;
- subject scope, optional normalized unit identifier, and selection provenance;
- a Canadian shared-listing reference needed to reopen the existing result;
- creation and update timestamps.

It does not store a raw address, place ID, provider response, classification, occupancy signal, owner information, capability evidence, or financing assumptions. A Canadian result reference can indirectly identify the shared listing and is therefore private product state, not analytics. The API supports owner-scoped deletion.

This state is essential to the signed-in feature the user explicitly requested. It is not written to Clerk profile metadata, the shared `Listing`, or the behavioral event stream, and it is not used for occupancy-driven personalization.

## Restore behavior

- Canadian results reopen the already-persisted shared property page and restore the private active view and confirmed scope.
- US results reuse the private goal and confirmation but refresh the current assessment evidence because the existing US result is rendered inline and has no saved result page.
- A restored US assessment does not create a second private record.
- The user's just-selected query state wins during the short best-effort save window; the owner-scoped record is the durable fallback on later opens.
- Manual view switching never makes a provider call.
- A restored user confirmation may resolve a repeated P2 clarification, but it never manufactures evidence or makes a mismatched capability available.

## Event privacy hardening

The journey event API now applies event-specific allowlists. A P4 event is rejected if a client attempts to include an address, unit, place ID, slug, classification, occupancy value, or any undocumented key—even when the value is otherwise a small primitive.

Tracking remains suppressed when any of these conditions apply:

- `Sec-GPC: 1`;
- the Do-Not-Sell/Share opt-out cookie;
- missing analytics consent;
- withdrawn analytics consent.

Private assessment state is not copied into analytics events.

## Verification

- Additive production migration: `user_assessments` created; existing rows `0`
- Live DB ownership round trip: owner create/read/update/delete passes; cross-user read/update/delete fails; synthetic row removed in `finally`
- P4 Sprint B contract/privacy fixtures: 10/10, including disguised-identifier and incomplete-schema rejection
- P0–P4 fixtures and pipeline guard: pass; zero provider calls from the fixture suites
- TypeScript: pass
- Touched-file lint: pass; one documented pre-existing warning remains in `property/[slug]/page.tsx`
- Production build: pass; 338/338 static pages generated
- Integration: 20/20, seed `20260812`, RentCast quota `50 -> 50`
- Full-repository lint: unchanged baseline of 26 errors and 20 warnings in untouched files
- Signed-in browser restore QA: pending release verification

## Remaining P4 gate

Sprint B completes private assessment persistence and explicit opt-out test coverage. P4 stays behind the existing flag until signed-in production restore is verified and an internal 10–20-address review covers detached, unit, ambiguous multi-unit, mixed-use, land, institutional, active-listing, off-market, and regional-fallback outcomes across supported geographies.

Occupancy-driven suggestions, view selection, CTA routing, and intent-profile persistence remain blocked pending counsel/privacy direction.
