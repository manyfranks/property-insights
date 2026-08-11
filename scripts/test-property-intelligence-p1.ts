import assert from "node:assert/strict";
import {
  addAssessmentEvidence,
  addRentCastEvidence,
  createPropertyEvidenceSnapshot,
  mergePropertyEvidence,
} from "../src/lib/property-intelligence/evidence";
import { buildUsListing } from "../src/lib/pipeline/us-assess";
import { mapDetailListing, mapSearchListing } from "../src/lib/zoocasa";
import type { Assessment } from "../src/lib/types";
import type { USPropertyBundle } from "../src/lib/rentcast";

let passed = 0;

function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

function availableValues<T>(items: Array<{ availability: string; value: T | null }>): T[] {
  return items
    .filter((item): item is { availability: "available"; value: T } => item.availability === "available")
    .map((item) => item.value);
}

const activeListing = {
  formattedAddress: "123 Main St, Austin, TX 78701",
  addressLine1: "123 Main St",
  city: "Austin",
  state: "TX",
  price: 625_000,
  status: "Active",
  listingType: "Standard",
  listedDate: "2026-08-01",
  daysOnMarket: 10,
  bedrooms: 3,
  bathrooms: 2,
  squareFootage: 1_800,
  propertyType: "Single Family",
  mlsNumber: "ACT-123",
  priceHistory: [],
};

const record = {
  formattedAddress: "123 Main St, Austin, TX 78701",
  addressLine1: "123 Main St",
  city: "Austin",
  state: "TX",
  zipCode: "78701",
  county: "Travis",
  latitude: 30.27,
  longitude: -97.74,
  propertyType: "Single Family",
  bedrooms: 3,
  bathrooms: 2,
  squareFootage: 1_800,
  lotSize: 7_200,
  yearBuilt: 1998,
  lastSaleDate: "2020-01-01",
  lastSalePrice: 410_000,
  taxAssessments: [{ year: 2025, value: 515_000, land: 210_000, improvements: 305_000 }],
  propertyTaxes: [{ year: 2025, total: 9_100 }],
  saleHistory: [],
  ownerOccupied: false,
};

const fullBundle: USPropertyBundle = {
  record,
  avm: null,
  rent: null,
  activeListing,
  meta: { quotaExhausted: false, cacheHits: 4, liveCalls: 0, errors: [] },
};

console.log("\nP1 property-evidence mapper fixtures\n");

test("Zoocasa search property_type survives with provider provenance", () => {
  const listing = mapSearchListing(
    { id: 11, address: "10 Oak St", price: 500_000, property_type: "House" },
    "Victoria",
    "bc"
  );
  assert.deepEqual(availableValues(listing.propertyEvidence!.propertyTypes), ["House"]);
  assert.equal(listing.propertyEvidence!.propertyTypes[0].source, "zoocasa_search");
});

test("Zoocasa detail type and subtype survive without collapsing", () => {
  const listing = mapDetailListing(
    {
      id: 12,
      price: 700_000,
      streetNumber: "20",
      streetName: "Pine Ave",
      city: "Victoria",
      province: "bc",
      addedAt: "2026-08-01",
      type: "Residential",
      propertySubType: "Apartment/Condo",
    },
    "Victoria",
    "bc",
    "402"
  );
  assert.deepEqual(availableValues(listing.propertyEvidence!.propertyTypes), ["Residential", "Apartment/Condo"]);
  assert.equal(listing.propertyEvidence!.input.parsedUnit.value, "402");
});

test("RentCast listing and property types both survive", () => {
  const listing = buildUsListing(fullBundle, "Austin", "TX");
  assert.deepEqual(availableValues(listing.propertyEvidence!.propertyTypes), ["Single Family", "Single Family"]);
  assert.deepEqual(listing.propertyEvidence!.propertyTypes.map((item) => item.source), [
    "rentcast_listing",
    "rentcast_property",
  ]);
});

test("RentCast ownerOccupied remains observed evidence, not investment intent", () => {
  const listing = buildUsListing(fullBundle, "Austin", "TX");
  assert.deepEqual(availableValues(listing.propertyEvidence!.occupancy), [false]);
  assert.equal(listing.propertyEvidence!.occupancy[0].kind, "observed");
  assert.equal("investmentIntent" in listing.propertyEvidence!, false);
});

test("RentCast land and improvement values retain assessment year", () => {
  const listing = buildUsListing(fullBundle, "Austin", "TX");
  assert.deepEqual(availableValues(listing.propertyEvidence!.landValues), [210_000]);
  assert.deepEqual(availableValues(listing.propertyEvidence!.buildingValues), [305_000]);
  assert.equal(listing.propertyEvidence!.landValues[0].sourceRecordId, "2025");
});

test("Discover seed records property endpoint fields as not queried", () => {
  const seed = buildUsListing(
    { ...fullBundle, record: null },
    "Austin",
    "TX",
    { surface: "discover_seed", recordQueried: false, listingQueried: true }
  );
  assert.equal(seed.propertyEvidence!.surface, "discover_seed");
  const recordType = seed.propertyEvidence!.propertyTypes.find((item) => item.source === "rentcast_property");
  assert.equal(recordType?.availability, "unavailable");
  assert.equal(recordType?.availability === "unavailable" ? recordType.reason : null, "not_queried");
  assert.equal(seed.propertyEvidence!.occupancy[0].availability, "unavailable");
});

test("Discover enrichment changes the tier without rewriting seed evidence", () => {
  const seed = buildUsListing(
    { ...fullBundle, record: null },
    "Austin",
    "TX",
    { surface: "discover_seed", recordQueried: false, listingQueried: true }
  ).propertyEvidence!;
  const enriched = addRentCastEvidence(
    createPropertyEvidenceSnapshot({ surface: "discover_enriched", normalizedAddress: "123 Main St" }),
    { record, listing: null, recordQueried: true, listingQueried: false }
  );
  const merged = mergePropertyEvidence(seed, enriched, "discover_enriched");
  assert.equal(merged.surface, "discover_enriched");
  assert.deepEqual(availableValues(merged.occupancy), [false]);
  assert.ok(merged.occupancy.some((item) => item.availability === "unavailable"));
});

test("Exact assessment input and selected Place ID survive unchanged", () => {
  const rawInput = "  123 Main St, Austin, TX 78701, USA  ";
  const snapshot = createPropertyEvidenceSnapshot({
    surface: "assess_on_demand",
    rawInput,
    normalizedAddress: "123 MAIN ST, AUSTIN, TX 78701",
    selectedPlaceId: "places/abc123",
  });
  assert.equal(snapshot.input.rawInput.value, rawInput);
  assert.equal(snapshot.input.selectedPlaceId.value, "places/abc123");
});

const assessment = (overrides: Partial<Assessment>): Assessment => ({
  totalValue: 800_000,
  landValue: 300_000,
  buildingValue: 500_000,
  assessmentYear: "2026",
  found: true,
  source: "government",
  evidenceClass: "observed",
  ...overrides,
});

test("BC assessment split is available when the adapter marks it supplied", () => {
  const snapshot = addAssessmentEvidence(
    createPropertyEvidenceSnapshot({ surface: "canada_listing" }),
    assessment({ totalValue: 500_000, landValue: 0, componentAvailability: "available" }),
    "BC"
  );
  assert.deepEqual(availableValues(snapshot.landValues), [0]);
  assert.deepEqual(availableValues(snapshot.buildingValues), [500_000]);
});

test("AB, ON, and MB legacy zero components become explicit unavailability", () => {
  for (const province of ["AB", "ON", "MB"]) {
    const snapshot = addAssessmentEvidence(
      createPropertyEvidenceSnapshot({ surface: "canada_listing" }),
      assessment({ landValue: 0, buildingValue: 0 }),
      province
    );
    assert.equal(snapshot.landValues[0].availability, "unavailable");
    assert.equal(snapshot.buildingValues[0].availability, "unavailable");
    assert.equal(
      snapshot.landValues[0].availability === "unavailable" ? snapshot.landValues[0].reason : null,
      "source_does_not_supply"
    );
  }
});

test("BC total-only cache sentinels are unavailable rather than meaningful zeroes", () => {
  const snapshot = addAssessmentEvidence(
    createPropertyEvidenceSnapshot({ surface: "canada_listing" }),
    assessment({ landValue: 369_000, buildingValue: 0, totalValue: 571_000, componentAvailability: "unavailable" }),
    "BC"
  );
  assert.equal(snapshot.landValues[0].availability, "unavailable");
  assert.equal(snapshot.buildingValues[0].availability, "unavailable");
});

test("Normalized envelope contains no owner names or mailing addresses", () => {
  const json = JSON.stringify(buildUsListing(fullBundle, "Austin", "TX").propertyEvidence);
  assert.equal(/ownerName|mailingAddress/i.test(json), false);
});

console.log(`\n${passed}/${passed} P1 fixtures passed\n`);
