import assert from "node:assert/strict";
import { normalizeAssessmentTerminology } from "../src/lib/pipeline/us-narrative";
import type { Assessment } from "../src/lib/types";

const countyMarketAssessment: Assessment = {
  found: true,
  totalValue: 922_000,
  landValue: 0,
  buildingValue: 0,
  assessmentYear: "2026",
  source: "government",
  liveCountySource: true,
  liveCountyValueKind: "market_value",
};

assert.equal(
  normalizeAssessmentTerminology(
    "The tax assessment supports the offer, while the tax-assessed value is below list.",
    countyMarketAssessment
  ),
  "The county assessor market value supports the offer, while the county assessor market value is below list."
);

assert.equal(
  normalizeAssessmentTerminology("The tax assessment supports the offer.", {
    ...countyMarketAssessment,
    liveCountyValueKind: "assessed_value",
  }),
  "The tax assessment supports the offer."
);

assert.equal(normalizeAssessmentTerminology("No government value is available.", null), "No government value is available.");

console.log("US narrative assessment-label tests passed (3/3)");
