/**
 * scripts/prod-smoke.ts
 *
 * Post-deploy, read-only smoke test against the live insurance path.
 * Complements scripts/journey-matrix.ts (which oracles *config-computed*
 * outcomes offline, no network) by hitting the real deployed site and
 * checking that a handful of load-bearing routes actually respond the way
 * the current rollout stage says they should.
 *
 * Run: npx tsx scripts/prod-smoke.ts
 *   BASE_URL=https://staging.example.com npx tsx scripts/prod-smoke.ts
 *   EXPECTED_STAGE=intake npx tsx scripts/prod-smoke.ts
 *   WRITE_CHECK=1 npx tsx scripts/prod-smoke.ts   (see WRITE_CHECK section below)
 *
 * EXPECTED_STAGE mirrors NEXT_PUBLIC_INSURANCE_STAGE (src/config/
 * insurance-stage.ts: off|landing|intake|switch) — the value the deployed
 * site is *supposed* to currently be running. This script doesn't read the
 * deployed env (it's an outside-in black-box check), so it has to be told
 * what to expect.
 *
 * Default is "intake", NOT "landing" — verified live (2026-08-15) via a
 * direct curl against BASE_URL: GET /coverage-profile?country=CA&region=BC
 * &line=homeowner&address=... returns 200 with real wizard markup ("Build
 * your coverage profile"), not a 404, and /insurance shows no "Already
 * insured? We'll help you switch" copy. That's exactly the intake-stage
 * signature (stageAtLeast("intake") true, stageAtLeast("switch") false) —
 * production has already flipped past "landing". A "landing" default would
 * make this script report a false failure on every single real run against
 * the live site, which defeats the point of a smoke test. Pass
 * EXPECTED_STAGE=switch (or back to =landing/=off, if the dial is ever
 * turned back down) to keep this correct as the rollout keeps moving.
 *
 * Exit code: 0 if every check passes, 1 otherwise — with every failing
 * check printed (not just the first), so a single run tells you everything
 * that's wrong, never just a partial picture.
 */

const BASE_URL = (process.env.BASE_URL ?? "https://www.propertyinsights.xyz").replace(/\/$/, "");
const EXPECTED_STAGE = process.env.EXPECTED_STAGE ?? "intake";
const STAGE_ORDER: Record<string, number> = { off: 0, landing: 1, intake: 2, switch: 3 };
const WRITE_CHECK = process.env.WRITE_CHECK === "1";

const WRITE_CHECK_EMAIL = "prod-smoke-delete-me@example.com";

// H1 copy from src/components/insurance/landing/hero.tsx — the text node
// before the highlighted "insurance" span, stable across the animated
// underline styling.
const INSURANCE_H1_SUBSTRING = "Forget everything you know about";

if (!(EXPECTED_STAGE in STAGE_ORDER)) {
  console.error(
    `[prod-smoke] EXPECTED_STAGE="${EXPECTED_STAGE}" is not one of off|landing|intake|switch — refusing to guess.`
  );
  process.exit(1);
}
const stageRank = STAGE_ORDER[EXPECTED_STAGE];

interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
}

const results: CheckResult[] = [];

function record(name: string, pass: boolean, detail: string): void {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function fetchText(path: string): Promise<{ status: number; body: string } | { error: string }> {
  const url = `${BASE_URL}${path}`;
  try {
    const res = await fetch(url, { redirect: "manual" });
    const body = await res.text().catch(() => "");
    return { status: res.status, body };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

async function checkInsuranceLanding(): Promise<void> {
  const expectPublic = stageRank >= STAGE_ORDER.landing;
  const res = await fetchText("/insurance");

  if ("error" in res) {
    record("GET /insurance", false, `request failed: ${res.error}`);
    return;
  }

  if (expectPublic) {
    if (res.status !== 200) {
      record("GET /insurance", false, `expected 200 (stage=${EXPECTED_STAGE} >= landing), got ${res.status}`);
      return;
    }
    const hasH1 = res.body.includes(INSURANCE_H1_SUBSTRING);
    record(
      "GET /insurance",
      hasH1,
      hasH1 ? `200, H1 present` : `200 but H1 text "${INSURANCE_H1_SUBSTRING}" not found in body`
    );
  } else {
    // stage=off — the page should 404 (app/insurance/page.tsx: !stageAtLeast("landing") -> notFound()).
    const ok = res.status === 404;
    record("GET /insurance", ok, `expected 404 (stage=off), got ${res.status}`);
  }
}

async function checkCoverageProfile(): Promise<void> {
  // A real, always-eligible cell (see scripts/journey-matrix.ts's ground
  // truth: BC + homeowner + residential is never excluded and BC is the
  // only rollout-"live" CA province today) — hitting /coverage-profile bare
  // (no query params) 404s in EVERY stage once the stage gate passes
  // (app/coverage-profile/page.tsx also 404s on missing params), so that
  // wouldn't distinguish "stage gate closed" from "stage gate open, wizard
  // would render". Query params make the check meaningful at every stage.
  const qs = "country=CA&region=BC&line=homeowner&address=" + encodeURIComponent("123 Test St, Victoria, BC");
  const res = await fetchText(`/coverage-profile?${qs}`);

  if ("error" in res) {
    record("GET /coverage-profile", false, `request failed: ${res.error}`);
    return;
  }

  const expectWizard = stageRank >= STAGE_ORDER.intake;
  if (expectWizard) {
    const ok = res.status === 200;
    record(
      "GET /coverage-profile",
      ok,
      ok ? `200 (stage=${EXPECTED_STAGE} >= intake, BC/homeowner is live)` : `expected 200, got ${res.status}`
    );
  } else {
    const ok = res.status === 404;
    record(
      "GET /coverage-profile",
      ok,
      ok ? `404 (stage=${EXPECTED_STAGE} < intake)` : `expected 404 (stage=${EXPECTED_STAGE} < intake), got ${res.status}`
    );
  }
}

async function checkDisclosures(): Promise<void> {
  const res = await fetchText("/disclosures");
  if ("error" in res) {
    record("GET /disclosures", false, `request failed: ${res.error}`);
    return;
  }
  record("GET /disclosures", res.status === 200, `status ${res.status}`);
}

async function checkSitemap(): Promise<void> {
  const res = await fetchText("/sitemap-main.xml");
  if ("error" in res) {
    record("GET /sitemap-main.xml", false, `request failed: ${res.error}`);
    return;
  }
  if (res.status !== 200) {
    record("GET /sitemap-main.xml", false, `expected 200, got ${res.status}`);
    return;
  }
  const hasInsurance = res.body.includes("/insurance");
  record(
    "GET /sitemap-main.xml",
    hasInsurance,
    hasInsurance ? "200, contains /insurance" : "200 but no /insurance entry found"
  );
}

async function checkRobots(): Promise<void> {
  const res = await fetchText("/robots.txt");
  if ("error" in res) {
    record("GET /robots.txt", false, `request failed: ${res.error}`);
    return;
  }
  record("GET /robots.txt", res.status === 200, `status ${res.status}`);
}

/**
 * Optional, opt-in only (WRITE_CHECK=1): POSTs one real waitlist entry with
 * a clearly-marked throwaway email, then deletes it via a direct DATABASE_URL
 * connection so nothing durable is left behind. Skipped by default — this
 * is the only check in this script that writes anything.
 */
async function checkWaitlistWrite(): Promise<void> {
  if (!WRITE_CHECK) {
    console.log("  SKIP  POST /api/insurance/waitlist (WRITE_CHECK not set to 1)");
    return;
  }

  const url = `${BASE_URL}/api/insurance/waitlist`;
  let postStatus: number;
  let id: string | undefined;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: WRITE_CHECK_EMAIL,
        country: "CA",
        region: "BC",
        line: "homeowner",
        address: null,
      }),
    });
    postStatus = res.status;
    const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
    id = body.id;
    if (res.status !== 200 || !id) {
      record("POST /api/insurance/waitlist", false, `status ${postStatus}, body=${JSON.stringify(body)}`);
      return;
    }
  } catch (err) {
    record("POST /api/insurance/waitlist", false, `request failed: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  record("POST /api/insurance/waitlist", true, `created id=${id}`);

  // Clean up via a direct DB connection — same loadEnvLocal() pattern as
  // scripts/lib/ingest-shared.ts (manual .env.local parse, no dotenv dep).
  try {
    const { loadEnvLocal } = await import("./lib/ingest-shared");
    loadEnvLocal();
    if (!process.env.DATABASE_URL) {
      record(
        "DELETE waitlist test row",
        false,
        "DATABASE_URL not set — the test row was created but could NOT be cleaned up. Delete manually: " +
          `DELETE FROM insurance_waitlist WHERE id = '${id}';`
      );
      return;
    }
    const { sql } = await import("../src/lib/db");
    const db = sql();
    const deleted = (await db`DELETE FROM insurance_waitlist WHERE id = ${id}::uuid RETURNING id`) as Array<{
      id: string;
    }>;
    record(
      "DELETE waitlist test row",
      deleted.length === 1,
      deleted.length === 1 ? `deleted id=${id}` : `expected 1 row deleted, got ${deleted.length}`
    );
  } catch (err) {
    record(
      "DELETE waitlist test row",
      false,
      `cleanup failed — the test row (id=${id}) may still be in insurance_waitlist: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

async function main() {
  console.log(`[prod-smoke] BASE_URL=${BASE_URL} EXPECTED_STAGE=${EXPECTED_STAGE} WRITE_CHECK=${WRITE_CHECK ? "1" : "0"}\n`);

  await checkInsuranceLanding();
  await checkCoverageProfile();
  await checkDisclosures();
  await checkSitemap();
  await checkRobots();
  await checkWaitlistWrite();

  const failed = results.filter((r) => !r.pass);
  console.log("");
  if (failed.length > 0) {
    console.error(`[prod-smoke] FAILED: ${failed.length}/${results.length} check(s) failed:\n`);
    for (const f of failed) console.error(`  - ${f.name}: ${f.detail}`);
    process.exit(1);
  }

  console.log(`[prod-smoke] PASSED: ${results.length}/${results.length} checks.`);
}

main().catch((err) => {
  console.error("[prod-smoke] unexpected error:", err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
