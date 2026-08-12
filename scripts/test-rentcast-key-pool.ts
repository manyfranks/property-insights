/** Offline regression for production RentCast credential rotation. */

import assert from "node:assert/strict";

async function main() {
  const originalFetch = global.fetch;
  const prior = Object.fromEntries(
    [
      "RENTCAST_API_KEY",
      "RENTCAST_API_KEY_2",
      "RENTCAST_API_KEY_3",
      "RENTCAST_MONTHLY_QUOTA",
      "RENTCAST_SECONDARY_MONTHLY_QUOTA",
      "KV_REST_API_URL",
      "KV_REST_API_TOKEN",
    ].map((key) => [key, process.env[key]])
  );

  Object.assign(process.env, {
    RENTCAST_API_KEY: "primary-fixture-key",
    RENTCAST_API_KEY_2: "secondary-two-fixture-key",
    RENTCAST_API_KEY_3: "secondary-three-fixture-key",
    RENTCAST_MONTHLY_QUOTA: "2",
    RENTCAST_SECONDARY_MONTHLY_QUOTA: "1",
  });
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;

  const observedKeys: string[] = [];
  global.fetch = (async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    const headers = new Headers(init?.headers);
    observedKeys.push(headers.get("X-Api-Key") || "missing");
    if (url.pathname === "/v1/properties") {
      return Response.json([{
        formattedAddress: "1 Pool Test Ave, Testville, TX 75001",
        addressLine1: "1 Pool Test Ave",
        city: "Testville",
        state: "TX",
      }]);
    }
    if (url.pathname === "/v1/listings/sale") return Response.json([]);
    if (url.pathname === "/v1/avm/value") return Response.json({ price: 500_000 });
    if (url.pathname === "/v1/avm/rent/long-term") return Response.json({ rent: 2_500 });
    throw new Error(`Unexpected fixture path: ${url.pathname}`);
  }) as typeof fetch;

  try {
    const { getRentcastQuotaPoolStatus, getUSProperty } = await import("../src/lib/rentcast");
    const bundle = await getUSProperty("1 Pool Test Ave", "Testville", "TX", "75001");
    assert.equal(bundle.avm?.value, 500_000);
    assert.equal(bundle.rent?.value, 2_500);
    assert.deepEqual(observedKeys, [
      "secondary-two-fixture-key",
      "secondary-three-fixture-key",
      "primary-fixture-key",
      "primary-fixture-key",
    ]);
    const statuses = await getRentcastQuotaPoolStatus();
    assert.deepEqual(statuses.map(({ namespace, used, limit }) => ({ namespace, used, limit })), [
      { namespace: "quota2", used: 1, limit: 1 },
      { namespace: "quota-rentcast-api-key-3", used: 1, limit: 1 },
      { namespace: "quota", used: 2, limit: 2 },
    ]);
    console.log("\n3/3 RentCast key-pool checks passed\n");
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
