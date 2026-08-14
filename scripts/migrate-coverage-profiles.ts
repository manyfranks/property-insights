// One-time: create coverage_profiles in Neon (mirrors src/lib/db/schema.sql).
// Delivered, not executed — do not run this against a real database as part
// of this change; see src/lib/db/coverage-profiles.ts for the write path.
import { loadEnvLocal } from "./lib/ingest-shared";
loadEnvLocal();

import { sql } from "../src/lib/db";

async function main() {
  const db = sql();
  await db`
    CREATE TABLE IF NOT EXISTS coverage_profiles (
      id             UUID PRIMARY KEY,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      user_id        TEXT,
      country        TEXT NOT NULL CHECK (country IN ('US', 'CA')),
      region         TEXT NOT NULL,
      address        TEXT NOT NULL,
      line           TEXT NOT NULL CHECK (line IN ('homeowner', 'landlord', 'tenant', 'strata', 'commercial')),
      property       JSONB NOT NULL,
      answers        JSONB NOT NULL,
      vendor_id      TEXT,
      consent        BOOLEAN NOT NULL CHECK (consent = TRUE),
      consent_text   TEXT NOT NULL,
      consented_at   TIMESTAMPTZ,
      source         TEXT
    )
  `;
  await db`CREATE INDEX IF NOT EXISTS idx_coverage_profiles_created ON coverage_profiles (created_at)`;
  await db`CREATE INDEX IF NOT EXISTS idx_coverage_profiles_region ON coverage_profiles (region)`;
  await db`CREATE INDEX IF NOT EXISTS idx_coverage_profiles_line ON coverage_profiles (line)`;

  const rows = await db`SELECT COUNT(*)::int AS count FROM coverage_profiles` as Array<{ count: number }>;
  console.log(`coverage_profiles ready; existing rows=${rows[0]?.count ?? 0}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
