/**
 * Read-only aggregate report for anonymous P3/P3.5 shadow telemetry.
 * No user, address, unit, occupancy, goal, or raw evidence is selected.
 *
 * Run: npx tsx scripts/report-property-intelligence-events.ts [days=30]
 */

import { loadEnvLocal } from "./lib/ingest-shared";
loadEnvLocal();

import { sql } from "../src/lib/db";

interface CountRow {
  country: string;
  region: string;
  surface: string;
  result_variant: string;
  value: string;
  count: number;
}

interface CapabilityRow {
  country: string;
  surface: string;
  result_variant: string;
  capability: string;
  reason: string;
  count: number;
}

async function main() {
  const days = Math.min(90, Math.max(1, Number(process.argv[2]) || 30));
  const db = sql();
  const totals = await db`
    SELECT
      country,
      region,
      surface,
      result_variant,
      event_type AS value,
      COUNT(*)::int AS count
    FROM property_intelligence_events
    WHERE created_at >= NOW() - (${days} * INTERVAL '1 day')
    GROUP BY country, region, surface, result_variant, event_type
    ORDER BY country, region, surface, result_variant, event_type
  ` as CountRow[];
  const parcelUse = await db`
    SELECT
      country,
      region,
      surface,
      result_variant,
      classification->>'parcelUse' AS value,
      COUNT(*)::int AS count
    FROM property_intelligence_events
    WHERE event_type = 'classification_result'
      AND created_at >= NOW() - (${days} * INTERVAL '1 day')
    GROUP BY country, region, surface, result_variant, classification->>'parcelUse'
    ORDER BY country, region, surface, result_variant, classification->>'parcelUse'
  ` as CountRow[];
  const confidence = await db`
    SELECT
      country,
      region,
      surface,
      result_variant,
      classification->>'overallConfidence' AS value,
      COUNT(*)::int AS count
    FROM property_intelligence_events
    WHERE event_type = 'classification_result'
      AND created_at >= NOW() - (${days} * INTERVAL '1 day')
    GROUP BY country, region, surface, result_variant, classification->>'overallConfidence'
    ORDER BY country, region, surface, result_variant, classification->>'overallConfidence'
  ` as CountRow[];
  const missingCapabilities = await db`
    SELECT
      event.country,
      event.surface,
      event.result_variant,
      capability.key AS capability,
      capability.value AS reason,
      COUNT(*)::int AS count
    FROM property_intelligence_events event,
      LATERAL jsonb_each_text(event.capabilities) capability
    WHERE event.event_type = 'capability_missing'
      AND event.created_at >= NOW() - (${days} * INTERVAL '1 day')
    GROUP BY event.country, event.surface, event.result_variant, capability.key, capability.value
    ORDER BY event.country, event.surface, event.result_variant, capability.key, capability.value
  ` as CapabilityRow[];

  const printRows = (title: string, rows: CountRow[]) => {
    console.log(`\n${title}`);
    if (rows.length === 0) console.log("no rows");
    for (const row of rows) {
      console.log(`${row.country}\t${row.region}\t${row.surface}\t${row.result_variant}\t${row.value}\t${row.count}`);
    }
  };

  console.log(`P3 shadow telemetry — last ${days} days`);
  printRows("EVENTS", totals);
  printRows("PARCEL_USE", parcelUse);
  printRows("CONFIDENCE", confidence);
  console.log("\nMISSING_CAPABILITIES");
  if (missingCapabilities.length === 0) console.log("no rows");
  for (const row of missingCapabilities) {
    console.log(`${row.country}\t${row.surface}\t${row.result_variant}\t${row.capability}\t${row.reason}\t${row.count}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
