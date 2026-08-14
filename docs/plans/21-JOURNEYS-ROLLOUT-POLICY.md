# 21 — Journeys Release and Containment Policy

## Decision

Property journeys are a supported product path, not a permanent preview and
not a matrix of environment-controlled variants. The application therefore
has no `PROPERTY_JOURNEYS_MODE` or `PROPERTY_JOURNEYS_ENABLED` runtime flag.

The `journeys=1` query value is routing state: Discover goal handoffs use it to
enter the goal-first assessment flow while a plain `/assess` request retains
the established buyer flow. It is not a security boundary and does not
override server policy. The result UI is labeled **Assessment focus**, not
Preview.

This choice avoids accumulating switches whose production values become hard
to discover, test, and remove. Rollback for this release is a code revert and
redeploy. A future emergency switch requires a named incident owner, an expiry
date, and a deletion issue in the same change; it must not become a default
feature-development pattern.

## Subject-scope containment

`subjectScope` in a URL is never accepted as user confirmation. A Canadian
assessment that needs clarification must complete its authenticated,
owner-scoped `PATCH /api/assessment-state` before redirecting to the property
page. If that write fails, the user remains on clarification with a retryable
message; the assessment does not crash and the result does not guess.

On restore, a saved subject scope is treated as explicitly confirmed only when
the durable row has `subject_selected_by = 'user_confirmation'`. Provider and
listing matches remain evidence, not proof of user intent. This provenance is
already stored in Neon and owner-checked by the API, so no application-only
`journeyStateVersion` marker or schema migration is needed. Freshly recomputed
classification and capability records remain authoritative regardless of row
age.

## State and privacy

Journey state is written only for journey assessments and remains private to
the authenticated user. `GET`, `PATCH`, and `DELETE /api/assessment-state`
all enforce ownership. Users can reopen and delete saved state. The record
contains goal, active view, result reference, subject scope/unit, and selection
provenance; it does not contain owner names, mailing addresses, occupancy,
provider payloads, or capability evidence.

Occupancy-driven personalization remains counsel-gated. Preserving an
`ownerOccupied` field for evidence completeness does not authorize using it to
infer intent, alter content, or route partner offers.

## Canada capability behavior

For on-demand Canadian assessments, rental availability is owned by the
capability reason enums. Classification selects accurate explanatory copy but
does not independently change availability. Vacant land, commercial,
institutional, and non-unit mixed-use subjects with provider exclusions render
an unavailable rental focus; the scenario calculator, yield output, and
partner CTAs are withheld. Residential subjects retain the existing limited
scenario flow, with CMHC labeled as regional context where available.

Discover-cron Canadian listings do not yet have universal capability records.
They retain the legacy limited behavior when no capability record exists.
Extending evidence-envelope computation into Discover is a separate workstream
and must be fixture-backed before it changes visible output.

## Release gate

Each release touching journeys must pass:

1. Zero-provider-call P0–P5 contract fixtures, including Canadian exclusion and
   no-CMHC render cases.
2. Subject-containment fixtures proving non-user provenance cannot restore a
   confirmed scope.
3. TypeScript and production build.
4. A signed-in browser pass covering one excluded Canadian assessment, one
   residential Canadian assessment, and one unchanged plain `/assess` buyer
   flow.
5. Post-deploy live acceptance before the full asset matrix is expanded.

If the live pass finds a release-blocking defect, revert the release commit.
Do not add a lasting per-feature environment mode as the repair.
