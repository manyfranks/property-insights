// One-time: create partner_clicks + subscriptions in Neon (mirrors src/lib/db/schema.sql + migrate route)
import { loadEnvLocal } from "./lib/ingest-shared";
import { neon } from "@neondatabase/serverless";

loadEnvLocal();
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL not found in .env.local");
const sql = neon(url);

const main = async () => {
  await sql`
    CREATE TABLE IF NOT EXISTS partner_clicks (
      id            BIGSERIAL PRIMARY KEY,
      vendor        TEXT NOT NULL,
      vertical      TEXT,
      state         TEXT,
      source        TEXT,
      affiliate     BOOLEAN,
      property_slug TEXT,
      city          TEXT,
      user_id       TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_partner_clicks_vendor ON partner_clicks (vendor)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_partner_clicks_created ON partner_clicks (created_at)`;

  await sql`
    CREATE TABLE IF NOT EXISTS subscriptions (
      user_id                 TEXT PRIMARY KEY,
      plan                    TEXT NOT NULL DEFAULT 'free',
      stripe_customer_id      TEXT,
      stripe_subscription_id  TEXT,
      status                  TEXT,
      current_period_end      TIMESTAMPTZ,
      created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_subscriptions_customer ON subscriptions (stripe_customer_id)`;

  const [{ count: clicks }] = await sql`SELECT count(*)::int AS count FROM partner_clicks`;
  const [{ count: subs }] = await sql`SELECT count(*)::int AS count FROM subscriptions`;
  console.log(`partner_clicks ready, rows: ${clicks}; subscriptions ready, rows: ${subs}`);
};
main();
