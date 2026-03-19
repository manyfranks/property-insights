/**
 * Test: Calgary SODA quadrant fix + LLM retry
 *
 * Fetches a Zoocasa listing by URL, runs it through the enrichment pipeline,
 * and verifies that:
 * 1. Calgary SODA assessment lookup works without quadrant in address
 * 2. LLM narrative is generated (not deterministic fallback)
 *
 * Usage: npx tsx scripts/test-pipeline-fix.ts [zoocasa-url]
 *
 * Default test URL: https://www.zoocasa.com/calgary-ab-real-estate/pump-hill/119-pumpmeadow-pl-sw
 */

import { readFileSync } from "fs";

// Load .env.local
const envContent = readFileSync(".env.local", "utf-8");
for (const line of envContent.split("\n")) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, "");
}

import { fetchDetailByUrl, fetchSoldListings } from "../src/lib/zoocasa";
import { lookupAB } from "../src/lib/assessment/ab";
import { enrichListing } from "../src/lib/pipeline/enrich";

const DEFAULT_URL = "https://www.zoocasa.com/calgary-ab-real-estate/pump-hill/119-pumpmeadow-pl-sw";

async function main() {
  const url = process.argv[2] || DEFAULT_URL;
  console.log(`\n=== Pipeline Fix Test ===\n`);
  console.log(`URL: ${url}\n`);

  // Step 1: Fetch Zoocasa listing
  console.log("--- Step 1: Fetch Zoocasa detail ---");
  const detail = await fetchDetailByUrl(url);
  const listing = detail.listing;
  console.log(`  Address:  ${listing.address}`);
  console.log(`  City:     ${listing.city}`);
  console.log(`  Province: ${listing.province}`);
  console.log(`  Price:    $${listing.price.toLocaleString()}`);
  console.log(`  Beds:     ${listing.beds}`);
  console.log(`  Baths:    ${listing.baths}`);
  console.log(`  Sqft:     ${listing.sqft || "unknown"}`);
  console.log(`  DOM:      ${listing.dom}`);
  console.log(`  Has suite: ${listing.hasSuite}`);
  console.log(`  Description: ${(listing.description || "").slice(0, 100)}...`);

  const hasQuadrant = /\b(NW|NE|SW|SE)\b/i.test(listing.address);
  console.log(`  Quadrant in address: ${hasQuadrant ? "YES" : "NO (← this is what we fixed)"}`);

  // Step 2: Test SODA lookup directly
  console.log("\n--- Step 2: Assessment lookup (SODA) ---");
  const assessment = await lookupAB(listing.address, listing.unit, listing.city);
  if (assessment?.found) {
    console.log(`  PASS: Assessment found`);
    console.log(`  Value:  $${assessment.totalValue.toLocaleString()}`);
    console.log(`  Source: ${assessment.source}`);
    console.log(`  Year:   ${assessment.assessmentYear}`);
    if (assessment.landValue) console.log(`  Land:   $${assessment.landValue.toLocaleString()}`);
    if (assessment.buildingValue) console.log(`  Building: $${assessment.buildingValue.toLocaleString()}`);
  } else {
    console.log(`  FAIL: No assessment found — SODA lookup still failing`);
  }

  // Step 3: Fetch sold pool for comparables
  console.log("\n--- Step 3: Sold pool ---");
  let soldPool: Awaited<ReturnType<typeof fetchSoldListings>> = [];
  try {
    soldPool = await fetchSoldListings(listing.city, listing.province);
    console.log(`  ${soldPool.length} sold listings fetched`);
  } catch (err) {
    console.log(`  Sold pool fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Step 4: Full pipeline enrichment
  console.log("\n--- Step 4: Full enrichment (forceLlm=true) ---");
  const enriched = await enrichListing(listing, { forceLlm: true, soldPool });

  console.log(`  Score:  ${enriched.preScore}`);
  console.log(`  Tier:   ${enriched.preTier}`);
  console.log(`  Signals: ${enriched.preSignals?.join(", ") || "none"}`);

  if (enriched.preOffer) {
    console.log(`  Offer:  $${enriched.preOffer.final_offer.toLocaleString()} (${(enriched.preOffer.pct_of_list * 100).toFixed(1)}% of list)`);
    console.log(`  Anchor tag: ${enriched.preOffer.anchor_tag}`);
    console.log(`  DOM tag: ${enriched.preOffer.dom_tag}`);
    console.log(`  Savings: $${enriched.preOffer.savings.toLocaleString()}`);
  }

  if (enriched.preAssessment) {
    console.log(`  Assessment source: ${enriched.preAssessment.source}`);
    console.log(`  Assessment value: $${enriched.preAssessment.totalValue.toLocaleString()}`);
  } else {
    console.log(`  Assessment: none (using language model)`);
  }

  if (enriched.preComparables) {
    console.log(`  Comparables: ${enriched.preComparables.matchedCount} matched (${enriched.preComparables.confidence} confidence)`);
  }

  // Step 5: Verify narrative quality
  console.log("\n--- Step 5: Narrative quality check ---");
  const narrative = enriched.preNarrative || "";
  const isDeterministic = narrative.includes("Monitor for price reductions or increased market time")
    || narrative.includes("WATCH only; check back");
  const hasMultipleParagraphs = (narrative.match(/\n\n/g) || []).length >= 1;

  console.log(`  Length: ${narrative.length} chars`);
  console.log(`  Deterministic template: ${isDeterministic ? "YES (← LLM failed)" : "NO (LLM generated)"}`);
  console.log(`  Multi-paragraph: ${hasMultipleParagraphs ? "YES" : "NO"}`);
  console.log(`\n  Narrative:\n  ${narrative.replace(/\n\n/g, "\n\n  ")}\n`);

  // Summary
  console.log("=== Results ===");
  const assessPass = assessment?.found && assessment.source === "government";
  const narrativePass = !isDeterministic && narrative.length > 200;
  console.log(`  Assessment fix: ${assessPass ? "PASS" : "FAIL"} (source=${assessment?.source || "none"})`);
  console.log(`  LLM narrative:  ${narrativePass ? "PASS" : "FAIL"} (${narrative.length} chars, deterministic=${isDeterministic})`);
  console.log();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
