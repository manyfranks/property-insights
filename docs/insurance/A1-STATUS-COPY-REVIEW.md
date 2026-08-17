# A1 case-status copy review

Status: **APPROVED AS WRITTEN by owner (Matt Francis), 2026-08-16** — recorded
via interactive approval in the release session. `CASE_PORTAL` may enable after
the `CASE_RECORD` canary verifies and a production smoke passes.

The case portal is default-off. These strings are intentionally factual and
stop before provider delivery. They do not imply review, quoting, partner
receipt, or coverage.

| State | Heading | Detail |
|---|---|---|
| `DRAFT` | Coverage profile started | Your information is saved with Property Insights. It has not been sent to an insurance partner. |
| `COLLECTING_FACTS` | Coverage profile in progress | Your information is saved with Property Insights. It has not been sent to an insurance partner. |
| `READY_FOR_SUBMISSION` | Coverage profile saved | Your finalized profile is saved with Property Insights. It has not been sent to an insurance partner. |

Footer: “This page reports only what Property Insights has saved. It does not
report a quote, coverage, or action by an insurance provider.”

Consent v1 is not changed by A1. The portal has no public consent-withdrawal
control until the privacy and data-usage pages receive counsel-approved copy.

## Pending owner approval — A2 addendum

Status: **APPROVED AS WRITTEN by owner (Matt Francis), 2026-08-17** — recorded
via interactive approval in the A2 audit session. (Originally proposed as a
code-review fix: the portal crashed on `SUBMISSION_IN_PROGRESS`, a legal
`insurance_cases.status` value since migration 0004, because `STATUS_COPY`
only covered the three A1 states. It follows the same factual,
pre-provider-delivery framing as the approved table above.)

`SUBMISSION_IN_PROGRESS` is unreachable in production today: it is written
only by A2 delivery (`src/lib/insurance/application/delivery.ts`), which is
not yet activated. This row exists so the portal renders correctly, rather
than crashing, the moment A2 delivery does start writing this status.

| State | Heading | Detail |
|---|---|---|
| `SUBMISSION_IN_PROGRESS` | Coverage profile in delivery | Your finalized profile is being delivered by Property Insights. Delivery has not yet been confirmed, and no quote, coverage, or provider decision exists yet. |

This detail string deliberately stops short of claiming provider receipt —
"delivery has not yet been confirmed" and "no ... provider decision exists
yet" mirror the same non-solicitation, no-quote-implied framing as the
approved rows.
