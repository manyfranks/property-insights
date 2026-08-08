// One-off: collapse duplicate US listings already in KV using the normalized
// dedup key (the merge-path fix prevents new ones; this cleans current state).
// Keeps the richest entry (narrative > assessment > yearBuilt).
// Usage: npx tsx scripts/dedupe-us-kv.ts
import { loadEnvLocal } from "./lib/ingest-shared";
import { buildUsListingDedupKey } from "../src/lib/pipeline/dedup";
import type { Listing } from "../src/lib/types";

loadEnvLocal();

(async () => {
  const url = process.env.KV_REST_API_URL!;
  const token = process.env.KV_REST_API_TOKEN!;
  const headers = { Authorization: `Bearer ${token}` };
  const r = (await (await fetch(`${url}/GET/listings:all`, { headers })).json()) as { result: string };
  const listings = JSON.parse(r.result) as Listing[];
  const isUS = (l: Listing) => ["TX", "FL", "AZ"].includes(l.province);
  const richness = (x: Listing) =>
    (x.preNarrative ? 4 : 0) + (x.preAssessment ? 2 : 0) + (x.yearBuilt ? 1 : 0);

  const seen = new Map<string, number>(); // key -> index in out
  const out: Listing[] = [];
  let dropped = 0;
  for (const l of listings) {
    if (!isUS(l)) {
      out.push(l);
      continue;
    }
    const key = buildUsListingDedupKey(l.address, l.city, l.province);
    const prevIdx = seen.get(key);
    if (prevIdx === undefined) {
      seen.set(key, out.length);
      out.push(l);
      continue;
    }
    dropped++;
    if (richness(l) > richness(out[prevIdx])) out[prevIdx] = l;
  }
  console.log(`total: ${listings.length} -> ${out.length} | dropped US duplicates: ${dropped}`);
  // Write through the app's own store (correct encoding + slug/meta keys kept
  // in sync). NEVER write listings:all via the raw REST path — a hand-rolled
  // SET here once double-encoded the value and 500'd the whole site.
  const { writeAllListings, getAllListings } = await import("../src/lib/kv/listings");
  const { written } = await writeAllListings(out);
  const roundTrip = await getAllListings();
  if (!Array.isArray(roundTrip) || roundTrip.length !== out.length) {
    throw new Error(`round-trip verification failed: expected ${out.length}, got ${Array.isArray(roundTrip) ? roundTrip.length : typeof roundTrip}`);
  }
  console.log(`KV write OK: ${written} listings, round-trip verified through getAllListings()`);
})();
