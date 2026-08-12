/**
 * Offline regression for provider-canonical address chaining.
 *
 * Reproduces the production Queens case without contacting RentCast:
 *   input    51-20 69th Pl, Flushing, NY 11377
 *   provider 5120 69th Pl, Woodside, NY 11377
 *
 * Also covers Seattle's directional/suffix canonicalization:
 *   input    1625 Federal Avenue E
 *   provider 1625 Federal Ave E
 *
 * Run: npx tsx scripts/test-rentcast-canonical-address.ts
 */

import assert from "node:assert/strict";

async function main() {
  const priorEnv = {
    apiKey: process.env.RENTCAST_API_KEY,
    quota: process.env.RENTCAST_MONTHLY_QUOTA,
    kvUrl: process.env.KV_REST_API_URL,
    kvToken: process.env.KV_REST_API_TOKEN,
  };
  const originalFetch = global.fetch;

  process.env.RENTCAST_API_KEY = "offline-fixture-key";
  process.env.RENTCAST_MONTHLY_QUOTA = "50";
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;

  const calls: URL[] = [];
  global.fetch = (async (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    calls.push(url);

    if (url.searchParams.get("address")?.startsWith("404 Fixture")) {
      return new Response(JSON.stringify({ message: "not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname === "/v1/properties") {
      if (url.searchParams.get("address") === "1625 Federal Avenue E, Seattle, WA, 98102") {
        return Response.json([
          {
            formattedAddress: "1625 Federal Ave E, Seattle, WA 98102",
            addressLine1: "1625 Federal Ave E",
            city: "Seattle",
            state: "WA",
            zipCode: "98102",
            propertyType: "Single Family",
            bedrooms: 5,
            bathrooms: 4,
            squareFootage: 11520,
          },
        ]);
      }
      assert.equal(url.searchParams.get("address"), "51-20 69th Pl, Flushing, NY, 11377");
      assert.deepEqual([...url.searchParams.keys()], ["address"]);
      return Response.json([
        {
          formattedAddress: "5120 69th Pl, Woodside, NY 11377",
          addressLine1: "5120 69th Pl",
          city: "Woodside",
          state: "NY",
          zipCode: "11377",
          propertyType: "Single Family",
          bedrooms: 3,
          bathrooms: 2.5,
          squareFootage: 1831,
          yearBuilt: 1950,
        },
      ]);
    }

    const requestedAddress = url.searchParams.get("address");
    const isSeattle = requestedAddress === "1625 Federal Ave E, Seattle, WA 98102";
    assert.ok(isSeattle || requestedAddress === "5120 69th Pl, Woodside, NY 11377");
    assert.deepEqual([...url.searchParams.keys()], ["address"]);
    if (url.pathname === "/v1/avm/value") return Response.json({ price: isSeattle ? 8_100_000 : 950_000 });
    if (url.pathname === "/v1/avm/rent/long-term") return Response.json({ rent: isSeattle ? 18_000 : 4_200 });
    if (url.pathname === "/v1/listings/sale") {
      return Response.json([
        {
          formattedAddress: isSeattle
            ? "1625 Federal Ave E, Seattle, WA 98102"
            : "5120 69th Pl, Woodside, NY 11377",
          addressLine1: isSeattle ? "1625 Federal Ave E" : "5120 69th Pl",
          city: isSeattle ? "Seattle" : "Woodside",
          state: isSeattle ? "WA" : "NY",
          status: "Active",
          price: isSeattle ? 8_750_000 : 999_000,
          bedrooms: isSeattle ? 5 : 3,
          bathrooms: isSeattle ? 4 : 2.5,
          squareFootage: isSeattle ? 11520 : 1831,
        },
      ]);
    }
    throw new Error(`Unexpected fixture request: ${url}`);
  }) as typeof fetch;

  try {
    const { getRentcastQuotaStatus, getUSActiveListing, getUSProperty } = await import("../src/lib/rentcast");

    const bundle = await getUSProperty("51-20 69th Pl", "Flushing", "NY", "11377");
    assert.equal(bundle.record?.formattedAddress, "5120 69th Pl, Woodside, NY 11377");
    assert.equal(bundle.activeListing?.price, 999_000);
    assert.equal(bundle.avm?.value, 950_000);
    assert.equal(bundle.rent?.value, 4_200);
    assert.equal(bundle.meta.inputAddress, "51-20 69th Pl, Flushing, NY, 11377");
    assert.equal(bundle.meta.canonicalAddress, "5120 69th Pl, Woodside, NY 11377");
    assert.equal(bundle.meta.addressResolution, "provider_canonical");
    assert.equal(bundle.meta.propertyLookup, "completed");
    assert.equal(bundle.meta.listingLookup, "completed");
    assert.equal(calls.length, 4);
    assert.equal(calls[1].pathname, "/v1/listings/sale", "listing lookup must get quota priority");

    const seattle = await getUSProperty("1625 Federal Avenue E", "Seattle", "WA", "98102");
    assert.equal(seattle.record?.formattedAddress, "1625 Federal Ave E, Seattle, WA 98102");
    assert.equal(seattle.activeListing?.price, 8_750_000);
    assert.equal(seattle.meta.addressResolution, "provider_canonical");
    assert.equal(seattle.meta.propertyLookup, "completed");
    assert.equal(seattle.meta.listingLookup, "completed");
    assert.equal(calls.length, 8);

    const afterSuccess = await getRentcastQuotaStatus();
    assert.equal(afterSuccess.used, 8, "eight successful HTTP 200 responses should count");
    assert.equal(afterSuccess.limit, 50);

    const missing = await getUSActiveListing("404 Fixture Ave", "Testville", "NY", "10001");
    assert.equal(missing, null);
    const after404 = await getRentcastQuotaStatus();
    assert.equal(after404.used, 8, "a non-billable 404 must release its reserved slot");

    console.log("\n12/12 RentCast canonical-address/accounting checks passed\n");
  } finally {
    global.fetch = originalFetch;
    if (priorEnv.apiKey === undefined) delete process.env.RENTCAST_API_KEY;
    else process.env.RENTCAST_API_KEY = priorEnv.apiKey;
    if (priorEnv.quota === undefined) delete process.env.RENTCAST_MONTHLY_QUOTA;
    else process.env.RENTCAST_MONTHLY_QUOTA = priorEnv.quota;
    if (priorEnv.kvUrl === undefined) delete process.env.KV_REST_API_URL;
    else process.env.KV_REST_API_URL = priorEnv.kvUrl;
    if (priorEnv.kvToken === undefined) delete process.env.KV_REST_API_TOKEN;
    else process.env.KV_REST_API_TOKEN = priorEnv.kvToken;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
