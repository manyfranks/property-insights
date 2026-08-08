// Phase 1d — zero quota. DOM/listedDate staleness distribution across all
// cached US listings (province in TX/FL/AZ = the 3 US_DISCOVER_CITIES states).
// Usage: npx tsx scripts/diag-staleness.ts
import { loadEnvLocal } from "./lib/ingest-shared";
import type { Listing } from "../src/lib/types";

loadEnvLocal();

(async () => {
  const url = process.env.KV_REST_API_URL!;
  const token = process.env.KV_REST_API_TOKEN!;
  const headers = { Authorization: `Bearer ${token}` };

  const r = (await (await fetch(`${url}/GET/listings:all`, { headers })).json()) as { result: string };
  const listings = JSON.parse(r.result) as Listing[];
  const us = listings.filter((l) => ["TX", "FL", "AZ"].includes(l.province));
  console.log(`US listings: ${us.length} / ${listings.length} total`);

  // DOM distribution
  const domBuckets = { "<30": 0, "30-89": 0, "90-179": 0, "180-299": 0, ">=300": 0 };
  for (const l of us) {
    const d = l.dom;
    if (d < 30) domBuckets["<30"]++;
    else if (d < 90) domBuckets["30-89"]++;
    else if (d < 180) domBuckets["90-179"]++;
    else if (d < 300) domBuckets["180-299"]++;
    else domBuckets[">=300"]++;
  }
  console.log("\nDOM distribution:", domBuckets);

  // sweep/enrichedAt dates present
  const enrichedDates = us.map((l) => l.enrichedAt).filter(Boolean).sort();
  console.log("\nenrichedAt range:", enrichedDates[0], "to", enrichedDates[enrichedDates.length - 1]);
  const bySource = us.reduce<Record<string, number>>((acc, l) => {
    const s = l.source || "unknown";
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});
  console.log("by source:", bySource);

  // DOM >= 300 detail
  const high = us.filter((l) => l.dom >= 300);
  console.log(`\n=== DOM >= 300 (${high.length}) ===`);
  for (const l of high) {
    console.log(`${l.address}, ${l.city}, ${l.province} | dom=${l.dom} price=${l.price} priceReduced=${l.priceReduced} enrichedAt=${l.enrichedAt} source=${l.source}`);
  }

  // Cross-check against RentCast's own listedDate via cached rentcast:listing:* keys
  // (SCAN, zero quota) to compute listedDate age vs sweep date precisely.
  console.log("\n=== Cross-check listedDate vs lastSeenDate/sweep for DOM>=250 listings ===");
  let cursor = "0";
  const listingKeys: string[] = [];
  do {
    const res = await fetch(`${url}/scan/${cursor}/match/rentcast:listing:*/count/500`, { headers });
    const body = (await res.json()) as { result: [string, string[]] };
    cursor = body.result[0];
    listingKeys.push(...body.result[1]);
  } while (cursor !== "0");
  console.log(`Total rentcast:listing:* cache keys: ${listingKeys.length}`);

  let exactYearOld = 0;
  let domGE300 = 0;
  let domGE300NoRecentPriceEvent = 0;
  const detail: string[] = [];
  for (const key of listingKeys) {
    const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, { headers });
    const body = (await res.json()) as { result: string | null };
    if (!body.result) continue;
    let parsed: any;
    try {
      parsed = JSON.parse(body.result);
    } catch {
      continue;
    }
    const raw = parsed?.v?.[0];
    if (!raw) continue;
    const listedDate = raw.listedDate ? new Date(raw.listedDate) : null;
    const lastSeenDate = raw.lastSeenDate ? new Date(raw.lastSeenDate) : null;
    const dom = raw.daysOnMarket ?? 0;
    if (dom >= 300) domGE300++;
    if (listedDate && lastSeenDate) {
      const ageDays = Math.round((lastSeenDate.getTime() - listedDate.getTime()) / 86400000);
      const isExactYear = Math.abs(ageDays - 365) <= 3;
      if (isExactYear) exactYearOld++;
      const historyEntries = Object.values(raw.history || {}) as any[];
      const hasRecentPriceEvent = historyEntries.some((h) => {
        const hd = h.date ? new Date(h.date) : (h.listedDate ? new Date(h.listedDate) : null);
        return hd && (Date.now() - hd.getTime()) / 86400000 < 180;
      });
      if (dom >= 300 && !hasRecentPriceEvent) domGE300NoRecentPriceEvent++;
      if (dom >= 250 || isExactYear) {
        detail.push(
          `${raw.addressLine1}, ${raw.city}, ${raw.state} | dom=${dom} listedDate=${raw.listedDate} lastSeenDate=${raw.lastSeenDate} ageDays=${ageDays} status=${raw.status} historyEvents=${historyEntries.length} hasRecentPriceEvent=${hasRecentPriceEvent}`
        );
      }
    }
  }
  console.log(`\nlistedDate ~365d before lastSeenDate (±3d): ${exactYearOld} / ${listingKeys.length}`);
  console.log(`DOM >= 300: ${domGE300} / ${listingKeys.length}`);
  console.log(`DOM >= 300 AND no price/history event in last 180d: ${domGE300NoRecentPriceEvent}`);
  console.log("\nDetail (DOM>=250 or ~365d old):");
  for (const d of detail) console.log(" ", d);
})();
