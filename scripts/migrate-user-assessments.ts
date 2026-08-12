import { loadEnvLocal } from "./lib/ingest-shared";
loadEnvLocal();

import { sql } from "../src/lib/db";

async function main() {
  const db = sql();
  await db`
    CREATE TABLE IF NOT EXISTS user_assessments (
      id                    UUID PRIMARY KEY,
      user_id               TEXT NOT NULL,
      country               VARCHAR(2) NOT NULL CHECK (country IN ('US', 'CA')),
      result_variant        TEXT NOT NULL CHECK (result_variant IN ('listed', 'off_market', 'regional_fallback')),
      result_ref            VARCHAR(200),
      assessment_goal       TEXT CHECK (assessment_goal IN ('buy_home', 'rental_investment', 'own_manage', 'explore')),
      active_view           TEXT CHECK (active_view IN ('buy_home', 'rental_investment', 'own_manage', 'explore')),
      subject_scope         TEXT NOT NULL CHECK (subject_scope IN ('unit', 'building', 'parcel', 'listing', 'unknown')),
      subject_unit          VARCHAR(32),
      subject_selected_by   TEXT NOT NULL CHECK (subject_selected_by IN ('explicit_input', 'listing_match', 'provider_match', 'user_confirmation', 'unresolved')),
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await db`CREATE INDEX IF NOT EXISTS idx_user_assessments_owner_updated ON user_assessments (user_id, updated_at DESC)`;
  const rows = await db`SELECT COUNT(*)::int AS count FROM user_assessments` as Array<{ count: number }>;
  console.log(`user_assessments ready; existing rows=${rows[0]?.count ?? 0}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
