/**
 * Compliance-as-code guard: unlicensed platforms that "urge" users toward a
 * specific insurer commit licensable solicitation (WA TAA 2021-01 — see
 * docs/legal/INSURANCE-BROKERAGE-STRUCTURES.md §3). Solicitation is defined
 * by *behavior*, not payment, so insurance-facing copy must never compare,
 * rank, or superlative-ize insurers — framing is always "get quotes / build
 * a coverage profile / get matched with a licensed broker."
 *
 * This script is the build-failing guard the proposal calls for
 * (docs/proposals/insurance-distribution-proposal.html, "compliance
 * expressed as code"): it scans every `vertical: "insurance"` vendor's
 * user-facing copy fields, plus any insurance-specific UI components, for
 * prohibited terms and fails the build (prebuild, before `next build`) on a
 * hit.
 *
 * Scope is deliberately insurance-only — mortgage/other verticals may keep
 * "Compare" (e.g. Ratehub's "Compare mortgage rates" is fine).
 *
 * Run: tsx scripts/check-insurance-copy.ts
 */
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, extname } from "node:path";
import { AFFILIATE_VENDORS, type AffiliateVendor } from "../src/config/affiliate-vendors";

// Word-boundary, case-insensitive. Multi-word terms use a literal space,
// which is a non-word character, so \b still anchors correctly around them
// (e.g. "\btop rated\b" matches "our top rated insurer" but not "desktop rated-x").
const PROHIBITED_TERMS = [
  "compare",
  "comparison",
  "best",
  "top-rated",
  "top rated",
  "recommended",
  "cheapest",
  "lowest",
];

const TERM_PATTERNS = PROHIBITED_TERMS.map((term) => ({
  term,
  pattern: new RegExp(`\\b${term.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "i"),
}));

interface Violation {
  location: string;
  field: string;
  term: string;
  matchedText: string;
}

function scanText(text: string): { term: string; matchedText: string }[] {
  const hits: { term: string; matchedText: string }[] = [];
  for (const { term, pattern } of TERM_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      hits.push({ term, matchedText: match[0] });
    }
  }
  return hits;
}

function checkVendorCopy(vendors: AffiliateVendor[]): Violation[] {
  const violations: Violation[] = [];
  const copyFields: (keyof AffiliateVendor)[] = ["ctaLabel", "description", "shortCta", "offerText"];

  for (const vendor of vendors) {
    if (vendor.vertical !== "insurance") continue;

    for (const field of copyFields) {
      const value = vendor[field];
      if (typeof value !== "string") continue;

      for (const hit of scanText(value)) {
        violations.push({
          location: `vendor "${vendor.id}" (${vendor.name})`,
          field,
          term: hit.term,
          matchedText: hit.matchedText,
        });
      }
    }
  }

  return violations;
}

/** Recursively lists .ts/.tsx files under `dir`. Returns [] if `dir` doesn't exist — that's not an error, the directory is just not built yet. */
function listSourceFiles(dir: string): string[] {
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(fullPath));
    } else if (entry.isFile() && (extname(entry.name) === ".ts" || extname(entry.name) === ".tsx")) {
      files.push(fullPath);
    }
  }
  return files;
}

function checkComponentFiles(dir: string): Violation[] {
  const violations: Violation[] = [];
  const files = listSourceFiles(dir);

  for (const file of files) {
    const content = readFileSync(file, "utf8");
    // Scan line-by-line so the reported "matched text" is a short, useful
    // snippet rather than the whole file.
    const lines = content.split("\n");
    lines.forEach((line, idx) => {
      for (const hit of scanText(line)) {
        violations.push({
          location: `${file}:${idx + 1}`,
          field: "(source line)",
          term: hit.term,
          matchedText: line.trim().slice(0, 160),
        });
      }
    });
  }

  return violations;
}

function main() {
  const violations: Violation[] = [
    ...checkVendorCopy(AFFILIATE_VENDORS),
    ...checkComponentFiles(join(process.cwd(), "src/components/insurance")),
  ];

  if (violations.length > 0) {
    console.error(
      `\n[check-insurance-copy] ${violations.length} prohibited-term violation(s) found in insurance-facing copy:\n`
    );
    for (const v of violations) {
      console.error(`  - ${v.location} [${v.field}]: term "${v.term}" matched "${v.matchedText}"`);
    }
    console.error(
      "\nInsurance copy must never solicit or compare (WA TAA 2021-01 — see docs/legal/INSURANCE-BROKERAGE-STRUCTURES.md §3)." +
        ' Use "get quotes / build a coverage profile / get matched with a licensed broker" framing instead.\n'
    );
    process.exit(1);
  }

  console.log("[check-insurance-copy] pass — no prohibited terms found in insurance copy.");
}

main();
