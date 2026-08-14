/**
 * db/analytics-events.ts
 *
 * Append-only log for the anonymous-capable analytics event spine
 * (analytics_events table — schema + full rationale in
 * src/app/api/db/migrate/route.ts). Modeled directly on
 * src/lib/db/partner-clicks.ts: anonymous, unauthenticated writes must
 * never break the caller, so every DB operation here is fail-soft-but-
 * logged (console.error), never a thrown exception that would turn a
 * dropped analytics row into a failed page/API request. This is the
 * "disclosed fallback" the house error philosophy calls for — degraded
 * silently to the caller, but never silently to the logs.
 *
 * Distinct from src/lib/db/user-events.ts (trackEvent/user_events), which
 * requires a Clerk user_id and is untouched by this module.
 */

import { sql, dbAvailable } from "@/lib/db";

/** One row to insert into analytics_events. Mirrors the table's columns
 *  1:1 (see src/app/api/db/migrate/route.ts) other than `id`/`created_at`,
 *  which the DB assigns. */
export interface AnalyticsEventInput {
  anonId: string;
  sessionId: string;
  userId?: string | null;
  eventType: string;
  data: Record<string, string | number | boolean>;
  path?: string | null;
  referrerHost?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  country?: string | null;
}

/**
 * Batch-insert 1-N validated event rows. Callers (src/app/api/signal/route.ts)
 * are expected to have already validated/sanitized each row's `data` and
 * `eventType` — this function does no allowlisting of its own, it just
 * persists what it's given.
 *
 * Inserted as one INSERT per row, run concurrently via Promise.all — same
 * approach as src/lib/db/property-intelligence-events.ts's batch writer.
 * The whole batch is wrapped in a single try/catch: a partial-batch DB
 * failure (e.g. a transient Neon connection blip) is logged once with the
 * row count rather than per-row, since by the time any row insert queries
 * are in flight the caller's own per-event validation has already
 * succeeded — a failure here is infrastructure, not bad input.
 */
export async function insertAnalyticsEvents(rows: AnalyticsEventInput[]): Promise<void> {
  if (!dbAvailable() || rows.length === 0) return;

  try {
    const db = sql();
    await Promise.all(
      rows.map(
        (row) => db`
          INSERT INTO analytics_events (
            anon_id, session_id, user_id, event_type, data, path,
            referrer_host, utm_source, utm_medium, utm_campaign, country
          ) VALUES (
            ${row.anonId}, ${row.sessionId}, ${row.userId ?? null}, ${row.eventType},
            ${JSON.stringify(row.data)}, ${row.path ?? null}, ${row.referrerHost ?? null},
            ${row.utmSource ?? null}, ${row.utmMedium ?? null}, ${row.utmCampaign ?? null},
            ${row.country ?? null}
          )
        `
      )
    );
  } catch (err) {
    console.error(`analytics_events: batch insert of ${rows.length} row(s) failed:`, err);
  }
}

/**
 * Backfills user_id onto a visitor's own recent anonymous rows once they
 * sign in, so pre-signup activity under their anon_id isn't permanently cut
 * off from the account. Deliberately narrow:
 *   - 30-day lookback only — old anonymous rows stay anonymous rather than
 *     being retroactively attributed indefinitely.
 *   - `user_id IS NULL` guard — first attribution wins. A row already
 *     stitched (to this account or, in a shared-device edge case, a
 *     different one) is never overwritten by a later stitch call.
 *
 * Fail-soft-but-logged, same reasoning as insertAnalyticsEvents: a failed
 * stitch must never fail the sign-in flow that triggers it
 * (src/app/api/signal/stitch/route.ts).
 */
export async function stitchUserId(anonId: string, userId: string): Promise<void> {
  if (!dbAvailable()) return;

  try {
    const db = sql();
    await db`
      UPDATE analytics_events
      SET user_id = ${userId}
      WHERE anon_id = ${anonId}
        AND user_id IS NULL
        AND created_at > NOW() - INTERVAL '30 days'
    `;
  } catch (err) {
    console.error(`analytics_events: stitchUserId failed for anon_id=${anonId}:`, err);
  }
}
