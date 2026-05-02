/**
 * Test: Map a typed Google-Places-style address to a Zoocasa listing
 *       via city-wide search + semantic best-match scoring.
 *
 * Goal: prove we can replace the brittle URL-guessing path in fetchDetail()
 *       with a search-first lookup BEFORE we refactor /api/assess.
 *
 * Run: npx tsx scripts/test-address-to-zoocasa.ts
 *
 * Method (self-bootstrapping — no hard-coded addresses that can go stale):
 *   1. For each city, call searchListings() to get current live inventory.
 *   2. Sample N listings from that inventory — these are the ground truth.
 *   3. Reformat each ground-truth address into Google-Places shape
 *      ("1024 Boxcar Close, Langford, BC V9B 0Y4, Canada") and treat it
 *      as the "typed" input we want to map.
 *   4. Re-run searchListings() for the city and score every candidate
 *      against the typed street using a number-anchored fuzzy scorer.
 *   5. Verify the top match is the original ground-truth listing.
 *   6. Fetch the matched URL via fetchDetailByUrl() to prove it loads
 *      end-to-end (same path /api/assess would take after refactor).
 *
 * Pass criteria (per case):
 *   - top-1 match.url === ground-truth listing url
 *   - detail fetch returns a listing with the same MLS number
 *
 * Reports per-city accuracy and prints any misses with diagnostic detail
 * so we can decide if the scoring rule needs tuning before shipping.
 */

import { searchListings, fetchDetailByUrl, findAndFetchDetail, ZoocasaNotFoundError } from "../src/lib/zoocasa";
import type { Listing } from "../src/lib/types";

// ---------------------------------------------------------------------------
// Cities to test — mix of small + large markets to stress single-page coverage
// ---------------------------------------------------------------------------

const CITIES: Array<{ city: string; province: string }> = [
  { city: "Langford", province: "bc" },
  { city: "Victoria", province: "bc" },
  { city: "Squamish", province: "bc" },
  { city: "Calgary", province: "ab" },
  { city: "Edmonton", province: "ab" },
  { city: "Hamilton", province: "on" },
];

const SAMPLES_PER_CITY = 5; // ground-truth listings per city
const SCORE_THRESHOLD = 0.7; // minimum confidence to claim a match

// ---------------------------------------------------------------------------
// Address tokenization + scoring
// ---------------------------------------------------------------------------
//
// "Semantic best guess" without a vector DB:
//   1. Hard anchor on street number (must match exactly — same address, same number).
//   2. After stripping street-type words ("st", "ave", "drive", etc.) and
//      directional words ("nw", "se"), compute Jaccard overlap on the remaining
//      street-name tokens.
//   3. Score = 0.5 (number match) + 0.5 * (token overlap ratio).
//
// This handles every variant we saw fail in fetchDetail():
//   - "Bear Mountain Parkway" vs Zoocasa's "Bear Mountain Pky"  → both lose
//      the type word, both keep "bear mountain" → 100% overlap.
//   - Unit prefixes "316-2341 Bear Mountain Pky" vs "2341 Bear Mountain Pky" →
//      number anchor pins "2341"; unit handled separately by the caller.
//   - Full vs abbreviated names — directional/type words stripped before compare.
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  // street types
  "st", "street", "ave", "avenue", "dr", "drive", "rd", "road",
  "blvd", "boulevard", "cres", "crescent", "crt", "court", "pl", "place",
  "way", "lane", "ln", "trail", "tr", "terr", "terrace", "cir", "circle",
  "pk", "park", "pkwy", "pky", "parkway", "sq", "square", "close",
  "gate", "hts", "heights", "pt", "point", "green", "grove", "cove",
  "landing", "rise", "mews", "bay", "glen", "commons", "row", "walk",
  // directionals
  "n", "s", "e", "w", "ne", "nw", "se", "sw",
  "north", "south", "east", "west",
  "northeast", "northwest", "southeast", "southwest",
]);

function tokenize(streetLine: string): { number: string | null; words: string[] } {
  // Strip trailing unit hints — they belong on the unit field, not the street.
  // Then normalize hyphens between numbers to spaces so "4-170" becomes "4 170".
  let s = streetLine
    .toLowerCase()
    .replace(/[#,\.]/g, " ")
    .replace(/\s+(unit|suite|apt|apartment)\s+\w+\s*$/i, "")
    .replace(/(\d)-(\d)/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();

  // Three shapes seen in the wild:
  //   "1024 Boxcar Close"        → number=1024
  //   "4 170 Celano Cres"        → unit 4, street number 170 (Zoocasa unit-prefix)
  //   "170 Celano Cres" + later  → number=170 (Google Places strips unit)
  // Heuristic: if the line starts with TWO numbers, the second is the street #.
  const dualNum = s.match(/^(\d+[a-z]?)\s+(\d+[a-z]?)\s+(.+)$/);
  if (dualNum) {
    const number = dualNum[2];
    const words = dualNum[3].split(" ").filter((w) => w && !STOPWORDS.has(w));
    return { number, words };
  }

  // Pull leading street number (e.g., "1024" or "1024A").
  const numMatch = s.match(/^(\d+[a-z]?)\s+(.+)$/);
  if (!numMatch) return { number: null, words: s.split(" ").filter(Boolean) };

  const number = numMatch[1];
  s = numMatch[2];

  const words = s
    .split(" ")
    .filter((w) => w.length > 0 && !STOPWORDS.has(w));

  return { number, words };
}

function score(typed: string, candidate: string): number {
  const a = tokenize(typed);
  const b = tokenize(candidate);

  // No number → no anchor → reject.
  if (!a.number || !b.number) return 0;
  if (a.number !== b.number) return 0;

  // Number matches but no name tokens left — partial credit.
  if (a.words.length === 0 && b.words.length === 0) return 0.5;
  if (a.words.length === 0 || b.words.length === 0) return 0.5;

  const setA = new Set(a.words);
  const setB = new Set(b.words);
  let intersect = 0;
  for (const w of setA) if (setB.has(w)) intersect++;
  const union = setA.size + setB.size - intersect;
  const jaccard = union === 0 ? 0 : intersect / union;

  return 0.5 + 0.5 * jaccard;
}

// ---------------------------------------------------------------------------
// Reformat a Zoocasa-clean address into Google-Places shape
// ---------------------------------------------------------------------------
// Zoocasa search returns "1024 Boxcar Close" (already cleaned).
// Google Places returns "1024 Boxcar Close, Langford, BC V9B 0Y4, Canada".
// We append the Google-style suffix to simulate the worst case the user pastes.

function asGooglePlaces(streetLine: string, city: string, province: string): string {
  const provDisplay = province.toUpperCase();
  // Postal code is irrelevant to our scorer — we still include it to match
  // the real input shape from /api/autocomplete.
  return `${streetLine}, ${city}, ${provDisplay} A1A 1A1, Canada`;
}

// Mimic parseAddress() from /api/assess — extract just the street line.
function extractStreet(googleFormatted: string): string {
  const cleaned = googleFormatted.replace(/,?\s*Canada\s*$/i, "").trim();
  return cleaned.split(",")[0].trim();
}

// ---------------------------------------------------------------------------
// Per-city test
// ---------------------------------------------------------------------------

interface CaseResult {
  truth: Listing;
  typed: string;
  candidatesCount: number;
  topMatch: Listing | null;
  topScore: number;
  matchedUrlEqualsTruth: boolean;
  detailLoaded: boolean;
  detailMlsMatchesTruth: boolean;
  notes: string;
}

async function runCity(city: string, province: string): Promise<CaseResult[]> {
  console.log(`\n=== ${city}, ${province.toUpperCase()} ===`);

  let inventory: Listing[];
  try {
    inventory = await searchListings(city, province);
  } catch (err) {
    console.log(`  ✗ search failed: ${err instanceof Error ? err.message : err}`);
    return [];
  }

  console.log(`  inventory: ${inventory.length} listings on first page`);

  // Filter to listings that have a usable URL and a numeric street start —
  // those are the only ones we can fairly test (Zoocasa sometimes returns
  // entries without addressSlug for in-development properties).
  const testable = inventory.filter(
    (l) => l.url && /^\d/.test(l.address)
  );
  if (testable.length === 0) {
    console.log(`  ✗ no testable listings in this market`);
    return [];
  }

  // Sample evenly across the inventory.
  const step = Math.max(1, Math.floor(testable.length / SAMPLES_PER_CITY));
  const samples = [];
  for (let i = 0; i < testable.length && samples.length < SAMPLES_PER_CITY; i += step) {
    samples.push(testable[i]);
  }

  const results: CaseResult[] = [];
  for (const truth of samples) {
    const typedFull = asGooglePlaces(truth.address, city, province);
    const typedStreet = extractStreet(typedFull);

    // Re-run search so each case is independent (pretend we don't have inventory in hand).
    let candidates: Listing[];
    try {
      candidates = await searchListings(city, province);
    } catch (err) {
      results.push({
        truth, typed: typedFull, candidatesCount: 0,
        topMatch: null, topScore: 0,
        matchedUrlEqualsTruth: false, detailLoaded: false, detailMlsMatchesTruth: false,
        notes: `search failed: ${err instanceof Error ? err.message : err}`,
      });
      continue;
    }

    const ranked = candidates
      .map((c) => ({ c, s: score(typedStreet, c.address) }))
      .filter((x) => x.s >= SCORE_THRESHOLD)
      .sort((a, b) => b.s - a.s);

    const top = ranked[0];
    if (!top) {
      results.push({
        truth, typed: typedFull, candidatesCount: candidates.length,
        topMatch: null, topScore: 0,
        matchedUrlEqualsTruth: false, detailLoaded: false, detailMlsMatchesTruth: false,
        notes: "no candidate met score threshold",
      });
      continue;
    }

    const matchedUrlEqualsTruth = top.c.url === truth.url;

    // End-to-end: fetch the matched URL like /api/assess would do post-refactor.
    let detailLoaded = false;
    let detailMlsMatchesTruth = false;
    let detailErr = "";
    try {
      const detail = await fetchDetailByUrl(top.c.url);
      detailLoaded = true;
      detailMlsMatchesTruth = !!detail.listing.mlsNumber &&
        detail.listing.mlsNumber === truth.mlsNumber;
    } catch (err) {
      detailErr = err instanceof Error ? err.message : String(err);
    }

    results.push({
      truth, typed: typedFull, candidatesCount: candidates.length,
      topMatch: top.c, topScore: top.s,
      matchedUrlEqualsTruth, detailLoaded, detailMlsMatchesTruth,
      notes: detailErr,
    });

    const ok = matchedUrlEqualsTruth && detailLoaded && detailMlsMatchesTruth;
    console.log(
      `  ${ok ? "✓" : "✗"} "${truth.address}"` +
      ` → "${top.c.address}"` +
      ` score=${top.s.toFixed(2)}` +
      ` urlMatch=${matchedUrlEqualsTruth}` +
      ` detail=${detailLoaded ? "ok" : "fail"}` +
      ` mlsMatch=${detailMlsMatchesTruth}` +
      (detailErr ? ` (${detailErr})` : "")
    );
  }

  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function verifyComposedFunction(samples: Array<{ truth: Listing; city: string; province: string }>) {
  console.log(`\n=== composed findAndFetchDetail() check ===`);
  console.log(`Calls the production function the way /api/assess will, end-to-end.`);
  let pass = 0;
  for (const { truth, city, province } of samples) {
    try {
      const detail = await findAndFetchDetail(truth.address, city, province);
      const ok = detail.listing.mlsNumber === truth.mlsNumber;
      console.log(`  ${ok ? "✓" : "✗"} ${truth.address} → mls=${detail.listing.mlsNumber} (truth=${truth.mlsNumber})`);
      if (ok) pass++;
    } catch (err) {
      const tag = err instanceof ZoocasaNotFoundError ? "not-found" : "error";
      console.log(`  ✗ ${truth.address} (${tag}: ${err instanceof Error ? err.message : err})`);
    }
  }
  console.log(`composed pass: ${pass}/${samples.length}`);
  return pass === samples.length;
}

async function main() {
  const allResults: CaseResult[] = [];

  for (const c of CITIES) {
    const r = await runCity(c.city, c.province);
    allResults.push(...r);
  }

  // Run the composed production function on a small subset.
  const composedSamples = allResults
    .filter((r) => r.matchedUrlEqualsTruth)
    .slice(0, 5)
    .map((r) => {
      const cityProv = CITIES.find((c) => r.truth.url.includes(`/${c.city.toLowerCase().replace(/\s+/g, "-")}-${c.province}-real-estate/`))
        || CITIES[0];
      return { truth: r.truth, city: cityProv.city, province: cityProv.province };
    });
  if (composedSamples.length > 0) {
    await verifyComposedFunction(composedSamples);
  }

  console.log(`\n=== summary ===`);
  const total = allResults.length;
  if (total === 0) {
    console.log(`No cases ran — investigate before refactoring.`);
    process.exit(1);
  }

  const fullPass = allResults.filter(
    (r) => r.matchedUrlEqualsTruth && r.detailLoaded && r.detailMlsMatchesTruth
  ).length;
  const urlMatched = allResults.filter((r) => r.matchedUrlEqualsTruth).length;
  const detailLoaded = allResults.filter((r) => r.detailLoaded).length;
  const noMatch = allResults.filter((r) => !r.topMatch).length;

  console.log(`cases:        ${total}`);
  console.log(`url match:    ${urlMatched}/${total} (${((urlMatched / total) * 100).toFixed(0)}%)`);
  console.log(`detail load:  ${detailLoaded}/${total} (${((detailLoaded / total) * 100).toFixed(0)}%)`);
  console.log(`full pass:    ${fullPass}/${total} (${((fullPass / total) * 100).toFixed(0)}%)`);
  console.log(`no candidate: ${noMatch}/${total}`);

  // Detail every failure so we can judge whether the scorer needs tuning.
  const failures = allResults.filter(
    (r) => !(r.matchedUrlEqualsTruth && r.detailLoaded && r.detailMlsMatchesTruth)
  );
  if (failures.length > 0) {
    console.log(`\n--- failures ---`);
    for (const f of failures) {
      console.log(`  truth:   ${f.truth.address} (${f.truth.url})`);
      console.log(`    typed: ${f.typed}`);
      console.log(`    top:   ${f.topMatch ? `${f.topMatch.address} score=${f.topScore.toFixed(2)} (${f.topMatch.url})` : "none"}`);
      console.log(`    notes: ${f.notes || "(none)"}`);
    }
  }

  // Threshold for declaring the refactor safe to ship.
  const passRate = fullPass / total;
  const SHIP_THRESHOLD = 0.85;
  if (passRate >= SHIP_THRESHOLD) {
    console.log(`\nPASS — search-based mapping cleared ${(SHIP_THRESHOLD * 100).toFixed(0)}% bar (${(passRate * 100).toFixed(0)}%). Safe to refactor /api/assess.`);
    process.exit(0);
  } else {
    console.log(`\nFAIL — search-based mapping below ${(SHIP_THRESHOLD * 100).toFixed(0)}% bar (${(passRate * 100).toFixed(0)}%). Tune scorer before refactoring.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
