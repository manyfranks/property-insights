/**
 * playwright.config.ts
 *
 * Journey-class e2e suite (feature/journey-matrix) — proves the RENDERED
 * app matches the config-derived journey matrix (src/config/insurance-
 * rollout.ts, src/config/affiliate-vendors.ts, src/config/insurance-
 * stage.ts) per equivalence class, using a real browser rather than unit
 * tests against the config alone.
 *
 * ---------------------------------------------------------------------
 * Two dev servers, one per NEXT_PUBLIC_INSURANCE_STAGE value under test
 * ---------------------------------------------------------------------
 * NEXT_PUBLIC_INSURANCE_STAGE is read via process.env — server components
 * read it per-request (fine to flip live), but client components
 * ("use client", e.g. insurance-landing-form.tsx) have it inlined into
 * their bundle at compile time. A single running server can't represent
 * two stages at once, so each stage gets its OWN `next dev` process on its
 * own port (below), rather than one server with the env flipped between
 * tests.
 *
 * `next dev`, not `next build && next start`: build+start would need a
 * fresh production build per stage (NEXT_PUBLIC_* is baked in at build
 * time either way, so this isn't a shortcut we're skipping) — that's
 * minutes per stage before a single test can run, versus dev mode's lazy
 * per-route compilation. Tradeoff: dev mode is slower per first-hit route
 * (on-demand compile) and isn't 100% representative of the production
 * bundle (no minification, different HMR-only runtime code shipped to the
 * client) — acceptable here since these tests assert rendered markup/text,
 * not bundle size or prod-only behavior. scripts/prod-smoke.ts (owned by a
 * parallel change on this branch) is the prod-representative counterpart;
 * this suite is the fast, per-class correctness check.
 *
 * ---------------------------------------------------------------------
 * Env precedence — VERIFIED empirically (2026-08-15), not assumed
 * ---------------------------------------------------------------------
 * .env.development.local pins NEXT_PUBLIC_INSURANCE_STAGE=landing. Next.js's
 * documented env-file precedence is process.env > .env.$(NODE_ENV).local >
 * .env.local > .env.$(NODE_ENV) > .env — i.e. a real shell/process env var
 * should already beat that file. Verified directly rather than trusting the
 * docs: booted a throwaway `next dev` with NEXT_PUBLIC_INSURANCE_STAGE=intake
 * in its shell env (and its own NEXT_DIST_DIR, see below) and curled
 * /coverage-profile — under stage "landing" that route 404s (gated by
 * stageAtLeast("intake") in src/app/coverage-profile/page.tsx); it instead
 * returned the real step-1 wizard markup ("Confirm the property"), proving
 * the shell env var won outright. No globalSetup env-file-rewrite hack is
 * needed — the webServer `command` strings below just set
 * NEXT_PUBLIC_INSURANCE_STAGE directly and that's sufficient.
 *
 * ---------------------------------------------------------------------
 * The `.next` dev lock — VERIFIED empirically, solved via distDir
 * ---------------------------------------------------------------------
 * Next's dev server takes a lock at `<distDir>/dev/lock`
 * (node_modules/next/dist/server/lib/router-utils/setup-dev-bundler.js) and
 * exits immediately if it can't acquire it ("Unable to acquire lock... is
 * another instance of next dev running?") — reproduced directly: with this
 * repo's own `npm run dev` already holding the lock on the default `.next`
 * (observed running on :3117 while writing this suite), a second `next dev`
 * pointed at the same distDir failed to start rather than displacing it.
 * The lock is scoped to `distDir`, not the project directory, so each stage
 * gets its own via `NEXT_DIST_DIR` (read by next.config.ts, defaulting to
 * ".next" everywhere this env var isn't set — a no-op for the user's own
 * dev server, prod builds, etc.). That makes the two webServer entries
 * below lock-independent of each other AND of any dev server the user
 * already has running — no need to serialize them or detect/kill anything.
 * If a distDir's OWN lock is somehow already held (e.g. a previous run of
 * this suite didn't shut down cleanly), Playwright's webServer will fail to
 * see the port come up and this config's `reuseExistingServer` (dev only)
 * will just attach to whatever's already answering there; a genuinely stuck
 * lock will surface as a clear timeout, not a silent hang — report it,
 * don't kill unrelated processes to work around it.
 */

import { defineConfig, devices } from "@playwright/test";

const LANDING_PORT = 4101;
const INTAKE_PORT = 4102;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
  },

  projects: [
    {
      name: "stage-landing",
      testMatch: /landing\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${LANDING_PORT}` },
    },
    {
      name: "stage-intake",
      testMatch: /intake\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${INTAKE_PORT}` },
    },
  ],

  // Both entries start together (Playwright doesn't serialize a webServer
  // array) — safe because each has its own distDir (its own lock) and its
  // own port, per the comment above. .env.local's DB/KV vars load
  // automatically (Next always reads .env.local); only NEXT_PUBLIC_INSURANCE_STAGE
  // and NEXT_DIST_DIR are set explicitly here, per stage.
  // A non-secret dummy PostHog project token keeps instrumentation-client.ts's
  // development fail-loud guard from aborting hydration. Requests remain on
  // the local /ingest proxy and the suite never treats analytics delivery as
  // an assertion or production event.
  webServer: [
    {
      command: `NEXT_PUBLIC_INSURANCE_STAGE=landing NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN=phc_e2e_dummy NEXT_DIST_DIR=.next-e2e-landing PORT=${LANDING_PORT} npx next dev -p ${LANDING_PORT}`,
      url: `http://localhost:${LANDING_PORT}/insurance`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: `NEXT_PUBLIC_INSURANCE_STAGE=intake NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN=phc_e2e_dummy NEXT_DIST_DIR=.next-e2e-intake PORT=${INTAKE_PORT} npx next dev -p ${INTAKE_PORT}`,
      url: `http://localhost:${INTAKE_PORT}/insurance`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
