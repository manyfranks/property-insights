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

  return NextResponse.json({ ok: true, message: "Migration complete" });
}
