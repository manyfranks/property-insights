/**
 * Seed Vercel KV with all preloaded listings.
 *
 * Usage: npx tsx scripts/seed-kv.ts
 *
 * Requires KV_REST_API_URL and KV_REST_API_TOKEN in .env.local
 */

import { readFileSync } from "fs";
const envContent = readFileSync(".env.local", "utf-8");
for (const line of envContent.split("\n")) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, "");
}

import { PRELOADED_LISTINGS } from "../src/lib/data/listings";
import { writeAllListings, getListingsMeta } from "../src/lib/kv/listings";

async function main() {
  console.log(`Seeding KV with ${PRELOADED_LISTINGS.length} listings...`);

  // Deduplicate by address (remove the known duplicate)
  const seen = new Map<string, number>();
  const deduped = PRELOADED_LISTINGS.filter((l) => {
    const key = l.address.toLowerCase();
    const count = (seen.get(key) || 0) + 1;
    seen.set(key, count);
    return count === 1;
  });

  const dupeCount = PRELOADED_LISTINGS.length - deduped.length;
  if (dupeCount > 0) {
    console.log(`Removed ${dupeCount} duplicate(s)`);
  }

  const result = await writeAllListings(deduped);
  console.log(`Written: ${result.written} listings, ${result.slugs} slug entries`);

  const meta = await getListingsMeta();
  console.log("Meta:", JSON.stringify(meta, null, 2));
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
