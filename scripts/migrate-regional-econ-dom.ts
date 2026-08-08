// One-time: evolve regional_econ for monthly-grain metrics (median_dom).
// Mirrors migrate-regional-econ.ts's pattern (direct Neon connection, no
// HTTP round-trip through /api/db/migrate) but ALTERs the existing table
// instead of creating it fresh. See src/lib/db/schema.sql's regional_econ
// doc comment and src/app/api/db/migrate/route.ts for the full rationale —
// this script runs the identical statements so the live DB doesn't have to
// wait for a deploy + CRON_SECRET-gated POST to pick up the schema change.
//
// Idempotent and purely additive:
//   - ADD COLUMN IF NOT EXISTS month SMALLINT — no-op if already present.
//   - DROP CONSTRAINT IF EXISTS <old UNIQUE> — no-op if already dropped.
//   - CREATE UNIQUE INDEX IF NOT EXISTS on (geo_level, geo_fips, metric,
//     year, COALESCE(month, 0)) — equivalent to the old constraint for
//     every existing row (month IS NULL everywhere pre-migration), so this
//     can't turn a previously-rejected duplicate into an accepted one or
//     vice versa for any row that exists today.
//
// Safety: prints row count before AND after (should be identical — this
// migration touches no data, only the schema).
import { loadEnvLocal } from "./lib/ingest-shared";
import { neon } from "@neondatabase/serverless";

loadEnvLocal();
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL not found in .env.local");
const sql = neon(url);

async function rowCount(): Promise<number> {
  const [{ count }] = await sql`SELECT count(*)::int AS count FROM regional_econ`;
  return count as number;
}

async function main() {
  const before = await rowCount();
  console.log(`regional_econ row count BEFORE: ${before.toLocaleString()}`);

  await sql`ALTER TABLE regional_econ ADD COLUMN IF NOT EXISTS month SMALLINT`;
  console.log("  ALTER TABLE ... ADD COLUMN IF NOT EXISTS month SMALLINT — done");

  await sql`ALTER TABLE regional_econ DROP CONSTRAINT IF EXISTS regional_econ_geo_level_geo_fips_metric_year_key`;
  console.log("  ALTER TABLE ... DROP CONSTRAINT IF EXISTS regional_econ_geo_level_geo_fips_metric_year_key — done");

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_regional_econ_natural_key
      ON regional_econ (geo_level, geo_fips, metric, year, COALESCE(month, 0))
  `;
  console.log("  CREATE UNIQUE INDEX IF NOT EXISTS idx_regional_econ_natural_key — done");

  const after = await rowCount();
  console.log(`regional_econ row count AFTER:  ${after.toLocaleString()}`);
  if (before !== after) {
    console.warn(`WARNING: row count changed (${before} -> ${after}) — this migration should be schema-only. Investigate before proceeding.`);
  } else {
    console.log("Row count unchanged — schema-only migration confirmed safe.");
  }

  const constraints = await sql`
    SELECT conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid = 'regional_econ'::regclass
  `;
  const indexes = await sql`SELECT indexname FROM pg_indexes WHERE tablename = 'regional_econ'`;
  console.log("constraints now:", constraints.map((c) => (c as { conname: string }).conname));
  console.log("indexes now:", indexes.map((i) => (i as { indexname: string }).indexname));
}

main().catch((e) => {
  console.error("migrate-regional-econ-dom failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
