/**
 * test-canary-local.ts
 *
 * Invokes the /api/canary route handler directly (no HTTP server, no
 * `next dev` needed) — same "call the handler function in-process" pattern
 * golden-canada.ts uses for the assessment adapters, applied to the canary
 * route itself. Loads .env.local the same way every other scripts/*.ts
 * ingest/test script does (scripts/lib/ingest-shared.ts), then:
 *
 *   1. Builds a Request the same shape Vercel's cron would send (Bearer
 *      CRON_SECRET header if that env var is set locally, unauthenticated
 *      otherwise — matches route.ts's own auth gate).
 *   2. Calls GET(request) directly.
 *   3. Parses the JSON body, prints each of the 8 checks with PASS/FAIL,
 *      and exits 1 if any failed (so this is CI/pre-deploy-friendly, not
 *      just a manual eyeball tool).
 *
 * Run: npx tsx scripts/test-canary-local.ts
 *
 * NOTE: this makes real live calls (Zoocasa, Calgary/Edmonton/Winnipeg
 * SODA, Census geocoder) and real reads (Neon, KV) — same external
 * dependencies the daily cron itself exercises. It does NOT call RentCast
 * live (see checkUsRentcastCache's doc comment in route.ts) — quota-safe.
 */

import { loadEnvLocal } from "./lib/ingest-shared";
loadEnvLocal();

import { GET } from "../src/app/api/canary/route";

async function main() {
  console.log("Canary local test — invoking GET /api/canary handler directly\n");

  const cronSecret = process.env.CRON_SECRET;
  const headers: Record<string, string> = cronSecret ? { authorization: `Bearer ${cronSecret}` } : {};
  const request = new Request("http://localhost/api/canary", { method: "GET", headers });

  const t0 = Date.now();
  const response = await GET(request);
  const elapsedMs = Date.now() - t0;

  const body = (await response.json()) as {
    ok: boolean;
    checks: Record<string, { ok: boolean; detail: string }>;
    failures: string[];
  };

  console.log(`HTTP status: ${response.status}`);
  console.log(`Elapsed: ${elapsedMs}ms\n`);

  for (const [name, result] of Object.entries(body.checks)) {
    const tag = result.ok ? "PASS" : "FAIL";
    console.log(`  [${tag}] ${name} — ${result.detail}`);
  }

  console.log(`\n${body.ok ? "ALL CHECKS PASSED" : `${body.failures.length} CHECK(S) FAILED`}`);
  if (!body.ok) {
    console.log(body.failures.map((f) => `  - ${f}`).join("\n"));
  }

  process.exit(body.ok ? 0 : 1);
}

main().catch((err) => {
  console.error("test-canary-local.ts crashed:", err);
  process.exit(1);
});
