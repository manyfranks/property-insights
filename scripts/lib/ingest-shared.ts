/**
 * Shared helpers for scripts/ingest-us-*.ts (US county regional_econ ingest).
 *
 * Ported from Economic-Atlas's ingest/census.js + the per-source ingest
 * scripts' common conventions: fail-loud on unexpected response shape,
 * dry-run by default, --commit to write, throttled fetch with a
 * descriptive User-Agent, batched UNNEST upsert.
 *
 * NOTE: DATABASE_URL is not available in this environment. Every ingest
 * script defaults to DRY RUN (fetch + parse + print counts, no DB
 * connection at all). The --commit path below is written correctly and
 * defensively but is NOT exercised here — see each script's header for the
 * exact command to run once DATABASE_URL exists.
 */

import { readFileSync, existsSync } from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Env loading — same convention as scripts/seed-kv.ts, scripts/enrich-listings.ts
// (manual .env.local parse; the repo has no `dotenv` package installed and
// doesn't need one for this one job).
// ---------------------------------------------------------------------------

export function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) {
    console.warn(`[ingest] .env.local not found at ${envPath} — relying on process env only.`);
    return;
  }
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    if (process.env[key] === undefined) {
      process.env[key] = match[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

// ---------------------------------------------------------------------------
// Constants shared across all four sources
// ---------------------------------------------------------------------------

export const INGEST_USER_AGENT =
  process.env.INGEST_USER_AGENT || "Property Insights ingest mfrancis45@gmail.com";

export const COMMIT = process.argv.includes("--commit");

export const GEO_LEVEL = "county" as const;

// County FIPS format used throughout regional_econ: "US-SSCCC".
export function toGeoFips(stateFips: string, countyFips: string): string {
  return `US-${stateFips}${countyFips}`;
}

// ---------------------------------------------------------------------------
// Throttling — ported from Economic-Atlas's ingest/census.js throttle().
// Sliding 1s window, N requests/sec max.
// ---------------------------------------------------------------------------

export function makeThrottle(maxPerSecond: number): () => Promise<void> {
  let times: number[] = [];
  async function throttle(): Promise<void> {
    const now = Date.now();
    times = times.filter((t) => now - t < 1000);
    if (times.length >= maxPerSecond) {
      await new Promise((r) => setTimeout(r, 1000 - (now - times[0]) + 5));
      return throttle();
    }
    times.push(Date.now());
  }
  return throttle;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// regional_econ row shape + batched upsert (--commit path only)
// ---------------------------------------------------------------------------

export interface RegionalEconRow {
  geo_fips: string; // "US-SSCCC"
  geo_name: string;
  metric: string;
  year: number;
  /** 1-12 for monthly-grain metrics (median_dom); omitted/null for the
   * pre-existing annual-grain metrics (ACS, FHFA, HUD, FEMA). See
   * src/lib/db/schema.sql's regional_econ doc comment — the natural-key
   * unique index treats a missing month as COALESCE(month,0), so leaving
   * this unset reproduces the exact one-row-per-year behavior every other
   * ingest script already relies on. */
  month?: number | null;
  value: number;
  unit: string;
  source: string;
}

/**
 * Batched UNNEST upsert into regional_econ, mirroring Economic-Atlas's
 * upsertBatch() (pg Pool + UNNEST arrays) but built on
 * @neondatabase/serverless, matching src/lib/db/index.ts's connection
 * pattern (neon(DATABASE_URL) tagged-template client, no separate Pool).
 *
 * Conflict target is the expression index idx_regional_econ_natural_key
 * (geo_level, geo_fips, metric, year, COALESCE(month, 0)) rather than the
 * table's old plain UNIQUE(geo_level, geo_fips, metric, year) — the
 * relative-DOM migration (src/app/api/db/migrate/route.ts) drops that old
 * constraint and replaces it with this index specifically so a single
 * metric/year can hold up to 12 monthly rows. For every caller that never
 * sets `month` (ACS/FHFA/HUD/FEMA), this is a no-op behavior change: NULL
 * month always collapses to the same COALESCE(...,0) bucket, so the
 * one-row-per-year guarantee those scripts depend on is unchanged.
 *
 * `updated_at` is stamped conditionally: DO UPDATE always fires on a
 * conflict (there is no "only if different" clause), so an unconditional
 * `NOW()` would restamp every re-ingested row even when nothing changed —
 * collapsing the per-record sitemap <lastmod> signal (see
 * scripts/generate-sitemap.ts) back into a single build-time value. The
 * CASE compares every payload column DO UPDATE actually sets (value,
 * geo_name, month, unit, source) with IS DISTINCT FROM (NULL-safe) and only
 * advances `updated_at` when at least one changed; unchanged rows keep
 * their existing `regional_econ.updated_at`. Inside ON CONFLICT DO UPDATE,
 * a bare `regional_econ.col` reference reads the pre-update row regardless
 * of SET-list order, so this sees the old value even though `updated_at`
 * is set last.
 */
/** Structural shape of a Neon tagged-template SQL client — just enough to
 * type-check the injected test client below without importing Neon's
 * (complex, version-coupled) query-function type. */
type SqlTag = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;

/**
 * Test-only seam: lets scripts/test-regional-econ-stamping.ts exercise this
 * exact upsert against a throwaway local Postgres. @neondatabase/serverless's
 * neon() speaks Neon's HTTP proxy protocol, not raw Postgres wire protocol —
 * it cannot target a local `postgresql://` instance (same reason
 * src/lib/db/index.ts exposes setSqlForTest instead of letting tests call
 * neon() directly; see scripts/test-insurance-case-commands.ts for the
 * precedent of shelling out to psql for scratch-DB tests instead).
 * Production call sites never pass this — restricted like setSqlForTest.
 */
export async function upsertRegionalEcon(rows: RegionalEconRow[], sqlClientForTest?: SqlTag): Promise<number> {
  let sql: SqlTag;
  if (sqlClientForTest) {
    if (process.env.NODE_ENV !== "test" && process.env.INGEST_SCRATCH_TEST !== "1") {
      throw new Error("sqlClientForTest is restricted to test processes");
    }
    sql = sqlClientForTest;
  } else {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL required for --commit (see src/lib/db/index.ts for the expected connection string shape).");
    }
    const { neon } = await import("@neondatabase/serverless");
    sql = neon(url) as unknown as SqlTag;
  }

  const BATCH = 1000;
  let wrote = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    await sql`
      INSERT INTO regional_econ (geo_level, geo_fips, geo_name, metric, year, month, value, unit, source, updated_at)
      SELECT 'county', t.fips, t.name, t.metric, t.year, t.month, t.value, t.unit, t.source, NOW()
      FROM UNNEST(
        ${batch.map((r) => r.geo_fips)}::text[],
        ${batch.map((r) => r.geo_name)}::text[],
        ${batch.map((r) => r.metric)}::text[],
        ${batch.map((r) => r.year)}::int[],
        ${batch.map((r) => (r.month ?? null))}::smallint[],
        ${batch.map((r) => r.value)}::double precision[],
        ${batch.map((r) => r.unit)}::text[],
        ${batch.map((r) => r.source)}::text[]
      ) AS t(fips, name, metric, year, month, value, unit, source)
      ON CONFLICT (geo_level, geo_fips, metric, year, (COALESCE(month, 0)))
      DO UPDATE SET
        value = EXCLUDED.value,
        geo_name = EXCLUDED.geo_name,
        month = EXCLUDED.month,
        unit = EXCLUDED.unit,
        source = EXCLUDED.source,
        updated_at = CASE
          WHEN regional_econ.value    IS DISTINCT FROM EXCLUDED.value
            OR regional_econ.geo_name IS DISTINCT FROM EXCLUDED.geo_name
            OR regional_econ.month    IS DISTINCT FROM EXCLUDED.month
            OR regional_econ.unit     IS DISTINCT FROM EXCLUDED.unit
            OR regional_econ.source   IS DISTINCT FROM EXCLUDED.source
          THEN NOW()
          ELSE regional_econ.updated_at
        END
    `;
    wrote += batch.length;
    console.log(`  upserted ${wrote.toLocaleString()}/${rows.length.toLocaleString()}`);
  }
  return wrote;
}

/** Null-safe numeric parse; treats Census ACS negative sentinel codes
 * (-666666666 etc, "not computed") as missing, same as Economic-Atlas's num(). */
export function num(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || Math.abs(n) >= 555555555) return null;
  return n;
}
