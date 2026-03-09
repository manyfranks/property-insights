-- User behavioral data schema for Property Insights
-- Run via: src/app/api/db/migrate/route.ts (one-time, cron-secret protected)

-- User events: append-only log of behavioral signals
CREATE TABLE IF NOT EXISTS user_events (
  id            BIGSERIAL PRIMARY KEY,
  user_id       TEXT NOT NULL,
  event_type    TEXT NOT NULL,  -- property_view, assessment_request, search, city_subscribe, partner_click
  data          JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for event queries
CREATE INDEX IF NOT EXISTS idx_events_user_id ON user_events (user_id);
CREATE INDEX IF NOT EXISTS idx_events_user_type ON user_events (user_id, event_type);
CREATE INDEX IF NOT EXISTS idx_events_created ON user_events (created_at);

-- User profiles: aggregated intent signals, updated on each event
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
);

-- Indexes for pro dashboard queries
CREATE INDEX IF NOT EXISTS idx_profiles_intent ON user_profiles (intent_score DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_city ON user_profiles USING GIN (cities);
CREATE INDEX IF NOT EXISTS idx_profiles_active ON user_profiles (last_active_at DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_consent ON user_profiles (partner_consent) WHERE partner_consent = TRUE;

-- Trim old events: keep last 200 per user (run periodically)
-- This is handled in application code, not a DB trigger.
