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

export function sql() {
  if (_sql) return _sql;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  _sql = neon(url);
  return _sql;
}

export function dbAvailable(): boolean {
  return !!process.env.DATABASE_URL;
}
