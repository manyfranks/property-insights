/**
 * Idempotent P3.5 operational-telemetry migration.
 *
 * Run: npx tsx scripts/migrate-property-intelligence-events.ts
 */

import { loadEnvLocal } from "./lib/ingest-shared";
loadEnvLocal();

import { sql } from "../src/lib/db";

async function main() {
const db = sql();

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

const rows = await db`
  SELECT COUNT(*)::int AS count
  FROM property_intelligence_events
` as Array<{ count: number }>;

console.log(`property_intelligence_events ready; existing rows=${rows[0]?.count ?? 0}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
