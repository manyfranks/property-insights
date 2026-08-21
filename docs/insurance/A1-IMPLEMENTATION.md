# Iteration A1 implementation record

Status: implemented, migrated, and activated in production on 2026-08-16/17.
Case record and the capability-protected status portal are enabled. Quote,
bind, claim-intake, historical backfill, consent replacement, and public
withdrawal remain disabled. The dated migration/activation evidence below is
authoritative; the original pre-production wording is retained only in git
history.

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
on the capability route. A1 also provides internal-only, capability-authorized
idempotent update and finalize commands: an update creates a new immutable
`DRAFT` submission version with its own reaffirmed consent artifact, and a
finalize command moves only that newest version to `READY`. These commands are
not wired to a public endpoint in A1 and cannot create delivery, quote, bind,
or provider-review evidence. Consent withdrawal remains unreachable in A1;
the `WITHDRAWN` states are defined in the schema and domain state machines,
but no withdrawal command, public withdrawal UI, or endpoint ships pending
counsel and privacy-copy approval.

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
narrowing, analytics leakage, portal dependency failures, server-authoritative
replay conflicts, command-level create/update/finalize execution against
scratch Postgres, migration idempotency/checksum drift, immutable consent and
submissions, TypeScript, lint, build, and the existing journey E2E suite.

HITL required before the original A1 production activation:

- approve the strings in `A1-STATUS-COPY-REVIEW.md`;
- approve and run the production migration with backup/PITR and release-owner
  evidence;
- enable case record only after migration verification;
- enable the public portal only after copy review and a production smoke test;
- keep consent v1 frozen; and
- keep public withdrawal and historical-PII backfill disabled pending counsel.

Those pre-activation HITL gates were completed only as recorded in the two
production sections below. They do not approve later consent, delivery,
quote/bind, claims, or backfill work.

## Production migration record — 2026-08-16 (America/Vancouver)

- Release: `d65f41a` (PR #4 merge). Release owner: Matt Francis; executed by
  Claude session on the owner's instruction (`INSURANCE_MIGRATION_ACTOR=
  claude-session-on-behalf-of-matt`, `INSURANCE_MIGRATION_RELEASE_ID=d65f41a`).
- Target: production Neon (`ep-winter-credit-ad7gj8x6-pooler`, cross-checked
  as the deployed database 2026-08-14). Credential injected via
  `INSURANCE_MIGRATION_DATABASE_URL` for the release commands only.
- Pre-migration evidence: `coverage_profiles=0`, `insurance_waitlist=0`,
  A1 tables absent; `insurance:migrate:check` → 0 applied, 2 pending.
- Applied: `0001_insurance_create_case_submission.sql` (sha256 160c074816c3…),
  `0002_insurance_idempotency_and_submission_commands.sql` (sha256
  aa547ee4a894…). Post-check → 2 applied, 0 pending; 9 insurance_* tables
  present; `npm run smoke:prod` 5/5.
- Risk note: both migrations are expand-only against empty tables; no legacy
  table was altered. PITR: Neon default retention assumed — console
  confirmation by the owner recommended and noted as an open item.
- NOT done in this release (deliberately): historical backfill (either mode),
  `INSURANCE_KERNEL_ENABLE_CASE_RECORD`, `INSURANCE_KERNEL_ENABLE_CASE_PORTAL`
  (flag activation is a separate canary release after this verification),
  consent replacement, public withdrawal.

## Flag activation record — 2026-08-16/17 (America/Vancouver)

- Owner approvals recorded in-session: status copy APPROVED AS WRITTEN
  (see A1-STATUS-COPY-REVIEW.md); canary authorized via CLI.
- Env set in Vercel production (via CLI, scope manyfranks-projects):
  `INSURANCE_KERNEL_EXECUTION_MODE=PRODUCTION`,
  `INSURANCE_KERNEL_ENABLE_PROFILE_CAPTURE=1`,
  `INSURANCE_KERNEL_ENABLE_CASE_RECORD=1`, then after canary verification
  `INSURANCE_KERNEL_ENABLE_CASE_PORTAL=1`; redeploys of the d65f41a-line build.
- **Ops incident (resolved, worth remembering):** values first added via
  `echo | vercel env add` stored a literal trailing `\n`; the kernel's
  exact-match parsing correctly refused them (default-deny narrowed to
  DISABLED — two test submissions took the legacy-only path, proving the
  fallback). Re-added with `printf`. Lesson: always `printf`, and verify with
  `vercel env pull` + `cat -A` after adding exact-match flags.
- Canary verification (production, real route): test POST created exactly one
  `insurance_cases` row (READY_FOR_SUBMISSION, PRODUCTION, BC/homeowner) with
  submission, consent artifact, and audit events; an identical replay POST
  returned the SAME profile id with `operatorNotified:false` (idempotent
  dedup + single-email confirmed live). Portal check: valid token → 200 with
  approved copy + disclaimer; bogus token → 404. `smoke:prod` 5/5 after each
  redeploy.
- Test data left in prod (owner to decide on cleanup): 4 legacy-only
  coverage_profiles rows from the flag-off canary attempts + 2 canary
  cases/profiles (address prefix "TEST CANARY"), contact
  mfrancis45+a1canary@gmail.com; operator emails for these went to the owner.
  These rows pollute funnel counts until removed.
- Still deliberately OFF: quote/bind/claim-intake flags, historical backfill,
  public consent withdrawal (counsel), consent v1 replacement (counsel).

## Open production truth and next-phase gates — 2026-08-20

These items are not closed by the successful A1 canary:

- **KPI contamination:** 4 legacy-only coverage profiles plus 2 A1 canary
  cases/profiles remain in production. Delete them under an approved cleanup
  record or explicitly exclude them from every funnel query. Until then,
  coverage-profile/case totals are not customer KPIs.
- **Recovery evidence:** Neon PITR was assumed at migration time. Provider
  console confirmation and an isolated restore exercise have not been recorded.
  Do not describe backup/recovery as verified.
- **Counsel gates:** consent v1 stays frozen. Replacement wording, a public
  withdrawal command/UI, historical-PII backfill, APOLLO reliance expansion,
  and compensation characterization remain pending counsel/partner review.
- **Dependency/auth closure:** Sprint 25 closed on 2026-08-21. Direct production
  dependencies report zero advisories; 8/8 authorization regressions, 143/143
  Property Intelligence fixtures, 2,688 journey cells, TypeScript, production
  build, insurance kernel/A1 checks, browser E2E (14 passed, one intentional
  live-fixture skip), and 11/11 production smoke checks passed. The review fixed
  cross-owner coverage-profile handoff linkage by enforcing owner identity in
  the update predicate.
- **A2 ordering:** do not start the durable delivery spine until Sprint 25 and
  the P5 curated live-acceptance matrix both close. A2 remains deterministic
  simulation only; no real provider, quote, bind, policy, payment, or claim
  authority follows from A1.
