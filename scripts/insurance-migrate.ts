import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

type Mode = "plan" | "check" | "apply";
interface Migration { sequence: number; filename: string; checksum: string; sql: string }

const MIGRATION_NAME = /^(\d{4})_insurance_[a-z0-9_]+\.sql$/;
const MIGRATIONS_DIR = resolve(process.env.INSURANCE_MIGRATIONS_DIR || resolve(process.cwd(), "db/migrations"));
const LOCK_ID = "704119340216";

function fail(message: string): never {
  throw new Error(`[insurance-migrate] ${message}`);
}

function loadMigrations(): Migration[] {
  const files = readdirSync(MIGRATIONS_DIR).filter((name) => name.includes("_insurance_")).sort();
  const migrations = files.map((filename) => {
    const match = filename.match(MIGRATION_NAME);
    if (!match) fail(`invalid filename: ${filename}`);
    const sql = readFileSync(resolve(MIGRATIONS_DIR, filename), "utf8");
    return {
      sequence: Number(match[1]),
      filename,
      sql,
      checksum: createHash("sha256").update(sql).digest("hex"),
    };
  });
  migrations.forEach((migration, index) => {
    if (migration.sequence !== index + 1) {
      fail(`sequence must be contiguous from 0001; found ${migration.filename} at position ${index + 1}`);
    }
  });
  return migrations;
}

function psqlEnvironment(databaseUrl: string): NodeJS.ProcessEnv {
  const url = new URL(databaseUrl);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") fail("database URL must use postgres protocol");
  return {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGSSLMODE: url.searchParams.get("sslmode") || (url.hostname === "localhost" || url.hostname === "127.0.0.1" ? "disable" : "require"),
  };
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function runPsql(script: string, databaseUrl: string, tuplesOnly = false): string {
  const args = ["-X", "--no-password", "-v", "ON_ERROR_STOP=1"];
  if (tuplesOnly) args.push("-A", "-t", "-F", "|");
  const result = spawnSync("psql", args, {
    env: psqlEnvironment(databaseUrl),
    input: script,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) fail((result.stderr || result.stdout || "psql failed").trim());
  return result.stdout.trim();
}

function ledgerBootstrap(): string {
  return `
SELECT pg_advisory_lock(${LOCK_ID});
CREATE TABLE IF NOT EXISTS schema_migrations (
  namespace TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  filename TEXT NOT NULL,
  checksum CHAR(64) NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_by TEXT NOT NULL,
  release_id TEXT NOT NULL,
  PRIMARY KEY (namespace, sequence),
  UNIQUE (namespace, filename)
);`;
}

function main(): void {
  const modeArg = process.argv.find((arg) => arg.startsWith("--mode="))?.split("=")[1] ?? "plan";
  if (!(["plan", "check", "apply"] as string[]).includes(modeArg)) fail(`invalid mode: ${modeArg}`);
  const mode = modeArg as Mode;
  const migrations = loadMigrations();

  if (mode === "plan") {
    for (const item of migrations) console.log(`${item.filename} sha256:${item.checksum}`);
    console.log(`[insurance-migrate] plan only; ${migrations.length} migration(s), database untouched`);
    return;
  }

  const databaseUrl = process.env.INSURANCE_MIGRATION_DATABASE_URL;
  if (!databaseUrl) fail("INSURANCE_MIGRATION_DATABASE_URL is required for check/apply");
  const ledgerRows = runPsql(
    `${ledgerBootstrap()}\nSELECT sequence, filename, checksum FROM schema_migrations WHERE namespace = 'insurance' ORDER BY sequence;\nSELECT pg_advisory_unlock(${LOCK_ID});`,
    databaseUrl,
    true
  )
    .split("\n")
    .filter((line) => /^\d+\|/.test(line));

  for (const [index, line] of ledgerRows.entries()) {
    const [sequenceText, filename, checksum] = line.split("|");
    const sequence = Number(sequenceText);
    if (sequence !== index + 1) fail(`database ledger has a sequence gap before ${sequence}`);
    const local = migrations.find((item) => item.sequence === sequence);
    if (!local || local.filename !== filename) fail(`ledger sequence ${sequence} does not match committed migrations`);
    if (local.checksum !== checksum) fail(`checksum drift detected for ${filename}`);
  }
  if (ledgerRows.length > migrations.length) fail("database ledger is ahead of committed migrations");

  if (mode === "check") {
    console.log(`[insurance-migrate] check passed; ${ledgerRows.length} applied, ${migrations.length - ledgerRows.length} pending`);
    return;
  }

  const appliedCount = ledgerRows.length;
  const pending = migrations.slice(appliedCount);
  if (pending.length === 0) {
    console.log("[insurance-migrate] no pending migrations");
    return;
  }
  const actor = process.env.INSURANCE_MIGRATION_ACTOR || "local-release-runner";
  const releaseId = process.env.INSURANCE_MIGRATION_RELEASE_ID || "unversioned";
  let script = `${ledgerBootstrap()}\n`;
  for (const migration of pending) {
    const variable = `migration_${migration.sequence}`;
    script += `
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM schema_migrations
    WHERE namespace = 'insurance' AND sequence = ${migration.sequence}
      AND (filename <> ${sqlLiteral(migration.filename)} OR checksum <> ${sqlLiteral(migration.checksum)})
  ) THEN RAISE EXCEPTION 'insurance migration checksum or filename drift at sequence ${migration.sequence}'; END IF;
END $$;
SELECT NOT EXISTS (
  SELECT 1 FROM schema_migrations
  WHERE namespace = 'insurance' AND sequence = ${migration.sequence}
) AS pending \\gset ${variable}_
\\if :${variable}_pending
BEGIN;
${migration.sql}
INSERT INTO schema_migrations(namespace, sequence, filename, checksum, applied_by, release_id)
VALUES ('insurance', ${migration.sequence}, ${sqlLiteral(migration.filename)}, ${sqlLiteral(migration.checksum)}, ${sqlLiteral(actor)}, ${sqlLiteral(releaseId)});
COMMIT;
\\endif
`;
  }
  script += `SELECT pg_advisory_unlock(${LOCK_ID});\n`;
  runPsql(script, databaseUrl);
  console.log(`[insurance-migrate] applied ${pending.length} migration(s); ledger now at ${migrations.length}`);
}

main();
