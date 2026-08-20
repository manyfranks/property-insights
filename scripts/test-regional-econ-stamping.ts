/**
 * Scratch verification for scripts/lib/ingest-shared.ts's conditional
 * `updated_at` stamping in upsertRegionalEcon's ON CONFLICT DO UPDATE.
 *
 * Regression this guards against: Postgres's DO UPDATE fires unconditionally
 * on every conflict — there is no "only if different" clause built in. An
 * unconditional `updated_at = NOW()` therefore restamps every re-ingested
 * row even when nothing changed (the overwhelming majority of rows on any
 * re-run of this annual/periodic county data). That collapses the
 * per-record sitemap <lastmod> signal PR #5 (scripts/generate-sitemap.ts,
 * see scripts/test-sitemap-lastmod.ts) shipped — 1 distinct timestamp ->
 * 2,231 -> back toward 1 on the next manual full ingest.
 *
 * Pattern: mirrors the throwaway-Postgres lifecycle established by
 * scripts/test-insurance-migrations.ts (initdb/pg_ctl/createdb in a temp
 * dir, torn down in `finally`). upsertRegionalEcon's real DB client is
 * @neondatabase/serverless's neon(), which speaks Neon's HTTP proxy
 * protocol and cannot target a local `postgresql://` instance — the same
 * reason src/lib/db/index.ts exposes setSqlForTest instead of letting tests
 * call neon() directly, and scripts/test-insurance-case-commands.ts shells
 * out to psql for its scratch-DB assertions instead of using neon(). This
 * test uses the equivalent seam (upsertRegionalEcon's optional
 * sqlClientForTest param) with a psql-backed fake tag function, so it
 * exercises the REAL upsertRegionalEcon() and the REAL SQL text in
 * scripts/lib/ingest-shared.ts — not a copy of it.
 *
 * NOW() is frozen at transaction start in Postgres. Each call below is its
 * own psql invocation (no explicit BEGIN/COMMIT spanning multiple calls),
 * so each upsert is its own transaction. To keep before/after comparisons
 * unambiguous regardless of wall-clock granularity, seed rows carry
 * explicit far-past `updated_at` values (2019/2020) rather than relying on
 * relative timing.
 *
 * Usage: node --import tsx scripts/test-regional-econ-stamping.ts
 */
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { upsertRegionalEcon, RegionalEconRow } from "./lib/ingest-shared";

function fail(message: string): never {
  throw new Error(`[regional-econ-stamping-test] ${message}`);
}

function command(commandName: string, args: string[], env: NodeJS.ProcessEnv = process.env, input?: string): string {
  const result = spawnSync(commandName, args, { env, input, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  if (result.status !== 0) fail(`${commandName} failed: ${(result.stderr || result.stdout).trim()}`);
  return result.stdout.trim();
}

function sqlLiteral(value: unknown): string {
  if (Array.isArray(value)) return `ARRAY[${value.map(sqlLiteral).join(",")}]`;
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function render(strings: TemplateStringsArray | readonly string[], values: readonly unknown[]): string {
  return strings.reduce((sql, part, index) => sql + part + (index < values.length ? sqlLiteral(values[index]) : ""), "");
}

async function main(): Promise<void> {
  // Deliberately /tmp, not os.tmpdir(): the throwaway server binds a
  // Unix-domain socket under this dir, and macOS's real TMPDIR (what
  // os.tmpdir() returns) is long enough to blow Postgres's 103-byte socket
  // path limit. /tmp is a short, stable symlink to the same private tmp area.
  const root = mkdtempSync(resolve("/tmp", "regional-econ-stamping-test-"));
  const data = resolve(root, "pgdata");
  const socket = resolve(root, "socket");
  mkdirSync(socket);
  const port = 55000 + (process.pid % 5000);
  let started = false;

  try {
    command("initdb", ["-D", data, "--auth=trust", "--no-locale", "--encoding=UTF8"]);
    command("pg_ctl", ["-D", data, "-l", resolve(root, "postgres.log"), "-o", `-F -p ${port} -k ${socket}`, "-w", "start"]);
    started = true;
    command("createdb", ["-h", socket, "-p", String(port), "regional_econ_test"]);
    const pgEnv = {
      ...process.env,
      PGHOST: socket,
      PGPORT: String(port),
      PGDATABASE: "regional_econ_test",
      PGSSLMODE: "disable",
    };

    function psql(sql: string): string {
      const result = spawnSync("psql", ["-X", "-q", "-A", "-t", "-F", "\t", "-v", "ON_ERROR_STOP=1"], {
        env: pgEnv,
        input: sql,
        encoding: "utf8",
      });
      if (result.status !== 0) fail((result.stderr || result.stdout || "psql failed").trim());
      return result.stdout.trim();
    }

    // Schema verbatim from src/lib/db/schema.sql — the real regional_econ
    // table and the real ON CONFLICT arbiter index upsertRegionalEcon relies on.
    psql(`
      CREATE TABLE regional_econ (
        id            BIGSERIAL PRIMARY KEY,
        geo_level     TEXT NOT NULL,
        geo_fips      VARCHAR(12) NOT NULL,
        geo_name      TEXT,
        metric        TEXT NOT NULL,
        year          INTEGER NOT NULL,
        month         SMALLINT,
        value         DOUBLE PRECISION,
        unit          TEXT,
        source        TEXT,
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX idx_regional_econ_natural_key
        ON regional_econ (geo_level, geo_fips, metric, year, COALESCE(month, 0));
    `);

    process.env.INGEST_SCRATCH_TEST = "1";
    const testSql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = render(strings, values);
      psql(text);
      return [];
    }) as unknown as Parameters<typeof upsertRegionalEcon>[1];

    async function upsert(rows: RegionalEconRow[]): Promise<void> {
      await upsertRegionalEcon(rows, testSql);
    }

    function updatedAtEpoch(geoFips: string, metric: string, year: number): number {
      const out = psql(
        `SELECT EXTRACT(EPOCH FROM updated_at)::text FROM regional_econ WHERE geo_fips='${geoFips}' AND metric='${metric}' AND year=${year}`
      );
      if (!out) fail(`no row found for ${geoFips}/${metric}/${year}`);
      return Number(out);
    }

    function rowCount(): number {
      return Number(psql(`SELECT count(*) FROM regional_econ`));
    }

    const nowEpoch = Date.now() / 1000;
    const recentThreshold = nowEpoch - 300; // last 5 minutes — generous for a scratch test

    // -------------------------------------------------------------------
    // Test 1: an upsert that CHANGES a value moves updated_at forward.
    // -------------------------------------------------------------------
    psql(`
      INSERT INTO regional_econ (geo_level, geo_fips, geo_name, metric, year, month, value, unit, source, updated_at)
      VALUES ('county', 'US-06075', 'San Francisco County, CA', 'median_home_value', 2020, NULL, 900000, 'USD', 'census_acs', '2020-01-01T00:00:00Z');
    `);
    const seededEpoch1 = updatedAtEpoch("US-06075", "median_home_value", 2020);
    if (seededEpoch1 >= recentThreshold) fail("test 1 setup: seed timestamp did not stick as far-past");

    await upsert([
      { geo_fips: "US-06075", geo_name: "San Francisco County, CA", metric: "median_home_value", year: 2020, value: 950000, unit: "USD", source: "census_acs" },
    ]);
    const changedEpoch = updatedAtEpoch("US-06075", "median_home_value", 2020);
    if (!(changedEpoch > seededEpoch1 && changedEpoch >= recentThreshold)) {
      fail(`test 1 FAILED: value-changing upsert should move updated_at forward to "now". seeded=${seededEpoch1} after=${changedEpoch}`);
    }
    console.log("test 1 PASSED: changed value moves updated_at forward");

    // -------------------------------------------------------------------
    // Test 2: an upsert with an IDENTICAL value leaves updated_at unchanged.
    // -------------------------------------------------------------------
    psql(`
      INSERT INTO regional_econ (geo_level, geo_fips, geo_name, metric, year, month, value, unit, source, updated_at)
      VALUES ('county', 'US-48453', 'Travis County, TX', 'fmr_2br', 2021, NULL, 1500, 'USD', 'hud', '2020-06-15T00:00:00Z');
    `);
    const seededEpoch2 = updatedAtEpoch("US-48453", "fmr_2br", 2021);
    if (seededEpoch2 >= recentThreshold) fail("test 2 setup: seed timestamp did not stick as far-past");

    await upsert([
      { geo_fips: "US-48453", geo_name: "Travis County, TX", metric: "fmr_2br", year: 2021, value: 1500, unit: "USD", source: "hud" },
    ]);
    const unchangedEpoch = updatedAtEpoch("US-48453", "fmr_2br", 2021);
    if (unchangedEpoch !== seededEpoch2) {
      fail(`test 2 FAILED: identical-value upsert must leave updated_at unchanged. seeded=${seededEpoch2} after=${unchangedEpoch}`);
    }
    console.log("test 2 PASSED: identical value leaves updated_at unchanged");

    // -------------------------------------------------------------------
    // Test 3: seed N rows with distinct older updated_at values, re-run the
    // ingest TWICE with unchanged data — every row must keep its own
    // distinct timestamp. This is the assertion that models the real
    // failure (2,231 distinct <lastmod> values collapsing toward 1 on the
    // next full re-ingest).
    // -------------------------------------------------------------------
    const seedSpecs = [
      { fips: "US-01001", name: "Autauga County, AL", year: 2019, value: 100000, ts: "2019-01-01T00:00:00Z" },
      { fips: "US-01003", name: "Baldwin County, AL", year: 2019, value: 200000, ts: "2019-02-01T00:00:00Z" },
      { fips: "US-01005", name: "Barbour County, AL", year: 2019, value: 300000, ts: "2019-03-01T00:00:00Z" },
      { fips: "US-01007", name: "Bibb County, AL", year: 2019, value: 400000, ts: "2019-04-01T00:00:00Z" },
      { fips: "US-01009", name: "Blount County, AL", year: 2019, value: 500000, ts: "2019-05-01T00:00:00Z" },
    ];
    const METRIC3 = "median_home_value_test3";
    for (const s of seedSpecs) {
      psql(`
        INSERT INTO regional_econ (geo_level, geo_fips, geo_name, metric, year, month, value, unit, source, updated_at)
        VALUES ('county', '${s.fips}', '${s.name}', '${METRIC3}', ${s.year}, NULL, ${s.value}, 'USD', 'census_acs', '${s.ts}');
      `);
    }
    const seededEpochs3 = new Map(seedSpecs.map((s) => [s.fips, updatedAtEpoch(s.fips, METRIC3, s.year)]));
    for (const s of seedSpecs) {
      if (seededEpochs3.get(s.fips)! >= recentThreshold) fail(`test 3 setup: ${s.fips} seed timestamp did not stick as far-past`);
    }
    // Sanity: all 5 seeded timestamps are genuinely distinct before we start.
    if (new Set(seededEpochs3.values()).size !== seedSpecs.length) fail("test 3 setup: seeded timestamps were not distinct");

    const unchangedRows: RegionalEconRow[] = seedSpecs.map((s) => ({
      geo_fips: s.fips,
      geo_name: s.name,
      metric: METRIC3,
      year: s.year,
      value: s.value,
      unit: "USD",
      source: "census_acs",
    }));
    await upsert(unchangedRows); // re-run 1, unchanged data
    await upsert(unchangedRows); // re-run 2, unchanged data

    const finalEpochs3 = new Map(seedSpecs.map((s) => [s.fips, updatedAtEpoch(s.fips, METRIC3, s.year)]));
    const collapsed: string[] = [];
    for (const s of seedSpecs) {
      if (finalEpochs3.get(s.fips) !== seededEpochs3.get(s.fips)) collapsed.push(s.fips);
    }
    if (collapsed.length > 0) {
      fail(`test 3 FAILED: ${collapsed.length}/${seedSpecs.length} rows lost their distinct updated_at after two unchanged re-ingests: ${collapsed.join(", ")}`);
    }
    if (new Set(finalEpochs3.values()).size !== seedSpecs.length) {
      fail("test 3 FAILED: final timestamps collapsed to fewer than 5 distinct values");
    }
    console.log(`test 3 PASSED: all ${seedSpecs.length} rows kept their own distinct updated_at across two unchanged re-ingests`);

    if (rowCount() !== 2 + seedSpecs.length) fail(`unexpected total row count: ${rowCount()}`);

    console.log("\nregional_econ conditional-stamping scratch test passed");
  } finally {
    if (started) spawnSync("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"], { encoding: "utf8" });
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
