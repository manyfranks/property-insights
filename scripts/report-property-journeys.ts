/**
 * Read-only aggregate report for consented P4 journey funnel events.
 * It deliberately selects no user ID, address, unit, slug, or raw payload.
 *
 * Run: npx tsx scripts/report-property-journeys.ts [days=30]
 */

import { loadEnvLocal } from "./lib/ingest-shared";
loadEnvLocal();

import { sql } from "../src/lib/db";
import { JOURNEY_EVENT_TYPES } from "../src/lib/property-intelligence/journey";

interface JourneyCountRow {
  event_type: string;
  surface: string;
  goal: string;
  subject_scope: string;
  capability_status: string;
  count: number;
}

async function main() {
  const days = Math.min(90, Math.max(1, Number(process.argv[2]) || 30));
  const db = sql();
  const rows = await db`
    SELECT
      event_type,
      COALESCE(data->>'surface', 'none') AS surface,
      COALESCE(data->>'goal', 'none') AS goal,
      COALESCE(data->>'subjectScope', 'none') AS subject_scope,
      COALESCE(data->>'capabilityStatus', 'none') AS capability_status,
      COUNT(*)::int AS count
    FROM user_events
    WHERE event_type = ANY(${JOURNEY_EVENT_TYPES as unknown as string[]})
      AND created_at >= NOW() - (${days} * INTERVAL '1 day')
    GROUP BY event_type, surface, goal, subject_scope, capability_status
    ORDER BY event_type, surface, goal, subject_scope, capability_status
  ` as JourneyCountRow[];

  console.log(`P4 consented journey funnel — last ${days} days`);
  console.log("event\tsurface\tgoal\tsubject_scope\tcapability_status\tcount");
  if (rows.length === 0) console.log("no rows");
  for (const row of rows) {
    console.log(
      `${row.event_type}\t${row.surface}\t${row.goal}\t${row.subject_scope}\t${row.capability_status}\t${row.count}`
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
