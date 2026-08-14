// One-time: create insurance_waitlist in Neon (mirrors src/lib/db/schema.sql).
// Delivered, not executed — do not run this against a real database as part
// of this change; see src/lib/db/insurance-waitlist.ts for the write path.
// Must be run (once, against the production DB) before the /insurance
// landing page's waitlist mode is deployed — POST /api/insurance/waitlist
// will 500 on every request until this table exists.
import { loadEnvLocal } from "./lib/ingest-shared";
loadEnvLocal();

import { sql } from "../src/lib/db";

async function main() {
  const db = sql();
  await db`
    CREATE TABLE IF NOT EXISTS insurance_waitlist (
      id            UUID PRIMARY KEY,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      email         TEXT NOT NULL,
      country       TEXT NOT NULL CHECK (country IN ('US', 'CA')),
      region        TEXT NOT NULL,
      line          TEXT CHECK (line IN ('homeowner', 'landlord', 'tenant', 'strata', 'commercial')),
      address       TEXT
    )
  `;
  await db`CREATE INDEX IF NOT EXISTS idx_insurance_waitlist_created ON insurance_waitlist (created_at)`;
  await db`CREATE INDEX IF NOT EXISTS idx_insurance_waitlist_region ON insurance_waitlist (region)`;
  await db`CREATE INDEX IF NOT EXISTS idx_insurance_waitlist_email ON insurance_waitlist (email)`;

  const rows = (await db`SELECT COUNT(*)::int AS count FROM insurance_waitlist`) as Array<{ count: number }>;
  console.log(`insurance_waitlist ready; existing rows=${rows[0]?.count ?? 0}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
