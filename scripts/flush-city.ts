/**
 * Flush all listings for a given city from KV.
 *
 * Usage: npx tsx scripts/flush-city.ts "Victoria"
 */

import { readFileSync } from "fs";
import { resolve } from "path";

// Load .env.local manually (no dotenv dependency)
try {
  const envFile = readFileSync(resolve(process.cwd(), ".env.local"), "utf-8");
  for (const line of envFile.split("\n")) {
    const match = line.match(/^([A-Z_]+)=(.+)$/);
    if (match) process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
} catch {}

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

if (!KV_URL || !KV_TOKEN) {
  console.error("Missing KV_REST_API_URL or KV_REST_API_TOKEN");
  process.exit(1);
}

const city = process.argv[2];
if (!city) {
  console.error("Usage: npx tsx scripts/flush-city.ts <city>");
  process.exit(1);
}

const headers: HeadersInit = {
  Authorization: `Bearer ${KV_TOKEN}`,
  "Content-Type": "application/json",
};

async function kvGet(key: string): Promise<unknown> {
  const res = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, { headers });
  if (!res.ok) return null;
  const body = await res.json();
  return body.result;
}

async function kvSet(key: string, value: unknown): Promise<void> {
  const path = ["set", key, JSON.stringify(value)].map(encodeURIComponent).join("/");
  await fetch(`${KV_URL}/${path}`, { headers });
}

async function kvDel(key: string): Promise<void> {
  await fetch(`${KV_URL}/del/${encodeURIComponent(key)}`, { headers });
}

function slugify(address: string): string {
  return address
    .toLowerCase()
    .replace(/[#,\.]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function main() {
  console.log(`Flushing all "${city}" listings from KV...`);

  const raw = await kvGet("listings:all");
  let all: any[] = [];
  if (typeof raw === "string") all = JSON.parse(raw);
  else if (Array.isArray(raw)) all = raw;

  const toRemove = all.filter((l: any) => l.city === city);
  const toKeep = all.filter((l: any) => l.city !== city);

  if (toRemove.length === 0) {
    console.log(`No listings found for "${city}".`);
    return;
  }

  console.log(`Found ${toRemove.length} listings to remove:`);
  for (const l of toRemove) {
    console.log(`  - ${l.address} (${l.preTier || "no tier"})`);
  }

  // Delete slug keys for removed listings
  const slugDeletes = toRemove.map((l: any) => kvDel(`listings:by-slug:${slugify(l.address)}`));
  await Promise.all(slugDeletes);
  console.log(`Deleted ${toRemove.length} slug keys`);

  // Write back filtered list + meta
  const cities = [...new Set(toKeep.map((l: any) => l.city))];
  await Promise.all([
    kvSet("listings:all", toKeep),
    kvSet("listings:meta", {
      count: toKeep.length,
      cities,
      updatedAt: new Date().toISOString(),
    }),
  ]);

  console.log(`Done. ${toKeep.length} listings remain (was ${all.length}).`);
  console.log(`Cities: ${cities.join(", ")}`);
}

main().catch(console.error);
