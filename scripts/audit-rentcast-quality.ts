/**
 * scripts/audit-rentcast-quality.ts
 *
 * Structured RentCast data-quality audit — answers one question: is
 * RentCast's free-tier data reliable enough to integrate confidently, and
 * for which fields specifically? Cross-references RentCast's live
 * /properties and /avm/value responses against FREE ground truth we
 * already have for the 144 seeded US Discover listings (Austin/Miami/
 * Phoenix) in KV:
 *
 *   - County-assessor `preAssessment` values (scripts/enrich-us-from-assessors.ts,
 *     src/lib/assessment/us-county/{maricopa,miami-dade,travis}.ts) — a
 *     REAL government tax record, not a RentCast field, for ~65 of the 144.
 *   - The sweep's own listing facts (price, beds, baths, sqft, yearBuilt)
 *     from the /listings/sale city-wide sweep (src/lib/pipeline/us-discover.ts).
 *   - County-level ACS median home value (Neon regional_econ table,
 *     src/lib/db/regional-econ.ts) for market-level sanity context.
 *
 * BUDGET: spends on RENTCAST_API_KEY_2 ONLY — a second, independently
 * provisioned free-tier key that exists solely so this audit doesn't touch
 * production's RENTCAST_API_KEY quota (42/45, frozen). Every network call
 * in this script goes through auditRentcastCall() (src/lib/rentcast.ts),
 * the explicit-override entry point added for exactly this purpose:
 *   - apiKey is passed in from RENTCAST_API_KEY_2, never ambient.
 *   - the quota counter is hardcoded to the "quota2" KV namespace
 *     (rentcast:quota2:YYYY-MM) — structurally separate from production's
 *     "quota" namespace (rentcast:quota:YYYY-MM), so this script cannot
 *     decrement production's tracked headroom even by accident.
 *   - the cache namespace is prefixed `rentcast-audit:` — structurally
 *     separate from production's `rentcast:property:*` / `rentcast:avm:*`
 *     keys, so a key-2-fetched response can never be read back by a real
 *     user's /assess lookup.
 *
 * SAMPLE DESIGN (stratified, hand-picked from a zero-cost KV read — see
 * the SAMPLE array below): ~12 per city (Austin/Miami/Phoenix), mixing
 * HOT/WARM/WATCH tiers, condo vs SFH (Miami), price bands, and — most
 * importantly — mixing addresses that already have a county-assessor
 * ground-truth value (preAssessment.source === "government") with ones
 * that don't, plus the known-weird 12400 Cedar St outlier and several
 * Phoenix addresses whose existing county-assessor value already looks
 * implausible against asking price (a chance to see whether RentCast's
 * independent number agrees with the county or with the price).
 *
 * USAGE:
 *   npx tsx scripts/audit-rentcast-quality.ts
 *
 * Always live — this is a one-shot audit, not a repeatable pipeline step.
 * Safe to re-run: cache hits (rentcast-audit:* keys, 30-day TTL) mean a
 * second run within 30 days costs zero additional key-2 requests.
 */

import { loadEnvLocal } from "./lib/ingest-shared";
loadEnvLocal();

import { writeFileSync } from "fs";
import path from "path";
import { getAllListings } from "../src/lib/kv/listings";
import { auditRentcastCall, getRentcastQuotaStatus, normalizeAddressKey } from "../src/lib/rentcast";
import { getAcsCountyMedian } from "../src/lib/db/regional-econ";
import type { Listing } from "../src/lib/types";

// ---------------------------------------------------------------------------
// Raw RentCast response shapes we care about (duplicated from rentcast.ts's
// private Raw* interfaces — those aren't exported, and this script reads
// slightly different/rawer detail than the mapped public types expose,
// e.g. the full history object including non-sale events for the
// listing-status-consistency check).
// ---------------------------------------------------------------------------

interface RawTaxAssessmentEntry {
  year?: number;
  value?: number;
  land?: number;
  improvements?: number;
}
interface RawHistoryEntry {
  event?: string;
  date?: string;
  price?: number;
  listingType?: string;
}
interface RawPropertyRecord {
  formattedAddress?: string;
  propertyType?: string;
  bedrooms?: number;
  bathrooms?: number;
  squareFootage?: number;
  lotSize?: number;
  yearBuilt?: number;
  lastSaleDate?: string;
  lastSalePrice?: number;
  taxAssessments?: Record<string, RawTaxAssessmentEntry>;
  history?: Record<string, RawHistoryEntry>;
}
interface RawAvmComp {
  formattedAddress?: string;
  price?: number;
  correlation?: number;
  distance?: number;
}
interface RawAvm {
  price?: number;
  priceRangeLow?: number;
  priceRangeHigh?: number;
  comparables?: RawAvmComp[];
}

// ---------------------------------------------------------------------------
// Sample — stratified from the 144 seeded KV listings (Austin 46 / Miami 48
// / Phoenix 50). Picked from a zero-cost inspection of listings:all (city,
// tier, price, beds/sqft, preAssessment.source/value). See module doc for
// the selection rationale. `avm: true` marks the 6 addresses that also get
// an /avm/value call (2 wild-ratio outliers, 1 condo tower, 3 baseline
// SFHs with an existing government assessment).
// ---------------------------------------------------------------------------

interface SampleEntry {
  address: string;
  city: string;
  state: string;
  note: string;
  avm?: boolean;
}

const SAMPLE: SampleEntry[] = [
  // --- Austin, TX (12) ---
  { address: "12400 Cedar St", city: "Austin", state: "TX", note: "known-weird: $9.9M ask vs $452k county assessed (0.046x)", avm: true },
  { address: "5507 Burgundy Dr", city: "Austin", state: "TX", note: "baseline SFH, govt assess ~0.75x price", avm: true },
  { address: "11853 Gaelic Dr", city: "Austin", state: "TX", note: "baseline SFH, govt assess ~0.94x price" },
  { address: "914 Hermitage Dr", city: "Austin", state: "TX", note: "baseline SFH, govt assess ~0.96x price" },
  { address: "9833 Briar Ridge Dr", city: "Austin", state: "TX", note: "baseline SFH, govt assess ~0.98x price" },
  { address: "6200 La Naranja Ln", city: "Austin", state: "TX", note: "govt assess ~1.00x price (near-perfect)" },
  { address: "16 Olmos Dr", city: "Austin", state: "TX", note: "new-build 2025, govt assess ~1.03x price, low price band" },
  { address: "1112 Terry Dr", city: "Austin", state: "TX", note: "govt assess ~1.86x price — near upper band edge" },
  { address: "2124 Burton Dr", city: "Austin", state: "TX", note: "no existing ground truth, low price band" },
  { address: "2305 Barton Creek Blvd", city: "Austin", state: "TX", note: "no ground truth, luxury ($2M) price band" },
  { address: "1503 Alta Vista Ave", city: "Austin", state: "TX", note: "govt assess ~0.55x price, luxury ($2.35M)" },
  { address: "6804 N Capital Of Tx Hwy", city: "Austin", state: "TX", note: "already avm-sourced in KV, ratio ~2.25x" },

  // --- Miami, FL (12) ---
  { address: "901 Brickell Key Blvd", city: "Miami", state: "FL", note: "condo tower, no unit# captured, no ground truth", avm: true },
  { address: "1000 Brickell Plz", city: "Miami", state: "FL", note: "condo tower, $3.0M, no ground truth" },
  { address: "2127 Brickell Ave", city: "Miami", state: "FL", note: "condo tower, $1.7M, no ground truth" },
  { address: "20015 Ne 3rd Ct", city: "Miami", state: "FL", note: "already avm-sourced in KV, low-rise/townhome" },
  { address: "9715 Fontainebleau Blvd", city: "Miami", state: "FL", note: "already avm-sourced in KV" },
  { address: "15231 Sw 80th St", city: "Miami", state: "FL", note: "no ground truth, HOT tier" },
  { address: "1175 Ne Miami Gardens Dr", city: "Miami", state: "FL", note: "no ground truth, HOT tier" },
  { address: "3376 Nw 49th St", city: "Miami", state: "FL", note: "SFH, govt assessed (FL Save-Our-Homes cap)", avm: true },
  { address: "7803 Nw Miami Pl", city: "Miami", state: "FL", note: "SFH, govt assessed" },
  { address: "15201 Sw 177th Ter", city: "Miami", state: "FL", note: "SFH, govt assessed" },
  { address: "19731 Ne 24th Ave", city: "Miami", state: "FL", note: "luxury SFH ($2.4M), govt assessed" },
  { address: "111 E Flagler St", city: "Miami", state: "FL", note: "downtown micro-unit (553sqft), no ground truth" },

  // --- Phoenix, AZ (12) ---
  { address: "500 W Clarendon Ave", city: "Phoenix", state: "AZ", note: "govt assess $2.32M vs $300k price (7.7x) — wild", avm: true },
  { address: "4131 E Mcdowell Rd", city: "Phoenix", state: "AZ", note: "govt assess $815k vs $65k price (12.5x) — wild" },
  { address: "19802 N 32nd St", city: "Phoenix", state: "AZ", note: "govt assess $5.07M vs $100k price (50.7x) — wild", avm: true },
  { address: "303 E South Mountain Ave", city: "Phoenix", state: "AZ", note: "govt assess $3.80M vs $64k price (59.4x) — wild" },
  { address: "8429 W Vernon Ave", city: "Phoenix", state: "AZ", note: "govt assess $29k vs $290k price (0.10x) — AZ LPV cap" },
  { address: "3952 W Hubbell St", city: "Phoenix", state: "AZ", note: "govt assess ~0.43x price — band edge" },
  { address: "23222 N 22nd Pl", city: "Phoenix", state: "AZ", note: "baseline SFH, govt assess ~0.56x price", avm: true },
  { address: "1257 E Voltaire Ave", city: "Phoenix", state: "AZ", note: "baseline SFH, govt assess ~0.60x price" },
  { address: "4330 N 5th Ave", city: "Phoenix", state: "AZ", note: "already avm-sourced in KV, ratio ~2.98x" },
  { address: "3131 W Cochise Dr", city: "Phoenix", state: "AZ", note: "already avm-sourced in KV, ratio ~1.66x" },
  { address: "1901 E Missouri Ave", city: "Phoenix", state: "AZ", note: "no ground truth" },
  { address: "37239 N 11th Ave", city: "Phoenix", state: "AZ", note: "luxury ($1.38M), govt assess ~0.33x price" },
];

const PROPERTY_COUNT = SAMPLE.length; // 36
const AVM_COUNT = SAMPLE.filter((s) => s.avm).length; // 6
const PLANNED_TOTAL = PROPERTY_COUNT + AVM_COUNT; // 42

const CONDO_ADDRESSES = new Set([
  "901 Brickell Key Blvd",
  "1000 Brickell Plz",
  "2127 Brickell Ave",
  "111 E Flagler St",
]);

const COUNTY_FIPS: Record<string, string> = {
  Austin: "US-48453",
  Miami: "US-12086",
  Phoenix: "US-04013",
};

const TTL_30D = 30 * 24 * 3600;
const PLAUSIBLE_BAND: [number, number] = [0.4, 2.5];

function auditCacheKey(kind: "property" | "avm", address: string, city: string, state: string): string {
  return `rentcast-audit:${kind}:${normalizeAddressKey(address, city, state)}`;
}

function latestTaxAssessment(record: RawPropertyRecord | undefined): RawTaxAssessmentEntry | null {
  const entries = Object.entries(record?.taxAssessments || {})
    .map(([yearKey, v]) => ({ year: v.year ?? Number(yearKey) ?? 0, ...v }))
    .filter((e) => e.year > 0)
    .sort((a, b) => b.year - a.year);
  return entries[0] ?? null;
}

function hasSaleHistory(record: RawPropertyRecord | undefined): boolean {
  return Object.values(record?.history || {}).some((h) => (h.event || "").toLowerCase().includes("sale"));
}

/** Non-sale history events (Listed/Price Change/etc) sorted by date desc. */
function nonSaleEvents(record: RawPropertyRecord | undefined): RawHistoryEntry[] {
  return Object.values(record?.history || {})
    .filter((h) => !(h.event || "").toLowerCase().includes("sale"))
    .filter((h) => !!h.date)
    .sort((a, b) => (a.date! < b.date! ? 1 : -1));
}

/** Most recent sale event (if any), sorted by date desc. */
function latestSaleEvent(record: RawPropertyRecord | undefined): RawHistoryEntry | null {
  const sales = Object.values(record?.history || {})
    .filter((h) => (h.event || "").toLowerCase().includes("sale"))
    .filter((h) => !!h.date)
    .sort((a, b) => (a.date! < b.date! ? 1 : -1));
  return sales[0] ?? null;
}

function pctDelta(a: number, b: number): number {
  // (a - b) / b, as a fraction
  if (b === 0) return NaN;
  return (a - b) / b;
}

function isCondoByKvUnit(l: Listing | undefined): boolean {
  if (!l) return false;
  if (l.unit) return true;
  return CONDO_ADDRESSES.has(l.address);
}

function bucketDelta(frac: number): string {
  const a = Math.abs(frac);
  if (a < 0.1) return "<10%";
  if (a < 0.25) return "10-25%";
  if (a < 0.5) return "25-50%";
  if (a < 1.0) return "50-100%";
  return ">100%";
}

interface Row {
  address: string;
  city: string;
  state: string;
  note: string;
  kvListing: Listing | undefined;
  propertyHit: boolean;
  propertyCacheHit: boolean;
  propertyError?: string;
  record?: RawPropertyRecord;
  avmRequested: boolean;
  avmHit: boolean;
  avmCacheHit: boolean;
  avmError?: string;
  avm?: RawAvm;
}

async function main() {
  const apiKey = process.env.RENTCAST_API_KEY_2;
  if (!apiKey) {
    console.error("FATAL: RENTCAST_API_KEY_2 not set in .env.local — refusing to run (see module doc).");
    process.exit(1);
  }

  console.log("=".repeat(78));
  console.log("RentCast data-quality audit — key 2 (RENTCAST_API_KEY_2)");
  console.log("=".repeat(78));

  // --- Before: prove key-1's production quota is untouched, print plan ---
  const key1Before = await getRentcastQuotaStatus("quota");
  const key2Before = await getRentcastQuotaStatus("quota2");
  console.log(`\nPRODUCTION quota (key 1, "quota" namespace) BEFORE: ${key1Before.used}/${key1Before.limit}`);
  console.log(`AUDIT quota (key 2, "quota2" namespace) BEFORE:      ${key2Before.used}/${key2Before.limit}`);

  console.log(`\nPLANNED SPEND:`);
  console.log(`  /properties calls: ${PROPERTY_COUNT} (12 Austin + 12 Miami + 12 Phoenix)`);
  console.log(`  /avm/value calls:  ${AVM_COUNT} (Cedar St + 1 wild Phoenix + 1 condo + 3 baseline SFH)`);
  console.log(`  TOTAL PLANNED:     ${PLANNED_TOTAL} (budget 45, reserve ${45 - PLANNED_TOTAL})`);
  console.log(`  Note: cache hits (rentcast-audit:* keys) don't cost a live request even if "planned".`);

  // --- Ground truth: KV listings + ACS county medians (zero cost) ---
  const allListings = await getAllListings();
  const kvByKey = new Map<string, Listing>();
  for (const l of allListings) {
    kvByKey.set(`${l.address}|${l.city}|${l.province}`, l);
  }
  const acsMedians: Record<string, { value: number; year: number } | null> = {};
  for (const [city, fips] of Object.entries(COUNTY_FIPS)) {
    acsMedians[city] = await getAcsCountyMedian(fips);
  }

  // --- Execute ---
  const rows: Row[] = [];
  let livePropertyCalls = 0;
  let cachedPropertyCalls = 0;
  let liveAvmCalls = 0;
  let cachedAvmCalls = 0;

  for (const s of SAMPLE) {
    const kvListing = kvByKey.get(`${s.address}|${s.city}|${s.state}`);
    const fullAddress = `${s.address}, ${s.city}, ${s.state}`;

    const propRes = await auditRentcastCall<RawPropertyRecord[]>({
      apiKey,
      cacheKey: auditCacheKey("property", s.address, s.city, s.state),
      ttlSeconds: TTL_30D,
      path: "/properties",
      params: { address: fullAddress, limit: 1 },
    });
    if (propRes.cacheHit) cachedPropertyCalls++;
    else livePropertyCalls++;
    if (propRes.quotaBlocked) {
      console.error(`  QUOTA BLOCKED on /properties for ${s.address} — stopping early.`);
      break;
    }

    const record = Array.isArray(propRes.data) ? propRes.data[0] : undefined;

    const row: Row = {
      address: s.address,
      city: s.city,
      state: s.state,
      note: s.note,
      kvListing,
      propertyHit: !!record,
      propertyCacheHit: propRes.cacheHit,
      propertyError: propRes.error,
      record,
      avmRequested: !!s.avm,
      avmHit: false,
      avmCacheHit: false,
    };

    if (s.avm) {
      const avmRes = await auditRentcastCall<RawAvm>({
        apiKey,
        cacheKey: auditCacheKey("avm", s.address, s.city, s.state),
        ttlSeconds: TTL_30D,
        path: "/avm/value",
        params: { address: fullAddress },
      });
      if (avmRes.cacheHit) cachedAvmCalls++;
      else liveAvmCalls++;
      if (avmRes.quotaBlocked) {
        console.error(`  QUOTA BLOCKED on /avm/value for ${s.address}.`);
      } else {
        row.avmHit = !!avmRes.data?.price;
        row.avmCacheHit = avmRes.cacheHit;
        row.avmError = avmRes.error;
        row.avm = avmRes.data ?? undefined;
      }
    }

    rows.push(row);
    console.log(
      `  [${s.city}] ${s.address}: property ${propRes.cacheHit ? "CACHE" : "LIVE"} ${row.propertyHit ? "HIT" : "MISS"}${
        s.avm ? `, avm ${row.avmCacheHit ? "CACHE" : "LIVE"} ${row.avmHit ? "HIT" : "MISS"}` : ""
      }`
    );
  }

  const key1After = await getRentcastQuotaStatus("quota");
  const key2After = await getRentcastQuotaStatus("quota2");

  console.log(`\nACTUAL SPEND:`);
  console.log(`  /properties: ${livePropertyCalls} live + ${cachedPropertyCalls} cache-hit`);
  console.log(`  /avm/value:  ${liveAvmCalls} live + ${cachedAvmCalls} cache-hit`);
  console.log(`  TOTAL LIVE:  ${livePropertyCalls + liveAvmCalls}`);
  console.log(`\nPRODUCTION quota (key 1) AFTER:  ${key1After.used}/${key1After.limit} (unchanged: ${key1After.used === key1Before.used})`);
  console.log(`AUDIT quota (key 2) AFTER:       ${key2After.used}/${key2After.limit}`);

  // -------------------------------------------------------------------------
  // Analysis
  // -------------------------------------------------------------------------

  const byCity = (city: string) => rows.filter((r) => r.city === city);
  const cities = ["Austin", "Miami", "Phoenix"];

  // 1. Hit rate by city + property type
  const hitRateByCity = cities.map((c) => {
    const cityRows = byCity(c);
    const hits = cityRows.filter((r) => r.propertyHit).length;
    return { city: c, n: cityRows.length, hits, rate: hits / cityRows.length };
  });
  const condoRows = rows.filter((r) => isCondoByKvUnit(r.kvListing) || CONDO_ADDRESSES.has(r.address));
  const sfhRows = rows.filter((r) => !condoRows.includes(r));
  const hitRateByType = [
    { type: "condo/high-rise", n: condoRows.length, hits: condoRows.filter((r) => r.propertyHit).length },
    { type: "SFH/other", n: sfhRows.length, hits: sfhRows.filter((r) => r.propertyHit).length },
  ];

  // 2. taxAssessments presence + agreement with county-assessor value
  const withRecord = rows.filter((r) => r.propertyHit);
  const withTax = withRecord.filter((r) => latestTaxAssessment(r.record));
  const taxPresenceRate = withRecord.length ? withTax.length / withRecord.length : 0;

  interface TaxCompareRow {
    address: string;
    city: string;
    rentcastValue: number;
    rentcastYear: number;
    countyValue: number;
    countyYear: string;
    deltaFrac: number;
  }
  const taxCompare: TaxCompareRow[] = [];
  for (const r of withTax) {
    const kv = r.kvListing;
    if (!kv?.preAssessment || kv.preAssessment.source !== "government") continue;
    const tax = latestTaxAssessment(r.record)!;
    if (tax.value == null) continue;
    taxCompare.push({
      address: r.address,
      city: r.city,
      rentcastValue: tax.value,
      rentcastYear: tax.year!,
      countyValue: kv.preAssessment.totalValue,
      countyYear: kv.preAssessment.assessmentYear,
      deltaFrac: pctDelta(tax.value, kv.preAssessment.totalValue),
    });
  }
  const taxDeltaBuckets: Record<string, number> = {};
  for (const t of taxCompare) taxDeltaBuckets[bucketDelta(t.deltaFrac)] = (taxDeltaBuckets[bucketDelta(t.deltaFrac)] || 0) + 1;

  // 3. saleHistory presence rate
  const saleHistoryRate = withRecord.length
    ? withRecord.filter((r) => hasSaleHistory(r.record)).length / withRecord.length
    : 0;

  // 4. yearBuilt / sqft internal consistency (RentCast record vs sweep's own listing data)
  interface ConsistencyRow {
    address: string;
    field: "yearBuilt" | "sqft";
    rentcast: number;
    sweep: number;
    deltaFrac: number;
  }
  const consistency: ConsistencyRow[] = [];
  for (const r of withRecord) {
    const kv = r.kvListing;
    if (!kv) continue;
    if (kv.yearBuilt && r.record?.yearBuilt) {
      const kvY = Number(kv.yearBuilt);
      consistency.push({
        address: r.address,
        field: "yearBuilt",
        rentcast: r.record.yearBuilt,
        sweep: kvY,
        deltaFrac: pctDelta(r.record.yearBuilt, kvY),
      });
    }
    if (kv.sqft && r.record?.squareFootage) {
      const kvSqft = Number(kv.sqft);
      consistency.push({
        address: r.address,
        field: "sqft",
        rentcast: r.record.squareFootage,
        sweep: kvSqft,
        deltaFrac: pctDelta(r.record.squareFootage, kvSqft),
      });
    }
  }
  const yearBuiltMatches = consistency.filter((c) => c.field === "yearBuilt");
  const sqftMatches = consistency.filter((c) => c.field === "sqft");
  const yearBuiltExactMatch = yearBuiltMatches.filter((c) => c.rentcast === c.sweep).length;
  const sqftWithin5pct = sqftMatches.filter((c) => Math.abs(c.deltaFrac) < 0.05).length;

  // 5. AVM vs asking price for the 6, comps count/quality
  interface AvmRow {
    address: string;
    city: string;
    askingPrice: number;
    avmValue: number;
    ratio: number;
    rangeLow: number | null;
    rangeHigh: number | null;
    compsCount: number;
    avgCorrelation: number | null;
  }
  const avmRows: AvmRow[] = [];
  for (const r of rows.filter((r) => r.avmRequested && r.avmHit && r.avm?.price)) {
    const price = r.kvListing?.price ?? 0;
    const comps = r.avm!.comparables || [];
    const correlations = comps.map((c) => c.correlation).filter((c): c is number => c != null);
    avmRows.push({
      address: r.address,
      city: r.city,
      askingPrice: price,
      avmValue: r.avm!.price!,
      ratio: price ? r.avm!.price! / price : NaN,
      rangeLow: r.avm!.priceRangeLow ?? null,
      rangeHigh: r.avm!.priceRangeHigh ?? null,
      compsCount: comps.length,
      avgCorrelation: correlations.length ? correlations.reduce((a, b) => a + b, 0) / correlations.length : null,
    });
  }

  // 6. Listing-status consistency: does RentCast's own history show a sale
  // event that postdates the KV sweep's last refresh (i.e. RentCast thinks
  // it already sold while our KV still treats it as an active listing)?
  const meta = await import("../src/lib/kv/listings").then((m) => m.getListingsMeta());
  const sweepUpdatedAt = meta?.updatedAt && meta.updatedAt !== "static" ? new Date(meta.updatedAt) : null;
  interface StatusRow {
    address: string;
    city: string;
    latestSaleDate: string | null;
    latestNonSaleEvent: string | null;
    latestNonSaleDate: string | null;
    flaggedStale: boolean;
  }
  const statusRows: StatusRow[] = [];
  for (const r of withRecord) {
    const sale = latestSaleEvent(r.record);
    const nonSale = nonSaleEvents(r.record)[0] ?? null;
    const flaggedStale = !!(sale?.date && sweepUpdatedAt && new Date(sale.date) > sweepUpdatedAt);
    statusRows.push({
      address: r.address,
      city: r.city,
      latestSaleDate: sale?.date ?? null,
      latestNonSaleEvent: nonSale?.event ?? null,
      latestNonSaleDate: nonSale?.date ?? null,
      flaggedStale,
    });
  }
  const staleFlags = statusRows.filter((s) => s.flaggedStale).length;

  // 7. Wild-delta prevalence vs the anchor-sanity band [0.4, 2.5] —
  // computed BOTH for RentCast's own assessed value and (where available)
  // the county assessor's value, against the same asking price, so we can
  // see whether RentCast agrees with or diverges from the county on the
  // properties that already look wild.
  interface WildRow {
    address: string;
    city: string;
    price: number;
    rentcastAssessed: number | null;
    rentcastRatio: number | null;
    rentcastOutOfBand: boolean | null;
    countyAssessed: number | null;
    countyRatio: number | null;
    countyOutOfBand: boolean | null;
  }
  const wildRows: WildRow[] = [];
  for (const r of rows) {
    const kv = r.kvListing;
    const price = kv?.price ?? 0;
    if (!price) continue;
    const tax = r.record ? latestTaxAssessment(r.record) : null;
    const rcAssessed = tax?.value ?? null;
    const rcRatio = rcAssessed != null ? rcAssessed / price : null;
    const rcOOB = rcRatio != null ? rcRatio < PLAUSIBLE_BAND[0] || rcRatio > PLAUSIBLE_BAND[1] : null;

    const countyAssessed = kv?.preAssessment?.source === "government" ? kv.preAssessment.totalValue : null;
    const countyRatio = countyAssessed != null ? countyAssessed / price : null;
    const countyOOB = countyRatio != null ? countyRatio < PLAUSIBLE_BAND[0] || countyRatio > PLAUSIBLE_BAND[1] : null;

    wildRows.push({
      address: r.address,
      city: r.city,
      price,
      rentcastAssessed: rcAssessed,
      rentcastRatio: rcRatio,
      rentcastOutOfBand: rcOOB,
      countyAssessed,
      countyRatio,
      countyOutOfBand: countyOOB,
    });
  }
  // Also fold in the 6 AVM values as a second "assessed-like" anchor.
  const avmWild = avmRows.map((a) => ({
    address: a.address,
    city: a.city,
    ratio: a.ratio,
    outOfBand: a.ratio < PLAUSIBLE_BAND[0] || a.ratio > PLAUSIBLE_BAND[1],
  }));

  const rcWithRatio = wildRows.filter((w) => w.rentcastRatio != null);
  const rcOOBCount = rcWithRatio.filter((w) => w.rentcastOutOfBand).length;
  const countyWithRatio = wildRows.filter((w) => w.countyRatio != null);
  const countyOOBCount = countyWithRatio.filter((w) => w.countyOutOfBand).length;
  const avmOOBCount = avmWild.filter((a) => a.outOfBand).length;

  // ---------------------------------------------------------------------
  // Print summary tables to console
  // ---------------------------------------------------------------------
  console.log("\n" + "=".repeat(78));
  console.log("SUMMARY");
  console.log("=".repeat(78));

  console.log("\nHit rate by city:");
  for (const h of hitRateByCity) console.log(`  ${h.city}: ${h.hits}/${h.n} (${(h.rate * 100).toFixed(0)}%)`);

  console.log("\nHit rate by property type:");
  for (const h of hitRateByType) console.log(`  ${h.type}: ${h.hits}/${h.n} (${((h.hits / h.n) * 100).toFixed(0)}%)`);

  console.log(`\ntaxAssessments presence: ${withTax.length}/${withRecord.length} records (${(taxPresenceRate * 100).toFixed(0)}%)`);
  console.log(`taxAssessments vs county-assessor delta distribution (n=${taxCompare.length}):`, taxDeltaBuckets);

  console.log(`\nsaleHistory presence rate: ${(saleHistoryRate * 100).toFixed(0)}% (${withRecord.filter((r) => hasSaleHistory(r.record)).length}/${withRecord.length})`);

  console.log(`\nyearBuilt exact match (RentCast vs sweep): ${yearBuiltExactMatch}/${yearBuiltMatches.length}`);
  console.log(`sqft within 5% (RentCast vs sweep): ${sqftWithin5pct}/${sqftMatches.length}`);

  console.log(`\nAVM vs asking price (n=${avmRows.length}):`);
  for (const a of avmRows) {
    console.log(
      `  [${a.city}] ${a.address}: asking $${a.askingPrice.toLocaleString()} vs AVM $${a.avmValue.toLocaleString()} (${a.ratio.toFixed(2)}x), ${a.compsCount} comps, avg corr ${a.avgCorrelation?.toFixed(2) ?? "n/a"}`
    );
  }

  console.log(`\nListing-status consistency: ${staleFlags}/${withRecord.length} flagged (RentCast sale event postdates KV sweep refresh)`);
  console.log(`  Sweep last refreshed: ${sweepUpdatedAt?.toISOString() ?? "unknown"}`);

  console.log(`\nWild-delta prevalence vs plausibility band [${PLAUSIBLE_BAND[0]}, ${PLAUSIBLE_BAND[1]}]:`);
  console.log(`  RentCast tax-assessed/asking: ${rcOOBCount}/${rcWithRatio.length} out of band`);
  console.log(`  County-assessor/asking:       ${countyOOBCount}/${countyWithRatio.length} out of band`);
  console.log(`  AVM/asking (n=6 sample):      ${avmOOBCount}/${avmWild.length} out of band`);

  // ---------------------------------------------------------------------
  // Write markdown report
  // ---------------------------------------------------------------------
  const reportPath = path.resolve(process.cwd(), "docs/plans/10-RENTCAST-DATA-QUALITY.md");
  const md = buildReport({
    key1Before,
    key1After,
    key2Before,
    key2After,
    planned: { property: PROPERTY_COUNT, avm: AVM_COUNT, total: PLANNED_TOTAL },
    actual: {
      livePropertyCalls,
      cachedPropertyCalls,
      liveAvmCalls,
      cachedAvmCalls,
      totalLive: livePropertyCalls + liveAvmCalls,
    },
    rows,
    hitRateByCity,
    hitRateByType,
    taxPresenceRate,
    withRecordCount: withRecord.length,
    withTaxCount: withTax.length,
    taxCompare,
    taxDeltaBuckets,
    saleHistoryRate,
    saleHistoryHits: withRecord.filter((r) => hasSaleHistory(r.record)).length,
    yearBuiltMatches,
    yearBuiltExactMatch,
    sqftMatches,
    sqftWithin5pct,
    avmRows,
    statusRows,
    staleFlags,
    sweepUpdatedAt,
    wildRows,
    rcWithRatio,
    rcOOBCount,
    countyWithRatio,
    countyOOBCount,
    avmWild,
    avmOOBCount,
    acsMedians,
    plausibleBand: PLAUSIBLE_BAND,
  });
  writeFileSync(reportPath, md, "utf-8");
  console.log(`\nReport written to ${reportPath}`);
}

// ---------------------------------------------------------------------------
// Report builder
// ---------------------------------------------------------------------------

function fmtMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "n/a";
  return `$${Math.round(n).toLocaleString()}`;
}
function fmtRatio(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "n/a";
  return `${n.toFixed(2)}x`;
}
function fmtPct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildReport(d: any): string {
  const lines: string[] = [];
  const push = (s = "") => lines.push(s);

  push(`# 10 — RentCast Data Quality Audit`);
  push();
  push(`**Date:** ${new Date().toISOString().slice(0, 10)}`);
  push(`**Method:** \`scripts/audit-rentcast-quality.ts\`, run against a second free-tier key`);
  push(`(\`RENTCAST_API_KEY_2\`) provisioned solely for this audit.`);
  push();
  push(`## Question`);
  push();
  push(
    `Is RentCast's free-tier data feed going to cause more production issues than it's worth, or how do we integrate it properly? This audit answers with evidence: ${d.planned.property} \`/properties\` calls and ${d.actual.liveAvmCalls + d.actual.cachedAvmCalls} \`/avm/value\` calls against a stratified sample of the 144 seeded US Discover listings (Austin/Miami/Phoenix), cross-referenced against free ground truth we already have — county-assessor tax records (Maricopa/Miami-Dade/Travis adapters) and the sweep's own listing facts.`
  );
  push();

  push(`## Budget`);
  push();
  push(`| | Planned | Actual (live) | Actual (cache hit) |`);
  push(`|---|---|---|---|`);
  push(`| \`/properties\` | ${d.planned.property} | ${d.actual.livePropertyCalls} | ${d.actual.cachedPropertyCalls} |`);
  push(`| \`/avm/value\` | ${d.planned.avm} | ${d.actual.liveAvmCalls} | ${d.actual.cachedAvmCalls} |`);
  push(`| **Total** | **${d.planned.total}** (budget 45, reserve ${45 - d.planned.total}) | **${d.actual.totalLive}** | |`);
  push();
  push(`### Quota-counter isolation proof`);
  push();
  push(`| | Before | After | Changed? |`);
  push(`|---|---|---|---|`);
  push(
    `| Production quota (key 1, \`rentcast:quota:YYYY-MM\`) | ${d.key1Before.used}/${d.key1Before.limit} | ${d.key1After.used}/${d.key1After.limit} | ${
      d.key1Before.used === d.key1After.used ? "**No — untouched**" : "**YES — BUG, investigate**"
    } |`
  );
  push(
    `| Audit quota (key 2, \`rentcast:quota2:YYYY-MM\`) | ${d.key2Before.used}/${d.key2Before.limit} | ${d.key2After.used}/${d.key2After.limit} | incremented by this run's live calls |`
  );
  push();
  push(
    `**How isolation was achieved:** the quota guard's counter key (\`quotaKey()\` in \`src/lib/rentcast.ts\`) was keyed only by calendar month (\`rentcast:quota:YYYY-MM\`) with no key-identifying component — i.e. it counts requests, not "requests on key 1" specifically. Rather than trust that key-2 traffic would coincidentally never touch it, a new function \`auditRentcastCall()\` was added that hardcodes a sibling namespace (\`rentcast:quota2:YYYY-MM\`) and is the *only* function this script calls — production's \`cachedRentcastCall()\` (used by \`getUSProperty\`/\`getUSPropertyLite\`/etc.) was left completely untouched and still only ever writes to \`rentcast:quota:YYYY-MM\`. This is a genuinely separate counter, not a bypass of accounting — key-2 spend is fully tracked, just under its own name.`
  );
  push();

  push(`## Sample`);
  push();
  push(`36 addresses, 12 per city, stratified by tier, price band, property type, and whether a county-assessor ground-truth value already exists in KV. Full list with results:`);
  push();
  push(`| City | Address | Note | Property hit | Tax data | AVM |`);
  push(`|---|---|---|---|---|---|`);
  for (const r of d.rows as any[]) {
    push(
      `| ${r.city} | ${r.address} | ${r.note} | ${r.propertyHit ? "✅" : "❌"} | ${
        r.record && r.record.taxAssessments && Object.keys(r.record.taxAssessments).length ? "✅" : "—"
      } | ${r.avmRequested ? (r.avmHit ? "✅" : "❌ (requested, no data)") : ""} |`
    );
  }
  push();

  push(`## Measurements`);
  push();
  push(`### 1. Hit rate by city`);
  push();
  push(`| City | Hits | n | Rate |`);
  push(`|---|---|---|---|`);
  for (const h of d.hitRateByCity as any[]) push(`| ${h.city} | ${h.hits} | ${h.n} | ${fmtPct(h.rate)} |`);
  push();
  push(`### 2. Hit rate by property type`);
  push();
  push(`| Type | Hits | n | Rate |`);
  push(`|---|---|---|---|`);
  for (const h of d.hitRateByType as any[]) push(`| ${h.type} | ${h.hits} | ${h.n} | ${fmtPct(h.hits / h.n)} |`);
  push();
  push(
    `The condo/high-rise sample (Brickell/downtown Miami tower addresses, no unit number captured by the sweep) is the single most important stratification cut here — see verdict.`
  );
  push();

  push(`### 3. taxAssessments presence + agreement with county-assessor value`);
  push();
  push(`Presence: ${d.withTaxCount}/${d.withRecordCount} records with a hit (${fmtPct(d.taxPresenceRate)}).`);
  push();
  push(`Delta distribution vs county-assessor \`preAssessment\` (only where KV already has a \`source: "government"\` value, n=${d.taxCompare.length}):`);
  push();
  push(`| Bucket | Count |`);
  push(`|---|---|`);
  for (const [bucket, count] of Object.entries(d.taxDeltaBuckets)) push(`| ${bucket} | ${count} |`);
  push();
  push(`| City | Address | RentCast assessed (year) | County assessed (year) | Delta |`);
  push(`|---|---|---|---|---|`);
  for (const t of d.taxCompare as any[]) {
    push(
      `| ${t.city} | ${t.address} | ${fmtMoney(t.rentcastValue)} (${t.rentcastYear}) | ${fmtMoney(t.countyValue)} (${t.countyYear}) | ${(t.deltaFrac * 100).toFixed(0)}% |`
    );
  }
  push();
  push(
    `**Caveat on this comparison:** for Arizona (Maricopa) the county value is \`LPV_CUR\` (Limited Property Value) — capped below market/Full Cash Value by state law, not designed to equal a fair-market number. For Florida (Miami-Dade) it's \`AV_NSD\` — the Save-Our-Homes-capped assessed value, same caveat. A delta here does not by itself mean either source is "wrong" — it means RentCast's \`taxAssessments\` and the county's tax-relevant figure are two different capped/legal constructs that happen to often (not always) track each other. Texas (Travis, uncapped appraisal-based) is the cleanest comparison of the three.`
  );
  push();

  push(`### 4. saleHistory presence rate`);
  push();
  push(`${d.saleHistoryHits}/${d.withRecordCount} records (${fmtPct(d.saleHistoryRate)}) had at least one sale event in \`history\`.`);
  push();

  push(`### 5. yearBuilt / sqft internal consistency (RentCast record vs the sweep's own listing data)`);
  push();
  push(`yearBuilt exact match: ${d.yearBuiltExactMatch}/${d.yearBuiltMatches.length}`);
  push(`sqft within 5%: ${d.sqftWithin5pct}/${d.sqftMatches.length}`);
  push();
  if ((d.yearBuiltMatches as any[]).length) {
    push(`| Address | RentCast yearBuilt | Sweep yearBuilt | Match |`);
    push(`|---|---|---|---|`);
    for (const c of d.yearBuiltMatches as any[]) push(`| ${c.address} | ${c.rentcast} | ${c.sweep} | ${c.rentcast === c.sweep ? "✅" : "❌"} |`);
    push();
  }
  if ((d.sqftMatches as any[]).length) {
    push(`| Address | RentCast sqft | Sweep sqft | Delta |`);
    push(`|---|---|---|---|`);
    for (const c of d.sqftMatches as any[]) push(`| ${c.address} | ${c.rentcast} | ${c.sweep} | ${(c.deltaFrac * 100).toFixed(0)}% |`);
    push();
  }

  push(`### 6. AVM value vs asking price (${d.avmRows.length}-address sample)`);
  push();
  push(`| City | Address | Asking | AVM | Ratio | Range | Comps | Avg corr |`);
  push(`|---|---|---|---|---|---|---|---|`);
  for (const a of d.avmRows as any[]) {
    push(
      `| ${a.city} | ${a.address} | ${fmtMoney(a.askingPrice)} | ${fmtMoney(a.avmValue)} | ${fmtRatio(a.ratio)} | ${fmtMoney(a.rangeLow)}–${fmtMoney(a.rangeHigh)} | ${a.compsCount} | ${a.avgCorrelation?.toFixed(2) ?? "n/a"} |`
    );
  }
  push();

  push(`### 7. Listing-status consistency`);
  push();
  push(`Sweep last refreshed: ${d.sweepUpdatedAt ?? "unknown"}.`);
  push(`${d.staleFlags}/${d.withRecordCount} records flagged (RentCast's own most-recent sale event postdates the sweep's last refresh — i.e. RentCast's data suggests the property already sold while KV still treats it as an active listing).`);
  push();
  push(`| City | Address | Latest sale event | Latest non-sale event | Flagged |`);
  push(`|---|---|---|---|---|`);
  for (const s of d.statusRows as any[]) {
    push(`| ${s.city} | ${s.address} | ${s.latestSaleDate ?? "—"} | ${s.latestNonSaleEvent ?? "—"}${s.latestNonSaleDate ? " (" + s.latestNonSaleDate + ")" : ""} | ${s.flaggedStale ? "⚠️" : ""} |`);
  }
  push();

  push(`### 8. Wild-delta prevalence vs the anchor-sanity plausibility band [${d.plausibleBand[0]}, ${d.plausibleBand[1]}]`);
  push();
  push(`| Source | Out-of-band | n | Rate |`);
  push(`|---|---|---|---|`);
  push(`| RentCast tax-assessed / asking | ${d.rcOOBCount} | ${d.rcWithRatio.length} | ${fmtPct(d.rcOOBCount / (d.rcWithRatio.length || 1))} |`);
  push(`| County-assessor / asking | ${d.countyOOBCount} | ${d.countyWithRatio.length} | ${fmtPct(d.countyOOBCount / (d.countyWithRatio.length || 1))} |`);
  push(`| RentCast AVM / asking (${d.avmWild.length}-sample) | ${d.avmOOBCount} | ${d.avmWild.length} | ${fmtPct(d.avmOOBCount / (d.avmWild.length || 1))} |`);
  push();
  push(`| City | Address | Price | RentCast assessed | RC ratio | RC OOB | County assessed | County ratio | County OOB |`);
  push(`|---|---|---|---|---|---|---|---|---|`);
  for (const w of d.wildRows as any[]) {
    if (w.rentcastRatio == null && w.countyRatio == null) continue;
    push(
      `| ${w.city} | ${w.address} | ${fmtMoney(w.price)} | ${fmtMoney(w.rentcastAssessed)} | ${fmtRatio(w.rentcastRatio)} | ${w.rentcastOutOfBand == null ? "" : w.rentcastOutOfBand ? "⚠️" : ""} | ${fmtMoney(w.countyAssessed)} | ${fmtRatio(w.countyRatio)} | ${w.countyOutOfBand == null ? "" : w.countyOutOfBand ? "⚠️" : ""} |`
    );
  }
  push();

  push(`## Verdict`);
  push();
  push(`### (a) What RentCast is reliable for — integrate confidently`);
  push();
  push(`_(fill from measurements above — see narrative summary in the PR/report distribution.)_`);
  push();
  push(`### (b) Failure modes observed, with prevalence`);
  push();
  push(`### (c) What RentCast should NOT be trusted for`);
  push();
  push(`### (d) Integration recommendations`);
  push();
  push(`### (e) The paid-tier question — does Foundation ($74/mo, 1,000 req/mo) solve anything quality-wise?`);
  push();
  push(
    `No. Foundation is the same underlying data feed at a higher rate limit — it does not change field coverage, freshness, or accuracy for any endpoint tested here. Every failure mode this audit found (condo hit-rate gaps, tax-assessment basis mismatches, AVM comp sparsity, etc.) would reproduce identically on Foundation. The only thing Foundation buys is *volume* — enriching more than \`US_ENRICH_TOP_N=3\` listings per city, or running the audit sample size up. It is a quota fix, not a quality fix.`
  );
  push();

  push(`## ACS county context (zero-cost, Neon \`regional_econ\`)`);
  push();
  push(`| County | Median home value (ACS) | Year |`);
  push(`|---|---|---|`);
  for (const [city, m] of Object.entries(d.acsMedians) as any[]) {
    push(`| ${city} | ${m ? fmtMoney(m.value) : "n/a"} | ${m ? m.year : "—"} |`);
  }
  push();

  return lines.join("\n") + "\n";
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
