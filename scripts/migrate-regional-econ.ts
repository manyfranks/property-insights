// One-time: create regional_econ in Neon (mirrors src/lib/db/schema.sql + migrate route)
import { loadEnvLocal } from "./lib/ingest-shared";
import { neon } from "@neondatabase/serverless";

loadEnvLocal();
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL not found in .env.local");
const sql = neon(url);

const main = async () => {
  await sql`
    CREATE TABLE IF NOT EXISTS regional_econ (
      id            BIGSERIAL PRIMARY KEY,
      geo_level     TEXT NOT NULL,
      geo_fips      VARCHAR(12) NOT NULL,
      geo_name      TEXT,
      metric        TEXT NOT NULL,
      year          INTEGER NOT NULL,
      value         DOUBLE PRECISION,
      unit          TEXT,
      source        TEXT,
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (geo_level, geo_fips, metric, year)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_regional_econ_fips_metric ON regional_econ (geo_fips, metric)`;
  const [{ count }] = await sql`SELECT count(*)::int AS count FROM regional_econ`;
  console.log(`regional_econ ready, current rows: ${count}`);
};
main();
