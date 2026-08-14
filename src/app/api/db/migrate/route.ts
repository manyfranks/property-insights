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

  await db`
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
    )
  `;
  await db`CREATE INDEX IF NOT EXISTS idx_property_intelligence_created ON property_intelligence_events (created_at DESC)`;
  await db`CREATE INDEX IF NOT EXISTS idx_property_intelligence_surface ON property_intelligence_events (surface, result_variant, created_at DESC)`;

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

  // --- Insurance path, Stage 2 (coverage_profiles + insurance_waitlist) ---
  // DDL copied verbatim from src/lib/db/schema.sql (see that file for the
  // full rationale comments on each table). This is now the canonical
  // provisioning path for both tables — scripts/migrate-coverage-profiles.ts
  // and scripts/migrate-insurance-waitlist.ts are kept only as redundant
  // manual fallbacks.
  await db`
    CREATE TABLE IF NOT EXISTS coverage_profiles (
      id             UUID PRIMARY KEY,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      user_id        TEXT,
      country        TEXT NOT NULL CHECK (country IN ('US', 'CA')),
      region         TEXT NOT NULL,
      address        TEXT NOT NULL,
      line           TEXT NOT NULL CHECK (line IN ('homeowner', 'landlord', 'tenant', 'strata', 'commercial')),
      property       JSONB NOT NULL,
      answers        JSONB NOT NULL,
      vendor_id      TEXT,
      consent        BOOLEAN NOT NULL CHECK (consent = TRUE),
      consent_text   TEXT NOT NULL,
      consented_at   TIMESTAMPTZ,
      source         TEXT
    )
  `;

  await db`CREATE INDEX IF NOT EXISTS idx_coverage_profiles_created ON coverage_profiles (created_at)`;
  await db`CREATE INDEX IF NOT EXISTS idx_coverage_profiles_region ON coverage_profiles (region)`;
  await db`CREATE INDEX IF NOT EXISTS idx_coverage_profiles_line ON coverage_profiles (line)`;

  await db`
    CREATE TABLE IF NOT EXISTS insurance_waitlist (
      id            UUID PRIMARY KEY,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      email         TEXT NOT NULL,
      country       TEXT NOT NULL CHECK (country IN ('US', 'CA')),
      region        TEXT NOT NULL,
      line          TEXT CHECK (line IN ('homeowner', 'landlord', 'tenant', 'strata', 'commercial')),
      address       TEXT
    )
  `;

  await db`CREATE INDEX IF NOT EXISTS idx_insurance_waitlist_created ON insurance_waitlist (created_at)`;
  await db`CREATE INDEX IF NOT EXISTS idx_insurance_waitlist_region ON insurance_waitlist (region)`;
  await db`CREATE INDEX IF NOT EXISTS idx_insurance_waitlist_email ON insurance_waitlist (email)`;

  // --- Anonymous analytics event spine (W1-SPINE) ---
  // Additive and standalone — deliberately NOT a replacement for
  // user_events/user_profiles above, and neither of those tables nor
  // /api/track is touched by this change. This table exists because
  // /api/track requires a Clerk session and therefore can never see
  // signed-out traffic; analytics_events captures anonymous behavioral
  // events keyed by anon_id/session_id (two httpOnly cookies minted by
  // src/proxy.ts, only for visitors who have not opted out).
  //
  // user_id is nullable and populated only when the visitor is signed in
  // at event time; earlier anonymous rows for the same anon_id can be
  // backfilled with a user_id after the fact via stitchUserId() (see
  // src/lib/db/analytics-events.ts) once they sign in, so pre-signup
  // activity isn't permanently orphaned from the account.
  //
  // Privacy: no IP address or user agent column exists here by design (see
  // the house pattern in src/lib/privacy.ts). referrer_host stores only the
  // hostname of the referring page (e.g. "www.google.com"), never the full
  // referrer URL, since a full URL can carry query strings that leak
  // search terms or other PII from the referring site.
  await db`
    CREATE TABLE IF NOT EXISTS analytics_events (
      id            BIGSERIAL PRIMARY KEY,
      anon_id       UUID        NOT NULL,
      session_id    UUID        NOT NULL,
      user_id       TEXT,
      event_type    TEXT        NOT NULL,
      data          JSONB       NOT NULL DEFAULT '{}',
      path          TEXT,
      referrer_host TEXT,
      utm_source    TEXT,
      utm_medium    TEXT,
      utm_campaign  TEXT,
      country       TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await db`CREATE INDEX IF NOT EXISTS idx_analytics_events_type_created ON analytics_events (event_type, created_at DESC)`;
  await db`CREATE INDEX IF NOT EXISTS idx_analytics_events_session ON analytics_events (session_id, created_at)`;
  await db`CREATE INDEX IF NOT EXISTS idx_analytics_events_anon ON analytics_events (anon_id, created_at)`;
  await db`CREATE INDEX IF NOT EXISTS idx_analytics_events_user ON analytics_events (user_id, created_at) WHERE user_id IS NOT NULL`;

  return NextResponse.json({ ok: true, message: "Migration complete" });
}
