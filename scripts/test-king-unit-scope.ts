/**
 * Offline regression for King County shared-address/unit scope.
 *
 * Run: npx tsx scripts/test-king-unit-scope.ts
 */

import assert from "node:assert/strict";
import { lookupByAddress } from "../src/lib/assessment/us-county/king";

async function main() {
  const originalFetch = global.fetch;
  let calls = 0;

  global.fetch = (async (input) => {
    calls++;
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    const where = url.searchParams.get("where");

    if (where === "ADDR_FULL='1122 BROADWAY E'") {
      return Response.json({
        features: [{
          attributes: {
            ADDR_FULL: "1122 BROADWAY E",
            UNIT_NUM: "102      ",
            TAX_LNDVAL: 72_000,
            TAX_IMPR: 178_000,
            APPRLNDVAL: 72_000,
            APPR_IMPR: 178_000,
            KCTP_TAXYR: 2025,
          },
        }],
      });
    }

    if (where === "ADDR_FULL='209 N 41ST ST'") {
      return Response.json({
        features: [{
          attributes: {
            ADDR_FULL: "209 N 41ST ST",
            UNIT_NUM: null,
            TAX_LNDVAL: 600_000,
            TAX_IMPR: 300_000,
            APPRLNDVAL: 600_000,
            APPR_IMPR: 300_000,
            KCTP_TAXYR: 2025,
            LOTSQFT: 4_000,
          },
        }],
      });
    }

    throw new Error(`Unexpected King County fixture query: ${where}`);
  }) as typeof fetch;

  try {
    const sharedAddress = await lookupByAddress("1122 Broadway E");
    assert.equal(sharedAddress, null, "unit 102 must not be treated as the whole property");

    const parcel = await lookupByAddress("209 N 41st St");
    assert.equal(parcel?.assessedValue, 900_000);
    assert.equal(parcel?.assessmentBasis, "full_value");
    assert.equal(calls, 2);
    console.log("\n3/3 King County unit-scope checks passed\n");
  } finally {
    global.fetch = originalFetch;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
