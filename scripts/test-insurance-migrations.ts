import { appendFileSync, cpSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

function fail(message: string): never { throw new Error(`[insurance-migration-test] ${message}`); }

function command(commandName: string, args: string[], env: NodeJS.ProcessEnv = process.env, input?: string) {
  const result = spawnSync(commandName, args, { env, input, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  if (result.status !== 0) fail(`${commandName} failed: ${(result.stderr || result.stdout).trim()}`);
  return result.stdout.trim();
}

function expectPsqlFailure(sql: string, env: NodeJS.ProcessEnv, label: string): void {
  const result = spawnSync("psql", ["-X", "-v", "ON_ERROR_STOP=1"], { env, input: sql, encoding: "utf8" });
  if (result.status === 0) fail(`${label} was not rejected`);
}

function main(): void {
  const root = mkdtempSync(resolve(tmpdir(), "insurance-migration-test-"));
  const data = resolve(root, "pgdata");
  const socket = resolve(root, "socket");
  const migrations = resolve(root, "migrations");
  mkdirSync(socket);
  cpSync(resolve(process.cwd(), "db/migrations"), migrations, { recursive: true });
  // The socket directory is unique, and this high port is varied per process.
  // pg_ctl will fail loudly if the unlikely collision occurs.
  const port = 55000 + (process.pid % 5000);
  let started = false;

  try {
    command("initdb", ["-D", data, "--auth=trust", "--no-locale", "--encoding=UTF8"]);
    // Redirect the daemon's output so it does not retain this process's
    // captured stdout pipe and make spawnSync wait for server shutdown.
    command("pg_ctl", ["-D", data, "-l", resolve(root, "postgres.log"), "-o", `-F -p ${port} -k ${socket}`, "-w", "start"]);
    started = true;
    command("createdb", ["-h", socket, "-p", String(port), "insurance_test"]);
    const databaseUrl = `postgresql://127.0.0.1:${port}/insurance_test?sslmode=disable`;
    const pgEnv = { ...process.env, PGHOST: socket, PGPORT: String(port), PGDATABASE: "insurance_test", PGSSLMODE: "disable" };
    command("psql", ["-X", "-v", "ON_ERROR_STOP=1"], pgEnv, `
      CREATE TABLE coverage_profiles (
        id UUID PRIMARY KEY,
        user_id TEXT,
        country TEXT NOT NULL,
        region TEXT NOT NULL,
        address TEXT NOT NULL,
        line TEXT NOT NULL,
        property JSONB NOT NULL,
        answers JSONB NOT NULL,
        consent BOOLEAN NOT NULL,
        consent_text TEXT NOT NULL,
        consented_at TIMESTAMPTZ NOT NULL,
        source TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const runnerEnv = {
      ...process.env,
      INSURANCE_MIGRATION_DATABASE_URL: databaseUrl,
      INSURANCE_MIGRATIONS_DIR: migrations,
      INSURANCE_MIGRATION_ACTOR: "scratch-test",
      INSURANCE_MIGRATION_RELEASE_ID: "scratch",
    };
    command("node", ["--import", "tsx", "scripts/insurance-migrate.ts", "--mode=apply"], runnerEnv);
    command("node", ["--import", "tsx", "scripts/insurance-migrate.ts", "--mode=apply"], runnerEnv);
    command("node", ["--import", "tsx", "scripts/test-insurance-case-commands.ts"], {
      ...runnerEnv,
      DATABASE_URL: databaseUrl,
      INSURANCE_SCRATCH_TEST: "1",
      ...pgEnv,
    });
    command("psql", ["-X", "-v", "ON_ERROR_STOP=1"], pgEnv, `
      INSERT INTO coverage_profiles(id, country, region, address, line, property, answers, consent, consent_text, consented_at)
      VALUES ('10000000-0000-4000-8000-000000000099', 'CA', 'BC', 'structural fixture', 'tenant', '{}', '{}', TRUE, 'structural consent', NOW());
    `);
    command("node", ["--import", "tsx", "scripts/backfill-insurance-cases.ts", "--apply-structural"], runnerEnv);
    const structuralHash = command(
      "psql",
      ["-X", "-A", "-t", "-c", "SELECT request_hash || '|' || historical_shell FROM insurance_cases WHERE legacy_coverage_profile_id='10000000-0000-4000-8000-000000000099'"],
      pgEnv
    );
    if (!/^[0-9a-f]{64}\|(t|true)$/i.test(structuralHash)) fail(`structural backfill must create a non-PII 64-hex request hash; got ${structuralHash}`);
    const ledgerCount = command("psql", ["-X", "-A", "-t", "-c", "SELECT count(*) FROM schema_migrations WHERE namespace='insurance'"], pgEnv);
    if (ledgerCount !== "2") fail(`expected two ledger rows after idempotent apply; got ${ledgerCount}`);

    const fixtureSql = `
      INSERT INTO coverage_profiles(id, country, region, address, line, property, answers, consent, consent_text, consented_at)
      VALUES ('10000000-0000-4000-8000-000000000001', 'CA', 'BC', 'fixture address', 'homeowner', '{}', '{}', TRUE, 'fixture consent', NOW());
      INSERT INTO insurance_cases(id, execution_mode, status, legacy_coverage_profile_id, idempotency_key, request_hash, country, region, insurance_line, historical_shell)
      VALUES ('20000000-0000-4000-8000-000000000001', 'SIMULATION', 'DRAFT', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', repeat('a', 64), 'CA', 'BC', 'homeowner', TRUE);
      INSERT INTO insurance_consent_artifacts(id, case_id, version, language, purpose, exact_text, intended_recipients, field_scope, granted_at)
      VALUES ('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'v1', 'en-CA', 'profile', 'frozen consent', '[]', '["property"]', NOW());
      INSERT INTO insurance_submissions(id, case_id, version, status, questionnaire_version, idempotency_key, request_hash, consent_artifact_id)
      VALUES ('50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 1, 'DRAFT', 'coverage-profile-v1', '60000000-0000-4000-8000-000000000001', repeat('b', 64), '40000000-0000-4000-8000-000000000001');
      INSERT INTO insurance_submission_answers(id, submission_id, question_key, answer_kind, value, origin)
      VALUES ('70000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'occupancy', 'ATTESTATION', '"owner"', 'USER');
      UPDATE insurance_submissions SET status='READY', finalized_at=NOW(), updated_at=NOW() WHERE id='50000000-0000-4000-8000-000000000001';
      UPDATE insurance_cases SET status='READY_FOR_SUBMISSION', updated_at=NOW() WHERE id='20000000-0000-4000-8000-000000000001';
    `;
    command("psql", ["-X", "-v", "ON_ERROR_STOP=1"], pgEnv, fixtureSql);
    expectPsqlFailure(
      "UPDATE insurance_submission_answers SET value='12' WHERE id='70000000-0000-4000-8000-000000000001';\n",
      pgEnv,
      "finalized answer mutation"
    );
    expectPsqlFailure(
      "UPDATE insurance_cases SET execution_mode='PRODUCTION' WHERE id='20000000-0000-4000-8000-000000000001';\n",
      pgEnv,
      "execution-mode mutation"
    );
    expectPsqlFailure(
      "UPDATE insurance_cases SET status='DRAFT' WHERE id='20000000-0000-4000-8000-000000000001';\n",
      pgEnv,
      "backward case transition"
    );
    expectPsqlFailure(
      "UPDATE insurance_consent_artifacts SET exact_text='changed' WHERE id='40000000-0000-4000-8000-000000000001';\n",
      pgEnv,
      "exact consent mutation"
    );
    expectPsqlFailure(
      "UPDATE insurance_submissions SET status='SUBMITTED' WHERE id='50000000-0000-4000-8000-000000000001';\n",
      pgEnv,
      "A2 provider-delivery state in A1 schema"
    );
    // A1 edits must create a new immutable draft version, which temporarily
    // returns the case to fact collection; no in-place edit of v1 is allowed.
    command("psql", ["-X", "-v", "ON_ERROR_STOP=1"], pgEnv, `
      UPDATE insurance_cases SET status='COLLECTING_FACTS' WHERE id='20000000-0000-4000-8000-000000000001';
      INSERT INTO insurance_consent_artifacts(id, case_id, version, language, purpose, exact_text, intended_recipients, field_scope, granted_at, supersedes_consent_id)
      VALUES ('40000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'v1', 'en-CA', 'profile', 'frozen consent', '[]', '["property"]', NOW(), '40000000-0000-4000-8000-000000000001');
      INSERT INTO insurance_submissions(id, case_id, version, status, questionnaire_version, idempotency_key, request_hash, consent_artifact_id, supersedes_submission_id)
      VALUES ('50000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 2, 'DRAFT', 'coverage-profile-v1', '60000000-0000-4000-8000-000000000002', repeat('c', 64), '40000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000001');
      INSERT INTO insurance_submission_answers(id, submission_id, question_key, answer_kind, value, origin, corrects_answer_id)
      VALUES ('70000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000002', 'occupancy', 'ATTESTATION', '"rental"', 'USER', '70000000-0000-4000-8000-000000000001');
      INSERT INTO insurance_case_command_receipts(id, case_id, command_type, idempotency_key, request_hash, result_submission_id)
      VALUES ('80000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'UPDATE', '90000000-0000-4000-8000-000000000001', repeat('d', 64), '50000000-0000-4000-8000-000000000002');
    `);
    const versionCount = command(
      "psql",
      ["-X", "-A", "-t", "-c", "SELECT max(version) FROM insurance_submissions WHERE case_id='20000000-0000-4000-8000-000000000001'"],
      pgEnv
    );
    if (versionCount !== "2") fail(`expected edit to create submission version 2; got ${versionCount}`);
    expectPsqlFailure(
      `INSERT INTO insurance_case_command_receipts(id, case_id, command_type, idempotency_key, request_hash, result_submission_id)
       VALUES ('80000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'UPDATE', '90000000-0000-4000-8000-000000000001', repeat('e', 64), '50000000-0000-4000-8000-000000000002');`,
      pgEnv,
      "concurrent update command idempotency collision"
    );
    command("psql", ["-X", "-v", "ON_ERROR_STOP=1"], pgEnv, `
      UPDATE insurance_submissions SET status='READY', finalized_at=NOW(), updated_at=NOW() WHERE id='50000000-0000-4000-8000-000000000002';
      UPDATE insurance_cases SET status='READY_FOR_SUBMISSION' WHERE id='20000000-0000-4000-8000-000000000001';
      INSERT INTO insurance_case_command_receipts(id, case_id, command_type, idempotency_key, request_hash, result_submission_id)
      VALUES ('80000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', 'FINALIZE', '90000000-0000-4000-8000-000000000002', repeat('f', 64), '50000000-0000-4000-8000-000000000002');
    `);
    const retryReceipt = command(
      "psql",
      ["-X", "-A", "-t", "-c", "SELECT result_submission_id FROM insurance_case_command_receipts WHERE case_id='20000000-0000-4000-8000-000000000001' AND command_type='FINALIZE' AND idempotency_key='90000000-0000-4000-8000-000000000002'"],
      pgEnv
    );
    if (retryReceipt !== "50000000-0000-4000-8000-000000000002") fail("finalize retry receipt did not preserve original submission");
    expectPsqlFailure(
      `INSERT INTO insurance_cases(id, execution_mode, status, idempotency_key, request_hash, country, region, insurance_line, historical_shell)
       VALUES ('20000000-0000-4000-8000-000000000002', 'SIMULATION', 'DRAFT', '30000000-0000-4000-8000-000000000001', repeat('a', 64), 'CA', 'BC', 'homeowner', TRUE);`,
      pgEnv,
      "duplicate create idempotency key"
    );

    appendFileSync(resolve(migrations, "0001_insurance_create_case_submission.sql"), "\n-- forbidden checksum mutation\n");
    const drift = spawnSync("node", ["--import", "tsx", "scripts/insurance-migrate.ts", "--mode=check"], {
      env: runnerEnv,
      encoding: "utf8",
    });
    if (drift.status === 0 || !`${drift.stderr}${drift.stdout}`.includes("checksum drift")) {
      fail("checksum drift was not rejected");
    }
    console.log("insurance migration scratch test passed");
  } finally {
    if (started) spawnSync("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"], { encoding: "utf8" });
    rmSync(root, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
