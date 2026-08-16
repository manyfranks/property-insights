# A0 production truth baseline

Observed 2026-08-16 (America/Vancouver). This is an outside-in, read-only
baseline. It is not proof of environment-variable values, database state,
carrier connectivity, or successful write-path operation.

## Canonical production smoke

- URL: `https://www.propertyinsights.xyz`
- Command: `npm run smoke:prod` (default `EXPECTED_STAGE=intake`, `WRITE_CHECK=0`)
- Result: exit 0; 5/5 assertions passed.
- Observable results: `/insurance` returned 200 and the expected H1; a BC
  homeowner coverage-profile URL returned 200; `/disclosures`,
  `/sitemap-main.xml`, and `/robots.txt` returned 200; sitemap contained
  `/insurance`.
- Intentionally not exercised: `POST /api/insurance/waitlist`; no production
  record was created or removed.

The smoke script asserts a caller-supplied expected stage. It does **not** read
deployed environment variables. Therefore the above establishes a production
signature consistent with `intake`; it does not independently prove that
`NEXT_PUBLIC_INSURANCE_STAGE=intake` is present in Vercel.

## Repo baseline versus observable production

| Subject | Repository assertion | Production observation | Status |
| --- | --- | --- | --- |
| Rollout dial | `off < landing < intake < switch`; unset/invalid fails closed to `off` | `/insurance` and eligible BC coverage-profile page returned 200 | Consistent with at least `intake`; exact env remains unobservable |
| BC homeowner journey | Script calls a BC homeowner residential fixture described as eligible/live | Page returned 200 | Consistent |
| Write-path verification | Optional `WRITE_CHECK=1` posts then directly deletes a test waitlist row | Skipped | Not verified; use only with DB cleanup authority and audited runbook |
| Carrier quote/bind | No carrier API is exercised by smoke | No external carrier evidence | Not implemented/proven by this smoke |
| Database schema/migrations | Repo has schema plus legacy/manual migration paths | Aggregate counts were read from the locally configured database; schema version and deployment linkage were not | Not proven; future migration runner must establish schema-version truth |

## A0 journey/config boundary

The live smoke verifies public page availability and selected static content
only. It must not be described as an insurance quote, underwriting, referral,
payment, issuance, policy-service, or claims verification. Before each deploy,
record the smoke timestamp, base URL, expected stage, git SHA, environment
deployment ID, result, and any skipped assertion in the release record.

## Configured-database funnel baseline

A read-only aggregate query was run on 2026-08-16 through the repository's
locally configured `DATABASE_URL`. It returned:

| Aggregate | Count |
| --- | ---: |
| Coverage profiles | 0 |
| Coverage profiles with `vendor_id` handoff stamp | 0 |
| Coverage profiles created in the last 7 days | 0 |
| Insurance waitlist entries | 0 |
| Insurance waitlist entries created in the last 7 days | 0 |

No customer fields were selected and the transaction was declared read-only.
The repository cannot prove that this connection is the same database used by
the canonical deployment, so these counts are a configured-environment
baseline, not a production conversion claim. Production database identity and
deployment-to-database linkage must be recorded before A1 metrics are treated
as authoritative.

## Known legal-copy hold

General customer copy now describes Square One and APOLLO by configured role
and uses neutral partner-compensation language. The persisted coverage-wizard
consent remains the owner-and-counsel-controlled text already in production;
its vendor variant still uses the term `referral fee`. APOLLO's published
terms characterize its tenant reward differently. Do not treat the existing
consent label as a legal characterization of APOLLO compensation or expand
APOLLO reliance until counsel approves a versioned replacement. A1 must store
the approved wording and version as a consent artifact rather than silently
rewriting historical consent.
