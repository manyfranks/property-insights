/**
 * Deterministic test for scripts/generate-sitemap.ts's lastmod policy
 * (see that file's header for the full per-surface sourcing rationale).
 *
 * Regression it guards against: lastmod used to be `new Date()` (build
 * time) stamped onto every URL — 11,828 of 11,840 URLs carried one
 * identical value. This test would have caught that: it fails if (a) any
 * emitted lastmod falls inside the actual build's wall-clock window (i.e.
 * looks like a build/deploy stamp rather than a real per-record date), or
 * (b) two surfaces that are sourced from unrelated systems (KV listing
 * enrichment vs. regional_econ ingestion vs. hand-maintained blog dates)
 * emit the exact same lastmod value, which would only happen if one of
 * them fell back to a shared stamp instead of its own real data.
 *
 * Runs the REAL generator as a subprocess (same command `npm run
 * prebuild` uses) against real .env.local-configured KV/DB, then parses
 * the real output file. No mocks, no fixtures — this is an assertion over
 * production-shaped data, not a unit test of the parsing logic.
 *
 * Usage: npx tsx scripts/test-sitemap-lastmod.ts
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SITEMAP_PATH = join(process.cwd(), "public", "sitemap-main.xml");

// W3C datetime (the sitemap protocol's required lastmod format) as emitted
// by JS's Date#toISOString(): YYYY-MM-DDTHH:mm:ss.sssZ
const W3C_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

interface UrlEntry {
  loc: string;
  lastmod: string | null;
}

function parseSitemap(xml: string): UrlEntry[] {
  const blocks = xml.match(/<url>[\s\S]*?<\/url>/g) ?? [];
  return blocks.map((block) => {
    const locMatch = block.match(/<loc>(.*?)<\/loc>/);
    const lastmodMatch = block.match(/<lastmod>(.*?)<\/lastmod>/);
    if (!locMatch) throw new Error(`Malformed <url> block (no <loc>): ${block}`);
    return { loc: locMatch[1], lastmod: lastmodMatch ? lastmodMatch[1] : null };
  });
}

type Surface =
  | "static-omitted"
  | "property"
  | "discover"
  | "blog-post"
  | "blog-tag"
  | "blog-index"
  | "us-county"
  | "us-county-rent"
  | "us-county-tax"
  | "us-state"
  | "us-root"
  | "us-rankings";

const STATIC_OMITTED_PATHS = new Set([
  "",
  "/dashboard",
  "/how-it-works",
  "/insurance",
  "/tools/assessment-gap",
  "/privacy",
  "/terms",
  "/data-usage",
  "/disclosures",
  "/tools/appeal-checker",
  "/resources",
]);

function classify(loc: string): Surface {
  const path = new URL(loc).pathname.replace(/\/$/, "");
  if (STATIC_OMITTED_PATHS.has(path)) return "static-omitted";
  if (path === "/blog") return "blog-index";
  if (path.startsWith("/blog/tags/")) return "blog-tag";
  if (path.startsWith("/blog/")) return "blog-post";
  if (path.startsWith("/discover/")) return "discover";
  if (path.startsWith("/property/")) return "property";
  if (path.startsWith("/us/rankings/")) return "us-rankings";
  if (path === "/us") return "us-root";
  if (path.endsWith("/rent")) return "us-county-rent";
  if (path.endsWith("/property-tax")) return "us-county-tax";
  const usMatch = path.match(/^\/us\/([^/]+)(?:\/([^/]+))?$/);
  if (usMatch) return usMatch[2] ? "us-county" : "us-state";
  throw new Error(`Unclassified sitemap URL — update this test's classifier: ${loc}`);
}

// Surfaces sourced from genuinely independent systems. Sharing an exact
// lastmod VALUE across these groups would mean one of them silently fell
// back to some other surface's (or a shared build) timestamp instead of
// its own real per-record data. Surfaces *within* a group are allowed to
// share values (e.g. a state page's lastmod is deliberately MAX() over its
// counties' own regional_econ values — that's the same source, coarser
// grain, not a collision).
const SOURCE_GROUP: Record<Exclude<Surface, "static-omitted">, string> = {
  property: "kv-listings",
  discover: "kv-listings",
  "blog-post": "blog-source",
  "blog-tag": "blog-source",
  "blog-index": "blog-source",
  "us-county": "regional-econ",
  "us-county-rent": "regional-econ",
  "us-county-tax": "regional-econ",
  "us-state": "regional-econ",
  "us-root": "regional-econ",
  "us-rankings": "regional-econ",
};

function main() {
  console.log("[test-sitemap-lastmod] running the real generator...");
  const buildWindowStart = Date.now();
  execFileSync("npx", ["tsx", "scripts/generate-sitemap.ts"], { stdio: "inherit" });
  const buildWindowEnd = Date.now();
  // Pad the window generously — this test doesn't need tight timing, just
  // enough margin to catch "this value is suspiciously close to when the
  // script ran" without flaking on a slow machine.
  const windowLo = buildWindowStart - 60_000;
  const windowHi = buildWindowEnd + 60_000;

  const xml = readFileSync(SITEMAP_PATH, "utf-8");
  const entries = parseSitemap(xml);
  if (entries.length < 10_000) {
    throw new Error(`Sanity check failed: only ${entries.length} <url> entries parsed — sitemap looks truncated/broken.`);
  }
  console.log(`[test-sitemap-lastmod] parsed ${entries.length} <url> entries.`);

  const failures: string[] = [];
  const valuesByGroup = new Map<string, Set<string>>();
  const valueOwner = new Map<string, { group: string; surface: Surface; loc: string }>();
  let withLastmod = 0;
  const lastmodCounts = new Map<string, number>();

  for (const entry of entries) {
    const surface = classify(entry.loc);

    if (surface === "static-omitted") {
      if (entry.lastmod !== null) {
        failures.push(
          `${entry.loc}: expected NO <lastmod> (static page, no real per-page timestamp source) but found "${entry.lastmod}"`
        );
      }
      continue;
    }

    if (entry.lastmod === null) {
      failures.push(`${entry.loc}: missing <lastmod> — surface "${surface}" is expected to have a real per-record timestamp`);
      continue;
    }

    withLastmod++;
    lastmodCounts.set(entry.lastmod, (lastmodCounts.get(entry.lastmod) ?? 0) + 1);

    if (!W3C_DATETIME.test(entry.lastmod)) {
      failures.push(`${entry.loc}: <lastmod>${entry.lastmod}</lastmod> is not valid W3C datetime format`);
      continue;
    }

    const epoch = Date.parse(entry.lastmod);
    if (epoch >= windowLo && epoch <= windowHi) {
      failures.push(
        `${entry.loc}: <lastmod>${entry.lastmod}</lastmod> falls inside this build's own wall-clock window ` +
          `(${new Date(windowLo).toISOString()} .. ${new Date(windowHi).toISOString()}) — looks like a build/deploy ` +
          `timestamp, not a real per-record date.`
      );
    }

    const group = SOURCE_GROUP[surface];
    if (!valuesByGroup.has(group)) valuesByGroup.set(group, new Set());
    valuesByGroup.get(group)!.add(entry.lastmod);

    const existingOwner = valueOwner.get(entry.lastmod);
    if (existingOwner && existingOwner.group !== group) {
      failures.push(
        `Cross-surface collision: "${entry.lastmod}" is shared by ${existingOwner.loc} (source group "${existingOwner.group}") ` +
          `and ${entry.loc} (source group "${group}") — these are sourced from unrelated systems and should never coincide exactly.`
      );
    } else if (!existingOwner) {
      valueOwner.set(entry.lastmod, { group, surface, loc: entry.loc });
    }
  }

  // Belt-and-suspenders: no single value should dominate the corpus the
  // way the old build-stamp bug did (11,828/11,840 = 99.9% one value).
  // A generous 50% threshold still catches any regression to "one shared
  // stamp for (almost) everything" without being sensitive to the honest
  // clustering that real batched DB writes produce (a few thousand rows
  // upserted in one transaction legitimately share one NOW()).
  for (const [value, count] of lastmodCounts) {
    const share = count / withLastmod;
    if (share > 0.5) {
      failures.push(
        `Dominance check failed: "${value}" accounts for ${count}/${withLastmod} (${(share * 100).toFixed(1)}%) of all ` +
          `lastmod values — looks like a reintroduced shared/build stamp.`
      );
    }
  }

  console.log(`[test-sitemap-lastmod] ${withLastmod} URLs with lastmod, ${lastmodCounts.size} distinct values, ` +
    `${entries.length - withLastmod} URLs with lastmod omitted.`);
  console.log(`[test-sitemap-lastmod] source groups: ${[...valuesByGroup.entries()].map(([g, v]) => `${g}=${v.size} distinct values`).join(", ")}`);

  if (failures.length > 0) {
    console.error(`\n[test-sitemap-lastmod] FAILED with ${failures.length} issue(s):\n`);
    for (const f of failures.slice(0, 50)) console.error(" - " + f);
    if (failures.length > 50) console.error(`   ...and ${failures.length - 50} more`);
    process.exit(1);
  }

  console.log("[test-sitemap-lastmod] PASSED");
}

main();
