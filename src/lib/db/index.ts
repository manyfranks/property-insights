/**
 * db/index.ts
 *
 * Neon Postgres connection for user behavioral data.
 * Uses @neondatabase/serverless for edge-compatible, pooled connections.
 *
 * Separate from Upstash KV (which handles listings + rate limiting).
 */

import { neon } from "@neondatabase/serverless";

let _sql: ReturnType<typeof neon> | null = null;
let sqlOverrideForTest: ReturnType<typeof neon> | null = null;

/** Test-only seam for exercising application commands against scratch Postgres.
 * Production code never sets this; tests must clear it after each process. */
export function setSqlForTest(override: ReturnType<typeof neon> | null): void {
  if (process.env.NODE_ENV !== "test" && process.env.INSURANCE_SCRATCH_TEST !== "1") {
    throw new Error("setSqlForTest is restricted to test processes");
  }
  sqlOverrideForTest = override;
}

export function sql() {
  if (sqlOverrideForTest) return sqlOverrideForTest;
  if (_sql) return _sql;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  _sql = neon(url);
  return _sql;
}

export function dbAvailable(): boolean {
  return !!process.env.DATABASE_URL;
}
