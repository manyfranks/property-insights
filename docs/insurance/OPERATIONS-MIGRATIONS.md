# Insurance operations: migrations and recovery

These conventions were established before the first insurance production
schema change and remain the release contract for every later change. They are
forward-only and deliberately avoid production mutation from web routes.

## Current production truth — 2026-08-20

- Migrations `0001_insurance_create_case_submission.sql` and
  `0002_insurance_idempotency_and_submission_commands.sql` were applied to the
  production Neon database on 2026-08-16; the ledger reported 2 applied and 0
  pending. See `A1-IMPLEMENTATION.md` for the release IDs and checksums.
- Case record and the capability-protected case portal were enabled after a
  production canary. Quote, bind, claim-intake, historical backfill, consent
  replacement, and public withdrawal remain disabled.
- The production dataset still contains 4 legacy-only canary profiles and 2 A1
  canary cases/profiles. Cleanup or KPI-query exclusion remains an owner action;
  no cleanup is claimed by this document.
- Neon PITR was assumed during the migration. Console confirmation and an
  isolated point-in-time restore exercise remain open. No recovery SLO or
  restore capability should be claimed as verified until that evidence exists.
- Consent replacement, withdrawal, historical-PII backfill, APOLLO reliance
  expansion, and legal characterization of partner compensation remain
  counsel/partner gated.

## Sprint 25 release prerequisite

Closed by root review on 2026-08-21. Before Insurance A2 or another
sensitive-schema change, preserve this evidence baseline:

1. record the remediated Clerk/Next and other direct production dependency
   versions plus the resulting audit output;
2. pass unauthenticated/cross-owner negatives for private assessment, billing,
   and coverage profile/case linkage, plus valid/invalid capability portal
   tests;
3. rerun TypeScript, production build, the full Property Intelligence and
   journey matrices, insurance kernel/A1 validation, browser E2E, and
   production smoke; and
4. record each unresolved canary/PITR/counsel item with an owner and explicit
   decision rather than treating silence as closure.

Sprint 25 passed with a zero-advisory production graph, 8/8 authorization
regressions, 143/143 Property Intelligence fixtures, 2,688 journey cells,
TypeScript/build/insurance validation, browser E2E (14 passed, one intentional
live-fixture skip), and 11/11 production smoke checks. Canary KPI cleanup,
provider-console PITR/restore proof, and counsel-controlled items remain
explicitly owned open operations rather than silently claimed complete. The
next feature phase is A2 only after the P5 curated live-acceptance matrix also
passes.

## Enforceable migration convention

1. Store each migration in one ordered directory, e.g. `db/migrations/`.
2. Filename is mandatory: `NNNN_insurance_<imperative_snake_case>.sql`, where
   `NNNN` is a zero-padded sequence greater than every committed migration.
   Examples: `0001_insurance_create_case.sql`,
   `0002_insurance_add_case_submission_version.sql`.
3. A migration contains one forward change only. It is never edited after it
   has reached any shared environment; correction means a new higher-numbered
   migration.
4. A privileged CI/release migration runner (not a public HTTP endpoint) must
   hold an advisory lock, record filename/checksum/applied-at/deployer in an
   `schema_migrations` ledger, reject checksum drift, and apply strictly in
   sequence. This runner is a required implementation before the first new
   insurance migration.
5. The deployment identity has DDL rights; application runtime identities do
   not. No secrets belong in SQL files, scripts, output, or documentation.

## Expand, migrate, contract

- **Expand:** add nullable fields/tables/indexes, new enum-compatible values,
  and dual-read/dual-write code when needed. Deploy this first.
- **Migrate:** backfill through a resumable, idempotent job with progress,
  batch size, error quarantine, and metrics. Validate counts/checksums and
  read parity before making the new field required.
- **Contract:** only after every supported app version and retention window no
  longer need the old shape. Remove old reads/writes first, then later drop
  old schema in a separate migration.

Never combine a breaking rename/drop with the first code deployment that uses
the new shape. Avoid table-rewrite/long-lock DDL during peak traffic; use the
database-supported concurrent/index-online mechanism where available.

## Rollback, recovery, and data integrity

- **Code rollback:** permitted only while the schema remains backward
  compatible. This is the normal immediate response.
- **Schema rollback:** exceptional. Do not automatically run down migrations
  against insurance data. Roll forward with a corrective migration unless
  counsel/incident command authorizes a tested restore plan.
- **Restore:** define RPO/RTO with the database provider before launch; test a
  point-in-time restore into an isolated environment at least quarterly.
  Validate row counts, referential integrity, migration ledger, encrypted
  document pointers, and ability to replay carrier/billing events before any
  cutover.
- **Reconciliation:** immutable external IDs and idempotency keys are required
  for carrier quote/bind, payment, policy, and claims-handoff events. Rebuild
  derived views from append-only event/audit records; never recreate a legal
  policy or payment state from UI logs alone.

## Retention and audit

Retention, deletion, legal hold, and records-location periods require Canadian
insurance/privacy counsel plus carrier agreement confirmation. Until then,
implement configurable retention policies rather than hard-coded deletion.
Preserve immutable audit facts: actor/service identity, timestamp, consent
version, source, before/after values or content hash, migration version,
authority/decision ID, and correlation/idempotency ID. Restrict audit access,
encrypt data in transit/at rest, and prove deletion/hold outcomes in logs.

## Pre-deploy checklist

- Approved migration number, checksum, owner, rollback/roll-forward plan.
- Backup/PITR health and last restore-test evidence verified.
- Expand/migrate/contract phase explicitly identified; compatibility reviewed
  against current and one-prior app release.
- Staging rehearsal completed with production-like volume/lock impact.
- Backfill is idempotent, rate-limited, observable, and can pause safely.
- Smoke expectations, release SHA, deployment ID, and on-call owner recorded.
- Carrier/broker impact checked where changes touch profile, consent, policy,
  payment, claims, or document data.

## Post-deploy checklist

- Migration ledger/version/checksum and application release match expected.
- Run read-only production smoke; record URL, timestamp, expected stage,
  result, and skipped checks.
- Observe error rate, DB lock/latency, queue/backfill progress, and external
  event failures through the agreed window.
- Reconcile sample quote/policy/payment/consent audit chains where applicable.
- Confirm no unplanned schema drift; retain release evidence and close only
  after the owner signs off.
