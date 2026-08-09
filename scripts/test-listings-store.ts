/**
 * Round-trip test for the sharded KV listings store (src/lib/kv/listings.ts).
 *
 * Exercises the REAL writeAllListings/getAllListings/getListingBySlug code
 * paths — including the byte-capped chunking, the listings:index manifest,
 * the floor guard, and shape validation — but against a fully isolated
 * key namespace (a unique "test-listings-<timestamp>:*" prefix, threaded
 * through via each function's optional `keyPrefix` opt) so this can never
 * read, overwrite, or corrupt the real "listings:*" production data living
 * in the same shared Upstash instance. All test keys are deleted at the end
 * (best-effort, in a finally block).
 *
 * Usage: npx tsx scripts/test-listings-store.ts
 */
import { loadEnvLocal } from "./lib/ingest-shared";
import type { Listing } from "../src/lib/types";

loadEnvLocal();

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

if (!KV_URL || !KV_TOKEN) {
  console.error("Missing KV_REST_API_URL or KV_REST_API_TOKEN — cannot run a real KV round-trip test.");
  process.exit(1);
}

const KEY_PREFIX = `test-listings-${Date.now()}`;
const FIXTURE_COUNT = 2000;

// A ~2KB filler string so 2,000 fixtures serialize to a multi-MB payload —
// large enough to force multiple storage chunks, the same regime that
// caused the real 9.9MB / 2,322-listing blob to blow past the 2MB cache
// ceiling this fix addresses.
const FILLER = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(35);

function makeFixture(i: number): Listing {
  return {
    address: `${1000 + i} Test Fixture St #${i}`,
    city: "Testville",
    province: "ZZ",
    dom: i % 120,
    price: 300000 + i * 137,
    beds: String(1 + (i % 5)),
    baths: String(1 + (i % 3)),
    sqft: String(600 + i * 3),
    yearBuilt: String(1950 + (i % 74)),
    taxes: String(2000 + i),
    lotSize: String(2000 + i * 5),
    priceReduced: i % 4 === 0,
    hasSuite: i % 7 === 0,
    estateKeywords: i % 11 === 0,
    description: `Fixture listing #${i}. ${FILLER}`,
    notes: `Synthetic test-listings-store.ts fixture, batch ${KEY_PREFIX}.`,
    cluster: `test-cluster-${i % 6}`,
    url: `https://example.invalid/listing/${i}`,
    mlsNumber: `TEST-${i}`,
  };
}

// ---------------------------------------------------------------------------
// Minimal raw REST helpers — deliberately NOT importing anything from
// kv/listings.ts here, so the "garbage data" and cleanup steps can write/
// scan/delete bytes that bypass the module's own JSON encoding (needed to
// simulate real corruption, and to sweep every key under this run's prefix
// without the module knowing those keys exist).
// ---------------------------------------------------------------------------
const headers = { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" };

async function rawSet(key: string, literalValue: string): Promise<void> {
  await fetch(`${KV_URL}`, {
    method: "POST",
    headers,
    body: JSON.stringify(["SET", key, literalValue]),
  });
}

async function scanAndDelete(matchPattern: string): Promise<number> {
  let cursor = "0";
  let deleted = 0;
  do {
    const res = await fetch(
      `${KV_URL}/scan/${encodeURIComponent(cursor)}/match/${encodeURIComponent(matchPattern)}/count/200`,
      { headers }
    );
    const body = await res.json();
    const [nextCursor, keys] = body.result as [string, string[]];
    cursor = nextCursor;
    if (keys.length > 0) {
      await Promise.all(
        keys.map((k) => fetch(`${KV_URL}/del/${encodeURIComponent(k)}`, { headers }))
      );
      deleted += keys.length;
    }
  } while (cursor !== "0");
  return deleted;
}

// ---------------------------------------------------------------------------

let failures = 0;
function check(label: string, pass: boolean, detail?: string): void {
  if (pass) {
    console.log(`  OK   ${label}`);
  } else {
    failures++;
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  console.log(`Using isolated key namespace: ${KEY_PREFIX}:*`);
  const {
    writeAllListings,
    getAllListings,
    getListingBySlug,
    buildStorageChunks,
    estimateCachedResponseBytes,
    STORAGE_CHUNK_TARGET_BYTES,
  } = await import("../src/lib/kv/listings");
  const { slugify } = await import("../src/lib/utils");

  const fixtures = Array.from({ length: FIXTURE_COUNT }, (_, i) => makeFixture(i));

  // --- 1. Pure unit check: chunking stays under the byte target ----------
  console.log("\n[1/6] buildStorageChunks sizing (pure, no KV)");
  const chunks = buildStorageChunks(fixtures);
  const totalFromChunks = chunks.reduce((sum, c) => sum + c.length, 0);
  // Match the real Upstash GET response shape ({"result": "<escaped chunk
  // JSON>"}) that Next's fetch cache actually measures against its 2MB
  // ceiling — checking raw JSON.stringify(chunk).length here would pass
  // even for chunks that blow past 2MB once enveloped (this is the exact
  // bug that first shipped and had to be corrected — see
  // estimateCachedResponseBytes's doc comment in kv/listings.ts).
  const oversized = chunks.filter((c) => estimateCachedResponseBytes(JSON.stringify(c)) > 2_000_000);
  check("produces more than one chunk for 2,000 fixtures", chunks.length > 1, `got ${chunks.length}`);
  check("every chunk is under the 2MB cache ceiling (enveloped-size estimate)", oversized.length === 0, `${oversized.length} oversized`);
  check("chunks collectively contain all fixtures", totalFromChunks === FIXTURE_COUNT, `got ${totalFromChunks}`);
  console.log(`  (chunk target ${STORAGE_CHUNK_TARGET_BYTES.toLocaleString()} bytes, ${chunks.length} chunks produced)`);

  // --- 2. Write 2,000 fixtures through the real writeAllListings ---------
  console.log("\n[2/6] writeAllListings — initial write of 2,000 fixtures");
  const writeResult = await writeAllListings(fixtures, { keyPrefix: KEY_PREFIX });
  check("write not refused", !writeResult.refused, writeResult.refusedReason);
  check("written count matches", writeResult.written === FIXTURE_COUNT, `got ${writeResult.written}`);

  // --- 3. Round-trip read back, verify identical ---------------------------
  console.log("\n[3/6] getAllListings — round-trip read-back");
  const roundTrip = await getAllListings({ keyPrefix: KEY_PREFIX });
  check("read-back count matches", roundTrip.length === FIXTURE_COUNT, `got ${roundTrip.length}`);
  const identical = JSON.stringify(roundTrip) === JSON.stringify(fixtures);
  check("read-back content is byte-identical to what was written", identical);
  if (!identical && roundTrip.length === fixtures.length) {
    const diffIdx = fixtures.findIndex((f, i) => JSON.stringify(f) !== JSON.stringify(roundTrip[i]));
    if (diffIdx >= 0) console.error(`    first diff at index ${diffIdx}`);
  }

  // --- 4. Per-slug lookup --------------------------------------------------
  console.log("\n[4/6] getListingBySlug — per-slug lookup");
  const sampleIdxs = [0, 1, 500, 1000, 1999];
  for (const i of sampleIdxs) {
    const slug = slugify(fixtures[i].address);
    const found = await getListingBySlug(slug, { keyPrefix: KEY_PREFIX });
    check(`slug lookup for fixture #${i} (${slug})`, !!found && found.address === fixtures[i].address);
  }

  // --- 5. Floor guard -------------------------------------------------------
  console.log("\n[5/6] floor guard — refuses a >60% shrink, force bypasses it");
  const shrunk = fixtures.slice(0, 700); // 700 / 2000 = 35% < 40% floor
  const guardedResult = await writeAllListings(shrunk, { keyPrefix: KEY_PREFIX });
  check("floor guard refuses the shrink write", guardedResult.refused === true);
  const afterGuardedAttempt = await getAllListings({ keyPrefix: KEY_PREFIX });
  check("store still has 2,000 after refused write", afterGuardedAttempt.length === FIXTURE_COUNT, `got ${afterGuardedAttempt.length}`);

  const forcedResult = await writeAllListings(shrunk, { keyPrefix: KEY_PREFIX, force: true });
  check("force:true bypasses the floor guard", !forcedResult.refused && forcedResult.written === 700, JSON.stringify(forcedResult));
  const afterForced = await getAllListings({ keyPrefix: KEY_PREFIX });
  check("store now has 700 after forced shrink", afterForced.length === 700, `got ${afterForced.length}`);

  // --- 6. Shape validation catches garbage ----------------------------------
  console.log("\n[6/6] shape validation — corrupted data falls back to static, never throws");
  await rawSet(`${KEY_PREFIX}:index`, "not-json{{{"); // malformed JSON -> sharded read must throw+recover, not crash
  await rawSet(`${KEY_PREFIX}:all`, JSON.stringify([1, 2, 3])); // valid JSON, wrong shape (not Listing[])
  let garbageResult: Listing[] | null = null;
  let threw = false;
  try {
    garbageResult = await getAllListings({ keyPrefix: KEY_PREFIX });
  } catch {
    threw = true;
  }
  check("getAllListings never throws on corrupted data", !threw);
  check(
    "falls back to static data (not the [1,2,3] garbage)",
    !!garbageResult && garbageResult.every((l) => typeof l.address === "string"),
    JSON.stringify(garbageResult?.slice(0, 1))
  );

  // --- Cleanup ---------------------------------------------------------------
  console.log("\nCleaning up all test keys...");
  const deleted = await scanAndDelete(`${KEY_PREFIX}:*`);
  console.log(`Deleted ${deleted} keys under ${KEY_PREFIX}:*`);

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error("Test script crashed:", err);
  // Best-effort cleanup even on crash.
  try {
    await scanAndDelete(`${KEY_PREFIX}:*`);
  } catch {
    // ignore
  }
  process.exit(1);
});
