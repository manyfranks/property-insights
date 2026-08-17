import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { psqlEnvironment } from "./insurance-migrate";

function fail(message: string): never { throw new Error(`[insurance-test-data] ${message}`); }

function flagValues(flag: string): string[] {
  const found: string[] = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === flag && process.argv[index + 1]) found.push(process.argv[index + 1]);
  }
  return found;
}

function assertUuids(ids: string[], label: string): void {
  if (!ids.every((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) {
    fail(`all ${label} IDs must be UUIDs`);
  }
}

function esc(value: string): string {
  return value.replaceAll("'", "''");
}

/** Safe even for an empty id list — `ARRAY[]::uuid[]` is valid Postgres. Every
 * element is pre-validated as a UUID by assertUuids, so this string-builds
 * without any injectable free text. */
function uuidArraySql(ids: string[]): string {
  return `ARRAY[${ids.map((id) => `'${id}'::uuid`).join(",")}]::uuid[]`;
}

const apply = process.argv.includes("--apply");
const revertMode = process.argv.includes("--revert");
const caseIds = [...new Set(flagValues("--case-id"))];
const profileIds = [...new Set(flagValues("--coverage-profile-id"))];
assertUuids(caseIds, "--case-id");
assertUuids(profileIds, "--coverage-profile-id");

const reason = process.env.INSURANCE_TEST_DATA_REASON;
const actor = process.env.INSURANCE_TEST_DATA_ACTOR;
const label = process.env.INSURANCE_TEST_DATA_LABEL;
const originalLabel = process.env.INSURANCE_TEST_DATA_ORIGINAL_LABEL;
const databaseUrl = process.env.INSURANCE_MIGRATION_DATABASE_URL;

if (!databaseUrl) fail("INSURANCE_MIGRATION_DATABASE_URL is required; runtime credentials are not accepted");
if (caseIds.length === 0 && profileIds.length === 0) {
  fail("explicit target IDs (--case-id / --coverage-profile-id) are required");
}
if (!reason || !actor || !label) {
  fail("INSURANCE_TEST_DATA_REASON, _ACTOR, and _LABEL are required");
}
if (revertMode && !originalLabel) {
  fail("--revert requires INSURANCE_TEST_DATA_ORIGINAL_LABEL naming the run being reverted");
}
if (revertMode && originalLabel === label) {
  fail("the new run label must differ from INSURANCE_TEST_DATA_ORIGINAL_LABEL");
}

const runId = randomUUID();
const selector = JSON.stringify({
  mode: revertMode ? "REVERT" : "CLASSIFY",
  caseIds: [...caseIds].sort(),
  profileIds: [...profileIds].sort(),
  ...(revertMode ? { originalLabel } : {}),
});
const selectorHash = createHash("sha256").update(selector).digest("hex");

function runPsql(input: string, tuplesOnly: boolean): { status: number; stdout: string; stderr: string } {
  const args = ["-X", "--no-password", "-v", "ON_ERROR_STOP=1"];
  if (tuplesOnly) args.push("-A", "-t", "-F", "|");
  const result = spawnSync("psql", args, {
    env: psqlEnvironment(databaseUrl!),
    input,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

interface EligibilityRow {
  id: string;
  kind: "case" | "profile";
  classification: string;
  runLabel: string | null;
  linkedCaseId: string | null;
}

/**
 * Reads current state for every requested ID up front. This drives the
 * human-readable per-ID report (missing vs. already-classified vs. wrong
 * run), and it also tells us which coverage_profiles have no linked
 * insurance_cases row — those cannot receive an insurance_audit_events row
 * (case_id is NOT NULL there), which is a real, disclosed coverage gap, not
 * a silently swallowed one.
 */
function readEligibility(): EligibilityRow[] {
  const query = `
    SELECT c.id::text, 'case', c.record_classification, coalesce(run.label,''), NULL::text
    FROM insurance_cases c LEFT JOIN insurance_test_data_runs run ON run.id = c.test_data_run_id
    WHERE c.id = ANY(${uuidArraySql(caseIds)})
    UNION ALL
    SELECT p.id::text, 'profile', p.record_classification, coalesce(run.label,''), lc.id::text
    FROM coverage_profiles p
    LEFT JOIN insurance_test_data_runs run ON run.id = p.test_data_run_id
    LEFT JOIN insurance_cases lc ON lc.legacy_coverage_profile_id = p.id
    WHERE p.id = ANY(${uuidArraySql(profileIds)});
  `;
  const result = runPsql(query, true);
  if (result.status !== 0) fail((result.stderr || result.stdout || "eligibility lookup failed").trim());
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [id, kind, classification, runLabel, linkedCaseId] = line.split("|");
      return {
        id,
        kind: kind as "case" | "profile",
        classification,
        runLabel: runLabel || null,
        linkedCaseId: linkedCaseId || null,
      };
    });
}

interface Verdict { kind: "case" | "profile"; id: string; eligible: boolean; note: string }

function evaluate(rows: EligibilityRow[]): { verdicts: Verdict[]; orphanProfileIds: string[] } {
  const byKindId = new Map<string, EligibilityRow>();
  for (const row of rows) byKindId.set(`${row.kind}:${row.id}`, row);

  const verdicts: Verdict[] = [];
  const evaluateOne = (kind: "case" | "profile", id: string) => {
    const row = byKindId.get(`${kind}:${id}`);
    if (!row) {
      verdicts.push({ kind, id, eligible: false, note: `missing — no ${kind === "case" ? "insurance_cases" : "coverage_profiles"} row with this ID` });
      return;
    }
    if (!revertMode) {
      if (row.classification !== "PRODUCTION") {
        verdicts.push({ kind, id, eligible: false, note: `already classified ${row.classification}${row.runLabel ? ` (run "${row.runLabel}")` : ""}, expected PRODUCTION` });
        return;
      }
      verdicts.push({ kind, id, eligible: true, note: "PRODUCTION -> TEST" });
      return;
    }
    if (row.classification !== "TEST") {
      verdicts.push({ kind, id, eligible: false, note: `currently ${row.classification}, expected TEST` });
      return;
    }
    if (row.runLabel !== originalLabel) {
      verdicts.push({ kind, id, eligible: false, note: `classified under run "${row.runLabel ?? "(unknown)"}", not "${originalLabel}"` });
      return;
    }
    verdicts.push({ kind, id, eligible: true, note: "TEST -> PRODUCTION" });
  };

  for (const id of caseIds) evaluateOne("case", id);
  for (const id of profileIds) evaluateOne("profile", id);

  const orphanProfileIds = profileIds.filter((id) => {
    const row = byKindId.get(`profile:${id}`);
    return row !== undefined && !row.linkedCaseId;
  });

  return { verdicts, orphanProfileIds };
}

function printReport(verdicts: Verdict[], heading: string): void {
  console.log(`[insurance-test-data] ${heading}`);
  for (const v of verdicts) {
    console.log(`  ${v.eligible ? "OK  " : "FAIL"} ${v.kind} ${v.id}: ${v.note}`);
  }
}

function buildApplySql(reasonText: string): string {
  const eventType = revertMode ? "TEST_DATA_REVERTED" : "TEST_DATA_CLASSIFIED";
  const metadata = `jsonb_build_object('testRunId','${runId}','reason','${esc(reasonText)}','selectorHash','${selectorHash}'${revertMode ? `,'originalRunLabel','${esc(originalLabel!)}'` : ""})`;
  const caseArray = uuidArraySql(caseIds);
  const profileArray = uuidArraySql(profileIds);

  const caseUpdate = !revertMode
    ? `
    DO $case_check$
    DECLARE affected int;
    BEGIN
      UPDATE insurance_cases SET record_classification='TEST', test_data_run_id='${runId}'::uuid
      WHERE id = ANY(${caseArray}) AND record_classification='PRODUCTION';
      GET DIAGNOSTICS affected = ROW_COUNT;
      IF affected <> ${caseIds.length} THEN
        RAISE EXCEPTION 'insurance_cases classification row-count mismatch: expected % got %', ${caseIds.length}, affected;
      END IF;
    END $case_check$;`
    : `
    DO $case_check$
    DECLARE affected int; original_run uuid;
    BEGIN
      SELECT id INTO original_run FROM insurance_test_data_runs WHERE label = '${esc(originalLabel!)}';
      IF original_run IS NULL THEN RAISE EXCEPTION 'original run label % not found', '${esc(originalLabel!)}'; END IF;
      UPDATE insurance_cases SET record_classification='PRODUCTION', test_data_run_id=NULL
      WHERE id = ANY(${caseArray}) AND record_classification='TEST' AND test_data_run_id = original_run;
      GET DIAGNOSTICS affected = ROW_COUNT;
      IF affected <> ${caseIds.length} THEN
        RAISE EXCEPTION 'insurance_cases revert row-count mismatch: expected % got %', ${caseIds.length}, affected;
      END IF;
    END $case_check$;`;

  const profileUpdate = !revertMode
    ? `
    DO $profile_check$
    DECLARE affected int;
    BEGIN
      UPDATE coverage_profiles SET record_classification='TEST', test_data_run_id='${runId}'::uuid
      WHERE id = ANY(${profileArray}) AND record_classification='PRODUCTION';
      GET DIAGNOSTICS affected = ROW_COUNT;
      IF affected <> ${profileIds.length} THEN
        RAISE EXCEPTION 'coverage_profiles classification row-count mismatch: expected % got %', ${profileIds.length}, affected;
      END IF;
    END $profile_check$;`
    : `
    DO $profile_check$
    DECLARE affected int; original_run uuid;
    BEGIN
      SELECT id INTO original_run FROM insurance_test_data_runs WHERE label = '${esc(originalLabel!)}';
      IF original_run IS NULL THEN RAISE EXCEPTION 'original run label % not found', '${esc(originalLabel!)}'; END IF;
      UPDATE coverage_profiles SET record_classification='PRODUCTION', test_data_run_id=NULL
      WHERE id = ANY(${profileArray}) AND record_classification='TEST' AND test_data_run_id = original_run;
      GET DIAGNOSTICS affected = ROW_COUNT;
      IF affected <> ${profileIds.length} THEN
        RAISE EXCEPTION 'coverage_profiles revert row-count mismatch: expected % got %', ${profileIds.length}, affected;
      END IF;
    END $profile_check$;`;

  return `
    BEGIN;
    INSERT INTO insurance_test_data_runs(id,label,reason,selector_hash,created_by)
    VALUES ('${runId}','${esc(label!)}','${esc(reasonText)}','${selectorHash}','${esc(actor!)}');
${caseUpdate}
${profileUpdate}
    INSERT INTO insurance_audit_events(id,case_id,event_type,actor_type,actor_id,correlation_id,subject_type,subject_id,metadata)
    SELECT gen_random_uuid(), id, '${eventType}', 'MIGRATION', '${esc(actor!)}', '${runId}', 'INSURANCE_CASE', id, ${metadata}
    FROM insurance_cases WHERE id = ANY(${caseArray});

    -- Coverage-profile targets only get an audit row when a case links to
    -- them (insurance_audit_events.case_id is NOT NULL). Orphan profile IDs
    -- are reported separately and recorded in the run's reason text; this is
    -- a disclosed limitation, not a silently dropped audit trail.
    INSERT INTO insurance_audit_events(id,case_id,event_type,actor_type,actor_id,correlation_id,subject_type,subject_id,metadata)
    SELECT gen_random_uuid(), c.id, '${eventType}', 'MIGRATION', '${esc(actor!)}', '${runId}', 'COVERAGE_PROFILE', p.id, ${metadata}
    FROM coverage_profiles p JOIN insurance_cases c ON c.legacy_coverage_profile_id = p.id
    WHERE p.id = ANY(${profileArray});
    COMMIT;
  `;
}

function main(): void {
  const eligibility = readEligibility();
  const { verdicts, orphanProfileIds } = evaluate(eligibility);
  const heading = `${apply ? "APPLY" : "DRY RUN"} — ${revertMode ? "revert TEST -> PRODUCTION" : "classify PRODUCTION -> TEST"}`;
  printReport(verdicts, heading);

  if (orphanProfileIds.length > 0) {
    console.log(
      `[insurance-test-data] NOTE: ${orphanProfileIds.length} coverage_profile ID(s) have no linked insurance_cases row and will not receive an insurance_audit_events row (case_id is NOT NULL there): ${orphanProfileIds.join(", ")}`
    );
  }

  const ineligible = verdicts.filter((v) => !v.eligible);

  if (!apply) {
    console.log(
      ineligible.length > 0
        ? "[insurance-test-data] dry run only; the above FAIL row(s) would make --apply fail with no database changes."
        : "[insurance-test-data] dry run only; --apply would succeed for all requested IDs."
    );
    return;
  }

  if (ineligible.length > 0) {
    console.error(`[insurance-test-data] refusing to apply: ${ineligible.length} of ${verdicts.length} requested ID(s) are ineligible (see FAIL rows above). No database changes were made.`);
    process.exitCode = 1;
    return;
  }

  const finalReason =
    reason! + (orphanProfileIds.length > 0 ? ` | unaudited coverage_profiles (no linked insurance_cases row): ${orphanProfileIds.join(",")}` : "");

  const result = runPsql(buildApplySql(finalReason), false);
  if (result.status !== 0) {
    // The whole apply (runs row + updates + audit rows) is one transaction;
    // any failure here — including a row-count mismatch raised inside the
    // DO blocks above — means nothing committed, not even the runs row.
    fail((result.stderr || result.stdout || "psql failed").trim());
  }

  console.log(`[insurance-test-data] applied run ${runId} ("${label}"); exact selector hash ${selectorHash}`);
  for (const v of verdicts) {
    console.log(`  CHANGED ${v.kind} ${v.id}: ${v.note}`);
  }
}

main();
