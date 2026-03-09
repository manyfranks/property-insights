/**
 * db/user-events.ts
 *
 * User behavioral event tracking backed by Neon Postgres.
 * Replaces the old KV-based implementation for better queryability
 * and to separate user data from listing data.
 *
 * TABLE SCHEMA:
 *   user_events   — append-only event log (capped at 500 per user)
 *   user_profiles  — aggregated intent signals (upserted on each event)
 */

import { sql, dbAvailable } from "@/lib/db";
import { calculateIntentScore } from "@/lib/intent-score";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EventType =
  | "property_view"
  | "assessment_request"
  | "search"
  | "city_subscribe"
  | "partner_click";

export interface UserEvent {
  type: EventType;
  timestamp: string;
  data: Record<string, string | number | boolean>;
}

export interface UserProfile {
  userId: string;
  cities: string[];
  priceMin: number | null;
  priceMax: number | null;
  viewCount: number;
  assessmentCount: number;
  searchCount: number;
  partnerClicks: number;
  intentScore: number;
  partnerConsent: boolean;
  firstSeenAt: string;
  lastActiveAt: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_EVENTS_PER_USER = 500;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Record a user event. Inserts into Postgres and updates the profile.
 * Single INSERT — no read-modify-write race condition.
 */
export async function trackEvent(
  userId: string,
  type: EventType,
  data: Record<string, string | number | boolean>
): Promise<void> {
  if (!dbAvailable()) return;

  const db = sql();

  // Insert event
  await db`
    INSERT INTO user_events (user_id, event_type, data)
    VALUES (${userId}, ${type}, ${JSON.stringify(data)})
  `;

  // Trim old events (keep most recent MAX_EVENTS_PER_USER)
  await db`
    DELETE FROM user_events
    WHERE user_id = ${userId}
      AND id NOT IN (
        SELECT id FROM user_events
        WHERE user_id = ${userId}
        ORDER BY created_at DESC
        LIMIT ${MAX_EVENTS_PER_USER}
      )
  `;

  // Update aggregated profile
  await updateProfile(userId);
}

/**
 * Get a user's aggregated profile.
 */
export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  if (!dbAvailable()) return null;

  const db = sql();
  const rows = await db`
    SELECT * FROM user_profiles WHERE user_id = ${userId}
  ` as Row[];

  if (rows.length === 0) return null;

  const row = rows[0];
  return {
    userId: row.user_id,
    cities: row.cities || [],
    priceMin: row.price_min,
    priceMax: row.price_max,
    viewCount: row.view_count,
    assessmentCount: row.assessment_count,
    searchCount: row.search_count,
    partnerClicks: row.partner_clicks,
    intentScore: row.intent_score,
    partnerConsent: row.partner_consent,
    firstSeenAt: row.first_seen_at,
    lastActiveAt: row.last_active_at,
  };
}

/**
 * Get a user's raw event history.
 */
export async function getUserEvents(userId: string): Promise<UserEvent[]> {
  if (!dbAvailable()) return [];

  const db = sql();
  const rows = await db`
    SELECT event_type, data, created_at
    FROM user_events
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT ${MAX_EVENTS_PER_USER}
  ` as Row[];

  return rows.map((row) => ({
    type: row.event_type as EventType,
    timestamp: row.created_at,
    data: typeof row.data === "string" ? JSON.parse(row.data) : row.data,
  }));
}

/**
 * Update partner consent flag on the profile.
 * Called when user updates consent preferences.
 */
export async function setPartnerConsent(
  userId: string,
  consent: boolean
): Promise<void> {
  if (!dbAvailable()) return;

  const db = sql();
  await db`
    UPDATE user_profiles
    SET partner_consent = ${consent}, updated_at = NOW()
    WHERE user_id = ${userId}
  `;
}

/**
 * Query profiles for the pro dashboard.
 * Returns users with intent score above threshold in a given city.
 */
export async function getHighIntentProfiles(
  city: string,
  minScore: number = 50,
  limit: number = 50
): Promise<UserProfile[]> {
  if (!dbAvailable()) return [];

  const db = sql();
  const rows = await db`
    SELECT * FROM user_profiles
    WHERE ${city} = ANY(cities)
      AND intent_score >= ${minScore}
      AND partner_consent = TRUE
    ORDER BY intent_score DESC, last_active_at DESC
    LIMIT ${limit}
  ` as Row[];

  return rows.map((row) => ({
    userId: row.user_id,
    cities: row.cities || [],
    priceMin: row.price_min,
    priceMax: row.price_max,
    viewCount: row.view_count,
    assessmentCount: row.assessment_count,
    searchCount: row.search_count,
    partnerClicks: row.partner_clicks,
    intentScore: row.intent_score,
    partnerConsent: row.partner_consent,
    firstSeenAt: row.first_seen_at,
    lastActiveAt: row.last_active_at,
  }));
}

/**
 * Get anonymized market stats for a city (for pro dashboard).
 */
export async function getCityStats(city: string): Promise<{
  activeBuyers: number;
  avgIntentScore: number;
  priceRangeMin: number | null;
  priceRangeMax: number | null;
  assessmentRequests7d: number;
}> {
  if (!dbAvailable()) {
    return { activeBuyers: 0, avgIntentScore: 0, priceRangeMin: null, priceRangeMax: null, assessmentRequests7d: 0 };
  }

  const db = sql();

  const profileRows = await db`
    SELECT
      COUNT(*)::int AS active_buyers,
      COALESCE(AVG(intent_score), 0)::int AS avg_intent,
      MIN(price_min) AS price_min,
      MAX(price_max) AS price_max
    FROM user_profiles
    WHERE ${city} = ANY(cities)
      AND last_active_at > NOW() - INTERVAL '30 days'
  ` as Row[];
  const profileStats = profileRows[0];

  const eventRows = await db`
    SELECT COUNT(*)::int AS assessment_count
    FROM user_events
    WHERE event_type = 'assessment_request'
      AND data->>'city' = ${city}
      AND created_at > NOW() - INTERVAL '7 days'
  ` as Row[];
  const eventStats = eventRows[0];

  return {
    activeBuyers: profileStats.active_buyers,
    avgIntentScore: profileStats.avg_intent,
    priceRangeMin: profileStats.price_min,
    priceRangeMax: profileStats.price_max,
    assessmentRequests7d: eventStats.assessment_count,
  };
}

// ---------------------------------------------------------------------------
// Internal: profile aggregation via SQL
// ---------------------------------------------------------------------------

async function updateProfile(userId: string): Promise<void> {
  const db = sql();

  // Aggregate all signals from events in a single query
  const statsRows = await db`
    SELECT
      ARRAY_AGG(DISTINCT data->>'city') FILTER (WHERE data->>'city' IS NOT NULL) AS cities,
      MIN((data->>'price')::int) FILTER (WHERE data->>'price' IS NOT NULL) AS price_min,
      MAX((data->>'price')::int) FILTER (WHERE data->>'price' IS NOT NULL) AS price_max,
      COUNT(*) FILTER (WHERE event_type = 'property_view')::int AS view_count,
      COUNT(*) FILTER (WHERE event_type = 'assessment_request')::int AS assessment_count,
      COUNT(*) FILTER (WHERE event_type = 'search')::int AS search_count,
      COUNT(*) FILTER (WHERE event_type = 'partner_click')::int AS partner_clicks,
      COUNT(*) FILTER (WHERE event_type = 'property_view' AND (data->>'returnVisit')::boolean = true)::int AS return_visits,
      COUNT(*) FILTER (WHERE event_type = 'partner_click' AND data->>'partnerType' IN ('compare-rates', 'pre-approval'))::int AS mortgage_clicks,
      COUNT(*) FILTER (WHERE event_type = 'partner_click' AND data->>'partnerType' = 'insurance')::int AS insurance_clicks,
      (SELECT COUNT(*)::int > 0 FROM user_events WHERE user_id = ${userId} AND event_type = 'city_subscribe') AS has_city_sub,
      MIN(created_at) AS first_seen_at,
      MAX(created_at) AS last_active_at
    FROM user_events
    WHERE user_id = ${userId}
  ` as Row[];
  const stats = statsRows[0];

  // Find max views in any single city (for "focused search" signal)
  const cityViewRows = await db`
    SELECT data->>'city' AS city, COUNT(*)::int AS cnt
    FROM user_events
    WHERE user_id = ${userId}
      AND event_type = 'property_view'
      AND data->>'city' IS NOT NULL
    GROUP BY data->>'city'
    ORDER BY cnt DESC
    LIMIT 1
  ` as Row[];
  const maxViewsInOneCity = cityViewRows.length > 0 ? cityViewRows[0].cnt : 0;

  const cities = (stats.cities || []).filter(Boolean);

  // Calculate intent score
  const intentScore = calculateIntentScore({
    assessmentCount: stats.assessment_count,
    returnVisitCount: stats.return_visits,
    mortgageClicks: stats.mortgage_clicks,
    insuranceClicks: stats.insurance_clicks,
    maxViewsInOneCity,
    hasCitySubscription: stats.has_city_sub,
    lastActiveAt: stats.last_active_at ? new Date(stats.last_active_at) : null,
    priceMin: stats.price_min,
    priceMax: stats.price_max,
  });

  // Upsert profile with intent score
  await db`
    INSERT INTO user_profiles (
      user_id, cities, price_min, price_max,
      view_count, assessment_count, search_count, partner_clicks,
      intent_score, first_seen_at, last_active_at, updated_at
    ) VALUES (
      ${userId}, ${cities}, ${stats.price_min}, ${stats.price_max},
      ${stats.view_count}, ${stats.assessment_count}, ${stats.search_count}, ${stats.partner_clicks},
      ${intentScore}, ${stats.first_seen_at}, ${stats.last_active_at}, NOW()
    )
    ON CONFLICT (user_id) DO UPDATE SET
      cities = EXCLUDED.cities,
      price_min = EXCLUDED.price_min,
      price_max = EXCLUDED.price_max,
      view_count = EXCLUDED.view_count,
      assessment_count = EXCLUDED.assessment_count,
      search_count = EXCLUDED.search_count,
      partner_clicks = EXCLUDED.partner_clicks,
      intent_score = EXCLUDED.intent_score,
      last_active_at = EXCLUDED.last_active_at,
      updated_at = NOW()
  `;
}
