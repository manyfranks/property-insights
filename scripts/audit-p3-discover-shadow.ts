/**
 * Zero-provider-call P3.5 replay over persisted Discover listings.
 *
 * The script permits reads only from the configured KV REST host. Any
 * RentCast, county, geocoder, Zoocasa, or other network request hard-fails.
 * It never writes listings or shadow results.
 *
 * Run: npx tsx scripts/audit-p3-discover-shadow.ts [reviewSample=20] [seed]
 */

import { loadEnvLocal } from "./lib/ingest-shared";
loadEnvLocal();

import { getAllListings } from "../src/lib/kv/listings";
import { createPropertyEvidenceSnapshot, type AvailableEvidence } from "../src/lib/property-intelligence/evidence";
import { classifyProperty } from "../src/lib/property-intelligence/classification";
import {
  evaluatePropertyCapabilities,
  type CapabilityScope,
} from "../src/lib/property-intelligence/capabilities";
import { resolveAssessmentSubject } from "../src/lib/property-intelligence/subject";
import type { Listing } from "../src/lib/types";

const REVIEW_SAMPLE = Number(process.argv[2]) || 20;
const SEED = Number(process.argv[3]) || 20260811;
const kvBase = process.env.KV_REST_API_URL?.replace(/\/$/, "") ?? "";
const originalFetch = global.fetch;
let kvReads = 0;
let providerCalls = 0;

global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (kvBase && url.startsWith(kvBase)) {
    kvReads += 1;
    return originalFetch(input, init);
  }
  providerCalls += 1;
  throw new Error(`P3.5 replay blocked non-KV network request: ${new URL(url).hostname}`);
}) as typeof fetch;

const US_STATES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN",
  "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV",
  "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN",
  "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC",
]);

function mulberry32(seed: number) {
  return () => {
    let t = seed += 0x6d2b79f5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function increment(target: Record<string, number>, key: string) {
  target[key] = (target[key] ?? 0) + 1;
}

function capabilityScope(
  listing: Listing,
  listingScope: string
): CapabilityScope {
  if (listing.unit || listingScope === "unit") return "unit";
  if (listingScope === "whole building") return "building";
  if (listingScope === "parcel") return "parcel";
  return "unknown";
}

function hasSplit(listing: Listing): boolean {
  const evidence = listing.propertyEvidence;
  if (!evidence) return false;
  const lands = evidence.landValues.filter(
    (item): item is AvailableEvidence<number> => item.availability === "available"
  );
  const buildings = evidence.buildingValues.filter(
    (item): item is AvailableEvidence<number> => item.availability === "available"
  );
  return lands.some((land) => buildings.some((building) =>
    building.source === land.source && building.sourceRecordId === land.sourceRecordId
  ));
}

async function quotaValue(): Promise<string> {
  if (!kvBase) return "local-no-kv";
  const now = new Date();
  const key = `rentcast:quota:${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const headers = { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` };
  const response = await global.fetch(`${kvBase}/GET/${encodeURIComponent(key)}`, { headers });
  const body = await response.json() as { result: string | null };
  return body.result ?? "0";
}

async function main() {
const quotaBefore = await quotaValue();
const listings = await getAllListings();
const rows = listings.map((listing) => {
  const stateOrProvince = listing.province.toUpperCase();
  const country = US_STATES.has(stateOrProvince) ? "US" as const : "CA" as const;
  const persistedEvidence = listing.propertyEvidence;
  const surface = persistedEvidence?.surface ?? (country === "US" ? "discover_seed" : "canada_listing");
  const evidence = persistedEvidence ?? createPropertyEvidenceSnapshot({
    surface,
    normalizedAddress: listing.address,
    parsedUnit: listing.unit,
  });
  const subject = listing.assessmentSubject ?? resolveAssessmentSubject({
    rawInput: listing.unit ? `${listing.address} Unit ${listing.unit}` : listing.address,
    normalizedAddress: listing.address,
    parsedUnit: listing.unit,
    listing: {
      address: listing.address,
      unit: listing.unit,
      source: country === "US" ? "rentcast_listing" : "zoocasa_listing",
      sourceRecordId: listing.mlsNumber,
    },
  });
  const classification = classifyProperty({
    subject,
    evidence,
    facts: {
      activeListing: true,
      hasSuite: listing.hasSuite,
      yearBuilt: listing.yearBuilt,
    },
  });
  const scope = capabilityScope(listing, classification.listingScope.value);
  const hasAvm = !!listing.preUsAdvantage?.triangulation.anchors.some((anchor) => anchor.kind === "avm");
  const hasMarket = !!listing.preUsAdvantage && (
    listing.preUsAdvantage.riskMomentum.hpiTrend5y != null ||
    listing.preUsAdvantage.riskMomentum.vacancyRate != null
  );
  const hasRisk = !!listing.preUsAdvantage?.riskMomentum.topPerils.length;
  const capabilities = evaluatePropertyCapabilities({
    subject,
    classification,
    facts: {
      addressSaleValue: hasAvm ? { available: true, scope, source: "persisted_rentcast_avm" } : undefined,
      // Discover enrichment intentionally skips address rent; do not infer it.
      activeListing: true,
      offerComputed: !!listing.preOffer,
      landImprovementSplit: {
        available: hasSplit(listing),
        scope: scope === "building" ? "building" : "parcel",
        source: "persisted_property_evidence",
      },
      countyMarketContext: hasMarket,
      countyRiskContext: hasRisk,
      insurancePrefillCore: !!(
        listing.address &&
        listing.yearBuilt &&
        parseInt(listing.sqft) > 0 &&
        evidence.propertyTypes.some((item) => item.availability === "available")
      ),
    },
  });
  const reviewReasons = [
    !persistedEvidence ? "missing_evidence_envelope" : null,
    classification.overallConfidence === "low" ? "low_overall_confidence" : null,
    classification.parcelUse.state === "conflicting" ? "conflicting_parcel_use" : null,
    classification.listingScope.value === "unknown" ? "unknown_listing_scope" : null,
    subject.requiresClarification ? "requires_clarification" : null,
    classification.parcelUse.confidence === "high" &&
      ["commercial", "mixed-use", "institutional", "land"].includes(classification.parcelUse.value)
      ? "high_confidence_unsupported_class"
      : null,
  ].filter((value): value is string => !!value);
  return {
    listing,
    country,
    surface,
    hasEvidence: !!persistedEvidence,
    subject,
    classification,
    capabilities,
    reviewReasons,
  };
});
const quotaAfter = await quotaValue();

const surfaceCounts: Record<string, number> = {};
const confidenceCounts: Record<string, number> = {};
const parcelUseCounts: Record<string, number> = {};
const listingScopeCounts: Record<string, number> = {};
const reviewReasonCounts: Record<string, number> = {};
const capabilityAvailable: Record<string, number> = {};
for (const row of rows) {
  increment(surfaceCounts, `${row.country}:${row.surface}:${row.hasEvidence ? "envelope" : "legacy"}`);
  increment(confidenceCounts, `${row.country}:${row.classification.overallConfidence}`);
  increment(parcelUseCounts, `${row.country}:${row.classification.parcelUse.value}`);
  increment(listingScopeCounts, `${row.country}:${row.classification.listingScope.value}`);
  row.reviewReasons.forEach((reason) => increment(reviewReasonCounts, reason));
  for (const [name, item] of Object.entries(row.capabilities.items)) {
    if (item.available) increment(capabilityAvailable, `${row.country}:${name}`);
  }
}

const rand = mulberry32(SEED);
const reviewPool = rows.filter((row) => row.reviewReasons.length > 0);
const reviewSample = [...reviewPool]
  .map((row) => ({ row, order: rand() }))
  .sort((a, b) => a.order - b.order)
  .slice(0, REVIEW_SAMPLE)
  .map(({ row }) => row);

console.log("P3.5 Discover shadow replay");
console.log(`seed=${SEED} listings=${rows.length} review_pool=${reviewPool.length} review_sample=${reviewSample.length}`);
console.log(`network: kv_reads=${kvReads} provider_calls=${providerCalls} rentcast_quota=${quotaBefore}->${quotaAfter}`);
console.log("\nSURFACES");
Object.entries(surfaceCounts).sort().forEach(([key, count]) => console.log(`${key}\t${count}`));
console.log("\nCONFIDENCE");
Object.entries(confidenceCounts).sort().forEach(([key, count]) => console.log(`${key}\t${count}`));
console.log("\nPARCEL_USE");
Object.entries(parcelUseCounts).sort().forEach(([key, count]) => console.log(`${key}\t${count}`));
console.log("\nLISTING_SCOPE");
Object.entries(listingScopeCounts).sort().forEach(([key, count]) => console.log(`${key}\t${count}`));
console.log("\nREVIEW_REASONS");
Object.entries(reviewReasonCounts).sort().forEach(([key, count]) => console.log(`${key}\t${count}`));
console.log("\nAVAILABLE_CAPABILITIES");
Object.entries(capabilityAvailable).sort().forEach(([key, count]) => console.log(`${key}\t${count}`));
console.log("\nREVIEW_SAMPLE");
for (const row of reviewSample) {
  console.log([
    row.country,
    row.listing.province,
    row.listing.city,
    row.listing.address,
    `surface=${row.surface}`,
    `scope=${row.classification.listingScope.value}`,
    `parcel=${row.classification.parcelUse.value}`,
    `confidence=${row.classification.overallConfidence}`,
    `review=${row.reviewReasons.join("|")}`,
  ].join("\t"));
}
console.log("\nEVIDENCE_ENVELOPE_SAMPLE");
for (const row of rows.filter((item) => item.hasEvidence).slice(0, REVIEW_SAMPLE)) {
  console.log([
    row.country,
    row.listing.province,
    row.listing.city,
    row.listing.address,
    `surface=${row.surface}`,
    `scope=${row.classification.listingScope.value}`,
    `parcel=${row.classification.parcelUse.value}`,
    `confidence=${row.classification.overallConfidence}`,
  ].join("\t"));
}

if (providerCalls !== 0 || quotaBefore !== quotaAfter) {
  throw new Error(`P3.5 replay violated quota invariant: provider_calls=${providerCalls}, quota=${quotaBefore}->${quotaAfter}`);
}
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
