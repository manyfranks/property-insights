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

-- Regional economic & housing indicators, US county-level.
-- Populated by scripts/ingest-us-*.ts (Census ACS, FHFA HPI, HUD FMR, FEMA NRI).
-- geo_fips uses "US-SSCCC" (state+county FIPS) for US counties, so it can
-- eventually sit alongside non-US geographies without a format collision.
CREATE TABLE IF NOT EXISTS regional_econ (
  id            BIGSERIAL PRIMARY KEY,
  geo_level     TEXT NOT NULL,             -- 'county' (only level ingested so far)
  geo_fips      VARCHAR(12) NOT NULL,      -- e.g. 'US-06075' (San Francisco County, CA)
  geo_name      TEXT,
  metric        TEXT NOT NULL,             -- median_home_value, fmr_2br, hpi, fema_risk_score, ...
  year          INTEGER NOT NULL,
  value         DOUBLE PRECISION,
  unit          TEXT,                      -- USD | ratio | index | years
  source        TEXT,                      -- census_acs | fhfa | hud | fema
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (geo_level, geo_fips, metric, year)
);

-- Primary lookup path: "give me metric X for county Y" (reader lib queries).
CREATE INDEX IF NOT EXISTS idx_regional_econ_fips_metric ON regional_econ (geo_fips, metric);

-- Partner clicks: append-only log of affiliate CTA click-throughs, including
-- anonymous (signed-out) clicks. Separate from user_events so top-of-funnel
-- EPC data isn't lost when there's no Clerk session. Deliberately no PI on
-- anonymous rows — no IP, no user agent.
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
);

CREATE INDEX IF NOT EXISTS idx_partner_clicks_vendor ON partner_clicks (vendor);
CREATE INDEX IF NOT EXISTS idx_partner_clicks_created ON partner_clicks (created_at);
