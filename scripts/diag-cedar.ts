// Phase 1 diagnostics — zero RentCast quota. Reads KV only.
// Usage: npx tsx scripts/diag-cedar.ts
import { loadEnvLocal } from "./lib/ingest-shared";
import type { Listing } from "../src/lib/types";

loadEnvLocal();

function normalizeAddressKey(address: string, city: string, state: string): string {
  return `${address}|${city}|${state}`
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9|]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

(async () => {
  const url = process.env.KV_REST_API_URL!;
  const token = process.env.KV_REST_API_TOKEN!;
  const headers = { Authorization: `Bearer ${token}` };

  const r = (await (await fetch(`${url}/GET/listings:all`, { headers })).json()) as { result: string };
  const listings = JSON.parse(r.result) as Listing[];
  console.log(`Total listings in KV: ${listings.length}`);

  const cedar = listings.filter((l) => l.address.toLowerCase().includes("cedar"));
  console.log(`\n=== Listings matching "cedar" (${cedar.length}) ===`);
  for (const l of cedar) {
    console.log(JSON.stringify(l, null, 2));
  }

  // SCAN rentcast:* for cedar-related keys
  console.log(`\n=== SCAN rentcast:* matching cedar ===`);
  let cursor = "0";
  const cedarKeys: string[] = [];
  do {
    const res = await fetch(`${url}/scan/${cursor}/match/rentcast:*/count/500`, { headers });
    const body = (await res.json()) as { result: [string, string[]] };
    const [next, keys] = body.result;
    cursor = next;
    for (const k of keys) if (k.toLowerCase().includes("cedar")) cedarKeys.push(k);
  } while (cursor !== "0");
  console.log(cedarKeys);

  for (const k of cedarKeys) {
    const res = await fetch(`${url}/get/${encodeURIComponent(k)}`, { headers });
    const body = (await res.json()) as { result: string };
    console.log(`\n--- ${k} ---`);
    console.log(body.result?.slice(0, 2000));
  }

  console.log(`\n=== Compute expected assess-time cache key for "12400 Cedar St","Austin","TX" ===`);
  console.log(normalizeAddressKey("12400 Cedar St", "Austin", "TX"));

  console.log(`\n=== us-discover last-refresh timestamps ===`);
  for (const slug of ["austin", "miami", "phoenix"]) {
    const res = await fetch(`${url}/get/${encodeURIComponent(`us-discover:last-refresh:${slug}`)}`, { headers });
    const body = (await res.json()) as { result: string | null };
    const ts = body.result ? Number(body.result) : null;
    console.log(slug, ts ? new Date(ts).toISOString() : "never", ts ? `(${Math.round((Date.now() - ts) / 86400000)}d ago)` : "");
  }

  console.log(`\n=== RentCast quota ===`);
  const now = new Date();
  const qkey = `rentcast:quota:${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const qres = await fetch(`${url}/get/${encodeURIComponent(qkey)}`, { headers });
  const qbody = (await qres.json()) as { result: string | null };
  console.log(qkey, "=", qbody.result);
})();

(async () => {
  const url = process.env.KV_REST_API_URL!;
  const token = process.env.KV_REST_API_TOKEN!;
  const headers = { Authorization: `Bearer ${token}` };
  console.log("\n=== property/avm cache + TTLs for 12400 Cedar St ===");
  for (const kind of ["property", "avm", "listing"]) {
    const key = `rentcast:${kind}:12400-cedar-st|austin|tx`;
    const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, { headers });
    const body = (await res.json()) as { result: string | null };
    const ttlRes = await fetch(`${url}/ttl/${encodeURIComponent(key)}`, { headers });
    const ttlBody = (await ttlRes.json()) as { result: number };
    console.log(`${key}: present=${body.result !== null} ttl=${ttlBody.result}s`);
    if (body.result) console.log("  value:", body.result.slice(0, 500));
  }
})();
