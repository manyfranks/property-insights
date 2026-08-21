#!/usr/bin/env node

/**
 * Release gate for direct production dependency advisories.
 *
 * `npm audit` deliberately reports the complete transitive graph and exits
 * non-zero for advisories below this repository's release threshold. That is
 * useful evidence, but it is too volatile to make every build depend on it.
 * This wrapper keeps the full report visible while failing only when a direct
 * production dependency has a high or critical advisory.
 *
 * Run explicitly before a production release:
 *   npm run security:audit
 */

import { spawnSync } from "node:child_process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(npmCommand, ["audit", "--omit=dev", "--json"], {
  encoding: "utf8",
  maxBuffer: 20 * 1024 * 1024,
});

if (result.error) {
  console.error(`[security:audit] npm audit could not start: ${result.error.message}`);
  process.exit(2);
}

let report;
try {
  report = JSON.parse(result.stdout || "{}");
} catch {
  console.error("[security:audit] npm audit did not return valid JSON.");
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(2);
}

if (report.error) {
  console.error(
    `[security:audit] npm audit failed: ${report.error.summary || report.error.code || "unknown error"}`
  );
  process.exit(2);
}

const severityRank = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const vulnerabilities = Object.values(report.vulnerabilities || {});
const releaseBlockers = vulnerabilities
  .filter((item) => item?.isDirect && (severityRank[item.severity] ?? 0) >= severityRank.high)
  .sort((a, b) => (severityRank[b.severity] ?? 0) - (severityRank[a.severity] ?? 0));

const totals = report.metadata?.vulnerabilities || {};
console.log(
  `[security:audit] production graph: ${totals.total || 0} advisories ` +
    `(${totals.critical || 0} critical, ${totals.high || 0} high, ` +
    `${totals.moderate || 0} moderate, ${totals.low || 0} low)`
);

if (releaseBlockers.length === 0) {
  console.log("[security:audit] pass — no direct high/critical production advisories.");
  process.exit(0);
}

console.error(
  `[security:audit] FAIL — ${releaseBlockers.length} direct high/critical production dependency advisories:`
);
for (const item of releaseBlockers) {
  const fix = item.fixAvailable
    ? typeof item.fixAvailable === "object"
      ? `; suggested ${item.fixAvailable.name}@${item.fixAvailable.version}`
      : "; fix available"
    : "; no automated fix reported";
  console.error(`  - ${item.name}: ${item.severity}${fix}`);
}
console.error("[security:audit] Review the complete `npm audit --omit=dev` report before release.");
process.exit(1);
