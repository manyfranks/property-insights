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

-- Private per-user assessment state. This is deliberately separate from the
-- shared listing corpus and from behavioral profiles/events. It stores no
-- raw address, place ID, classification, occupancy, owner, or provider
-- payload. CA result_ref may indirectly identify its shared listing.
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
);

CREATE INDEX IF NOT EXISTS idx_user_assessments_owner_updated
  ON user_assessments (user_id, updated_at DESC);

-- Insurance coverage profiles: Stage 2 of the insurance path (see
-- docs/proposals/insurance-distribution-proposal.html, "Stages" + "seam"
-- sections). Users confirm pre-filled property data, answer ~6 questions
-- only they can answer, consent, and are handed off to a licensed partner
-- with the profile. The partner is broker of record at this stage; the
-- profile row itself is the strategic asset (warm pipeline + conversion
-- proof for the eventual Stage 3 internal-brokerage submission), separate
-- from the affiliate click log in partner_clicks.
--
-- user_id is NULL when the visitor is opted out of sale/share (Sec-GPC /
-- pi_dns cookie — see src/lib/privacy.ts), mirroring partner_clicks: the
-- profile is still stored (it is user-initiated and separately consented
-- via `consent`/`consent_text`) but not tied to the account. vendor_id is
-- NULL until the handoff to a licensed partner actually happens.
--
-- consent is constrained to TRUE: the API layer (src/lib/db/coverage-profiles.ts,
-- src/app/api/coverage-profile/route.ts) rejects any submission without an
-- explicit affirmative consent before it reaches this insert, and the CHECK
-- makes that invariant hold at the data layer too, not just in application code.
CREATE TABLE IF NOT EXISTS coverage_profiles (
  id             UUID PRIMARY KEY,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_id        TEXT,
  country        TEXT NOT NULL CHECK (country IN ('US', 'CA')),
  region         TEXT NOT NULL,
  address        TEXT NOT NULL,
  line           TEXT NOT NULL CHECK (line IN ('homeowner', 'landlord', 'tenant', 'strata', 'commercial')),
  property       JSONB NOT NULL,  -- prefilled snapshot: identity/value/hazards groups, each tagged source: known | modeled
  answers        JSONB NOT NULL,  -- occupancy, unitCount, claims5yr, coverageExpiry, roofAge, contact
  vendor_id      TEXT,            -- registry id (src/config/affiliate-vendors.ts) of the handoff target; NULL until handoff
  consent        BOOLEAN NOT NULL CHECK (consent = TRUE),
  consent_text   TEXT NOT NULL,   -- exact consent copy shown to the user at submission time
  consented_at   TIMESTAMPTZ,
  source         TEXT             -- AffiliateSource value (src/config/affiliate-vendors.ts)
);

CREATE INDEX IF NOT EXISTS idx_coverage_profiles_created ON coverage_profiles (created_at);
CREATE INDEX IF NOT EXISTS idx_coverage_profiles_region ON coverage_profiles (region);
CREATE INDEX IF NOT EXISTS idx_coverage_profiles_line ON coverage_profiles (line);

-- Insurance waitlist: entered from the /insurance landing page whenever the
-- visitor's region isn't "live" yet (src/config/insurance-rollout.ts) or the
-- intake flag is off entirely. Deliberately thinner than coverage_profiles —
-- no property confirmation, no underwriting questions, no broker handoff —
-- just "notify me when this opens." Run via scripts/migrate-insurance-waitlist.ts
-- (one-time, delivered not executed) before the landing page's waitlist mode
-- is deployed.
CREATE TABLE IF NOT EXISTS insurance_waitlist (
  id            UUID PRIMARY KEY,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  email         TEXT NOT NULL,
  country       TEXT NOT NULL CHECK (country IN ('US', 'CA')),
  region        TEXT NOT NULL,
  line          TEXT CHECK (line IN ('homeowner', 'landlord', 'tenant', 'strata', 'commercial')),  -- nullable: visitor may join before picking a line
  address       TEXT  -- nullable: visitor may join before typing/selecting an address
);

CREATE INDEX IF NOT EXISTS idx_insurance_waitlist_created ON insurance_waitlist (created_at);
CREATE INDEX IF NOT EXISTS idx_insurance_waitlist_region ON insurance_waitlist (region);
CREATE INDEX IF NOT EXISTS idx_insurance_waitlist_email ON insurance_waitlist (email);
