# Iteration A1 implementation record

Status: implemented on `codex/insurance-a1-case-submission`; production
migration and public exposure are intentionally not performed.

## Vertical slice

When all server-side dependencies are enabled, one completed legacy coverage
profile is atomically written as:

1. the unchanged `coverage_profiles` compatibility row;
2. an `insurance_cases` record in its immutable execution mode;
3. applicant/insured/contact party roles;
4. the exact frozen consent-v1 text, intended recipients, and field scope;
5. a DRAFT submission with field-level provenance, finalized to `READY`;
6. a case ending at `READY_FOR_SUBMISSION`; and
7. append-only timeline and audit evidence.

No A1 table accepts `SUBMITTING`, `AWAITING_PROVIDER`, `SUBMITTED`, `QUOTED`,
`BOUND`, or `ISSUED`. `coverage_profiles.vendor_id` remains untouched by this
write and continues to mean legacy click attribution only.

## Runtime gates

- `INSURANCE_KERNEL_ENABLE_CASE_RECORD=1` requires profile capture and the A1
  schema. It enables the atomic compatibility/canonical dual-write.
- `INSURANCE_KERNEL_ENABLE_CASE_PORTAL=1` additionally requires case record.
  It exposes only the factual read-only status page.
- Both default to off and are server-only. A child flag cannot widen a disabled
  parent.

Anonymous access uses a browser-generated 256-bit capability. Only its SHA-256
hash is stored. Lookups are rate-limited by hashed capability plus IP. The URL
has `no-referrer`, `no-store`, and `noindex`; PostHog, Vercel Analytics, Speed
Insights, first-party signals, and analytics-cookie minting are all suppressed
on the capability route. Withdrawal and amendment commands (consent
withdrawal, draft answer updates/versioning, submission finalization) are
deferred to A2 — the WITHDRAWN states remain defined in the schema and domain
state machines but are unreachable in A1, since no command can drive a case
or submission into them. No public withdrawal UI or endpoint ships in A1.

## Database operations

`scripts/insurance-migrate.ts` is the only A1 schema vehicle. It is a privileged
CI/release command, never an HTTP route. It enforces contiguous filenames,
SHA-256 ledger checks, checksum-drift rejection, strict ordering, and a session
advisory lock. `plan` is read-only and is part of prebuild; `apply` requires the
separate `INSURANCE_MIGRATION_DATABASE_URL` credential.

`scripts/backfill-insurance-cases.ts` is dry-run by default. Its optional
structural mode creates only a legacy-ID linkage shell plus audit evidence; it
does not copy historical addresses, users, contact data, answers, or consent.
Historical-PII mode always fails pending counsel approval.

## Verification and release gates

Automated coverage includes domain transition negatives, execution-mode
narrowing, analytics leakage, migration idempotency/checksum drift, immutable
consent/submissions/execution mode, TypeScript, lint, build, and the existing
journey E2E suite.

HITL required before any production change:

- approve the strings in `A1-STATUS-COPY-REVIEW.md`;
- approve and run the production migration with backup/PITR and release-owner
  evidence;
- enable case record only after migration verification;
- enable the public portal only after copy review and a production smoke test;
- keep consent v1 frozen; and
- keep public withdrawal and historical-PII backfill disabled pending counsel.
