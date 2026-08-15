/**
 * e2e/support/db-cleanup.ts
 *
 * Deletes the row the waitlist-journey test creates via a real POST
 * /api/insurance/waitlist (through the UI, not a direct DB write) so
 * repeated suite runs don't accumulate test rows in the shared prod
 * Postgres (insurance_waitlist — src/lib/db/insurance-waitlist.ts).
 *
 * The Playwright test-runner *process* (this file), unlike the `next dev`
 * webServer child processes, does not get .env.local auto-loaded by
 * Next.js — so DATABASE_URL isn't in process.env here unless we load it
 * ourselves. Reuses the same manual .env.local parse convention as
 * scripts/lib/ingest-shared.ts's loadEnvLocal() (imported directly rather
 * than re-implemented — same repo convention: "the repo has no `dotenv`
 * package installed and doesn't need one for this one job").
 */

import { loadEnvLocal } from "../../scripts/lib/ingest-shared";

loadEnvLocal();

export const E2E_WAITLIST_EMAIL = "e2e-journey-test@example.com";

/**
 * Deletes every insurance_waitlist row for E2E_WAITLIST_EMAIL. Fails loud
 * (throws) if DATABASE_URL is missing or the delete errors — a cleanup step
 * that silently no-ops would leave test rows in prod data with nothing
 * telling anyone. Returns the number of rows deleted (0 is a valid,
 * non-error outcome — e.g. the waitlist test itself was skipped).
 */
export async function deleteE2eWaitlistRows(): Promise<number> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "[e2e/db-cleanup] DATABASE_URL not set (checked process.env after loadEnvLocal()) — cannot clean up the " +
        `test row for ${E2E_WAITLIST_EMAIL}. Check .env.local.`
    );
  }
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url);
  const rows = (await sql`
    DELETE FROM insurance_waitlist WHERE email = ${E2E_WAITLIST_EMAIL} RETURNING id
  `) as { id: string }[];
  return rows.length;
}
