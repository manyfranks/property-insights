import { spawnSync } from "node:child_process";
import { setSqlForTest } from "../src/lib/db";
import type { neon } from "@neondatabase/serverless";
import {
  createFinalizedCoverageCase,
  finalizeCoverageCase,
  InsuranceCaseConflictError,
  updateCoverageCase,
  type CreateFinalizedCoverageCaseInput,
} from "../src/lib/insurance/application/cases";

function fail(message: string): never { throw new Error(`[insurance-command-test] ${message}`); }
function expect(value: unknown, message: string): asserts value { if (!value) fail(message); }
function uuid(suffix: string): string { return `10000000-0000-4000-8000-${suffix.padStart(12, "0")}`; }

function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return `'${value.toISOString().replaceAll("'", "''")}'`;
  if (typeof value === "object") return `'${JSON.stringify(value).replaceAll("'", "''")}'`;
  return `'${String(value).replaceAll("'", "''")}'`;
}

function render(strings: TemplateStringsArray | readonly string[], values: readonly unknown[]): string {
  return strings.reduce((sql, part, index) => sql + part + (index < values.length ? sqlLiteral(values[index]) : ""), "");
}

function psql(sql: string): string {
  const result = spawnSync("psql", ["-X", "-q", "-A", "-t", "-F", "\t", "-v", "ON_ERROR_STOP=1"], {
    env: process.env,
    input: sql,
    encoding: "utf8",
  });
  if (result.status !== 0) fail((result.stderr || result.stdout || "psql failed").trim());
  return result.stdout.trim();
}

type LazyQuery = PromiseLike<Record<string, unknown>[]> & { readonly text: string };

function resultRows(text: string, output: string): Record<string, unknown>[] {
  if (!output) return [];
  const rows = output.split("\n").filter(Boolean).map((line) => line.split("\t"));
  if (text.includes("'REPLAY'::text outcome")) {
    return rows.map(([outcome, submissionId, version, status]) => ({
      outcome,
      submission_id: submissionId || null,
      submission_version: version ? Number(version) : null,
      submission_status: status || null,
    }));
  }
  if (text.includes("c.id AS case_id")) {
    return rows.map(([caseId, profileId, submissionId, version, createdAt, tokenHash, requestHash]) => ({
      case_id: caseId,
      profile_id: profileId,
      submission_id: submissionId,
      submission_version: Number(version),
      created_at: createdAt,
      access_token_hash: tokenHash,
      request_hash: requestHash,
    }));
  }
  return [];
}

function scratchSql() {
  const tag = ((strings: TemplateStringsArray | readonly string[], ...values: unknown[]): LazyQuery => {
    const text = render(strings, values);
    const execute = () => Promise.resolve(resultRows(text, psql(text)));
    return { text, then: (resolve, reject) => execute().then(resolve, reject) };
  }) as unknown as ReturnType<typeof neon>;
  (tag as unknown as { transaction: (callback: (tx: typeof tag) => LazyQuery[]) => Promise<unknown> }).transaction = async (callback) => {
    const queries = callback(tag);
    psql(`BEGIN;\n${queries.map((query) => query.text).join(";\n")};\nCOMMIT;`);
  };
  return tag;
}

function input(idempotencyKey: string, accessToken: string, claims5yr = 0): CreateFinalizedCoverageCaseInput {
  return {
    userId: "user-scratch",
    country: "CA",
    region: "BC",
    address: "123 Scratch Street, Vancouver, BC",
    line: "homeowner",
    property: {
      identity: { type: "house", yearBuilt: 2001, beds: 3, baths: 2, sqft: 1800, source: "known" },
      value: { estimatedValue: 900000, estimatedRent: null, source: "modeled" },
      hazards: { flood: 1, wildfire: 2, wind: 3, source: "modeled" },
    },
    answers: {
      occupancy: "owner", unitCount: 1, claims5yr, coverageExpiry: null, roofAge: 12,
      contact: { name: "Scratch User", email: "scratch@example.test", phone: null, preference: "email" },
    },
    consent: true,
    consentText: "Frozen consent text for scratch command testing.",
    source: "assess-result",
    executionMode: "SIMULATION",
    idempotencyKey,
    accessToken,
    intendedRecipients: [{ counterpartyId: "test-affiliate", name: "Test Affiliate", role: "AFFILIATE" }],
  };
}

async function expectConflict(action: () => Promise<unknown>, label: string): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (error instanceof InsuranceCaseConflictError) return;
    throw error;
  }
  fail(`${label} did not raise InsuranceCaseConflictError`);
}

async function main(): Promise<void> {
  if (process.env.INSURANCE_SCRATCH_TEST !== "1") fail("INSURANCE_SCRATCH_TEST=1 is required");
  setSqlForTest(scratchSql());
  const token = Buffer.alloc(32, 17).toString("base64url");
  const created = await createFinalizedCoverageCase(input(uuid("1"), token));
  const replay = await createFinalizedCoverageCase(input(uuid("1"), token));
  expect(created.newlyCreated && !replay.newlyCreated && replay.caseId === created.caseId, "exact create replay must return the original case");
  await expectConflict(() => createFinalizedCoverageCase(input(uuid("1"), token, 1)), "changed create replay");

  const concurrentToken = Buffer.alloc(32, 18).toString("base64url");
  const [concurrentOne, concurrentTwo] = await Promise.all([
    createFinalizedCoverageCase(input(uuid("2"), concurrentToken)),
    createFinalizedCoverageCase(input(uuid("2"), concurrentToken)),
  ]);
  expect(concurrentOne.caseId === concurrentTwo.caseId && concurrentOne.newlyCreated !== concurrentTwo.newlyCreated, "concurrent create must produce one case and one replay");
  const concurrentUpdateInput = { ...input(uuid("8"), concurrentToken, 1), caseId: concurrentOne.caseId };
  const [concurrentUpdateOne, concurrentUpdateTwo] = await Promise.all([
    updateCoverageCase(concurrentUpdateInput),
    updateCoverageCase(concurrentUpdateInput),
  ]);
  expect(
    concurrentUpdateOne.submissionId === concurrentUpdateTwo.submissionId &&
      concurrentUpdateOne.replayed !== concurrentUpdateTwo.replayed &&
      concurrentUpdateOne.submissionVersion === 2,
    "concurrent exact update must create one draft v2 and one replay"
  );

  await expectConflict(
    () => updateCoverageCase({ ...input(uuid("9"), token, 2), caseId: created.caseId, country: "US" }),
    "cross-country update"
  );
  const updateInput = { ...input(uuid("3"), token, 2), caseId: created.caseId };
  const updated = await updateCoverageCase(updateInput);
  expect(updated.submissionVersion === 2 && updated.status === "DRAFT" && !updated.replayed, "update must append draft v2");
  const updateReplay = await updateCoverageCase(updateInput);
  expect(updateReplay.replayed && updateReplay.submissionId === updated.submissionId, "exact update replay must return v2");
  await expectConflict(() => updateCoverageCase({
    ...updateInput,
    answers: { ...(updateInput.answers as Record<string, unknown>), claims5yr: 3 },
  }), "changed update replay");

  const finalized = await finalizeCoverageCase({
    caseId: created.caseId, submissionId: updated.submissionId, userId: "user-scratch", executionMode: "SIMULATION", idempotencyKey: uuid("4"), accessToken: token,
  });
  expect(finalized.status === "READY" && finalized.submissionVersion === 2 && !finalized.replayed, "finalize must make v2 ready");
  const finalizeReplay = await finalizeCoverageCase({
    caseId: created.caseId, submissionId: updated.submissionId, userId: "user-scratch", executionMode: "SIMULATION", idempotencyKey: uuid("4"), accessToken: token,
  });
  expect(finalizeReplay.replayed && finalizeReplay.submissionId === updated.submissionId, "exact finalize replay must return v2");

  const summary = psql(`
    SELECT (SELECT count(*) FROM insurance_cases WHERE id='${created.caseId}') || '|' ||
      (SELECT count(*) FROM insurance_submissions WHERE case_id='${created.caseId}') || '|' ||
      (SELECT status FROM insurance_cases WHERE id='${created.caseId}') || '|' ||
      (SELECT status FROM insurance_submissions WHERE id='${updated.submissionId}') || '|' ||
      (SELECT count(*) FROM insurance_consent_artifacts WHERE case_id='${created.caseId}' AND version='coverage-profile-consent-v1') || '|' ||
      (SELECT count(*) FROM insurance_submission_answers WHERE submission_id='${updated.submissionId}' AND corrects_answer_id IS NOT NULL) || '|' ||
      (SELECT count(*) FROM insurance_case_command_receipts WHERE case_id='${created.caseId}') || '|' ||
      (SELECT count(*) FROM insurance_case_timeline_events WHERE case_id='${created.caseId}') || '|' ||
      (SELECT count(*) FROM insurance_audit_events WHERE case_id='${created.caseId}') || '|' ||
      (SELECT count(*) FROM insurance_cases WHERE status IN ('SUBMITTED','QUOTED','BOUND'));
  `);
  expect(summary === "1|2|READY_FOR_SUBMISSION|READY|2|1|2|4|5|0", `unexpected command evidence summary: ${summary}`);
  setSqlForTest(null);
  console.log("insurance case command scratch test passed");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
