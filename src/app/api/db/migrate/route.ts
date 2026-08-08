/**
 * POST /api/db/migrate
 *
 * One-time schema migration for Neon Postgres.
 * Protected by CRON_SECRET.
 */

import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = sql();

  await db`
    CREATE TABLE IF NOT EXISTS user_events (
      id            BIGSERIAL PRIMARY KEY,
      user_id       TEXT NOT NULL,
      event_type    TEXT NOT NULL,
      data          JSONB NOT NULL DEFAULT '{}',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await db`CREATE INDEX IF NOT EXISTS idx_events_user_id ON user_events (user_id)`;
  await db`CREATE INDEX IF NOT EXISTS idx_events_user_type ON user_events (user_id, event_type)`;
  await db`CREATE INDEX IF NOT EXISTS idx_events_created ON user_events (created_at)`;

  await db`
    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id           TEXT PRIMARY KEY,
      cities            TEXT[] NOT NULL DEFAULT '{}',
      price_min         INTEGER,
      price_max         INTEGER,
      view_count        INTEGER NOT NULL DEFAULT 0,
      assessment_count  INTEGER NOT NULL DEFAULT 0,
      search_count      INTEGER NOT NULL DEFAULT 0,
      partner_clicks    INTEGER NOT NULL DEFAULT 0,
      intent_score      INTEGER NOT NULL DEFAULT 0,
      partner_consent   BOOLEAN NOT NULL DEFAULT FALSE,
      first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_active_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await db`CREATE INDEX IF NOT EXISTS idx_profiles_intent ON user_profiles (intent_score DESC)`;
  await db`CREATE INDEX IF NOT EXISTS idx_profiles_city ON user_profiles USING GIN (cities)`;
  await db`CREATE INDEX IF NOT EXISTS idx_profiles_active ON user_profiles (last_active_at DESC)`;
  await db`CREATE INDEX IF NOT EXISTS idx_profiles_consent ON user_profiles (partner_consent) WHERE partner_consent = TRUE`;

  await db`
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
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // --- Relative-DOM (median_dom, monthly-grain) migration ---
  // Deployments created before this pass have a table with no `month`
  // column and a plain UNIQUE(geo_level, geo_fips, metric, year) constraint
  // that would reject a second row for the same year (e.g. two different
  // months of median_dom). This block is idempotent and purely additive:
  // - ADD COLUMN IF NOT EXISTS is a no-op on a table that already has it.
  // - DROP CONSTRAINT IF EXISTS is a no-op on a table that never had it
  //   (fresh installs) or already had it dropped by a prior run.
  // - The new expression index is equivalent to the old constraint for
  //   every pre-existing row (month IS NULL everywhere until this ingest),
  //   so nothing that used to be rejected as a duplicate becomes
  //   accepted, and nothing that used to be accepted becomes rejected —
  //   it only WIDENS the key for rows that now carry a real month.
  await db`ALTER TABLE regional_econ ADD COLUMN IF NOT EXISTS month SMALLINT`;
  await db`ALTER TABLE regional_econ DROP CONSTRAINT IF EXISTS regional_econ_geo_level_geo_fips_metric_year_key`;
  await db`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_regional_econ_natural_key
      ON regional_econ (geo_level, geo_fips, metric, year, COALESCE(month, 0))
  `;

  await db`CREATE INDEX IF NOT EXISTS idx_regional_econ_fips_metric ON regional_econ (geo_fips, metric)`;

  await db`
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

  await db`CREATE INDEX IF NOT EXISTS idx_partner_clicks_vendor ON partner_clicks (vendor)`;
  await db`CREATE INDEX IF NOT EXISTS idx_partner_clicks_created ON partner_clicks (created_at)`;

  await db`
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

  await db`CREATE INDEX IF NOT EXISTS idx_subscriptions_customer ON subscriptions (stripe_customer_id)`;

  return NextResponse.json({ ok: true, message: "Migration complete" });
}
