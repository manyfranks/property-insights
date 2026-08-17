# Iteration A2 implementation record

Status: implementation in progress on `codex/insurance-a2-delivery-spine`.
This iteration adds a durable, provider-neutral delivery spine to the live A1
case/submission kernel. It does not activate delivery in production.

A later integrity pass (migration `0007_insurance_delivery_integrity.sql`)
closed gaps found in code review: dispatch/webhook writes now obey the
transaction state machine (with a DB trigger as backstop), evidence is never
silently dropped, and the provider-transaction outcome now actually advances
the A1 `insurance_submissions` record instead of stopping at `SUBMITTING`.
The sections below describe the corrected behavior; see "0007 integrity
corrections" at the end for what changed and why.

## Scope and boundary

An internal command may create one provider-submission transaction for an A1
`READY` submission and atomically append its non-PII outbox intent. The
provider call happens after that commit. Only durable, authenticated provider
evidence can move a transaction to `ACKNOWLEDGED`; acknowledgement means only
that a provider accepted/received a submission. It is not a quote, referral,
inspection, decline, bind, policy, billing, claim, payment, or carrier action.

The deterministic adapter is available only in `SIMULATION` and `SANDBOX`.
It has no production mode, production credential, network destination, or
production-shaped identifier. A missing mode, feature parent, connection,
authority decision, or provider conformance match denies delivery.

## State and authority

| Record | State | Authority / evidence |
|---|---|---|
| Case | `READY_FOR_SUBMISSION → SUBMISSION_IN_PROGRESS` | Orio delivery command after A1 consent/finalization checks |
| Submission | `READY → SUBMITTING → AWAITING_PROVIDER → SUBMITTED` (or `→ PROVIDER_ERROR`) | Durable provider transaction and outbox intent; advanced by the transaction's own outcome (see "Submission advancement" below) |
| Transaction | `PENDING_DISPATCH`, `AWAITING_PROVIDER`, `RETRY_SCHEDULED`, `DEAD_LETTER`, `RECONCILIATION_REQUIRED` | Orio workflow evidence only |
| Transaction | `ACKNOWLEDGED` | Authenticated provider response or signed provider webhook |
| Task | open exception | Retry exhaustion, illegal/out-of-order/conflicting event, or reconciliation mismatch. A pending (async) acknowledgement is the normal flow and never opens one. |

An async-pending acknowledgement (`PENDING`) is deliberately ambiguous. It
creates/retains `AWAITING_PROVIDER`; it never infers success, decline, quote,
or provider receipt, and it does not open an exception -- it is the normal
`DELAYED_ACK` flow. Its recorded attempt outcome is `DISPATCHED`, not
`TIMEOUT`; true timeout detection is a reconciliation concern, out of A2
scope. Retry uses the original provider idempotency key. Exhaustion (bounded
by `MAX_DELIVERY_ATTEMPTS` in `application/delivery.ts` until a real
retry/backoff worker replaces it) creates a dead-letter transaction and a
`RETRY_EXHAUSTED` task. Operator replay is a new auditable attempt, never a
direct projection patch.

Every provider-submission status change -- from a dispatch result or a
webhook -- is validated against the same transition table
(`canTransitionDelivery()` in `domain/delivery.ts`) before it is written, with
the current status re-read and the write predicate-guarded against races. An
illegal transition (e.g. a late worker reporting `ACKNOWLEDGED` against a
submission that has since moved to `DEAD_LETTER`) is never applied; it opens
a `WEBHOOK_CONFLICT` exception and the caller gets back the actual current
state, never the attempted one. Migration `0007` adds a matching DB trigger
on `insurance_provider_submissions` so this is enforced even against a direct
SQL write, not only through the application.

### Submission advancement

A landed transaction state now advances the A1 `insurance_submissions`
record (case status is untouched -- see "A2 does not touch case status"
below): `AWAITING_PROVIDER`/`RETRY_SCHEDULED` move `SUBMITTING →
AWAITING_PROVIDER`; `ACKNOWLEDGED` moves `SUBMITTING → AWAITING_PROVIDER →
SUBMITTED` as two sequential, individually-guarded updates in the same
transaction (so the 0004 submission trigger's own state machine is respected
rather than bypassed); `DEAD_LETTER` moves either `SUBMITTING` or
`AWAITING_PROVIDER → PROVIDER_ERROR`. Every hop is checked with
`assertA2SubmissionTransition()` against `domain/states.ts` before any SQL is
built. `SUBMITTED` is therefore reachable by real code, not only by direct
test fixture SQL.

### A synchronous acknowledgement is still ledger-honest

A provider that acknowledges synchronously in its dispatch response never
has a real "awaiting" window, but the append-only
`insurance_provider_status_events` ledger still records one: `PENDING_DISPATCH
→ AWAITING_PROVIDER → ACKNOWLEDGED`, both hops written in the same
transaction as the (single, real) `ACKNOWLEDGED` status on
`insurance_provider_submissions`. This is the only bridge the delivery
decision logic grants beyond a direct table lookup, and it is deliberately
narrow: it applies only from `PENDING_DISPATCH`, never from `RETRY_SCHEDULED`,
`DEAD_LETTER`, or `RECONCILIATION_REQUIRED` (a stray/late result against one
of those must be rejected as a conflict, not silently resurrected -- see the
`DEAD_LETTER → ACKNOWLEDGED` example above). `rebuildProviderProjection()`
replays the ledger with an order-sensitive fold starting from
`PENDING_DISPATCH` and reproduces `ACKNOWLEDGED` for exactly this reason. Zero
ledger events fold to `PENDING_DISPATCH`, never `AWAITING_PROVIDER`. An event
that is illegal at its point in the fold (recorded as durable evidence
without ever being applied live) is skipped-with-note rather than dropped or
raising an error.

### A2 does not touch case status

`insurance_cases.status` stays `SUBMISSION_IN_PROGRESS` for the whole A2
delivery lifecycle, including `SUBMITTED` and `PROVIDER_ERROR` at the
submission level. Advancing the case past `SUBMISSION_IN_PROGRESS` (e.g. to
something that reflects a bound policy or a declined case) is A3 scope.

## Inbox and reconciliation

Webhook input is verified from the raw body before persistence using a
provider-specific signature and bounded timestamp tolerance. The durable
inbox deduplicates `(provider, provider_event_id)` and now also stores the
event's typed fields (`transaction_external_id`, `transaction_id`,
`provider_status`, `normalized_reason_codes`) so a stuck event can be
reprocessed later without re-fetching the raw payload. A transaction id that
is not a well-formed UUID is never interpolated into a `::uuid` cast; it is
treated as absent and the event matches on the provider's external id only.

A duplicate delivery of an already-known `provider_event_id` is not a blind
no-op: if the existing inbox row is still `RECEIVED` or `DEFERRED`, the
provider's retry is used as the recovery mechanism and projection is re-run
for it. `reprocessDeferredWebhooks(providerConnectionId)` re-projects every
`RECEIVED`/`DEFERRED` inbox row for a connection on demand; A2 calls it
(non-fatal, logged on failure) immediately after `submitFinalizedSubmission`
commits, so a webhook that raced ahead of its own provider-submission
transaction gets a chance to land once that transaction exists. Any
unexpected failure inside projection itself (not a legality decision, an
actual thrown error) is caught, recorded as an `error_code` on the inbox row,
and the row is left in a reprocessable state -- it is never silently dropped
after the inbox insert has already committed.

Out-of-order events (no matching provider submission yet) are retained,
marked `DEFERRED`, and now also open a `WEBHOOK_OUT_OF_ORDER` operator
exception so they are visible even though there is no case yet to attach
them to (`insurance_operator_exceptions.case_id` is nullable for exactly this
case; the row is instead traceable through `webhook_inbox_id`). Conflicting
events (a legal-looking event that is illegal given the submission's current
state) open a `WEBHOOK_CONFLICT` exception, are still recorded as durable
ledger evidence, and never regress a provider transaction. Rebuild invokes
the same fold over append-only status-event evidence (dispatch-sourced and
webhook-sourced together) and must reproduce the same projection hash.

No public webhook route or broker UI is added in A2. HTTP transport remains a
private/test seam until a named provider supplies its signature contract,
source controls, credential ownership, and an executed agreement. A3 owns the
operator workbench; current operator tasks are durable data only.

## Withdrawal and reopening

`WITHDRAWN` is reachable from `SUBMITTING` and `PROVIDER_ERROR`, not only
from `READY` or `AWAITING_PROVIDER` -- an owner can record withdrawal intent
while a delivery is in flight or stuck in error. This only marks the local
submission; **cancelling an in-flight provider transaction itself is B2
scope**.

Reopening a case's fact collection (`SUBMISSION_IN_PROGRESS →
COLLECTING_FACTS`) is forbidden by a DB trigger while any provider submission
for the case is still active (`PENDING_DISPATCH`, `AWAITING_PROVIDER`,
`RETRY_SCHEDULED`, `RECONCILIATION_REQUIRED`, or `ACKNOWLEDGED`). It becomes
legal only once every provider submission for the case has reached
`DEAD_LETTER`. There is no A2 path to cancel an active provider submission in
order to satisfy this guard; that is also B2 scope.

## 0007 integrity corrections

Migration `0007_insurance_delivery_integrity.sql` (forward-only; `0001`-`0006`
are never edited) closed the following gaps found in code review of the
initial A2 delivery spine:

- Added a DB trigger on `insurance_provider_submissions` mirroring
  `canTransitionDelivery()`, so the transition rule is enforced even against
  a direct SQL write, not only through the application.
- Replaced the biconditional `acknowledged_at` CHECK with a one-directional
  rule (`status <> 'ACKNOWLEDGED' OR acknowledged_at IS NOT NULL`), so a
  legal post-ack transition (`ACKNOWLEDGED → RECONCILIATION_REQUIRED`) keeps
  its acknowledgement timestamp as evidence instead of being forced to drop
  it.
- Added the `WITHDRAWN` edges and the reopen guard described above.
- Added the `insurance_webhook_inbox` columns and `insurance_operator_exceptions`
  nullable `case_id`/new `webhook_inbox_id` needed to reprocess a deferred
  webhook and to open a visible exception for one that never matched a
  provider submission.
- Added append-only triggers on `insurance_provider_delivery_attempts` and
  `insurance_reconciliation_items` (both had evidence tables without the
  guard that every other append-only table already has).

Application-layer corrections in the same pass (no schema change): dispatch
results and webhook projections both now read-then-guarded-write instead of
trusting a hardcoded status allowlist (which had excluded
`RECONCILIATION_REQUIRED` as a legal source state for a redispatch); every
dispatch outcome leaves durable `insurance_provider_status_events` evidence,
including illegal/rejected ones; the outcome/exception vocabulary was
corrected per the table above (`PENDING → DISPATCHED`, no exception;
`RETRYABLE_FAILURE` exception only on exhaustion, typed `RETRY_EXHAUSTED`);
and the `"deterministic-simulator"` string literal, previously duplicated at
five call sites, is now a single exported constant
(`DETERMINISTIC_SIMULATOR_PROVIDER_KEY` in `domain/delivery.ts`).

## Test-data hygiene

Canary records are preserved, not deleted or trigger-bypassed. A privileged
release command marks explicitly supplied canonical case IDs and legacy
coverage-profile IDs as `TEST`; it defaults to dry-run and records actor,
reason, and test-run ID. Runtime intake never infers test status from a
customer email, address, browser value, or other public input. Reporting must
exclude `TEST` classifications by default and opt in to include them.

## Release / HITL gates

Before any A2 production migration or flag activation:

- Confirm Neon PITR retention and latest restorable time in the console; record
  owner and date in the release evidence.
- Review the forward-only migration checksum and staging/scratch rehearsal.
- Name a production provider connection, authority/appointment decision,
  credentials owner, secure raw-payload reference location, webhook signing
  contract, retry/reconciliation SLO, and on-call owner.
- Obtain product/counsel approval before any customer-visible delivery status
  or new copy. A2 intentionally adds no public UI.

Explicit exclusions: broker workbench (A3), real carrier/MGA/BMS connectivity,
quote/policy/bind/billing/claims facts, public withdrawal, historical-PII
backfill, cancellation of an in-flight provider submission (B2), and changes
to A1's existing `updateCoverageCase` or `finalizeCoverageCase` commands.
