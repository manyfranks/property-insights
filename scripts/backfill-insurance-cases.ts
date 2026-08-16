import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

const applyStructural = process.argv.includes("--apply-structural");
const includeHistoricalPii = process.argv.includes("--include-historical-pii");

function fail(message: string): never { throw new Error(`[insurance-backfill] ${message}`); }

if (includeHistoricalPii) {
  fail("historical PII mode is disabled pending documented retention/consent/purpose counsel approval");
}

const databaseUrl = process.env.INSURANCE_MIGRATION_DATABASE_URL;
if (!databaseUrl) fail("INSURANCE_MIGRATION_DATABASE_URL is required; runtime credentials are not accepted");
const url = new URL(databaseUrl);
const env = {
  ...process.env,
  PGHOST: url.hostname,
  PGPORT: url.port || "5432",
  PGUSER: decodeURIComponent(url.username),
  PGPASSWORD: decodeURIComponent(url.password),
  PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
  PGSSLMODE: url.searchParams.get("sslmode") || (url.hostname === "localhost" || url.hostname === "127.0.0.1" ? "disable" : "require"),
};

const dryRunSql = `
  SELECT count(*) AS structurally_eligible
  FROM coverage_profiles p
  LEFT JOIN insurance_cases c ON c.legacy_coverage_profile_id = p.id
  WHERE c.id IS NULL;
`;
const applySql = `
  BEGIN;
  WITH inserted AS (
    INSERT INTO insurance_cases (
      id, execution_mode, status, legacy_coverage_profile_id, idempotency_key,
      country, region, insurance_line, historical_shell
    )
    SELECT gen_random_uuid(), 'PRODUCTION', 'DRAFT', p.id,
      'historical-structural:' || p.id::text, p.country, p.region, p.line, TRUE
    FROM coverage_profiles p
    LEFT JOIN insurance_cases c ON c.legacy_coverage_profile_id = p.id
    WHERE c.id IS NULL
    ON CONFLICT (legacy_coverage_profile_id) DO NOTHING
    RETURNING id, legacy_coverage_profile_id
  ), timeline AS (
    INSERT INTO insurance_case_timeline_events (
      id, case_id, event_type, to_state, actor_type, correlation_id, details
    )
    SELECT gen_random_uuid(), id, 'HISTORICAL_STRUCTURAL_LINK_CREATED', 'DRAFT', 'MIGRATION',
      'historical-structural:' || legacy_coverage_profile_id::text,
      '{"piiCopied":false,"consentCopied":false}'::jsonb
    FROM inserted
    RETURNING id
  )
  INSERT INTO insurance_audit_events (
    id, case_id, event_type, actor_type, correlation_id, subject_type, subject_id, metadata
  )
  SELECT gen_random_uuid(), id, 'HISTORICAL_STRUCTURAL_LINK_CREATED', 'MIGRATION',
    'historical-structural:' || legacy_coverage_profile_id::text,
    'INSURANCE_CASE', id, '{"piiCopied":false,"consentCopied":false}'::jsonb
  FROM inserted;
  COMMIT;
`;

const result = spawnSync("psql", ["-X", "--no-password", "-v", "ON_ERROR_STOP=1", "-A", "-t"], {
  env,
  input: applyStructural ? applySql : dryRunSql,
  encoding: "utf8",
});
if (result.status !== 0) fail((result.stderr || result.stdout || "psql failed").trim());
if (applyStructural) {
  console.log(`[insurance-backfill] structural linkage applied; no historical address, contact, answers, consent, or user ID copied; run id ${randomUUID()}`);
} else {
  console.log(`[insurance-backfill] dry run only; ${result.stdout.trim()} legacy row(s) eligible for structural linkage; database untouched`);
}
