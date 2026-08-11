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
-- Populated by scripts/ingest-us-*.ts (Census ACS, FHFA HPI, HUD FMR, FEMA NRI,
-- realtor.com median-DOM via FRED — scripts/ingest-us-dom.ts).
-- geo_fips uses "US-SSCCC" (state+county FIPS) for US counties, so it can
-- eventually sit alongside non-US geographies without a format collision.
--
-- `month` is nullable: every metric before median_dom is annual-grain (one
-- row per geo_fips/metric/year) and leaves it NULL. median_dom is
-- monthly-grain (realtor.com/FRED publishes MEDDAYONMAR{fips} once a month),
-- so it needs a real month value to avoid one row per year clobbering the
-- other eleven. The natural-key uniqueness below is expressed with
-- COALESCE(month, 0) rather than a second UNIQUE(...,year) constraint so
-- existing annual rows (month IS NULL) keep exactly the same one-row-per-year
-- guarantee they always had (COALESCE(NULL,0) collapses to a constant, same
-- as before month existed), while monthly rows get a distinct key per month.
CREATE TABLE IF NOT EXISTS regional_econ (
  id            BIGSERIAL PRIMARY KEY,
  geo_level     TEXT NOT NULL,             -- 'county' (only level ingested so far)
  geo_fips      VARCHAR(12) NOT NULL,      -- e.g. 'US-06075' (San Francisco County, CA)
  geo_name      TEXT,
  metric        TEXT NOT NULL,             -- median_home_value, fmr_2br, hpi, fema_risk_score, median_dom, ...
  year          INTEGER NOT NULL,
  month         SMALLINT,                  -- 1-12, monthly-grain metrics only (median_dom); NULL for annual metrics
  value         DOUBLE PRECISION,
  unit          TEXT,                      -- USD | ratio | index | years | days
  source        TEXT,                      -- census_acs | fhfa | hud | fema | realtor_com_via_fred
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Natural-key uniqueness (superseded the old plain UNIQUE(geo_level,
-- geo_fips, metric, year) constraint — see migrate route for the idempotent
-- ALTER path on deployments created before `month` existed). Doubles as the
-- ON CONFLICT arbiter for scripts/lib/ingest-shared.ts's upsertRegionalEcon().
CREATE UNIQUE INDEX IF NOT EXISTS idx_regional_econ_natural_key
  ON regional_econ (geo_level, geo_fips, metric, year, COALESCE(month, 0));

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

-- Subscriptions: Pro tier entitlement state, sourced from Stripe webhooks.
-- Kept separate from user_profiles (behavioral/intent data) since this is
-- strictly billing state. One row per Clerk user; 'free' until a checkout
-- completes.
CREATE TABLE IF NOT EXISTS subscriptions (
  user_id                 TEXT PRIMARY KEY,
  plan                    TEXT NOT NULL DEFAULT 'free',   -- free | pro
  stripe_customer_id      TEXT,
  stripe_subscription_id  TEXT,
  status                  TEXT,                            -- Stripe subscription status (active, past_due, canceled, ...)
  current_period_end      TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_customer ON subscriptions (stripe_customer_id);

-- Anonymous P3 shadow-classification telemetry. Deliberately separate from
-- user_events/user_profiles and contains no user, address, unit, occupancy,
-- goal, journey, or evidence payload.
CREATE TABLE IF NOT EXISTS property_intelligence_events (
  id                       BIGSERIAL PRIMARY KEY,
  event_type               TEXT NOT NULL,
  country                  VARCHAR(2) NOT NULL,
  region                   VARCHAR(8) NOT NULL,
  surface                  TEXT NOT NULL,
  result_variant           TEXT NOT NULL,
  subject_scope            TEXT NOT NULL,
  subject_confidence       TEXT NOT NULL,
  requires_clarification   BOOLEAN NOT NULL,
  classification           JSONB NOT NULL DEFAULT '{}',
  capabilities             JSONB NOT NULL DEFAULT '{}',
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT property_intelligence_event_type_check
    CHECK (event_type IN ('classification_result', 'capability_missing'))
);

CREATE INDEX IF NOT EXISTS idx_property_intelligence_created
  ON property_intelligence_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_property_intelligence_surface
  ON property_intelligence_events (surface, result_variant, created_at DESC);
